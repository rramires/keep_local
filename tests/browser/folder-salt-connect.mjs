import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {withTwoProfiles,connectBoth,waitForRev,editNote,editFromOtherTab,focus,ready} from './folder-merge.mjs';
import {signIn} from './folder-salt-login.mjs';
import {folderCopyEvidence} from './folder-copy-view.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';

async function choose(page,assert) {
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until("!!document.querySelector('[data-folder-action=choose]')");
  await page.eval("document.querySelector('[data-folder-action=choose]').click()");
  await page.until("folderTest.events.some(e=>e.kind==='picker')");
  await page.eval("await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
  assert.equal(await page.eval("!!document.querySelector('.app-dialog input[type=password]')"),true);
}

async function password(page,value=NEW_PASSWORD) {
  await page.eval(`(async()=>{const input=document.querySelector('.app-dialog input[type=password]');
    input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
}

async function chooseConnectedFolder(page,entry='banner') {
  if(entry==='banner'){
    await page.eval("document.querySelector('[data-folder-action=openReadOnly]').click()");
    await page.until("!!document.querySelector('.folder-banner [data-folder-action=chooseAnother]')");
  }
  if(entry==='settings'){
    await page.until("!!document.querySelector('#folder-settings-btn')");
    await page.eval("document.querySelector('#folder-settings-btn').click()");
    await page.until("!!document.querySelector('.folder-settings [data-folder-action=change]')");
    await page.eval("document.querySelector('.folder-settings [data-folder-action=change]').click()");
  }else{
    await page.eval("document.querySelector('[data-folder-action=chooseAnother]').click()");
  }
  await page.until("!!document.querySelector('.app-dialog input[type=password]')");
}

export async function run({check,assert}) {
  await check('H2b.9 the read-only banner reports an unresponsive folder without writing',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await connectBoth(a,b,[note({title:'Fictional same-folder timeout'})]);
      await rotate(a);
      await waitForRev(a,2);
      const main='keeplocal-vault.keeplocal';
      await writeFolderFixture(b,main,await readFolderFixture(a,main));
      await signIn(b,PASSWORD);
      await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await b.eval("document.querySelector('[data-folder-action=openReadOnly]').click()");
      const chooseAnother='.folder-banner [data-folder-action=chooseAnother]';
      await b.until(`!!document.querySelector(${JSON.stringify(chooseAnother)})`);
      const before=await folderCopyEvidence(b);
      await b.eval(`folderTest.clear();folderTest.stalls.add('isSameEntry');
        document.querySelector(${JSON.stringify(chooseAnother)}).click()`);
      await b.until("!!document.querySelector('.app-dialog input[type=password]')");
      await password(b);
      await b.until("folderTest.pending.some(read=>read.kind==='isSameEntry')");
      await b.until("!!document.querySelector('#toast-container .toast:last-child > span')");
      const message=await b.eval("document.querySelector('#toast-container .toast:last-child > span').textContent");
      assert.deepEqual(await b.eval('folderTest.writes'),{});
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      assert.deepEqual(await folderCopyEvidence(b),before);
      assert.equal(await b.eval("(await import('./js/db.js')).isReadOnly()"),true);
      assert.equal(message,await b.eval("(await import('./js/i18n.js')).t('folder.unresponsive')"));
    },{metadata:1500});
  });

  for(const entry of ['banner','gate','settings'])await check(`H2b.8 M1 reselecting the connected folder from ${entry} keeps the receipt and loads without conflicts`,async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictional same-folder X'}),y=note({title:'Fictional same-folder Y'});
      await connectBoth(a,b,[x,y]);
      await rotate(a);
      await editNote(a,x.id,{content:'Fictional newer text after the password change'});
      await waitForRev(a,3);
      const file=await readFolderFixture(a,'keeplocal-vault.keeplocal');
      await writeFolderFixture(b,'keeplocal-vault.keeplocal',file);
      const connection=await b.eval("(await import('./js/db.js')).getMeta('folderConnectionId')");
      if(entry==='gate'){
        await b.reload();
        await b.eval(`folderTest.permission='denied';document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
        await b.until("!!document.querySelector('[data-folder-status=denied]')");
      }else if(entry==='banner'){
        await signIn(b,PASSWORD);
        await b.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      }
      await chooseConnectedFolder(b,entry);
      await password(b);
      await b.until("!document.querySelector('.app-dialog')");
      await b.until(`!!document.querySelector('.folder-review')||((await import('./js/db.js')).isReadOnly()===false&&
        (await import('./js/app.js')).getNotes().some(n=>n.id===${JSON.stringify(x.id)}&&n.content==='Fictional newer text after the password change'))`);
      assert.equal(await b.eval("!!document.querySelector('.folder-review')"),false,'the existing receipt must allow a direct load');
      await ready(b);
      assert.equal(await b.eval("(await import('./js/db.js')).getMeta('folderConnectionId')"),connection);
      assert.ok(await b.eval("(await import('./js/db.js')).getMeta('folderSyncedHash')"));
      assert.deepEqual(await b.eval("(await import('./js/app.js')).getNotes()"),await a.eval("(await import('./js/app.js')).getNotes()"));
      assert.equal(await readFolderFixture(b,'keeplocal-vault.keeplocal'),file);
    });
  });

  await check('H2b.8 M1 reselecting the connected folder keeps the newer passphrase during a delayed old-password write',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const x=note({title:'Fictional same-folder race X'}),y=note({title:'Fictional same-folder race Y'});
      await connectBoth(a,b,[x,y]);
      await editFromOtherTab(a,x.id,'Fictional edit included in the password change');
      await rotate(a);
      const before=await a.eval("(await import('./js/db.js')).readVault().then(({meta})=>({salt:meta.salt,clock:meta.folderSaltClock,connection:meta.folderConnectionId}))");
      await editNote(b,y.id,{content:'Fictional delayed edit under the old passphrase'});
      await waitForRev(b,2);
      const delayed=await readFolderFixture(b,'keeplocal-vault.keeplocal');
      await writeFolderFixture(a,'keeplocal-vault.keeplocal',delayed);
      await focus(a);
      await a.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await chooseConnectedFolder(a);
      await password(a,PASSWORD);
      await a.until("!document.querySelector('.app-dialog')");
      await a.until(`!!document.querySelector('.folder-review')||((await import('./js/db.js')).isReadOnly()===false&&
        (await import('./js/app.js')).getNotes().some(n=>n.id===${JSON.stringify(y.id)}&&n.content==='Fictional delayed edit under the old passphrase'))`);
      assert.equal(await a.eval("!!document.querySelector('.folder-review')"),false);
      await ready(a);
      assert.equal(await a.eval("(await import('./js/db.js')).getMeta('salt')"),before.salt,'the lineage must keep the newer passphrase');
      assert.equal(await a.eval("(await import('./js/db.js')).getMeta('folderConnectionId')"),before.connection);
      assert.deepEqual(await a.eval("(await import('./js/db.js')).getMeta('folderSaltClock')"),before.clock);
      const current=await a.eval("(await import('./js/app.js')).getNotes()");
      assert.deepEqual(current.map(n=>n.content).sort(),['Fictional delayed edit under the old passphrase','Fictional edit included in the password change']);
      const copy=await decodeV2(Buffer.from(await readFolderFixture(a,'keeplocal-vault.keeplocal'),'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(copy.payload.notes,copy.key),current);
      assert.ok(await a.eval(`(async()=>{const directory=await(await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        for await(const handle of directory.values())if(new Uint8Array(await(await handle.getFile()).arrayBuffer()).toBase64()===${JSON.stringify(delayed)})return true;return false;})()`));
    });
  });

  await check('H2b.4 an empty new browser connects another-passphrase folder and adopts its passphrase',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());await create(page);
      const fixture=await backupFixture([note({title:'Fictional folder on a new computer'})],NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',fixture.base64);
      await choose(page,assert);await password(page);
      await page.until("!!document.querySelector('.app-view')&&!(document.querySelector('#modal-overlay')?.classList.contains('open'))");
      await page.until("(await import('./js/app.js')).getNotes()[0]?.title==='Fictional folder on a new computer'");
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].title"),'Fictional folder on a new computer');
      assert.equal(await page.eval("(await import('./js/db.js')).getMeta('salt')"),Buffer.from(fixture.bytes.slice(0,16)).toString('base64'));
      assert.equal(await readFolderFixture(page,'keeplocal-vault.keeplocal'),fixture.base64);
    }finally{await browser.close();}
  });

  await check('H2b.4 identical decrypted notes adopt the other salt without rewriting the main file',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());await create(page);
      await page.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional equivalent notes'}))})`);
      const values=await page.eval("(await import('./js/app.js')).getNotes()");
      const fixture=await backupFixture(values,NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',fixture.base64);
      await choose(page,assert);await password(page);
      await page.until(`(await import('./js/db.js')).getMeta('salt').then(salt=>salt===${JSON.stringify(Buffer.from(fixture.bytes.slice(0,16)).toString('base64'))})`);
      assert.deepEqual(await page.eval("(await import('./js/app.js')).getNotes()"),values);
      assert.equal(await readFolderFixture(page,'keeplocal-vault.keeplocal'),fixture.base64);
    }finally{await browser.close();}
  });

  await check('H2b.4 a first connection reviews competing notes and joining without a base keeps a conflict copy',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());await create(page);
      await page.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional competing local note',content:'Fictional local text'}))})`);
      const local=(await page.eval("(await import('./js/app.js')).getNotes()"))[0];
      const remote={...local,content:'Fictional foreign text',updatedAt:local.updatedAt+1};
      const fixture=await backupFixture([remote],NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',fixture.base64);
      await choose(page,assert);await password(page);
      await page.until("!!document.querySelector('[data-folder-status=conflict]')");
      for(const action of ['joinBoth','useFolder','useLocal'])
        assert.equal(await page.eval(`!!document.querySelector('[data-folder-action=${action}]')`),true);
      await page.eval("document.querySelector('[data-folder-action=joinBoth]').click()");
      await page.until("!!document.querySelector('.app-dialog input')");
      await page.eval(`(async()=>{const input=document.querySelector('.app-dialog input');
        input.value=(await import('./js/i18n.js')).t('folder.replaceWord');input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
      await page.until("!!document.querySelector('.app-view')");
      await page.until("(await import('./js/app.js')).getNotes().length===2");
      const current=await page.eval("(await import('./js/app.js')).getNotes()");
      assert.equal(current.length,2);
      assert.deepEqual(current.map(n=>n.content).sort(),[remote.content,local.content].sort());
      assert.equal(current.filter(n=>n.id!==local.id).length,1);
      const copy=await decodeV2(Buffer.from(await readFolderFixture(page,'keeplocal-vault.keeplocal'),'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(copy.payload.notes,copy.key),current);
    }finally{await browser.close();}
  });

  await check('H2b.4 cancelling the folder passphrase leaves the folder disconnected and makes zero writes',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());await create(page);
      const fixture=await backupFixture([note()],NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',fixture.base64);
      await page.eval("window.beforeCancelledConnection=JSON.stringify(await (await import('./js/db.js')).readVault());folderTest.clear()");
      await choose(page,assert);
      await page.eval("document.querySelector('[data-dialog-action=cancel]').click()");
      await page.until("!document.querySelector('.app-dialog')");
      await page.eval("await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
      assert.equal(await page.eval("JSON.stringify(await (await import('./js/db.js')).readVault())===window.beforeCancelledConnection"),true);
      assert.equal(await page.eval("(await import('./js/db.js')).getMeta('syncFolder')"),null);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      assert.equal(await readFolderFixture(page,'keeplocal-vault.keeplocal'),fixture.base64);
    }finally{await browser.close();}
  });

  await check('H2b.4 opening this browser read only from the first-connection review retains recovery controls',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());await create(page);
      await page.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional local read-only choice'}))})`);
      const fixture=await backupFixture([note({title:'Fictional other folder choice'})],NEW_PASSWORD);
      await writeFolderFixture(page,'keeplocal-vault.keeplocal',fixture.base64);
      await choose(page,assert);await password(page);
      await page.until("!!document.querySelector('[data-folder-status=conflict]')");
      await page.eval("window.beforeLocalReadOnly=JSON.stringify(await (await import('./js/db.js')).readVault());folderTest.clear();document.querySelector('[data-folder-action=openReadOnly]').click()");
      await page.until("!!document.querySelector('.app-view')");
      assert.equal(await page.eval("!!document.querySelector('.folder-banner [data-folder-action=chooseAnother]')"),true);
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].title"),'Fictional local read-only choice');
      assert.equal(await page.eval("JSON.stringify(await (await import('./js/db.js')).readVault())===window.beforeLocalReadOnly"),true);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
    }finally{await browser.close();}
  });
}
