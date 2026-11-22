import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {NEW_PASSWORD} from './folder-salt.mjs';
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

async function password(page) {
  await page.eval(`(async()=>{const input=document.querySelector('.app-dialog input[type=password]');
    input.value=${JSON.stringify(NEW_PASSWORD)};input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`);
}

export async function run({check,assert}) {
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
