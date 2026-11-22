import {create, launch, launchExtension, note, PASSWORD, unlock} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {submitExtensionLogin} from './extension.mjs';
import {backupFixture,importExpression} from './backup-fixture.mjs';
import {decodeV2,payloadHash} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';
import {validateNote} from '../../js/note-model.js';
import {vaultFixture} from './vault-core.mjs';
import {assertReadsMergedCopy,exportFromApp} from './recovery-tool.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function run({check,assert}) {
  await integration({check,assert});
  await reviewMerge({check,assert});
  await e2e({check,assert});
  await check('H2a.0 permanent deletions and their tombstones commit or roll back together',async()=>{
    const browser=await launchExtension();
    try {
      const page=await browser.page(undefined,folderFixtureSource());
      await create(page);
      const seeded=[
        note({title:'Single deletion'}),
        note({title:'Batch deletion'}),
        note({title:'Unreadable record'}),
        note({title:'Expired Trash entry',deletedAt:1}),
      ];
      const evidence=await page.eval(`(async()=>{
        const db=await import('./js/db.js'),app=await import('./js/app.js');
        const {purgeTrash}=await import('./js/trash.js');
        const notes=${JSON.stringify(seeded)};
        for(const item of notes) await app.saveNote(item);
        const damaged={...await db.getNoteRecord(notes[2].id),ciphertext:'damaged'};
        await db.saveNoteRecord(damaged);
        const initial=await db.readVault();
        const stored=notes.map(item=>initial.notes.find(record=>record.id===item.id));
        const get=IDBObjectStore.prototype.put;
        const del=IDBObjectStore.prototype.delete;
        let failAt, active, seen=[];
        IDBObjectStore.prototype.put=function(row){
          if(row.key==='tombstones'){
            if(failAt==='tombstone') throw Error('Fictional tombstone write failure');
            seen.push(this.transaction);
          }
          return get.call(this,row);
        };
        IDBObjectStore.prototype.delete=function(id){
          if(this.name==='notes'){
            if(failAt==='delete') throw Error('Fictional note delete failure');
            active=this.transaction;
          }
          return del.call(this,id);
        };
        const operations=[
          async()=>{const {meta}=await db.readVault();const {id,updatedAt}=stored[0];
            return db.guardedNoteWrite({id,knownUpdatedAt:updatedAt,expectedVaultId:meta.vaultId});},
          async()=>{const {meta}=await db.readVault();const {id,updatedAt}=stored[1];
            return db.guardedNoteBatch([{id,knownUpdatedAt:updatedAt,record:null}],{expectedVaultId:meta.vaultId});},
          async()=>{const snapshot=await db.readVault();
            return db.discardPreservedRecord(damaged,snapshot.meta,{snapshotJSON:JSON.stringify(snapshot)});},
          ()=>purgeTrash(app.getNotes(),app.permanentDeleteNote),
        ];
        const results=[];
        for(const [index,operation] of operations.entries()){
          const before=JSON.stringify(await db.readVault());
          const rollbacks=[];
          for(const point of ['tombstone','delete']){
            failAt=point;
            let error;
            try{await operation();}catch(caught){error=caught.message;}
            rollbacks.push([error,before===JSON.stringify(await db.readVault())]);
          }
          failAt=null;active=null;seen=[];
          let committed,error;
          try{await operation();}catch(caught){error=caught.message;}
          const after=await db.readVault(),id=notes[index].id;
          committed=!after.notes.some(record=>record.id===id)&&after.meta.tombstones?.some(row=>row.id===id&&row.deletedAt>=notes[index].updatedAt);
          results.push({rollbacks,error,committed:!!committed,sameTransaction:!!active&&seen.includes(active)});
        }
        db.setWriteMode('readOnly');
        folderTest.clear();
        const before=JSON.stringify(await db.readVault());
        const rejected=[];
        for(const operation of operations.slice(0,3)){
          try{await operation();}catch(error){rejected.push(error.code);}
        }
        return {results,rejected,writes:folderTest.writes,unchanged:before===JSON.stringify(await db.readVault())};
      })()`);
      for(const result of evidence.results){
        assert.deepEqual(result.rollbacks,[['Fictional tombstone write failure',true],['Fictional note delete failure',true]]);
        assert.equal(result.error,undefined);
        assert.equal(result.committed,true);
        assert.equal(result.sameTransaction,true);
      }
      assert.deepEqual(evidence.rejected,Array(3).fill('vault.readOnly'));
      assert.deepEqual(evidence.writes,{});
      assert.ok(evidence.unchanged);
    } finally {await browser.close();}
  });

  await check('H2a.0 deletion prunes old and excess tombstones while recording the new deletion',async()=>{
    const browser=await launchExtension();
    try {
      const page=await browser.page(undefined,folderFixtureSource());
      await create(page);
      const result=await page.eval(`(async()=>{
        const db=await import('./js/db.js'),app=await import('./js/app.js');
        const now=Date.now(),item=${JSON.stringify(note())};
        const rows=Array.from({length:10000},(_,i)=>({id:crypto.randomUUID(),deletedAt:now-20000+i}));
        rows.push({id:crypto.randomUUID(),deletedAt:now-366*86400000});
        await app.saveNote(item);
        await db.saveMeta('tombstones',rows);
        const {meta}=await db.readVault(),record=await db.getNoteRecord(item.id);
        await db.guardedNoteWrite({id:item.id,knownUpdatedAt:record.updatedAt,expectedVaultId:meta.vaultId});
        const retained=await db.getMeta('tombstones'),ids=new Set(retained.map(row=>row.id));
        return [retained.length,ids.has(rows[0].id),ids.has(rows.at(-1).id),ids.has(item.id)];
      })()`);
      assert.deepEqual(result,[10000,false,false,true]);
    } finally {await browser.close();}
  });
}

const primary='keeplocal-vault.keeplocal';
export {withTwoProfiles,connectBoth,relogin,waitForRev,editNote,ready,focus};
const attach=page=>page.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");

async function relogin(page,{granted=true}={}) {
  await page.reload();
  if(granted) await page.eval("folderTest.permission='granted'");
  await submitExtensionLogin(page);
}

async function waitForRev(page,rev) {
  await page.until(`(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev===${rev})`);
}

