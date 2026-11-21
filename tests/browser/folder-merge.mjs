import {create, launchExtension, note} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';

export async function run({check,assert}) {
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
