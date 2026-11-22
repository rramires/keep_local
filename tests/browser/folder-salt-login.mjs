import {note,PASSWORD} from './harness.mjs';
import {withTwoProfiles,connectBoth,waitForRev,editNote,editFromOtherTab} from './folder-merge.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';

export async function signIn(page,password) {
  await page.reload();
  await page.until("!!document.querySelector('#login-password')");
  await page.eval(`folderTest.permission='prompt';folderTest.clear();
    window.loginGateTimers=new Set();
    const setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window);
    window.setTimeout=(callback,delay,...args)=>{const id=setTimer(callback,delay,...args);if(delay===300000)window.loginGateTimers.add(id);return id;};
    window.clearTimeout=id=>{window.loginGateTimers.delete(id);return clearTimer(id);};
    const session=await import('./js/session.js'),put=IDBObjectStore.prototype.put;
    window.keysDuringReplacement=[];
    IDBObjectStore.prototype.put=function(row){
      if(this.name==='meta'&&['salt','folderSaltClock','folderSyncedHash'].includes(row.key))
        window.keysDuringReplacement.push(session.getSessionKey().then(key=>!!key));
      return put.call(this,row);
    };
    document.querySelector('#login-password').value=${JSON.stringify(password)};
    document.querySelector('#login-form').requestSubmit();`);
  await page.until("!!document.querySelector('.app-view')||!!document.querySelector('[data-folder-changed]')||!!document.querySelector('#login-error')?.textContent");
}

export async function enterLocalPassword(page,password=PASSWORD) {
  await page.eval("document.querySelector('[data-folder-action=enterLocalPassword]').click()");
  await page.until("!!document.querySelector('.app-dialog input[type=password]')");
  await page.eval(`const input=document.querySelector('.app-dialog input[type=password]');
    input.value=${JSON.stringify(password)};input.dispatchEvent(new Event('input',{bubbles:true}));
    input.closest('form').requestSubmit();`);
}

export async function interruptRotation(page,item,{edit=false}={}) {
  await page.eval(`
    window.rotationClosed=false;
    const createWritable=FileSystemFileHandle.prototype.createWritable;
    const put=IDBObjectStore.prototype.put;
    FileSystemFileHandle.prototype.createWritable=async function(...args){
      const stream=await createWritable.apply(this,args);
      if(this.name==='keeplocal-vault.keeplocal'){
        const close=stream.close.bind(stream);
        stream.close=async()=>{await close();window.rotationClosed=true;await new Promise(resolve=>window.releaseRotation=resolve);};
      }
      return stream;
    };
    if(!${edit})IDBObjectStore.prototype.put=function(row){
      if(this.name==='meta'&&row.key==='folderSaltClock')throw Error('Fictional step six failure');
      return put.call(this,row);
    };
    window.rotationResult=(await import('./js/account.js')).changePassword(${JSON.stringify(PASSWORD)},${JSON.stringify(NEW_PASSWORD)},{signal:new AbortController().signal})
      .then(()=>({}),e=>({code:e.code})).finally(()=>{FileSystemFileHandle.prototype.createWritable=createWritable;IDBObjectStore.prototype.put=put;});
    void 0;
  `);
  await page.until('window.rotationClosed');
  if(edit)await editFromOtherTab(page,item.id,'Fictional edit made by another tab during rotation');
  return page.eval('(async()=>{window.releaseRotation();return window.rotationResult;})()');
}