function putNote(page,item) {
  return page.eval(`(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
}

function editNote(page,id,patch) {
  return page.eval(`(async()=>{
    const app=await import('./js/app.js');
    const item=app.getNotes().find(note=>note.id===${JSON.stringify(id)});
    await app.saveNote(item,{change:draft=>Object.assign(draft,${JSON.stringify(patch)})});
  })()`);
}

function editFromOtherTab(page,id,content) {
  return page.eval(`(async()=>{
    const db=await import('./js/db.js'),crypto=await import('./js/crypto.js');
    const {notes,meta}=await db.readVault();
    const id=${JSON.stringify(id)},record=notes.find(note=>note.id===id);
    const key=await crypto.deriveKey(${JSON.stringify(PASSWORD)},crypto.base64ToArray(meta.salt));
    const original=JSON.parse(await crypto.decrypt(key,crypto.base64ToArray(record.iv),crypto.base64ToArray(record.ciphertext)));
    const updatedAt=Math.max(Date.now(),record.updatedAt+1);
    const {iv,ciphertext}=await crypto.encrypt(key,JSON.stringify({...original,updatedAt,content:${JSON.stringify(content)}}));
    const mode=db.isReadOnly()?'readOnly':'readWrite';
    db.setWriteMode('readWrite');
    try{
      await db.guardedNoteWrite({id,knownUpdatedAt:record.updatedAt,expectedVaultId:meta.vaultId,
        record:{id,updatedAt,iv:crypto.arrayToBase64(iv),ciphertext:crypto.arrayBufferToBase64(ciphertext)}});
    }finally{db.setWriteMode(mode);}
  })()`);
}

const loaded=page=>page.eval("(await import('./js/app.js')).getNotes()");
const ready=page=>page.until("!!document.querySelector('.app-view #main-inner')?.firstElementChild");
const focus=page=>page.eval("window.dispatchEvent(new Event('focus'))");

async function withTwoProfiles(run,timeouts) {
  const first=await launchExtension();
  try {
    const second=await launchExtension();
    try {
      const a=await first.page(undefined,folderFixtureSource('KL-TEST-H2A-PC-A',timeouts));
      const b=await second.page(undefined,folderFixtureSource('KL-TEST-H2A-PC-B',timeouts));
      await run(a,b);
    } finally {await second.close();}
  } finally {await first.close();}
}

async function connectBoth(a,b,notes,startRev=1) {
  await create(a);
  for(const item of notes) await putNote(a,item);
  if(startRev>1) await a.eval(`(await import('./js/db.js')).saveMeta('exportRev',${startRev-1})`);
  await attach(a);
  await relogin(a);
  await waitForRev(a,startRev);
  const file=await readFolderFixture(a,primary);
  await b.eval(importExpression(file));
  await b.reload();
  await unlock(b);
  await attach(b);
  await writeFolderFixture(b,primary,file);
  await relogin(b);
  await waitForRev(b,startRev);
  await ready(b);
  return file;
}

async function decodedNotes(bytes) {
  const {key,payload}=await decodeV2(Buffer.from(bytes,'base64'),PASSWORD);
  return {payload,notes:await decryptRecords(payload.notes,key)};
}

async function integration({check,assert}) {
  await check('H2a.9c a new 65th writer writes a valid pruned file through the folder controller',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource('KL-TEST-H29-PRUNE'));
      const item=note({title:'Fictitious long-lived vault',content:'Fictitious recovered content'});
      const fixture=await backupFixture([item]);
      const clock=Object.fromEntries(Array.from({length:64},(_,i)=>[
        `f0650000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,1,
      ]));
      const file=await fixture.seal({...fixture.payload,clock});
      await page.eval(importExpression(file));
      await page.reload();
      await unlock(page);
      await attach(page);
      await relogin(page);
      await settleFocus(page);
      await waitForRev(page,1);
      const {payload,notes}=await decodedNotes(await readFolderFixture(page,primary));
      const meta=await page.eval("(await import('./js/db.js')).readVault().then(snapshot=>snapshot.meta)");
      assert.equal(Object.keys(payload.clock).length,64);
      assert.equal(payload.clock[meta.writerId],1);
      assert.equal(Object.hasOwn(payload.clock,Object.keys(clock)[0]),false);
      assert.equal(meta.writerCount,1);
      assert.equal(meta.folderPendingWrite,undefined);
      assert.deepEqual(meta.exportClock,payload.clock);
      assert.deepEqual(notes.map(note=>note.content),[item.content]);
    }finally{await browser.close();}
  });

  await check('H2a.9b E10 discarded merge uses the joined head as a base without a false copy',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictitious A-only note'}),y=note({title:'Fictitious B-only note'});
      await connectBoth(a,b,[x,y]);
      await editNote(a,x.id,{content:'A first edit'});
      await settleFocus(a);
      await waitForRev(a,2);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await editNote(b,y.id,{content:'B edit'});
      await settleFocus(b);
      await waitForRev(b,3);
      assert.deepEqual((await loaded(b)).map(note=>note.content).sort(),['A first edit','B edit']);
      await editNote(a,x.id,{content:'A second edit'});
      await settleFocus(a);
      await waitForRev(a,3);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await settleFocus(b);
      await waitForRev(b,4);
      const expected=['A second edit','B edit'];
      assert.deepEqual((await loaded(b)).map(note=>note.content).sort(),expected);
      assert.ok(!(await b.eval('folderTest.entries()')).includes('keeplocal-preserved'));
      await writeFolderFixture(a,primary,await readFolderFixture(b,primary));
      await settleFocus(a);
      await waitForRev(a,4);
      assert.deepEqual((await loaded(a)).map(note=>note.content).sort(),expected);
      assert.ok(!(await a.eval('folderTest.entries()')).includes('keeplocal-preserved'));
    });
  });

  for(const mode of ['race','reopen','control']){
    const code=mode==='reopen'?'E9':mode==='control'?'E8c':'E8';
    await check(`H2a.9a ${code} unsaved local edit survives an interrupted merge without a false copy`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const x=note({title:'Fictitious pending X'}),y=note({title:'Fictitious pending Y'});
        await connectBoth(a,b,[x,y]);
        await editNote(a,y.id,{content:'A edited Y'});
        await settleFocus(a);
        await waitForRev(a,2);
        await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
        await b.eval(`(()=>{
          const create=FileSystemFileHandle.prototype.createWritable;
          FileSystemFileHandle.prototype.createWritable=async function(...args){
            const stream=await create.apply(this,args);
            if(this.name===${JSON.stringify(primary)}&&!window.pendingMergePaused){
              const close=stream.close.bind(stream);
              stream.close=async()=>{await close();window.pendingMergePaused=true;
                await new Promise(resolve=>{window.resumePendingMerge=resolve;});};
            }
            return stream;
          };
        })()`);
        await editNote(b,x.id,{content:'B first unsaved edit'});
        await focus(b);
        await b.until('window.pendingMergePaused===true');
        const first=await decodedNotes(await readFolderFixture(b,primary));
        assert.deepEqual(first.notes.map(note=>note.content).sort(),['A edited Y','B first unsaved edit']);
        const finalContent=mode==='control'?'B first unsaved edit':'B second edit';
        if(mode==='reopen'){
          await b.reload();
          await editFromOtherTab(b,x.id,finalContent);
          await relogin(b);
        }else{
          if(mode==='race')await editFromOtherTab(b,x.id,finalContent);
          await b.eval('window.resumePendingMerge()');
        }
        await ready(b);
        await settleFocus(b);
        await waitForRev(b,mode==='control'?3:4);
        const expected=['A edited Y',finalContent].sort();
        assert.deepEqual((await loaded(b)).map(note=>note.content).sort(),expected);
        assert.deepEqual((await decodedNotes(await readFolderFixture(b,primary))).notes.map(note=>note.content).sort(),expected);
        assert.ok(!(await b.eval('folderTest.entries()')).includes('keeplocal-preserved'));
        assert.equal(await b.eval("(await import('./js/db.js')).getMeta('folderPendingWrite')"),null);
      });
    });
  }

  await check('H2a.9a reservation failure rolls back counter and pending base before any file write',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictitious failed reservation'});
      await connectBoth(a,b,[item]);
      await editNote(a,item.id,{content:'Fictitious next version'});
      const result=await a.eval(`(await import('./js/folder-write.js')).withVaultLineage(async()=>{
        const db=await import('./js/db.js'),{createFolderWriter}=await import('./js/folder-write.js');
        const snapshot=await db.readVault(),handle=await folderTest.directory();
        const writer=createFolderWriter(handle,(await import('./js/app.js')).getCryptoKey(),new AbortController().signal);
        const original=await (await handle.getFileHandle(${JSON.stringify(primary)})).getFile();
        const before=Array.from(new Uint8Array(await original.arrayBuffer()));
        const state=await writer.scan(snapshot.meta.salt),put=IDBObjectStore.prototype.put;
        const result=[];
        for(const field of ['writerCount','folderPendingWrite']){
          const attempts=folderTest.writeAttempts;
          IDBObjectStore.prototype.put=function(row){
            if(row.key===field)throw Error('Fictitious reservation failure');
            return put.call(this,row);
          };
          let failed=false;
          try{await writer.write(snapshot,state);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
          const file=await (await handle.getFileHandle(${JSON.stringify(primary)})).getFile();
          result.push({failed,unchanged:JSON.stringify(snapshot)===JSON.stringify(await db.readVault()),
            attempts:folderTest.writeAttempts-attempts,bytes:JSON.stringify(before)===JSON.stringify(Array.from(new Uint8Array(await file.arrayBuffer())))});
        }
        return result;
      })`);
      assert.deepEqual(result,[0,1].map(()=>({failed:true,unchanged:true,attempts:0,bytes:true})));
    });
  });

  await check('H2a.8a folder clocks commit with their hashes and keep each writer local',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictitious clock fixture'});
      await connectBoth(a,b,[item]);
      const snapshot=page=>page.eval("(await import('./js/db.js')).readVault()");
      const first=(await snapshot(a)).meta;
      const adopted=(await snapshot(b)).meta;
      assert.match(first.writerId,/^[a-f0-9-]{36}$/);
      assert.equal(first.writerCount,1);
      assert.deepEqual(first.exportClock,{[first.writerId]:1});
      assert.deepEqual(first.folderSyncedClock,first.exportClock);
      assert.deepEqual(adopted.exportClock,first.exportClock);
      assert.deepEqual(adopted.folderSyncedClock,first.exportClock);
      assert.equal(adopted.writerId,undefined);

      await editNote(b,item.id,{content:'PC B made a fictional change'});
      await settleFocus(b);
      await waitForRev(b,2);
      const written=(await snapshot(b)).meta;
      assert.match(written.writerId,/^[a-f0-9-]{36}$/);
      assert.notEqual(written.writerId,first.writerId);
      assert.equal(written.writerCount,1);
      const expected={[first.writerId]:1,[written.writerId]:1};
      const file=await readFolderFixture(b,primary);
      const {payload,payloadText}=await decodeV2(Buffer.from(file,'base64'),PASSWORD);
      assert.deepEqual(payload.clock,expected);
      assert.equal(written.exportParent,await payloadHash(payloadText));
      assert.deepEqual(written.exportClock,expected);
      assert.deepEqual(written.folderSyncedClock,expected);

      const exported=await exportFromApp(b);
      assert.deepEqual((await decodeV2(Buffer.from(exported,'base64'),PASSWORD)).payload.clock,expected);
      assert.equal((await snapshot(b)).meta.writerCount,1);
      await writeFolderFixture(a,primary,file);
      await relogin(a);
      await ready(a);
      const pulled=(await snapshot(a)).meta;
      assert.equal(pulled.writerId,first.writerId);
      assert.equal(pulled.writerCount,1);
      assert.deepEqual(pulled.exportClock,expected);
      assert.deepEqual(pulled.folderSyncedClock,expected);

      const rollback=await a.eval(`(async()=>{
        const db=await import('./js/db.js');
        const snapshot=await db.readVault();
        const head=(await import('./js/folder-vault.js')).readFolderState;
        const current=(await head(await folderTest.directory(),(await import('./js/app.js')).getCryptoKey(),snapshot.meta.salt)).head;
        const put=IDBObjectStore.prototype.put;
        const results=[];
        try{
          for(const key of ['exportClock','folderSyncedClock','writerCount','folderSyncedBases']){
            IDBObjectStore.prototype.put=function(row){
              if(row.key===key)throw Error('Fictional clock transaction failure');
              return put.call(this,row);
            };
            let failed=false;
            try{await db.recordFolderWrite(snapshot.meta,current,{adopt:true});}catch{failed=true;}
            results.push(failed&&JSON.stringify(snapshot)===JSON.stringify(await db.readVault()));
          }
        }finally{IDBObjectStore.prototype.put=put;}
        return results;
      })()`);
      assert.deepEqual(rollback,[true,true,true,true]);
    });
  });

  for(const writes of [34,100]){
    await check(`H2a.8b E6 loads ${writes} writes made while the other PC was closed without conflict copies`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const y=note({title:'Fictitious Y',content:'Original'}),z=note({title:'Fictitious Z',content:'Original'});
        await connectBoth(a,b,[y,z]);
        await b.reload();
        await editNote(a,z.id,{content:'PC A edited Z once'});
        await settleFocus(a);
        await waitForRev(a,2);
        for(let index=1;index<writes;index++){
          await editNote(a,y.id,{content:`PC A edit ${index}`});
          await settleFocus(a);
          await waitForRev(a,index+2);
        }
        const file=await readFolderFixture(a,primary);
        const {payload}=await decodedNotes(file);
        assert.equal(payload.ancestors.length,32);
        await writeFolderFixture(b,primary,file);
        await relogin(b);
        await ready(b);
        assert.deepEqual((await loaded(b)).map(note=>[note.id,note.content]).sort(),[
          [y.id,`PC A edit ${writes-1}`],[z.id,'PC A edited Z once'],
        ].sort());
        assert.equal(await b.eval("!!document.querySelector('.folder-review')"),false);
        assert.equal(await b.eval('folderTest.writeAttempts'),0);
        assert.equal(await readFolderFixture(b,primary),file);
        assert.ok(!(await b.eval('folderTest.entries()')).includes('keeplocal-preserved'));
        assert.match(await b.eval("document.querySelector('#toast-container').textContent"),new RegExp(`Loaded revision ${writes+1}`));
      });
    });
  }

  await check('H2a.8b reopening after a merged folder write resumes application without a conflict copy',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictitious interrupted X'}),y=note({title:'Fictitious interrupted Y'});
      await connectBoth(a,b,[x,y]);
      for(const [page,item,content] of [[b,x,'PC B before closing'],[a,y,'PC A before closing']]){
        await editNote(page,item.id,{content});
        await settleFocus(page);
        await waitForRev(page,2);
      }
      const {meta:before}=await b.eval("(await import('./js/db.js')).readVault()");
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      const {identifier}=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const create=FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable=async function(...args){
          const stream=await create.apply(this,args);
          if(this.name===${JSON.stringify(primary)}&&!window.interruptedWrite){
            const close=stream.close.bind(stream);
            stream.close=async()=>{
              await close();
              window.interruptedWrite=true;
              await new Promise(resolve=>{window.resumeInterruptedWrite=resolve;});
            };
          }
          return stream;
        };
      })()`});
      await relogin(b);
      await b.until("typeof window.resumeInterruptedWrite==='function'");
      const merged=await readFolderFixture(b,primary);
      assert.equal((await decodedNotes(merged)).payload.rev,3);
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('writerCount')"),before.writerCount+1);
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('folderSeenRev')"),2);
      await editFromOtherTab(b,x.id,'PC B edited after the folder write');
      await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
      await relogin(b);
      await ready(b);
      await waitForRev(b,4);
      assert.deepEqual((await loaded(b)).map(note=>note.content).sort(),['PC A before closing','PC B edited after the folder write']);
      const recovered=await decodedNotes(await readFolderFixture(b,primary));
      assert.deepEqual(recovered.notes.map(note=>note.content).sort(),['PC A before closing','PC B edited after the folder write']);
      assert.equal(await b.eval('folderTest.writeAttempts'),1);
      assert.ok(!(await b.eval('folderTest.entries()')).includes('keeplocal-preserved'));
      const {meta:resumed}=await b.eval("(await import('./js/db.js')).readVault()");
      assert.equal(resumed.writerId,before.writerId);
      assert.equal(resumed.writerCount,before.writerCount+2);
      await editNote(b,x.id,{content:'PC B continued after reopening'});
      await settleFocus(b);
      await waitForRev(b,5);
      const continued=await decodedNotes(await readFolderFixture(b,primary));
      assert.equal(continued.payload.clock[before.writerId],before.writerCount+3);
    });
  });

  for(const keepFile of [true,false]){
    await check(`H2a.8c interrupted normal write resumes its counter when the file is ${keepFile?'retained':'lost'}`,async()=>{
      const browser=await launchExtension();
      try{
        const page=await browser.page(undefined,folderFixtureSource('KL-TEST-H28-COUNTER'));
        await create(page);
        const item=note({title:'Fictitious interrupted counter'});
        await putNote(page,item);
        await attach(page);
        await relogin(page);
        await waitForRev(page,1);
        const prior=await readFolderFixture(page,primary);
        const {meta}=await page.eval("(await import('./js/db.js')).readVault()");
        await page.eval(`(()=>{
          const create=FileSystemFileHandle.prototype.createWritable;
          FileSystemFileHandle.prototype.createWritable=async function(...args){
            const stream=await create.apply(this,args);
            if(this.name===${JSON.stringify(primary)}&&!window.counterPaused){
              const close=stream.close.bind(stream);
              stream.close=async()=>{
                await close();
                window.counterPaused=true;
                await new Promise(resolve=>{window.resumeCounter=resolve;});
              };
            }
            return stream;
          };
        })()`);
        await editNote(page,item.id,{content:'Fictional content before closing'});
        await focus(page);
        await page.until("typeof resumeCounter==='function'");
        const pending=await readFolderFixture(page,primary);
        assert.equal((await decodedNotes(pending)).payload.clock[meta.writerId],2);
        const reservedCount=await page.eval("(await import('./js/db.js')).getMeta('writerCount')");
        await page.reload();
        if(!keepFile)await writeFolderFixture(page,primary,prior);
        await page.eval("folderTest.permission='granted'");
        await submitExtensionLogin(page);
        await ready(page);
        await settleFocus(page);
        await waitForRev(page,2);
        const recovered=await decodedNotes(await readFolderFixture(page,primary));
        assert.equal(recovered.payload.clock[meta.writerId],keepFile?2:3);
        assert.equal(reservedCount,2);
        assert.deepEqual(recovered.notes.map(note=>note.content),['Fictional content before closing']);
        assert.equal(await page.eval("(await import('./js/db.js')).getMeta('writerCount')"),keepFile?2:3);
        const continued=await page.eval("(await import('./js/db.js')).readVault()");
        assert.equal(continued.meta.writerId,meta.writerId);
        await editNote(page,item.id,{content:'Fictional next edit'});
        await settleFocus(page);
        await waitForRev(page,3);
        assert.equal((await decodedNotes(await readFolderFixture(page,primary))).payload.clock[meta.writerId],keepFile?3:4);

        if(keepFile){
          await page.eval(`(await import('./js/account.js')).resetVault((await import('./js/i18n.js')).t('account.resetWord'))`);
          await page.reload();
          await create(page);
          await page.eval("folderTest.name='KL-TEST-H28-RESET'");
          await attach(page);
          await relogin(page);
          await waitForRev(page,1);
          const reset=await page.eval("(await import('./js/db.js')).readVault()");
          assert.notEqual(reset.meta.writerId,meta.writerId);
          assert.equal(reset.meta.writerCount,1);
          assert.deepEqual(reset.meta.exportClock,{[reset.meta.writerId]:1});
        }
      }finally{await browser.close();}
    });
  }

  await check('H2a.8c reopening after a merged folder write resumes application without a conflict copy',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictitious interrupted X'}),y=note({title:'Fictitious interrupted Y'});
      await connectBoth(a,b,[x,y]);
      for(const [page,item,content] of [[b,x,'PC B before closing'],[a,y,'PC A before closing']]){
        await editNote(page,item.id,{content});
        await settleFocus(page);
        await waitForRev(page,2);
      }
      const {meta:before}=await b.eval("(await import('./js/db.js')).readVault()");
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      const {identifier}=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const create=FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable=async function(...args){
          const stream=await create.apply(this,args);
          if(this.name===${JSON.stringify(primary)}&&!window.interruptedWrite){
            const close=stream.close.bind(stream);
            stream.close=async()=>{
              await close();
              window.interruptedWrite=true;
              await new Promise(resolve=>{window.resumeInterruptedWrite=resolve;});
            };
          }
          return stream;
        };
      })()`});
      await relogin(b);
      await b.until("typeof window.resumeInterruptedWrite==='function'");
      const merged=await readFolderFixture(b,primary);
      assert.equal((await decodedNotes(merged)).payload.rev,3);
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('writerCount')"),before.writerCount+1);
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('folderSeenRev')"),2);
      await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
      await relogin(b);
      await ready(b);
      assert.deepEqual((await loaded(b)).map(note=>note.content).sort(),['PC A before closing','PC B before closing']);
      assert.equal(await readFolderFixture(b,primary),merged);
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      assert.ok(!(await b.eval('folderTest.entries()')).includes('keeplocal-preserved'));
      const {meta:resumed}=await b.eval("(await import('./js/db.js')).readVault()");
      assert.equal(resumed.writerId,before.writerId);
      assert.equal(resumed.writerCount,before.writerCount+1);
      await editNote(b,x.id,{content:'PC B continued after reopening'});
      await settleFocus(b);
      await waitForRev(b,4);
      const continued=await decodedNotes(await readFolderFixture(b,primary));
      assert.equal(continued.payload.clock[before.writerId],before.writerCount+2);
    });
  });

  for(const [scenario,aLater] of [['E1',true],['E2',false]]){
    await check(`H2a.7b ${scenario} preserves both edits after the folder drops PC B's revision`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const x=note({title:'Shared X',content:'Original X'}),y=note({title:'Shared Y',content:'Original Y'});
        const edits=['Edit typed on PC A','Edit typed on PC B'];
        await connectBoth(a,b,[x,y],4);
        for(const index of aLater?[1,0]:[0,1]){
          const page=[a,b][index];
          await editNote(page,x.id,{content:edits[index]});
          await waitForRev(page,5);
        }
        await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
        await editNote(a,y.id,{content:'Y edited on PC A'});
        await waitForRev(a,6);
        const incoming=await readFolderFixture(a,primary);
        await writeFolderFixture(b,primary,incoming);
        await relogin(b);
        await ready(b);
        const expected=[...edits,'Y edited on PC A'].sort();
        const bodies=notes=>notes.map(note=>note.content).sort();
        const notesB=await loaded(b);
        assert.deepEqual(bodies(notesB),expected);
        assert.equal(notesB.filter(note=>note.title.includes(' (conflict ')).length,1);
        await toast(b,'1 conflict (copy created)');
        const merged=await readFolderFixture(b,primary);
        assert.deepEqual(bodies((await decodedNotes(merged)).notes),expected);
        await waitForRev(b,7);
        const copies=await preservedCopies(b);
        assert.equal(copies.length,2);
        assert.ok(copies.some(([name,bytes])=>name.includes('-folder-')&&bytes===incoming));
        const localCopy=copies.find(([name])=>name.includes('-local-'))[1];
        assert.ok((await decodedNotes(localCopy)).notes.some(note=>note.content===edits[1]));
        await writeFolderFixture(a,primary,merged);
        await settleFocus(a);
        await waitForRev(a,7);
        await a.until("document.querySelectorAll('.note-card').length===3");
        assert.deepEqual(bodies(await loaded(a)),expected);
        assert.deepEqual((await loaded(a)).map(note=>note.id).sort(),notesB.map(note=>note.id).sort());
      });
    });
  }

  await check('H2a.7b pulls two descendant edits of the same note without a merge or review',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictitious shared note'});
      await connectBoth(a,b,[item],4);
      await editNote(b,item.id,{content:'B edited first'});
      await waitForRev(b,5);
      await writeFolderFixture(a,primary,await readFolderFixture(b,primary));
      await relogin(a);
      await ready(a);
      assert.equal((await loaded(a))[0].content,'B edited first');
      for(const rev of [6,7]){
        await editNote(a,item.id,{content:`A edit at revision ${rev}`});
        await waitForRev(a,rev);
      }
      const final=await readFolderFixture(a,primary);
      await writeFolderFixture(b,primary,final);
      await relogin(b);
      await ready(b);
      await waitForRev(b,7);
      assert.deepEqual((await loaded(b)).map(({id,content})=>({id,content})),[{id:item.id,content:'A edit at revision 7'}]);
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      assert.equal(await readFolderFixture(b,primary),final);
      assert.match(await b.eval("document.querySelector('#toast-container').textContent"),/Loaded revision 7/);
    });
  });

  await check('H2a.7b a manual export between folder writes still allows a direct pull',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Shared before a manual export'});
      await connectBoth(a,b,[item]);
      const {meta:shared}=await a.eval("(await import('./js/db.js')).readVault()");
      const manual=await exportFromApp(a);
      const manualCopy=await decodeV2(Buffer.from(manual,'base64'),PASSWORD);
      const manualHash=await payloadHash(manualCopy.payloadText);
      await editNote(a,item.id,{title:'Shared after a manual export'});
      await waitForRev(a,3);
      const final=await readFolderFixture(a,primary);
      const {payload,payloadText}=await decodeV2(Buffer.from(final,'base64'),PASSWORD);
      assert.equal(payload.parent,manualHash);
      assert.deepEqual(payload.ancestors,[manualHash,shared.folderSyncedHash]);
      const {meta:written}=await a.eval("(await import('./js/db.js')).readVault()");
      assert.deepEqual(written.folderSyncedBases.find(base=>base.hash===shared.folderSyncedHash),{hash:shared.folderSyncedHash,versions:shared.folderSyncedVersions,clock:shared.folderSyncedClock});
      await writeFolderFixture(b,primary,final);
      await relogin(b);
      await ready(b);
      assert.deepEqual((await loaded(b)).map(note=>note.title),['Shared after a manual export']);
      assert.match(await b.eval("document.querySelector('#toast-container').textContent"),/Loaded revision 3/);
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      const {meta:pulled}=await b.eval("(await import('./js/db.js')).readVault()");
      assert.equal(pulled.exportParent,await payloadHash(payloadText));
      assert.deepEqual(pulled.exportAncestors,payload.ancestors);

      const newer=await decodeV2(Buffer.from(await exportFromApp(b),'base64'),PASSWORD);
      await b.eval(`(await import('./js/folder-store.js')).disconnectSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})`);
      await attach(b);
      await relogin(b);
      await ready(b);
      const {meta:adopted}=await b.eval("(await import('./js/db.js')).readVault()");
      assert.equal(adopted.folderSyncedHash,pulled.folderSyncedHash);
      assert.equal(adopted.exportRev,4);
      assert.equal(adopted.exportParent,await payloadHash(newer.payloadText));
      assert.deepEqual(adopted.exportAncestors,newer.payload.ancestors);
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
    });
  });

  await check('H2a.3 a newer unrelated head retains PC B’s committed revision 5 edits',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Shared X'}),y=note({title:'Shared Y'});
      await connectBoth(a,b,[x,y],4);
      await editNote(b,x.id,{title:'PC B revised X'});
      await waitForRev(b,5);
      const discardedB5=await readFolderFixture(b,primary);
      await editNote(a,y.id,{title:'PC A revised Y'});
      await waitForRev(a,5);
      const chosenA5=await readFolderFixture(a,primary);
      assert.notEqual(chosenA5,discardedB5);
      await writeFolderFixture(b,primary,chosenA5);
      await editNote(a,y.id,{title:'PC A revised Y again'});
      await waitForRev(a,6);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await relogin(b);
      await ready(b);
      const titles=(await loaded(b)).map(item=>item.title).sort();
      assert.deepEqual(titles,['PC A revised Y again','PC B revised X'],'The A6 pull must not undo the B5 edit');
      const merged=await decodedNotes(await readFolderFixture(b,primary));
      assert.equal(merged.payload.rev,7);
      assert.deepEqual(merged.notes.map(item=>item.title).sort(),titles);
      await waitForRev(b,7);
    });
  });

  await check('H2a.3 independently written sibling copies retain both versions of one edited note',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Shared conflict'});
      await connectBoth(a,b,[item]);
      await editNote(a,item.id,{content:'Independent A contents'});
      await waitForRev(a,2);
      await editNote(b,item.id,{content:'Independent B contents'});
      await waitForRev(b,2);
      const b2=await readFolderFixture(b,primary);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await relogin(b);
      await b.until("!!document.querySelector('.app-view #main-inner')?.firstElementChild||!!document.querySelector('.folder-review')");
      assert.equal(await b.eval("!!document.querySelector('.folder-review')"),false,'Sibling revisions merge without review');
      assert.deepEqual((await loaded(b)).map(item=>item.content).sort(),['Independent A contents','Independent B contents']);
      assert.equal((await decodedNotes(b2)).payload.rev,2);
      await waitForRev(b,3);
    });
  });

  await check('H2a.3 a newer local edit aborts application after the merged file is committed',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Race X'}),y=note({title:'Race Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(b,x.id,{content:'B before remote'});
      await waitForRev(b,2);
      await editNote(a,y.id,{content:'A during B'});
      await waitForRev(a,2);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      const localApplication=await b.eval(`(()=>{
        const create=FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable=async function(...args){
          const stream=await create.apply(this,args);
          if(this.name===${JSON.stringify(primary)}&&!window.blockedMerge){
            const close=stream.close.bind(stream);
            stream.close=async()=>{
              await close();
              window.blockedMerge=true;
              await new Promise(resume=>{window.resumeAfterMergeWrite=resume;});
            };
          }
          return stream;
        };
        return true;
      })()`);
      assert.equal(localApplication,true);
      await focus(b);
      await b.until("typeof window.resumeAfterMergeWrite==='function'||!!document.querySelector('.folder-review')");
      assert.equal(await b.eval("typeof window.resumeAfterMergeWrite"),'function','Focus must merge and reach the guarded application');
      await editNote(b,x.id,{content:'B after merged file write'});
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('folderSeenRev')"),2);
      await b.eval("window.resumeAfterMergeWrite()");
      await waitForRev(b,4);
      const merged=await decodedNotes(await readFolderFixture(b,primary));
      assert.equal(merged.notes.find(item=>item.id===x.id).content,'B after merged file write');
      assert.equal(merged.notes.find(item=>item.id===y.id).content,'A during B');
    });
  });

  await check('H2a.3 an unresponsive preservation read stops before replacing either side',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictitious preservation deadline'});
      await connectBoth(a,b,[item]);
      await editNote(a,item.id,{content:'Independent A'});
      await waitForRev(a,2);
      await editNote(b,item.id,{content:'Independent B'});
      await waitForRev(b,2);
      const remote=await readFolderFixture(a,primary);
      await writeFolderFixture(b,primary,remote);
      const previous=await b.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");
      await b.eval(`(()=>{
        const get=FileSystemFileHandle.prototype.getFile;
        FileSystemFileHandle.prototype.getFile=function(...args){
          if(this.name.startsWith('preserved-')&&!window.preservationRead) {
            window.preservationRead=true;
            return new Promise(()=>{});
          }
          return get.apply(this,args);
        };
        folderTest.clear();
      })()`);
      await focus(b);
      await b.until('window.preservationRead===true');
      await b.until("!!document.querySelector('.folder-banner')",2500);
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),true);
      assert.equal(await readFolderFixture(b,primary),remote);
      assert.equal(await b.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),previous);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
    },{metadata:400,file:600});
  });
  await check('H2a.3 sign-in retries reconciliation when another tab edits during application',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Sign-in X'}),y=note({title:'Sign-in Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(b,x.id,{content:'B before sign-in'});
      await waitForRev(b,2);
      await editNote(a,y.id,{content:'A before sign-in'});
      await waitForRev(a,2);
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const create=FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable=async function(...args){
          const stream=await create.apply(this,args);
          if(this.name===${JSON.stringify(primary)}&&!window.waitedForSignIn){
            const close=stream.close.bind(stream);
            stream.close=async()=>{
              await close();
              window.waitedForSignIn=true;
              await new Promise(resume=>{window.resumeSignIn=resume;});
            };
          }
          return stream;
        };
      })()`});
      await relogin(b);
      await b.until("typeof window.resumeSignIn==='function'");
      await b.eval(`(async()=>{
        const db=await import('./js/db.js'), crypto=await import('./js/crypto.js');
        const snapshot=await db.readVault();
        const id=${JSON.stringify(x.id)}, record=snapshot.notes.find(row=>row.id===id);
        const key=await crypto.deriveKey(${JSON.stringify(PASSWORD)},crypto.base64ToArray(snapshot.meta.salt));
        const original=JSON.parse(await crypto.decrypt(key,crypto.base64ToArray(record.iv),crypto.base64ToArray(record.ciphertext)));
        const updatedAt=Math.max(Date.now(),record.updatedAt+1);
        const {iv,ciphertext}=await crypto.encrypt(key,JSON.stringify({...original,updatedAt,content:'B concurrent tab edit'}));
        // A second unlocked tab can commit a note while this tab is admitting a session.
        db.setWriteMode('readWrite');
        try {
          await db.guardedNoteWrite({id,knownUpdatedAt:record.updatedAt,expectedVaultId:snapshot.meta.vaultId,
            record:{id,updatedAt,iv:crypto.arrayToBase64(iv),ciphertext:crypto.arrayBufferToBase64(ciphertext)}});
        } finally {db.setWriteMode('readOnly');}
        window.resumeSignIn();
      })()`);
      await b.until("!!document.querySelector('.app-view #main-inner')?.firstElementChild||!!document.querySelector('#login-error')?.textContent");
      assert.equal(await b.eval("!!document.querySelector('.app-view #main-inner')?.firstElementChild"),true,'Sign-in must retry the changed snapshot');
      await waitForRev(b,4);
      const notes=await loaded(b);
      assert.deepEqual(notes.map(item=>item.content).sort(),['A before sign-in','B concurrent tab edit']);
      assert.equal(notes.find(item=>item.id===x.id).content,'B concurrent tab edit');
      assert.ok(notes.every(item=>!item.title.includes(' (conflict ')));
    });
  });
}

async function withFirstConflict(a,b,{lang='en'}={}) {
  const item=note({title:lang==='pt-BR'?'Nota de exemplo':'Fictitious first connection'});
  await a.eval(`(await import('./js/i18n.js')).setLang(${JSON.stringify(lang)})`);
  await create(a);
  await putNote(a,item);
  await attach(a);
  await relogin(a);
  await waitForRev(a,1);
  const file=await readFolderFixture(a,primary);
  await b.eval(importExpression(file));
  await b.reload();
  await unlock(b);
  await editNote(b,item.id,{content:'Local first-connection version'});
  await attach(b);
  await writeFolderFixture(b,primary,file);
  await relogin(b);
  await b.until("!!document.querySelector('[data-folder-status=conflict]')");
  return {item,file};
}

async function preservedCopies(page) {
  return page.eval(`(async()=>{
    const copies=await(await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
    const entries=[];
    for await(const [name,entry] of copies.entries()){
      entries.push([name,new Uint8Array(await(await entry.getFile()).arrayBuffer()).toBase64()]);
    }
    return entries;
  })()`);
}

async function joinReview(page) {
  await page.eval("document.querySelector('[data-folder-action=joinBoth]').click()");
  await page.until("!!document.querySelector('.app-dialog input')");
}

async function typeConfirmation(page) {
  await page.eval(`(async()=>{
    const {t}=await import('./js/i18n.js');
    const input=document.querySelector('.app-dialog input');
    input.value=t('folder.replaceWord');
    input.dispatchEvent(new Event('input'));
    document.querySelector('[data-dialog-action=confirm]').click();
  })()`);
}

async function reviewMerge({check,assert}) {
  for(const choice of ['remote','local']){
    await check(`H2a.9b explicit ${choice} replacement keeps only the chosen base and disconnect clears it`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const item=note({title:'Fictitious explicit replacement'});
        const original=await connectBoth(a,b,[item]);
        await editNote(b,item.id,{content:'B newer local edit'});
        await settleFocus(b);
        await waitForRev(b,2);
        await writeFolderFixture(b,primary,original);
        await relogin(b);
        await b.until("!!document.querySelector('[data-folder-status=rollback]')");
        const action=choice==='remote'?'useFolder':'useLocal';
        await b.eval(`document.querySelector('[data-folder-action=${action}]').click()`);
        await b.until("!!document.querySelector('.app-dialog input')");
        await typeConfirmation(b);
        await ready(b);
        const {meta,notes}=await b.eval("(await import('./js/db.js')).readVault()");
        assert.deepEqual(meta.folderSyncedBases,[{hash:meta.folderSyncedHash,clock:meta.folderSyncedClock,
          versions:Object.fromEntries(notes.map(record=>[record.id,record.updatedAt]))}]);
        assert.equal(meta.folderSyncedBase,undefined);
        assert.equal(meta.folderPendingWrite,undefined);
        const disconnected=await b.eval(`(async()=>{
          const db=await import('./js/db.js'),snapshot=await db.readVault();
          await db.storeFolderConnection(null,snapshot.meta,snapshot.meta.vaultId);
          return (await db.readVault()).meta;
        })()`);
        assert.equal(disconnected.folderSyncedBases,undefined);
        assert.equal(disconnected.folderPendingWrite,undefined);
        assert.equal(disconnected.writerCount,meta.writerCount);
        assert.equal(disconnected.writerId,meta.writerId);
      });
    });
  }

  await check('H2a.4 first connection offers a typed join and preserves both complete sources',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const {item,file}=await withFirstConflict(a,b,{lang:'pt-BR'});
      assert.equal(await b.eval("document.querySelector('[data-folder-action=joinBoth]')?.textContent"),'Juntar as duas');
      await captureMergeEvidence(b,'juntar-as-duas',assert);
      const hash=await b.eval("(await import('./js/db.js')).getMeta('folderSyncedHash')");
      assert.equal(hash,null);
      await joinReview(b);
      assert.equal(await b.eval("document.querySelector('[data-dialog-action=confirm]').disabled"),true);
      await b.eval("document.querySelector('[data-dialog-action=cancel]').click()");
      await b.until("!document.querySelector('.app-dialog')");
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      assert.equal(await readFolderFixture(b,primary),file);
      await b.eval("folderTest.failPreservation=true");
      await joinReview(b);
      await typeConfirmation(b);
      await b.until("document.querySelector('.folder-reason').textContent.includes('Não foi possível preservar')");
      assert.equal(await readFolderFixture(b,primary),file);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      await b.eval("folderTest.failPreservation=false");
      await joinReview(b);
      await typeConfirmation(b);
      await ready(b);
      await waitForRev(b,2);
      assert.deepEqual((await loaded(b)).map(row=>row.content).sort(),[item.content,'Local first-connection version'].sort());
      const copies=await preservedCopies(b);
      assert.ok(copies.some(([name,bytes])=>name.includes('-folder-')&&bytes===file));
      const local=await decodedNotes(copies.find(([name])=>name.includes('-local-'))[1]);
      assert.deepEqual(local.notes.map(row=>row.content),['Local first-connection version']);
    });
  });

  await check('H2a.4 rollback can join a prior file and keeps both encrypted source copies',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const earlier=note({title:'Already present'}), newer=note({title:'Written after the prior file'});
      const old=await connectBoth(a,b,[earlier]);
      await putNote(b,newer);
      await waitForRev(b,2);
      await writeFolderFixture(b,primary,old);
      await relogin(b);
      await b.until("!!document.querySelector('[data-folder-status=rollback]')");
      await joinReview(b);
      await typeConfirmation(b);
      await ready(b);
      await waitForRev(b,3);
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),false);
      const copies=await preservedCopies(b);
      assert.ok(copies.some(([name,bytes])=>name.includes('-folder-')&&bytes===old));
      const local=await decodedNotes(copies.find(([name])=>name.includes('-local-'))[1]);
      assert.deepEqual(local.notes.map(item=>item.title).sort(),[earlier.title,newer.title].sort());
      assert.deepEqual((await loaded(b)).map(item=>item.title).sort(),[earlier.title,newer.title].sort());
    });
  });
}


async function settleFocus(page) {
  await page.eval("window.dispatchEvent(new Event('focus'));await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
}

async function toast(page,text) {
  await page.until(`document.querySelector('#toast-container')?.textContent.includes(${JSON.stringify(text)})`);
}

async function assertBase(page,assert,rev) {
  const {meta,notes}=await page.eval("(await import('./js/db.js')).readVault()");
  assert.equal(meta.folderSeenRev,rev);
  assert.equal(meta.folderSyncedRevision,meta.revision);
  assert.deepEqual(meta.folderSyncedVersions,Object.fromEntries(notes.map(({id,updatedAt})=>[id,updatedAt])));
}

async function captureMergeEvidence(page,label,assert,{directory=process.env.KEEPLOCAL_H2A_CAPTURES,notice}={}) {
  if(!directory)return;
  const themeAtStart=await page.eval('document.documentElement.dataset.theme');
  try {
    for(const theme of ['light','dark']){
      for(const width of [1100,390]){
        await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
        await page.eval(`(async()=>{
          document.documentElement.dataset.theme=${JSON.stringify(theme)};
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const transitions=document.getAnimations().filter(animation=>
            animation.playState==='running'&&Number.isFinite(animation.effect.getComputedTiming().endTime));
          await Promise.allSettled(transitions.map(animation=>animation.finished));
        })()`);
        assert.equal(await page.eval('innerWidth'),width);
        assert.equal(await page.eval('document.documentElement.scrollWidth<=innerWidth'),true);
        if(notice){
          assert.equal(await page.eval(`(async()=>{
            const toast=[...document.querySelectorAll('#toast-container .toast')].find(node=>
              node.textContent.includes(${JSON.stringify(notice)}));
            if(!toast)return false;
            const bounds=toast.getBoundingClientRect();
            return bounds.width>0&&bounds.height>0&&bounds.left>=0&&bounds.right<=innerWidth&&
              bounds.top>=0&&bounds.bottom<=innerHeight&&Number(getComputedStyle(toast).opacity)>0;
          })()`),true,`Notice clipped in ${theme} at ${width}px`);
        }
        const {data}=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});
        await writeFile(join(directory,`${label}-${theme}-${width}.png`),Buffer.from(data,'base64'));
      }
    }
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.eval(`document.documentElement.dataset.theme=${JSON.stringify(themeAtStart)}`);
  }
}

async function e2e({check,assert}) {
  await check('H2a.5 disjoint changes merge on focus, report the count and converge without more writes',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Shared X'}),y=note({title:'Shared Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(a,x.id,{title:'Edited X on A'});
      await waitForRev(a,2);
      const a2=await readFolderFixture(a,primary);
      await writeFolderFixture(b,primary,a2);
      await editNote(b,y.id,{title:'Edited Y on B'});
      await focus(b);
      await b.until("!!document.querySelector('.folder-review')||document.querySelector('#toast-container')?.textContent.includes('were merged')");
      assert.equal(await b.eval("!!document.querySelector('.folder-review')"),false);
      await toast(b,'Changes from another computer were merged: 1 updated.');
      await assertBase(b,assert,3);
      const common=await readFolderFixture(b,primary);
      const {payload}=await decodedNotes(common);
      assert.equal(payload.parent,await payloadHash((await decodeV2(Buffer.from(a2,'base64'),PASSWORD)).payloadText));
      await writeFolderFixture(a,primary,common);
      for(const page of [a,b]){
        await relogin(page);
        await ready(page);
        await assertBase(page,assert,3);
        assert.deepEqual((await loaded(page)).map(item=>item.title).sort(),['Edited X on A','Edited Y on B']);
        await settleFocus(page);
        assert.equal(await page.eval('folderTest.writeAttempts'),0);
        assert.equal(await readFolderFixture(page,primary),common);
      }
    });
  });

  await check('H2a.5 sibling merges produce the same conflict ID, preserve sources and stay at the same revision',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await a.eval("(await import('./js/i18n.js')).setLang('pt-BR')");
      const item=note({title:'Planejamento fictício',content:'Texto inicial'});
      await connectBoth(a,b,[item]);
      await editNote(a,item.id,{content:'Texto editado no computador A'});
      await waitForRev(a,2);
      await editNote(b,item.id,{content:'Texto editado no computador B'});
      await waitForRev(b,2);
      const a2=await readFolderFixture(a,primary),b2=await readFolderFixture(b,primary);
      await writeFolderFixture(a,primary,b2);
      await writeFolderFixture(b,primary,a2);
      const ids=[];
      for(const [page,remote,local] of [[a,b2,a2],[b,a2,b2]]){
        await relogin(page);
        await ready(page);
        await assertBase(page,assert,3);
        const notes=await loaded(page);
        const copy=notes.find(row=>row.id!==item.id);
        assert.equal(notes.length,2);
        assert.match(copy.title,/\(conflito \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
        ids.push(copy.id);
        await toast(page,'1 em conflito (cópia criada)');
        if(page===a)await captureMergeEvidence(page,'aviso-juncao',assert);
        const copies=await preservedCopies(page);
        assert.ok(copies.some(([name,bytes])=>name.includes('-folder-')&&bytes===remote));
        const preserved=await decodedNotes(copies.find(([name])=>name.includes('-local-'))[1]);
        assert.deepEqual(preserved.notes,(await decodedNotes(local)).notes);
        await settleFocus(page);
        assert.equal(await page.eval('folderTest.writeAttempts'),1);
        if(page===a&&process.env.KEEPLOCAL_H2A_CAPTURES){
          await page.eval("document.querySelectorAll('#toast-container .toast').forEach(toast=>toast.remove())");
          await captureMergeEvidence(page,'copia-conflito',assert);
        }
      }
      assert.equal(ids[0],ids[1]);
      const common=await readFolderFixture(b,primary);
      await writeFolderFixture(a,primary,common);
      await relogin(a);
      await ready(a);
      await settleFocus(a);
      await assertBase(a,assert,3);
      assert.equal(await a.eval('folderTest.writeAttempts'),0);
      assert.equal(await readFolderFixture(a,primary),common);
    });
  });

  for(const [scenario,winningBranch,language] of [['E3','A','en'],['E4','B','pt-BR']]){
    await check(`H2a.7c ${scenario} keeps the unseen edit and shows both notices when the folder keeps PC ${winningBranch}`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const item=note({title:'Fictitious server login',content:'Original'});
        const edit='Updated fictional server login';
        await a.eval(`(await import('./js/i18n.js')).setLang(${JSON.stringify(language)})`);
        await connectBoth(a,b,[item]);
        await editNote(b,item.id,{content:edit});
        await waitForRev(b,2);
        const editedFile=await readFolderFixture(b,primary);

        await editNote(a,item.id,{deletedAt:Date.now()});
        await a.eval(`(await import('./js/app.js')).permanentDeleteNote(${JSON.stringify(item.id)})`);
        await settleFocus(a);
        await waitForRev(a,2);
        const deletedFile=await readFolderFixture(a,primary);
        const {payload:deleted}=await decodedNotes(deletedFile);
        const {notes:[edited]}=await decodedNotes(editedFile);
        assert.ok(deleted.tombstones.some(row=>row.id===item.id&&row.deletedAt>edited.updatedAt));

        const [first,second,file]=winningBranch==='A'?[b,a,deletedFile]:[a,b,editedFile];
        await writeFolderFixture(first,primary,file);
        await relogin(first);
        await ready(first);
        const contents=async page=>(await loaded(page)).map(note=>[note.id,note.content]);
        assert.deepEqual(await contents(first),[[item.id,edit]]);
        await waitForRev(first,3);
        const merged=await readFolderFixture(first,primary);
        const {payload,notes}=await decodedNotes(merged);
        assert.deepEqual(notes.map(note=>[note.id,note.content]),[[item.id,edit]]);
        assert.deepEqual(payload.tombstones,deleted.tombstones);

        await writeFolderFixture(second,primary,merged);
        await relogin(second);
        await ready(second);
        assert.deepEqual(await contents(second),[[item.id,edit]]);
        await waitForRev(second,3);
        assert.equal(await second.eval('folderTest.writeAttempts'),0);
        const messages=await Promise.all([a,b].map(page=>page.eval("document.querySelector('#toast-container').textContent")));
        const expected=language==='pt-BR'?[
          'Uma nota que você apagou foi mantida porque foi editada em outro computador.',
          'Uma nota apagada em outro computador foi mantida porque foi editada aqui.',
        ]:[
          'A note you deleted was kept because it was edited on another computer.',
          'A note deleted on another computer was kept because it was edited here.',
        ];
        for(const [index,message] of messages.entries())assert.ok(message.includes(expected[index]),message);
        const directory=process.env.KEEPLOCAL_H2A7_CAPTURES;
        if(scenario==='E4'&&directory){
          await captureMergeEvidence(a,'aviso-nota-mantida',assert,{directory,notice:expected[0]});
        }
      });
    });
  }

  for(const edited of [false,true]){
    await check(`H2a.5 a permanent deletion ${edited?'keeps a later local edit with a notice':'removes the unchanged note'}`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const item=note({title:'Fictitious permanent deletion'});
        await connectBoth(a,b,[item]);
        await editNote(a,item.id,{deletedAt:Date.now()});
        await a.eval(`(await import('./js/app.js')).permanentDeleteNote(${JSON.stringify(item.id)})`);
        await waitForRev(a,2);
        const remote=await readFolderFixture(a,primary);
        await writeFolderFixture(b,primary,remote);
        if(edited)await editNote(b,item.id,{content:'Edited after deletion'});
        await focus(b);
        await waitForRev(b,edited?3:2);
        await b.until(`(await import('./js/app.js')).getNotes().length===${Number(edited)}`);
        const copy=await decodedNotes(await readFolderFixture(b,primary));
        assert.equal(copy.payload.tombstones[0].id,item.id);
        assert.equal(copy.notes.length,Number(edited));
        if(edited){
          assert.equal(copy.notes[0].content,'Edited after deletion');
          await toast(b,'A note deleted on another computer was kept because it was edited here.');
        }else{
          assert.deepEqual(await loaded(a),[]);
          assert.deepEqual(await loaded(b),[]);
          assert.equal(await readFolderFixture(a,primary),remote);
        }
      });
    });
  }

  await check('H2a.5 tied highest heads merge and older sibling copies stay outside the result',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Common X'}),y=note({title:'Common Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(a,x.id,{title:'X from the alternate head'});
      await waitForRev(a,2);
      await editNote(b,y.id,{title:'Y from the main head'});
      await waitForRev(b,2);
      const a2=await readFolderFixture(a,primary);
      const salt=Buffer.from(await b.eval("(await import('./js/db.js')).getMeta('salt')"),'base64');
      const old=await backupFixture([note({title:'Obsolete sibling not selected'})],PASSWORD,salt);
      await writeFolderFixture(b,'tied.keeplocal',a2);
      await writeFolderFixture(b,'older.keeplocal',await old.seal({...old.payload,rev:1}));
      await relogin(b);
      await ready(b);
      await assertBase(b,assert,3);
      assert.deepEqual((await loaded(b)).map(row=>row.title).sort(),['X from the alternate head','Y from the main head']);
      assert.equal(await readFolderFixture(b,'tied.keeplocal'),a2);
    });
  });

  await check('H2a.5 vault conflicts stay masked on cards, in search and toasts and open in the recovery reader',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const secrets=['fixture-secret-'+crypto.randomUUID(),'fixture-secret-'+crypto.randomUUID()];
      const item=vaultFixture({title:'Fictitious private item'});
      await connectBoth(a,b,[item]);
      for(const [page,value] of [[a,secrets[0]],[b,secrets[1]]]){
        const blocks=structuredClone(item.blocks);
        blocks[1].value=value;
        await editNote(page,item.id,{blocks});
        await waitForRev(page,2);
      }
      await writeFolderFixture(b,primary,await readFolderFixture(a,primary));
      await relogin(b);
      await ready(b);
      await waitForRev(b,3);
      await toast(b,'1 conflict (copy created)');
      const file=await readFolderFixture(b,primary);
      const {notes}=await decodedNotes(file);
      assert.deepEqual(notes.map(row=>row.blocks[1].value).sort(),secrets.toSorted());
      notes.forEach(validateNote);
      await b.eval("document.querySelector('[data-view=vault]').click()");
      await b.until("document.querySelectorAll('.vault-card').length===2");
      const scan=()=>b.eval(`(async()=>{
        const dom=document.body.innerHTML;
        return ${JSON.stringify(secrets)}.some(value=>dom.includes(value));
      })()`);
      assert.equal(await scan(),false);
      for(const secret of secrets){
        await b.eval(`const search=document.querySelector('#search-input');
          search.value=${JSON.stringify(secret)};
          search.dispatchEvent(new Event('input',{bubbles:true}));`);
        await b.until("document.querySelector('.vault-section').dataset.vaultSearchActive==='true'&&!document.querySelector('.vault-card')");
        assert.equal(await scan(),false);
        await b.eval("document.querySelector('#search-clear').click()");
      }
      assert.ok(b.errors.every(error=>secrets.every(secret=>!error.includes(secret))));
      const browser=await launch();
      try {
        await assertReadsMergedCopy({browser,assert,base64:file,titles:notes.map(row=>row.title),secrets});
      } finally {await browser.close();}
    });
  });

  await check('H2a.5 a read-only session neither applies nor writes a merge when the folder returns',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Read-only local X'}),y=note({title:'Read-only remote Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(a,y.id,{content:'Remote edit available in the recovered folder'});
      await waitForRev(a,2);
      await editNote(b,x.id,{content:'Fictitious local work'});
      await waitForRev(b,2);
      const local=await b.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");
      const remote=await readFolderFixture(a,primary);
      await writeFolderFixture(b,primary,remote);
      await b.reload();
      await b.eval("folderTest.requested='denied'");
      await submitExtensionLogin(b);
      await b.until("!!document.querySelector('[data-folder-status=denied]')");
      await b.eval("document.querySelector('[data-folder-action=openReadOnly]').click()");
      await ready(b);
      await b.eval("folderTest.permission='granted'");
      await settleFocus(b);
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),true);
      assert.equal(await b.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),local);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      assert.equal(await readFolderFixture(b,primary),remote);
      assert.equal(await b.eval("document.querySelector('#toast-container').textContent.includes('were merged')"),false);
    });
  });
}
