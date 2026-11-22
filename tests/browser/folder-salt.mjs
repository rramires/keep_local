import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {writeFolderFixture,readFolderFixture} from './folder-transfer.mjs';
import {withTwoProfiles,connectBoth,waitForRev} from './folder-merge.mjs';
import {decodeV2} from '../../js/backup-v2.js';

export const NEW_PASSWORD='Fictional river lantern garden';

export async function rotate(page) {
  await page.eval("document.querySelector('#change-password-btn').click()");
  await page.until("!!document.querySelector('#change-password-form')");
  await page.eval(`document.querySelector('#current-password').value=${JSON.stringify(PASSWORD)};
    document.querySelector('#next-password').value=${JSON.stringify(NEW_PASSWORD)};
    document.querySelector('#next-confirm').value=${JSON.stringify(NEW_PASSWORD)};
    document.querySelector('#change-password-form').requestSubmit();`);
  await page.until("!!document.querySelector('.app-dialog')||!!document.querySelector('#change-password-error')?.textContent");
  const error=await page.eval("document.querySelector('#change-password-error')?.textContent||''");
  if(error)throw Error(error);
  await page.eval("document.querySelector('[data-dialog-action=confirm]').click()");
}

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

  await check('H2b.1 connected password rotation preserves the old bytes and keeps this computer writable',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional password rotation'})]);
      const before=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await rotate(a);
      await a.eval("window.dispatchEvent(new Event('focus'))");
      await a.until("!!document.querySelector('[data-folder-status=otherSalt]')||(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>=2)");
      const status=await a.eval("({readOnly:(await import('./js/db.js')).isReadOnly(),gate:document.querySelector('[data-folder-status]')?.dataset.folderStatus||null})");
      console.log('H2b.1 rotation state',JSON.stringify(status));
      assert.equal(status.gate,null);
      assert.equal(status.readOnly,false);
      const after=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      const decoded=await decodeV2(Buffer.from(after,'base64'),NEW_PASSWORD);
      assert.notEqual(after,before);
      const stored=await a.eval(`(async()=>{
        const directory=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const files=[];
        for await(const entry of directory.values())files.push(new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64());
        return files;
      })()`);
      assert.ok(stored.includes(before));
      assert.equal(await a.eval("(await import('./js/db.js')).getMeta('salt')"),Buffer.from(decoded.salt).toString('base64'));
      await a.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional edit after rotation'}))})`);
      await waitForRev(a,decoded.payload.rev+1);
      await a.reload();
      await a.eval("folderTest.permission='granted'");
      await a.until("!!document.querySelector('#login-password')");
      await a.eval(`document.querySelector('#login-password').value=${JSON.stringify(NEW_PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
      await a.until("!!document.querySelector('.app-view')");
      assert.equal(await a.eval("(await import('./js/app.js')).getNotes().length"),2);
      await a.reload();
      await a.until("!!document.querySelector('#login-password')");
      await a.eval(`document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
      await a.until("!!document.querySelector('#login-error').textContent");
      assert.equal(await a.eval("document.querySelector('#login-error').textContent"),'Incorrect passphrase.');
    });
  });

  await check('H2b.1 pending folder changes refuse rotation with zero writes',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional pending rotation'});
      await connectBoth(a,b,[item]);
      await b.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional change on the other computer'}))})`);
      await waitForRev(b,2);
      await writeFolderFixture(a,'keeplocal-vault.keeplocal',await readFolderFixture(b,'keeplocal-vault.keeplocal'));
      const before=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      const result=await a.eval(`(async()=>{
        const db=await import('./js/db.js');
        const before=JSON.stringify(await db.readVault());
        folderTest.clear();const writes=folderTest.writeAttempts;
        let error;
        try{await (await import('./js/account.js')).changePassword(${JSON.stringify(PASSWORD)},${JSON.stringify(NEW_PASSWORD)},{signal:new AbortController().signal});}
        catch(e){error=e.code;}
        return {error,same:before===JSON.stringify(await db.readVault()),writes:folderTest.writeAttempts-writes,
          transactions:Object.values(folderTest.writes).reduce((sum,count)=>sum+count,0)};
      })()`);
      assert.equal(result.error,'account.folderPending');
      assert.equal(result.same,true);
      assert.equal(result.writes,0);
      assert.equal(result.transactions,0);
      assert.equal(await readFolderFixture(a,'keeplocal-vault.keeplocal'),before);
    });
  });

  await check('H2b.1 a failed local application retains both decryptable versions and reports the new folder passphrase',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional guarded password rotation'})]);
      const before=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      const result=await a.eval(`(async()=>{
        const db=await import('./js/db.js'),before=await db.readVault();
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(row){
          if(this.name==='meta'&&row.key==='folderSaltClock')throw Error('Fictional application failure');
          return put.call(this,row);
        };
        let error;
        try{await (await import('./js/account.js')).changePassword(${JSON.stringify(PASSWORD)},${JSON.stringify(NEW_PASSWORD)},{signal:new AbortController().signal});}
        catch(e){error=e.code;}
        finally{IDBObjectStore.prototype.put=put;}
        const after=await db.readVault(),crypto=await import('./js/crypto.js');
        const oldKey=await crypto.deriveKey(${JSON.stringify(PASSWORD)},crypto.base64ToArray(after.meta.salt));
        const localNotes=await (await import('./js/backup-format.js')).decryptRecords(after.notes,oldKey);
        const directory=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const preserved=[];
        for await(const file of directory.values())preserved.push(new Uint8Array(await (await file.getFile()).arrayBuffer()).toBase64());
        return {error,saltUnchanged:before.meta.salt===after.meta.salt,notesUnchanged:JSON.stringify(before.notes)===JSON.stringify(after.notes),
          vaultUnchanged:before.meta.vaultId===after.meta.vaultId,oldSalt:after.meta.salt,
          oldKeyValid:await crypto.verifyKeyCheck(oldKey,after.meta.keyCheck),localNotes,preserved};
      })()`);
      assert.equal(result.error,'account.folderApplyFailed');
      assert.equal(result.saltUnchanged,true);
      assert.equal(result.notesUnchanged,true);
      assert.equal(result.vaultUnchanged,true);
      assert.equal(result.oldKeyValid,true);
      assert.ok(result.preserved.includes(before));
      const fresh=await decodeV2(Buffer.from(await readFolderFixture(a,'keeplocal-vault.keeplocal'),'base64'),NEW_PASSWORD);
      assert.notEqual(Buffer.from(fresh.salt).toString('base64'),result.oldSalt);
      const {decryptRecords}=await import('../../js/backup-format.js');
      assert.deepEqual(await decryptRecords(fresh.payload.notes,fresh.key),result.localNotes);
      const old=await decodeV2(Buffer.from(before,'base64'),PASSWORD);
      assert.deepEqual(await decryptRecords(old.payload.notes,old.key),result.localNotes);
    });
  });

  await check('H2b.1 a failed readback keeps the old principal and local notes',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional readback failure'})]);
      const before=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      const result=await a.eval(`(async()=>{
        const db=await import('./js/db.js'),before=await db.readVault();
        folderTest.badReadback=true;
        let error;
        try{await (await import('./js/account.js')).changePassword(${JSON.stringify(PASSWORD)},${JSON.stringify(NEW_PASSWORD)},{signal:new AbortController().signal});}
        catch(e){error=e.code;}
        finally{folderTest.badReadback=false;folderTest.corruptNextRead=false;}
        const after=await db.readVault();
        return {error,saltUnchanged:before.meta.salt===after.meta.salt,notesUnchanged:JSON.stringify(before.notes)===JSON.stringify(after.notes)};
      })()`);
      assert.equal(result.error,'folder.readback');
      assert.equal(result.saltUnchanged,true);
      assert.equal(result.notesUnchanged,true);
      assert.equal(await readFolderFixture(a,'keeplocal-vault.keeplocal'),before);
    });
  });

  await check('H2b.1 password settings wait for a pending note draft before opening',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());
      await create(page);
      await page.eval(`
        const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
        window.draftEncryptions=[];
        crypto.subtle.encrypt=async(...args)=>{
          if(window.holdDraft)await new Promise(resolve=>window.draftEncryptions.push(resolve));
          return encrypt(...args);
        };
        window.holdDraft=true;
        document.querySelector('.new-note-collapsed').click();
        const input=document.querySelector('#new-note-body');
        input.value='Fictional draft before password rotation';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#change-password-btn').click();
      `);
      await page.until("window.draftEncryptions.length>0");
      assert.equal(await page.eval("!!document.querySelector('#change-password-form')"),false);
      await page.eval("window.holdDraft=false;window.draftEncryptions.splice(0).forEach(resolve=>resolve())");
      await page.until("!!document.querySelector('#change-password-form')");
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].content"),'Fictional draft before password rotation');
    }finally{await browser.close();}
  });
}