export async function run({check,assert}) {
  await check('H2b.2 a pre-login conflict exports the local copy without activating a key or changing storage',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional unproven local version'});
      await connectBoth(a,b,[item]);
      await editFromOtherTab(b,item.id,'Fictional local edit without a stored base');
      await b.eval("await (await import('./js/db.js')).deleteMeta('folderSyncedVersions')");
      await rotate(a);
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',await readFolderFixture(a,'keeplocal-vault.keeplocal'));
      await signIn(b,NEW_PASSWORD);
      await enterLocalPassword(b);
      await b.until("!!document.querySelector('[data-folder-status=conflict]')");
      await b.eval(`window.beforeConflictExport=JSON.stringify(await (await import('./js/db.js')).readVault());
        URL.createObjectURL=blob=>{window.conflictExport=blob;return 'blob:fixture';};
        URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};
        document.querySelector('[data-folder-action=exportLocal]').click();`);
      await b.until('!!window.conflictExport');
      const exported=await b.eval('new Uint8Array(await window.conflictExport.arrayBuffer()).toBase64()');
      const copy=await decodeV2(Buffer.from(exported,'base64'),PASSWORD);
      assert.equal((await decryptRecords(copy.payload.notes,copy.key))[0].content,'Fictional local edit without a stored base');
      assert.equal(await b.eval("JSON.stringify(await (await import('./js/db.js')).readVault())===window.beforeConflictExport"),true);
      assert.equal(await b.eval("await (await import('./js/session.js')).getSessionKey()"),null);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
    });
  });
  await check('H2b.2 the second computer signs in with the new folder passphrase and rejects the old one',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional new-passphrase sign-in'})]);
      await rotate(a);
      const file=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',file);
      await signIn(b,NEW_PASSWORD);
      assert.equal(await b.eval("document.querySelector('#login-error')?.textContent||''"),'');
      await b.until("!!document.querySelector('.app-view')");
      assert.equal(await b.eval("(await import('./js/app.js')).getNotes()[0].title"),'Fictional new-passphrase sign-in');
      const evidence=await b.eval("({events:folderTest.events.map(e=>e.kind),writes:folderTest.writeAttempts,body:document.body.textContent})");
      assert.deepEqual(evidence.events.slice(0,3),['query','request','deriveKey']);
      assert.equal(evidence.events.filter(e=>e==='deriveKey').length,2);
      assert.equal(evidence.writes,0);
      const keys=await b.eval('Promise.all(window.keysDuringReplacement)');
      assert.ok(keys.length>=3);
      assert.ok(keys.every(active=>active===false));
      assert.ok(evidence.body.includes('This browser now uses the new passphrase.'));
      assert.equal(await readFolderFixture(b,'keeplocal-vault.keeplocal'),file);
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('#login-error')?.textContent");
      assert.equal(await b.eval("document.querySelector('#login-error').textContent"),'Incorrect passphrase.');
      assert.equal(await b.eval("folderTest.events.filter(e=>e.kind==='deriveKey').length"),1);
    });
  });

  await check('H2b.2 an unsent edit asks for the old local passphrase and joins both computers',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictional shared X'}),y=note({title:'Fictional shared Y'});
      await connectBoth(a,b,[x,y]);
      await editNote(a,x.id,{content:'Fictional edit from computer A'});
      await waitForRev(a,2);
      await editFromOtherTab(b,y.id,'Fictional unsent edit from computer B');
      await rotate(a);
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',await readFolderFixture(a,'keeplocal-vault.keeplocal'));
      await signIn(b,NEW_PASSWORD);
      await b.until("!!document.querySelector('[data-folder-changed]')");
      assert.equal(await b.eval("await (await import('./js/session.js')).getSessionKey()"),null);
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      await enterLocalPassword(b);
      await b.until("!!document.querySelector('.app-view')");
      const contents=await b.eval("(await import('./js/app.js')).getNotes().map(n=>n.content).sort()");
      assert.equal(await b.eval('window.loginGateTimers.size'),0);
      assert.deepEqual(contents,['Fictional edit from computer A','Fictional unsent edit from computer B']);
      const file=await readFolderFixture(b,'keeplocal-vault.keeplocal');
      await writeFolderFixture(a,'keeplocal-vault.keeplocal',file);
      await signIn(a,NEW_PASSWORD);
      await a.until("!!document.querySelector('.app-view')");
      assert.deepEqual(await a.eval("(await import('./js/app.js')).getNotes().map(n=>n.content).sort()"),contents);
    });
  });

  for(const edit of [false,true])await check(`H2b.2 step six recovery on the same computer ${edit?'retains the intervening tab edit':'loads a clean local vault directly'}`,async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional same-computer recovery'});
      await connectBoth(a,b,[item]);
      assert.equal((await interruptRotation(a,item,{edit})).code,'account.folderApplyFailed');
      const file=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      const expected=await decodeV2(Buffer.from(file,'base64'),NEW_PASSWORD);
      await signIn(a,NEW_PASSWORD);
      if(edit){
        await a.until("!!document.querySelector('[data-folder-changed]')");
        assert.equal(await a.eval("await (await import('./js/session.js')).getSessionKey()"),null);
        await enterLocalPassword(a);
      }
      await a.until("!!document.querySelector('.app-view')");
      const current=await a.eval("(await import('./js/app.js')).getNotes()");
      assert.equal(current.length,1);
      assert.equal(current[0].content,edit?'Fictional edit made by another tab during rotation':item.content);
      assert.equal(await a.eval("(await import('./js/db.js')).getMeta('salt')"),Buffer.from(expected.salt).toString('base64'));
      const recovered=await decodeV2(Buffer.from(await readFolderFixture(a,'keeplocal-vault.keeplocal'),'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(recovered.payload.notes,recovered.key),current);
    });
  });

  await check('H2b.2 failed sign-in uses one derivation for a same-salt main and reports an unreadable folder separately',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note()]);
      await signIn(b,'Fictional incorrect passphrase');
      assert.equal(await b.eval("document.querySelector('#login-error').textContent"),'Incorrect passphrase.');
      assert.equal(await b.eval("folderTest.events.filter(e=>e.kind==='deriveKey').length"),1);
      await rotate(a);
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',await readFolderFixture(a,'keeplocal-vault.keeplocal'));
      await signIn(b,'Fictional incorrect passphrase');
      assert.equal(await b.eval("document.querySelector('#login-error').textContent"),'Incorrect passphrase.');
      assert.equal(await b.eval("folderTest.events.filter(e=>e.kind==='deriveKey').length"),2);
      await b.reload();
      await b.until("!!document.querySelector('#login-password')");
      await b.eval(`folderTest.requested='denied';document.querySelector('#login-password').value=${JSON.stringify(NEW_PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
      await b.until("!!document.querySelector('#login-error').textContent");
      assert.ok(await b.eval("document.querySelector('#login-error').textContent.includes('folder could not be read')"));
      assert.deepEqual(await b.eval('folderTest.writes'),{});
    });
  });
}
