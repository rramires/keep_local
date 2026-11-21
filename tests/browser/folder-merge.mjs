import {create, launchExtension, note, PASSWORD, unlock} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {submitExtensionLogin} from './extension.mjs';
import {importExpression} from './backup-fixture.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';

export async function run({check,assert}) {
  await integration({check,assert});
  await reviewMerge({check,assert});
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
      assert.deepEqual((await loaded(b)).map(item=>item.content).sort(),['A before sign-in','B concurrent tab edit']);
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
  await check('H2a.4 first connection offers a typed join and preserves both complete sources',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const {item,file}=await withFirstConflict(a,b,{lang:'pt-BR'});
      assert.equal(await b.eval("document.querySelector('[data-folder-action=joinBoth]')?.textContent"),'Juntar as duas');
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
