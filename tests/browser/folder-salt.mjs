import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {writeFolderFixture,readFolderFixture} from './folder-transfer.mjs';

export const NEW_PASSWORD='Fictional river lantern garden';

export async function run({check,assert}) {
  await check('H2b.0 two-key adoption applies the folder salt and receipt in one guarded transaction',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());
      await create(page);
      const value=note({title:'Fictional other-salt adoption'});
      await page.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(value)})`);
      const saved=await page.eval(`(await import('./js/app.js')).getNotes().find(n=>n.id===${JSON.stringify(value.id)})`);
      const folder=await backupFixture([saved],NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',folder.base64);
      const result=await page.eval(`(async()=>{
        const db=await import('./js/db.js'),session=await import('./js/session.js');
        const initial=await db.readVault(),handle=await folderTest.directory();
        await db.storeFolderConnection(handle,initial.meta,initial.meta.vaultId);
        const snapshot=await db.readVault(),key=await session.getSessionKey();
        const crypto=await import('./js/crypto.js');
        const salt=${JSON.stringify(Buffer.from(folder.bytes.subarray(0,16)).toString('base64'))};
        const foreign={salt,key:await crypto.deriveKey(${JSON.stringify(NEW_PASSWORD)},crypto.base64ToArray(salt))};
        const transactions=new Set(),put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(row){
          if(this.name==='notes'||['salt','folderSaltClock','folderSyncedHash','exportParent'].includes(row.key))transactions.add(this.transaction);
          return put.call(this,row);
        };
        try{
          const outcome=await (await import('./js/folder-salt-access.js')).reconcileSaltFolder({handle,snapshot,key,foreign,signal:new AbortController().signal});
          const current=await db.readVault();
          return {status:outcome.status,transactions:transactions.size,salt:current.meta.salt,
            clock:current.meta.folderSaltClock,receipt:current.meta.folderSyncedHash,
            titles:(await (await import('./js/backup-format.js')).decryptRecords(current.notes,await session.getSessionKey())).map(n=>n.title),
            writes:folderTest.writes};
        }finally{IDBObjectStore.prototype.put=put;}
      })()`);
      assert.equal(result.status,'pulled');
      assert.equal(result.transactions,1);
      assert.deepEqual(result.clock,{});
      assert.deepEqual(result.titles,[value.title]);
      assert.equal(result.salt,Buffer.from(folder.bytes.subarray(0,16)).toString('base64'));
      assert.equal(await readFolderFixture(page,'keeplocal-vault.keeplocal'),folder.base64);
    }finally{await browser.close();}
  });
}
