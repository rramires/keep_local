import {note,PASSWORD} from './harness.mjs';
import {withTwoProfiles,connectBoth,waitForRev,editNote,editFromOtherTab,focus} from './folder-merge.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {signIn} from './folder-salt-login.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';

export async function enterFolderPassword(page,password) {
  await page.eval("document.querySelector('[data-folder-action=enterFolderPassword]').click()");
  await page.until("!!document.querySelector('.app-dialog input[type=password]')");
  await page.eval(`const input=document.querySelector('.app-dialog input[type=password]');
    window.usedFolderPassword=input;
    input.value=${JSON.stringify(password)};input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();`);
}

async function preserved(page) {
  return page.eval(`(async()=>{
    const directory=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
    const copies=[];
    for await(const entry of directory.values())copies.push(new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64());
    return copies;
  })()`);
}

export async function run({check,assert}) {
  for(const dirty of [false,true])await check(`H2b.3 signing in with the old passphrase ${dirty?'joins an unsent local edit':'loads the folder after entering its passphrase'}`,async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictional password review X'}),y=note({title:'Fictional password review Y'});
      await connectBoth(a,b,[x,y]);
      if(dirty)await editFromOtherTab(b,y.id,'Fictional offline edit before the password review');
      await rotate(a);
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',await readFolderFixture(a,'keeplocal-vault.keeplocal'));
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      assert.equal(await b.eval("!!document.querySelector('[data-folder-action=enterFolderPassword]')"),true);
      await enterFolderPassword(b,NEW_PASSWORD);
      await b.until("!!document.querySelector('.app-view')");
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),false);
      const current=await b.eval("(await import('./js/app.js')).getNotes()");
      assert.equal(current.length,2);
      if(dirty)assert.equal(current.find(n=>n.id===y.id).content,'Fictional offline edit before the password review');
      assert.equal(await b.eval('window.usedFolderPassword.value'),'');
      assert.equal(await b.eval("document.querySelector('#login-password')?.value||''"),'');
      const file=await decodeV2(Buffer.from(await readFolderFixture(b,'keeplocal-vault.keeplocal'),'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(file.payload.notes,file.key),current);
    });
  });

  await check('H2b.3 a delayed old-password folder write keeps the newer local passphrase and joins both edits',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictional delayed X'}),y=note({title:'Fictional delayed Y'});
      await connectBoth(a,b,[x,y]);
      await editFromOtherTab(a,x.id,'Fictional edit included in the password change');
      await rotate(a);
      const saltClock=await a.eval("(await import('./js/db.js')).getMeta('folderSaltClock')");
      await editNote(b,y.id,{content:'Fictional edit in the delayed old-password file'});
      await waitForRev(b,2);
      const delayed=await readFolderFixture(b,'keeplocal-vault.keeplocal');
      await writeFolderFixture(a,'keeplocal-vault.keeplocal',delayed);
      await focus(a);
      await a.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      assert.equal(await a.eval("!!document.querySelector('[data-folder-action=enterFolderPassword]')"),true);
      await enterFolderPassword(a,PASSWORD);
      await a.until("!!document.querySelector('.app-view')");
      assert.equal(await a.eval("(await import('./js/db.js')).isReadOnly()"),false);
      assert.deepEqual(await a.eval("(await import('./js/db.js')).getMeta('folderSaltClock')"),saltClock);
      const current=await a.eval("(await import('./js/app.js')).getNotes()");
      assert.deepEqual(current.map(n=>n.content).sort(),['Fictional edit in the delayed old-password file','Fictional edit included in the password change']);
      assert.ok((await preserved(a)).includes(delayed));
      const final=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await decodeV2(Buffer.from(final,'base64'),NEW_PASSWORD);
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',final);
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await enterFolderPassword(b,NEW_PASSWORD);
      await b.until("!!document.querySelector('.app-view')");
      assert.deepEqual(await b.eval("(await import('./js/app.js')).getNotes()"),current);
    });
  });

  await check('H2b.3 using this browser preserves unknown-password bytes and records the salt clock atomically',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional explicit password choice'})]);
      await rotate(a);
      const unknown=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',unknown);
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      assert.equal(await b.eval("!!document.querySelector('[data-folder-action=useLocal]')"),true);
      await b.eval("document.querySelector('[data-folder-action=useLocal]').click()");
      await b.until("!!document.querySelector('.app-dialog input')");
      await b.eval(`(async()=>{const t=(await import('./js/i18n.js')).t;
        window.choiceTransactions=new Set();
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(row){
          if(this.name==='meta'&&['folderSaltClock','folderSyncedHash','exportParent','exportClock'].includes(row.key))window.choiceTransactions.add(this.transaction);
          return put.call(this,row);
        };
        const input=document.querySelector('.app-dialog input');input.value=t('folder.replaceWord');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
      await b.until("!!document.querySelector('.app-view')");
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),false);
      assert.ok((await preserved(b)).includes(unknown));
      const file=await decodeV2(Buffer.from(await readFolderFixture(b,'keeplocal-vault.keeplocal'),'base64'),PASSWORD);
      assert.deepEqual(await b.eval("(await import('./js/db.js')).getMeta('folderSaltClock')"),file.payload.clock);
      assert.equal(await b.eval('window.choiceTransactions.size'),1);
      assert.ok(await b.eval("document.body.textContent.includes('The folder now uses this browser’s notes and passphrase.')"));
    });
  });

  await check('H2b.3 a wrong folder passphrase leaves the database and every folder file unchanged',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note()]);await rotate(a);
      const file=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',file);
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      assert.equal(await b.eval("!!document.querySelector('[data-folder-action=enterFolderPassword]')"),true);
      await b.eval("window.beforeWrongFolder=JSON.stringify(await (await import('./js/db.js')).readVault());folderTest.clear()");
      await enterFolderPassword(b,'Fictional incorrect folder passphrase');
      await b.until("document.querySelector('.folder-reason')?.textContent.includes('does not open the folder copy')");
      assert.equal(await b.eval("JSON.stringify(await (await import('./js/db.js')).readVault())===window.beforeWrongFolder"),true);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      assert.equal(await b.eval('window.usedFolderPassword.value'),'');
      assert.equal(await readFolderFixture(b,'keeplocal-vault.keeplocal'),file);
    });
  });

  await check('H2b.3 a changed unknown-password main aborts replacement before overwriting the unpreserved bytes',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional foreign-file race'})]);await rotate(a);
      const first=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await a.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional later foreign note'}))})`);
      await waitForRev(a,3);
      const later=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',first);
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await b.eval(`(async()=>{
        window.unknownFileSwapped=false;
        const createWritable=FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable=async function(...args){
          const stream=await createWritable.apply(this,args);
          if(this.name.startsWith('preserved-')&&!window.unknownFileSwapped){
            const close=stream.close.bind(stream);
            stream.close=async()=>{
              await close();window.unknownFileSwapped=true;
              const file=await (await folderTest.directory()).getFileHandle('keeplocal-vault.keeplocal');
              const replacement=await createWritable.call(file);
              await replacement.write(Uint8Array.fromBase64(${JSON.stringify(later)}));await replacement.close();
            };
          }
          return stream;
        };
        document.querySelector('[data-folder-action=useLocal]').click();
      })()`);
      await b.until("!!document.querySelector('.app-dialog input')");
      await b.eval(`(async()=>{const input=document.querySelector('.app-dialog input');
        input.value=(await import('./js/i18n.js')).t('folder.replaceWord');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
      await b.until('window.unknownFileSwapped');
      await b.eval("await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
      assert.equal(await readFolderFixture(b,'keeplocal-vault.keeplocal'),later);
      assert.ok((await preserved(b)).includes(first));
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),true);
    });
  });
}
