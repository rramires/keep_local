import {note,PASSWORD} from './harness.mjs';
import {withTwoProfiles,connectBoth,waitForRev,editNote,editFromOtherTab,focus} from './folder-merge.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {signIn} from './folder-salt-login.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {decodeV2,encodeV2} from '../../js/backup-v2.js';
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

async function confirmChoice(page,action) {
  await page.eval(`document.querySelector('[data-folder-action=${action}]').click()`);
  await page.until("!!document.querySelector('.app-dialog input')");
  await page.eval(`(async()=>{const input=document.querySelector('.app-dialog input');
    input.value=(await import('./js/i18n.js')).t('folder.replaceWord');
    input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
}

export async function run({check,assert}) {
  await check('H2b.8 O1 a manual cross-salt join preserves each byte version once',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const main='keeplocal-vault.keeplocal';
      const x=note({title:'Fictional preserved X'}),y=note({title:'Fictional preserved Y'});
      await connectBoth(a,b,[x,y]);
      await rotate(a);
      await editNote(a,x.id,{content:'Fictional edit after the password change'});
      await waitForRev(a,3);
      await editFromOtherTab(b,y.id,'Fictional unsent edit under the old passphrase');
      await writeFolderFixture(b,main,await readFolderFixture(a,main));
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await confirmChoice(b,'useLocal');
      await b.until("!!document.querySelector('.app-view')");
      const incoming=await readFolderFixture(b,main);
      const bytes=Buffer.from(incoming,'base64');
      const decoded=await decodeV2(bytes,PASSWORD);
      const otherEnvelope=Buffer.from(await encodeV2(decoded.key,bytes.subarray(0,16),decoded.payload)).toString('base64');
      assert.notEqual(otherEnvelope,incoming);
      const before=await preserved(a);
      await writeFolderFixture(a,main,incoming);
      await writeFolderFixture(a,'fictional-identical-copy.keeplocal',incoming);
      await writeFolderFixture(a,'fictional-other-envelope.keeplocal',otherEnvelope);
      await focus(a);
      await a.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await enterFolderPassword(a,PASSWORD);
      await a.until("!!document.querySelector('[data-folder-status=rollback]')");
      await confirmChoice(a,'joinBoth');
      await a.until("!!document.querySelector('.app-view')");
      await a.until(`(await import('./js/app.js')).getNotes().some(n=>n.id===${JSON.stringify(y.id)}&&n.content==='Fictional unsent edit under the old passphrase')`);
      const current=await a.eval("(await import('./js/app.js')).getNotes()");
      assert.equal(current.find(n=>n.id===x.id).content,'Fictional edit after the password change');
      const copies=await preserved(a);
      for(const old of before){const index=copies.indexOf(old);assert.ok(index>=0);copies.splice(index,1);}
      assert.equal(copies.filter(copy=>copy===incoming).length,1,'the exact incoming bytes must be preserved once');
      assert.equal(copies.filter(copy=>copy===otherEnvelope).length,1,'a distinct IV must keep its own preserved bytes');
      assert.equal(copies.length,3,'one local copy and two distinct folder byte versions');
      const local=copies.find(copy=>copy!==incoming&&copy!==otherEnvelope);
      const savedLocal=await decodeV2(Buffer.from(local,'base64'),NEW_PASSWORD);
      assert.equal((await decryptRecords(savedLocal.payload.notes,savedLocal.key)).find(n=>n.id===x.id).content,'Fictional edit after the password change');
      const joined=await decodeV2(Buffer.from(await readFolderFixture(a,main),'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(joined.payload.notes,joined.key),current);
    });
  });

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
