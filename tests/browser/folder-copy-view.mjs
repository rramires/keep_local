import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {withTwoProfiles,connectBoth,editFromOtherTab,waitForFolderLineage} from './folder-merge.mjs';
import {signIn} from './folder-salt-login.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {vaultFixture,makeVaultScanner,mockVaultTimers} from './vault-core.mjs';

const MAIN='keeplocal-vault.keeplocal';

export async function folderCopyEvidence(page) {
  return page.eval(`(async()=>{
    const db=await import('./js/db.js'),c=await import('./js/crypto.js');
    const files={};
    async function visit(directory,path=''){
      for await(const [name,entry] of directory.entries()){
        const full=path+name;
        if(entry.kind==='directory')await visit(entry,full+'/');
        else files[full]=await c.bytesHash(new Uint8Array(await(await entry.getFile()).arrayBuffer()));
      }
    }
    await visit(await navigator.storage.getDirectory());
    return {vault:await db.readVault(),files,folder:(await db.getMeta('syncFolder'))?.name??null,
      local:Object.entries(localStorage),session:Object.entries(sessionStorage)};
  })()`);
}

export async function connectedCopyPage(browser,page) {
  page ||= await browser.page(undefined,folderFixtureSource('KL-TEST-CONNECTED-COPY'));
  await create(page);
  await page.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(note({title:'Fictional browser notes'}))})`);
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until("!!document.querySelector('[data-folder-action=choose]')");
  await page.eval("document.querySelector('[data-folder-action=choose]').click()");
  await page.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)");
  await waitForFolderLineage(page);
  await page.eval("document.querySelector('#modal-close').click()");
  await page.until("!document.querySelector('#modal-overlay').classList.contains('open')");
  return page;
}

export async function openCopyList(page,assert,{gate=false,ready=true}={}) {
  if(!gate){
    await page.eval("document.querySelector('#folder-settings-btn').click()");
    await page.until("!!document.querySelector('.folder-settings')");
  }
  assert.equal(await page.eval("!!document.querySelector('[data-folder-action=browseCopies]')"),true);
  await page.eval("folderTest.clear();document.querySelector('[data-folder-action=browseCopies]').click()");
  await page.until("!!document.querySelector('[data-folder-copy-list]')");
  if(ready)await page.until("document.querySelector('[data-folder-copy-list]').dataset.ready==='true'");
}

export async function openSelectedCopy(page) {
  await page.eval("document.querySelector('[data-copy-action=open]').click()");
  await page.until("!!document.querySelector('[data-folder-copy-view]')&&!!document.querySelector('.note-card,.vault-card,[data-view=vault]')");
  await page.until("(await import('./js/app.js')).getNotes().length>0");
}

async function returnToBrowser(page) {
  await page.eval("document.querySelector('[data-copy-action=back]').click()");
  await page.until("!!document.querySelector('.app-view')&&!document.querySelector('[data-folder-copy-view]')");
  await page.until("(await import('./js/app.js')).getNotes()[0]?.title==='Fictional browser notes'");
}

export async function run({check,assert}) {
  await check('H2b.5 copy list bounds files and opens a same-salt copy with zero writes',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      const localBytes=Buffer.from(await readFolderFixture(page,MAIN),'base64');
      const values=[note({title:'Fictional read-only folder note',content:'Fictional searchable copy text'})];
      const same=await backupFixture(values,PASSWORD,localBytes.subarray(0,16));
      const foreign=await backupFixture([note({title:'Fictional other passphrase copy'})],NEW_PASSWORD);
      await page.eval("folderTest.name='KL-TEST-READ-COPIES'");
      await writeFolderFixture(page,'same.keeplocal',await same.seal({...same.payload,rev:2}));
      await writeFolderFixture(page,'old.keeplocal',same.base64);
      await writeFolderFixture(page,'foreign.keeplocal',foreign.base64);
      await writeFolderFixture(page,'broken.keeplocal',Buffer.from('broken').toString('base64'));
      await page.eval(`(async()=>{const dir=await folderTest.directory();const file=await dir.getFileHandle('large.keeplocal',{create:true});
        const stream=await file.createWritable();await stream.truncate(64*1024*1024+1);await stream.close();
        const kept=await dir.getDirectoryHandle('keeplocal-preserved',{create:true});const saved=await kept.getFileHandle('untouched.keeplocal',{create:true});
        const output=await saved.createWritable();await output.write('Fictional preserved bytes');await output.close();})()`);
      const before=await folderCopyEvidence(page);
      await openCopyList(page,assert);
      assert.deepEqual(await page.eval("folderTest.events.find(e=>e.kind==='picker').options"),{mode:'read',id:'keeplocal-copy-view'});
      assert.deepEqual(await page.eval("[...document.querySelectorAll('[data-copy-name]')].map(row=>[row.dataset.copyName,row.dataset.copyStatus]).sort()"),
        [['broken.keeplocal','unreadable'],['foreign.keeplocal','otherSalt'],['large.keeplocal','tooLarge'],['old.keeplocal','valid'],['same.keeplocal','valid']]);
      assert.equal(await page.eval("document.querySelector('[data-copy-name=\"same.keeplocal\"] input').checked"),true);
      await page.eval("document.querySelector('[data-copy-name=\"old.keeplocal\"] input').click()");
      assert.match(await page.eval("document.querySelector('[data-copy-warning]').textContent"),/older than.*1/i);
      await page.eval("document.querySelector('[data-copy-name=\"same.keeplocal\"] input').click()");
      await openSelectedCopy(page);
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].title"),values[0].title);
      assert.match(await page.eval("document.querySelector('.folder-copy-banner').textContent"),/same\.keeplocal.*KL-TEST-READ-COPIES.*2/);
      assert.equal(await page.eval("(await import('./js/session.js')).getSessionKey()"),null);
      assert.equal(await page.eval("getComputedStyle(document.querySelector('#backup-btn')).display"),'none');
      assert.equal(await page.eval("(await import('./js/backup.js')).exportBackup().then(()=>false,()=>true)"),true);
      await page.eval("document.querySelector('#search-input').value='searchable';document.querySelector('#search-input').dispatchEvent(new Event('input',{bubbles:true}))");
      await page.until("document.querySelectorAll('.note-card').length===1");
      await page.eval(`(async()=>{
        window.copyProbeReceived=0;
        window.unwatchCopyProbe=(await import('./js/vault-events.js')).watchVaultEvents(()=>copyProbeReceived++);
        const channel=new BroadcastChannel('keeplocal-vault');
        channel.postMessage({type:'note-changed',id:${JSON.stringify(values[0].id)}});
        channel.postMessage({type:'vault-replaced',vaultId:'fictitious-other-tab-vault'});
        channel.close();window.dispatchEvent(new Event('focus'));
      })()`);
      await page.until('copyProbeReceived===2');
      await page.eval('window.unwatchCopyProbe()');
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].title"),values[0].title);
      assert.deepEqual(await folderCopyEvidence(page),before);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      await returnToBrowser(page);
      assert.deepEqual(await folderCopyEvidence(page),before);
      await page.eval("await (await import('./js/app.js')).saveNote({... (await import('./js/app.js')).getNotes()[0],content:'Fictional edit after returning'})");
      await page.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev===2)");
    }finally{await browser.close();}
  });

  await check('H2b.5 another salt unlocks once and vault secrets remain masked through read-only tools',async()=>{
    const browser=await launchExtension();let scanner;
    try{
      const page=await browser.page(undefined,folderFixtureSource('KL-TEST-CONNECTED-SECRETS'));
      const sentinel='FICTIONAL-COPY-SECRET-'+crypto.randomUUID();
      scanner=await makeVaultScanner(browser,page,assert,[sentinel]);
      await connectedCopyPage(browser,page);
      const item=vaultFixture({title:'Fictional copy server',blocks:[{id:crypto.randomUUID(),kind:'field',label:'Password',value:sentinel,secret:true,primary:true}]});
      const fixture=await backupFixture([item],NEW_PASSWORD);
      await page.eval("folderTest.name='KL-TEST-FOREIGN-READ'");
      await writeFolderFixture(page,'foreign.keeplocal',fixture.base64);
      await writeFolderFixture(page,'second.keeplocal',await fixture.seal({...fixture.payload,rev:3}));
      const before=await folderCopyEvidence(page);
      await openCopyList(page,assert);
      await page.eval("document.querySelector('[data-copy-action=password]').click()");
      await page.until("!!document.querySelector('.app-dialog input[type=password]')");
      await page.eval(`(()=>{window.copyPasswordInput=document.querySelector('.app-dialog input[type=password]');copyPasswordInput.value=${JSON.stringify(NEW_PASSWORD)};
        copyPasswordInput.dispatchEvent(new Event('input',{bubbles:true}));copyPasswordInput.closest('form').requestSubmit();})()`);
      await page.until("document.querySelectorAll('[data-copy-status=valid]').length===2");
      assert.equal(await page.eval("copyPasswordInput.value"),'');
      assert.equal(await page.eval("folderTest.events.filter(e=>e.kind==='deriveKey'||e.kind==='deriveBits').length"),1);
      assert.equal(await page.eval("document.querySelector('[data-copy-name=\"second.keeplocal\"] input').checked"),true);
      await openSelectedCopy(page);
      await page.eval("document.querySelector('[data-view=vault]').click()");
      await page.until("!!document.querySelector('.vault-card')");
      for(const layout of ['list','grid']){
        await page.eval(`document.querySelector('[data-vault-layout=${layout}]').click()`);
        await scanner.scan('copy vault '+layout);
      }
      await mockVaultTimers(page);
      await page.eval("window.copyClipboard=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>copyClipboard.push(value)}});document.hasFocus=()=>true;document.querySelector('[data-vault-open]').click()");
      await page.until("!!document.querySelector('.vault-detail')");
      await scanner.scan('copy detail masked');
      await page.eval("document.querySelector('[data-vault-reveal]').click()");
      await page.until("vaultTimers.has(15000)");
      await page.eval("vaultTimers.fire(15000)");
      await scanner.scan('copy detail auto-hidden');
      await page.eval("document.querySelector('[data-vault-copy]').click()");
      await page.until("vaultTimers.has(20000)");
      assert.equal(await page.eval('copyClipboard.at(-1)'),sentinel);
      await page.eval('vaultTimers.fire(20000)');
      await page.until("copyClipboard.at(-1)===''");
      await page.eval("document.querySelector('#modal-close').click()");
      await page.until("!document.querySelector('.vault-detail')");
      await page.eval(`document.querySelector('#search-input').value=${JSON.stringify(sentinel)};document.querySelector('#search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
      await page.until("document.querySelectorAll('.vault-card').length===0");
      await page.eval("document.querySelector('#search-clear').click()");
      await scanner.scan('copy search and toast');
      assert.deepEqual(await folderCopyEvidence(page),before);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      await returnToBrowser(page);
      await scanner.scan('after leaving copy');
      assert.deepEqual(await folderCopyEvidence(page),before);
    }finally{scanner?.dispose();await browser.close();}
  });

  await check('H2b.5 unavailable-folder copy browsing restores read-only mode and discards keys on lock or expiry',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      await page.reload();await page.eval("folderTest.requested='denied'");
      await page.eval(`document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
      await page.until("!!document.querySelector('[data-folder-status=denied]')");
      const fixture=await backupFixture([note({title:'Fictional unavailable-folder recovery'})],NEW_PASSWORD);
      await page.eval("folderTest.name='KL-TEST-PRESERVED-READ'");await writeFolderFixture(page,MAIN,fixture.base64);
      const before=await folderCopyEvidence(page);
      for(const exit of ['back','lock','expiry']){
        if(exit!=='back'){
          await page.eval(`document.querySelector('#lock-btn').click()`);
          await page.until("!!document.querySelector('#login-password')");
          await page.eval(`document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
          await page.until("!!document.querySelector('[data-folder-status=denied]')");
        }
        await openCopyList(page,assert,{gate:true});
        await page.eval("document.querySelector('[data-copy-action=password]').click()");
        await page.until("!!document.querySelector('.app-dialog input[type=password]')");
        await page.eval(`(()=>{const input=document.querySelector('.app-dialog input');input.value=${JSON.stringify(NEW_PASSWORD)};input.dispatchEvent(new Event('input'));input.closest('form').requestSubmit();})()`);
        await page.until("!!document.querySelector('[data-copy-status=valid]')");await openSelectedCopy(page);
        if(exit==='back'){
          await returnToBrowser(page);
          assert.equal(await page.eval("(await import('./js/db.js')).isReadOnly()"),true);
          assert.equal(await page.eval("!!document.querySelector('.folder-banner [data-folder-action=browseCopies]')"),true);
        }else{
          if(exit==='lock')await page.eval("document.querySelector('#lock-btn').click()");
          else await page.eval("(await import('./js/session.js')).setIdleTimeout(1);await new Promise(resolve=>setTimeout(resolve,5));(await import('./js/session.js')).checkDeadline()");
          await page.until("!!document.querySelector('#login-password')");
          assert.equal(await page.eval("(await import('./js/app.js')).getCryptoKey()"),null);
          assert.equal(await page.eval("(await import('./js/folder-copy-view.js')).getFolderCopy()"),null);
          assert.equal(await page.eval("(await import('./js/session.js')).getSessionKey()"),null);
        }
        assert.deepEqual(await folderCopyEvidence(page),before);
        assert.deepEqual(await page.eval('folderTest.writes'),{});
        if(exit==='lock'){
          await page.eval(`document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);
          await page.until("!!document.querySelector('[data-folder-status=denied]')");
          await page.eval("document.querySelector('[data-folder-action=openReadOnly]').click()");
          await page.until("!!document.querySelector('.app-view')");
        }
      }
    }finally{await browser.close();}
  });

  await check('H2b.5 changed-password gate opens the folder copy without another derivation or picker',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional pre-login copy'});await connectBoth(a,b,[item]);
      await editFromOtherTab(b,item.id,'Fictional unsent browser edit');await rotate(a);
      await writeFolderFixture(b,MAIN,await readFolderFixture(a,MAIN));await signIn(b,NEW_PASSWORD);
      assert.equal(await b.eval("document.querySelector('[data-folder-action=openFolderCopy]').disabled"),false);
      const before=await folderCopyEvidence(b);
      await b.eval("folderTest.clear();document.querySelector('[data-folder-action=openFolderCopy]').click()");
      await b.until("!!document.querySelector('[data-folder-copy-list][data-ready=true]')");
      await openSelectedCopy(b);
      assert.equal(await b.eval("(await import('./js/app.js')).getNotes()[0].content"),item.content);
      assert.equal(await b.eval("(await import('./js/session.js')).getSessionKey()"),null);
      assert.equal(await b.eval("folderTest.events.some(e=>['picker','deriveKey','deriveBits'].includes(e.kind))"),false);
      assert.deepEqual(await folderCopyEvidence(b),before);
      await b.eval("document.querySelector('[data-copy-action=back]').click()");await b.until("!!document.querySelector('#login-password')");
      assert.deepEqual(await folderCopyEvidence(b),before);
    });
  });

  await check('H2b.5 the copy picker reads preserved subfolders with candidate limits and read deadlines',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource('KL-TEST-PRESERVED-ROOT',{metadata:150,file:250}));
      await connectedCopyPage(browser,page);
      const main=Buffer.from(await readFolderFixture(page,MAIN),'base64');
      const fixture=await backupFixture([note({title:'Fictional preserved copy'})],PASSWORD,main.subarray(0,16));
      await page.eval(`(async()=>{
        const parent=await folderTest.directory(),saved=await parent.getDirectoryHandle('keeplocal-preserved',{create:true});
        const bytes=(await import('./js/crypto.js')).base64ToArray(${JSON.stringify(fixture.base64)});
        for(let index=0;index<34;index++){
          const file=await saved.getFileHandle('preserved-'+index+'.keeplocal',{create:true});
          const output=await file.createWritable();await output.write(bytes);await output.close();
        }
        window.showDirectoryPicker=async options=>{
          folderTest.events.push({kind:'picker',options});return saved;
        };
      })()`);
      const before=await folderCopyEvidence(page);
      await openCopyList(page,assert);
      assert.equal(await page.eval("document.querySelectorAll('[data-copy-name]').length"),32);
      assert.match(await page.eval("document.querySelector('[data-folder-copy-list]').innerText"),/first 32/);
      await openSelectedCopy(page);
      assert.match(await page.eval("document.querySelector('.folder-copy-banner').textContent"),/keeplocal-preserved/);
      await returnToBrowser(page);
      await page.eval("folderTest.stalls.add('entries')");
      await openCopyList(page,assert,{ready:false});
      await page.until("!!document.querySelector('[data-folder-copy-list] .form-error').textContent");
      assert.match(await page.eval("document.querySelector('[data-folder-copy-list] .form-error').textContent"),/did not respond/i);
      await page.eval("folderTest.stalls.clear();folderTest.release();document.querySelector('[data-copy-action=back]').click()");
      await page.until("!!document.querySelector('#folder-settings-btn')");
      assert.deepEqual(await folderCopyEvidence(page),before);
    }finally{await browser.close();}
  });

  await check('H2b.5 cancelling the copy picker or entering a wrong copy passphrase keeps both folders intact',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      const fixture=await backupFixture([note()],NEW_PASSWORD);
      await page.eval("folderTest.name='KL-TEST-CANCELLED-READ'");await writeFolderFixture(page,MAIN,fixture.base64);
      const before=await folderCopyEvidence(page);
      await page.eval("document.querySelector('#folder-settings-btn').click()");
      await page.until("!!document.querySelector('[data-folder-action=browseCopies]')");
      await page.eval("folderTest.clear();folderTest.cancel=true;document.querySelector('[data-folder-action=browseCopies]').click()");
      await page.until("!(await import('./js/db.js')).isReadOnly()");
      assert.deepEqual(await folderCopyEvidence(page),before);
      await page.eval("folderTest.cancel=false;document.querySelector('[data-folder-action=browseCopies]').click()");
      await page.until("!!document.querySelector('[data-folder-copy-list][data-ready=true]')");
      await page.eval("document.querySelector('[data-copy-action=password]').click()");
      await page.until("!!document.querySelector('.app-dialog input[type=password]')");
      await page.eval("window.wrongCopyPassword=document.querySelector('.app-dialog input');wrongCopyPassword.value='Fictional wrong copy passphrase';wrongCopyPassword.dispatchEvent(new Event('input'));wrongCopyPassword.closest('form').requestSubmit()");
      await page.until("document.querySelector('.form-error')?.textContent.includes('does not open')");
      assert.equal(await page.eval('wrongCopyPassword.value'),'');
      assert.equal(await page.eval("document.querySelectorAll('[data-copy-status=valid]').length"),0);
      assert.deepEqual(await folderCopyEvidence(page),before);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      await returnToBrowser(page);
    }finally{await browser.close();}
  });
}
