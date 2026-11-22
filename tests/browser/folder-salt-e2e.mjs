import {launch,launchExtension,note,PASSWORD} from './harness.mjs';
import {withTwoProfiles,connectBoth,editNote,waitForRev,ready,focus} from './folder-merge.mjs';
import {signIn} from './folder-salt-login.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {vaultFixture} from './vault-core.mjs';
import {assertReadsMergedCopy} from './recovery-tool.mjs';
import {withArchivedProfile2} from '../build/archived-profile2.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';
import {validateNote} from '../../js/note-model.js';
import {backupFixture} from './backup-fixture.mjs';
import {connectedCopyPage,folderCopyEvidence,openCopyList,openSelectedCopy} from './folder-copy-view.mjs';

const MAIN='keeplocal-vault.keeplocal';

async function maskedVaults(page,secrets,assert) {
  await page.eval("document.querySelector('[data-view=vault]').click()");
  await page.until("document.querySelectorAll('.vault-card').length===2");
  for(const layout of ['list','grid']){
    await page.eval(`document.querySelector('[data-vault-layout=${layout}]').click()`);
    assert.equal(await page.eval(`${JSON.stringify(secrets)}.some(value=>document.documentElement.outerHTML.includes(value))`),false);
  }
  await page.eval(`document.querySelector('#search-input').value=${JSON.stringify(secrets[0])};document.querySelector('#search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  await page.until("document.querySelectorAll('.vault-card').length===0");
  await page.eval("document.querySelector('#search-clear').click()");
  assert.equal(await page.eval(`${JSON.stringify(secrets)}.some(value=>document.querySelector('#toast-container').textContent.includes(value))`),false);
}

export async function run({check,assert}) {
  await check('H2b.6 two computers converge after rotation and keep vault secrets masked without repeated folder writes',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional complete password cycle'});
      const secrets=['FICTIONAL-CYCLE-SECRET-'+crypto.randomUUID(),'FICTIONAL-CYCLE-TOKEN-'+crypto.randomUUID()];
      const vaults=secrets.map((value,index)=>vaultFixture({title:'Fictional protected server '+index,blocks:[
        {id:crypto.randomUUID(),kind:'field',label:'Host',value:'example-'+index+'.invalid'},
        {id:crypto.randomUUID(),kind:'field',label:'Password',value,secret:true},
      ]}));
      const oldFile=await connectBoth(a,b,[item,...vaults]);
      await rotate(a);
      const rotated=await readFolderFixture(a,MAIN);
      const preserved=await a.eval(`(async()=>{
        const directory=await(await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const copies=[];
        for await(const entry of directory.values())if(entry.kind==='file')
          copies.push(new Uint8Array(await(await entry.getFile()).arrayBuffer()).toBase64());
        return copies;
      })()`);
      assert.ok(preserved.includes(oldFile));
      await writeFolderFixture(b,MAIN,rotated);await signIn(b,NEW_PASSWORD);await ready(b);
      await editNote(b,item.id,{content:'Fictional edit on computer B after the passphrase change'});
      await focus(b);await waitForRev(b,3);
      const joined=await readFolderFixture(b,MAIN);
      await writeFolderFixture(a,MAIN,joined);await signIn(a,NEW_PASSWORD);await ready(a);await waitForRev(a,3);
      const expected=await a.eval("(await import('./js/app.js')).getNotes()");
      assert.equal(expected.find(value=>value.id===item.id).content,'Fictional edit on computer B after the passphrase change');
      assert.deepEqual(await b.eval("(await import('./js/app.js')).getNotes()"),expected);
      for(const value of expected)validateNote(value);
      for(const page of [a,b])await maskedVaults(page,secrets,assert);
      await withArchivedProfile2('47310be',async({backup,format,model})=>{
        const copy=await backup.decodeV2(Buffer.from(joined,'base64'),NEW_PASSWORD);
        format.validateRecords(copy.payload.notes);
        const values=await format.decryptRecords(copy.payload.notes,copy.key);
        values.forEach(model.validateNote);
        assert.deepEqual(values,expected);
        assert.equal(Object.hasOwn(copy.payload,'folderSaltClock'),false);
        assert.deepEqual(Object.keys(copy.payload).sort(),[
          'v','profile','rev','parent','exportedAt','preferences','notes','manifest','tombstones','ancestors','clock',
        ].sort());
      });
      const reader=await launch();
      try{
        const titles=[item.title,...vaults.map(value=>value.title)];
        await assertReadsMergedCopy({browser:reader,assert,base64:joined,password:NEW_PASSWORD,titles,secrets});
        await assertReadsMergedCopy({browser:reader,assert,base64:oldFile,password:PASSWORD,titles,secrets});
      }finally{await reader.close();}
      for(const page of [a,b]){
        const before=(await folderCopyEvidence(page)).files;
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
          window.h2bFileWrites=[];
          const createWritable=FileSystemFileHandle.prototype.createWritable;
          FileSystemFileHandle.prototype.createWritable=function(...args){
            h2bFileWrites.push(this.name);return createWritable.apply(this,args);
          };
        })()`});
        for(let round=0;round<2;round++){
          await signIn(page,NEW_PASSWORD);await ready(page);
          await focus(page);
          await page.eval("await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
          assert.equal(await page.eval('folderTest.writeAttempts'),0);
          assert.deepEqual(await page.eval('h2bFileWrites'),[]);
          assert.equal(await readFolderFixture(page,MAIN),joined);
          assert.deepEqual((await folderCopyEvidence(page)).files,before);
        }
      }
      const decoded=await decodeV2(Buffer.from(joined,'base64'),NEW_PASSWORD);
      assert.deepEqual(await decryptRecords(decoded.payload.notes,decoded.key),expected);
    });
  });

  await check('H2b.6 an unavailable read-only vault refuses rotation and still opens another folder copy with zero writes',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      const localFile=Buffer.from(await readFolderFixture(page,MAIN),'base64');
      const fixture=await backupFixture([note({title:'Fictional read-only rescue after a refusal'})],PASSWORD,localFile.subarray(0,16));
      await page.reload();await page.eval("folderTest.requested='denied'");
      await page.eval(`document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
      await page.until("!!document.querySelector('[data-folder-status=denied]')");
      await page.eval("folderTest.name='KL-TEST-READONLY-RESCUE'");await writeFolderFixture(page,MAIN,fixture.base64);
      const before=await folderCopyEvidence(page);
      const outcome=await page.eval(`(await import('./js/account.js')).changePassword(${JSON.stringify(PASSWORD)},${JSON.stringify(NEW_PASSWORD)})
        .then(()=>null,error=>error.code)`);
      assert.equal(outcome,'vault.readOnly');
      assert.deepEqual(await folderCopyEvidence(page),before);
      await openCopyList(page,assert,{gate:true});await openSelectedCopy(page);
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].title"),'Fictional read-only rescue after a refusal');
      assert.deepEqual(await folderCopyEvidence(page),before);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      await page.eval("document.querySelector('[data-copy-action=back]').click()");
      await page.until("!!document.querySelector('.folder-banner')");
      assert.equal(await page.eval("(await import('./js/db.js')).isReadOnly()"),true);
      assert.deepEqual(await folderCopyEvidence(page),before);
    }finally{await browser.close();}
  });
}
