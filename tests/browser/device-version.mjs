import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {connectBoth,editNote,focus,relogin,waitForFolderLineage,waitForRev,withTwoProfiles} from './folder-merge.mjs';
import {copyFolderFiles,readFolderFixture} from './folder-transfer.mjs';
import {connectedCopyPage} from './folder-copy-view.mjs';
import {exportFromApp} from './recovery-tool.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {backupFixture,importExpression} from './backup-fixture.mjs';
import {withDialogs} from './dialog-driver.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';

const meta=(page,name)=>page.eval(`(await import('./js/db.js')).getMeta(${JSON.stringify(name)})`);

async function openSettings(page,action){
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until(`!!document.querySelector('.folder-settings [data-folder-action=${action}]')`);
}

export async function runP51({check,assert}){
  await check('P5.1 a folder choice calls the picker in the click and asks for an optional local name',async()=>{
    const browser=await launchExtension();
    const prompt='.app-dialog input[name=deviceName]';
    try{
      const page=await browser.page(undefined,folderFixtureSource());
      await create(page);
      await openSettings(page,'choose');
      await page.eval(`(()=>{
        folderTest.showDeviceNamePrompt=true;
        const pick=window.showDirectoryPicker;
        let clicking=true;
        window.showDirectoryPicker=options=>{
          folderTest.pickerDuringClick=clicking;
          return pick(options);
        };
        document.querySelector('[data-folder-action=choose]').click();
        clicking=false;
      })()`);
      await page.until(`!!document.querySelector(${JSON.stringify(prompt)})||!!document.querySelector('[data-folder-action=change]')`);
      assert.equal(await page.eval('folderTest.pickerDuringClick'),true);
      assert.equal(await page.eval("folderTest.events.find(event=>event.kind==='picker').active"),true);
      assert.equal(await page.eval(`!!document.querySelector(${JSON.stringify(prompt)})`),true);
      assert.equal(await meta(page,'deviceName'),null);
      await page.eval("document.querySelector('.app-dialog [data-dialog-action=cancel]').click()");
      await page.until("!!document.querySelector('[data-folder-action=change]')");
      assert.equal(await meta(page,'deviceName'),null);

      await page.eval("document.querySelector('[data-folder-action=change]').click()");
      await page.until(`!!document.querySelector(${JSON.stringify(prompt)})`);
      for(const invalid of ['   ','X'.repeat(41),'bad\u007Fname']){
        await page.eval(`(()=>{
          const input=document.querySelector(${JSON.stringify(prompt)});
          input.value=${JSON.stringify(invalid)};
          input.dispatchEvent(new Event('input'));
        })()`);
        assert.equal(await page.eval("document.querySelector('.app-dialog [data-dialog-action=confirm]').disabled"),true);
      }
      await page.eval(`(()=>{
        const input=document.querySelector(${JSON.stringify(prompt)});
        input.value='  Desktop  ';
        input.dispatchEvent(new Event('input'));
        document.querySelector('.app-dialog [data-dialog-action=confirm]').click();
      })()`);
      await page.until("document.querySelector('[data-device-name]')?.value==='Desktop'");
      assert.equal(await meta(page,'deviceName'),'Desktop');

      await page.eval(`(()=>{
        const input=document.querySelector('[data-device-name]');
        input.value='  Desktop 2  ';
        input.dispatchEvent(new Event('input'));
        input.form.requestSubmit();
      })()`);
      await page.until("(await import('./js/db.js')).getMeta('deviceName').then(name=>name==='Desktop 2')");
      await page.eval("document.querySelector('[data-folder-action=disconnect]').click()");
      await page.until("!!document.querySelector('.app-dialog [data-dialog-action=confirm]')");
      await page.eval("document.querySelector('.app-dialog [data-dialog-action=confirm]').click()");
      await page.until("!!document.querySelector('[data-folder-action=choose]')");
      assert.equal(await meta(page,'deviceName'),'Desktop 2');
      assert.deepEqual(page.errors,[]);
    }finally{await browser.close();}
  });

  await check('P5.1 a local name survives pull, password rotation and import until a typed reset',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional device-name note'});
      await connectBoth(a,b,[item]);
      await b.eval("(await import('./js/db.js')).saveMeta('deviceName','Notebook')");
      await editNote(a,item.id,{content:'Fictional remote edit'});
      await focus(a);
      await waitForRev(a,2);
      await waitForFolderLineage(a);
      await copyFolderFiles(a,b);
      await focus(b);
      await waitForRev(b,2);
      await b.until("(await import('./js/app.js')).getNotes()[0]?.content==='Fictional remote edit'");
      assert.equal(await meta(b,'deviceName'),'Notebook');

      await rotate(b);
      await waitForRev(b,3);
      await waitForFolderLineage(b);
      assert.equal(await meta(b,'deviceName'),'Notebook');
      const incoming=await backupFixture([note({title:'Fictional import'})],NEW_PASSWORD);
      await withDialogs(b,importExpression(incoming.base64,NEW_PASSWORD),['confirm']);
      assert.equal(await meta(b,'syncFolder'),null);
      assert.equal(await meta(b,'deviceName'),'Notebook');
      assert.equal(await b.eval(`(async()=>{
        try{await (await import('./js/account.js')).resetVault('Invalid reset word');return true;}
        catch{return false;}
      })()`),false);
      assert.equal(await meta(b,'deviceName'),'Notebook');
      await b.eval("(await import('./js/account.js')).resetVault((await import('./js/i18n.js')).t('account.resetWord'))");
      assert.equal(await meta(b,'deviceName'),null);
    });
  });
}

export async function runP52({check,assert}){
  await check('P5.2 named computers author folder writes, manual exports and password rotation',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      const file='keeplocal-vault.keeplocal',name='Fictional Desktop P5.2';
      const main=async(password=PASSWORD)=>{
        const bytes=Buffer.from(await readFolderFixture(page,file),'base64');
        assert.equal(bytes.includes(Buffer.from(name)),false);
        return (await decodeV2(bytes,password)).payload;
      };
      assert.equal(Object.hasOwn(await main(),'writtenBy'),false);
      await page.eval(`(await import('./js/db.js')).saveMeta('deviceName',${JSON.stringify(name)})`);
      const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
      await editNote(page,id,{content:'Fictional authored folder edit'});
      await focus(page);
      await waitForRev(page,2);
      await waitForFolderLineage(page);
      assert.equal((await main()).writtenBy,name);
      const exported=(await decodeV2(Buffer.from(await exportFromApp(page),'base64'),PASSWORD)).payload;
      assert.equal(exported.writtenBy,name);
      assert.equal(Object.hasOwn(exported.preferences,'deviceName'),false);
      assert.equal(Object.hasOwn(exported,'deviceName'),false);
      await rotate(page);
      await waitForRev(page,4);
      await waitForFolderLineage(page);
      assert.equal((await main(NEW_PASSWORD)).writtenBy,name);
      assert.equal(await meta(page,'deviceName'),name);
    }finally{await browser.close();}
  });
}

export async function runP53({check,assert}){
  await check('P5.3 the sidebar displays the checked revision in EN and pt-BR, with a nameless fallback',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      await page.send('Emulation.setTimezoneOverride',{timezoneId:'America/Sao_Paulo'});
      const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
      await page.eval("(await import('./js/db.js')).saveMeta('deviceName','Desktop')");
      await editNote(page,id,{content:'Fictional named revision'});
      await focus(page);
      await waitForRev(page,2);
      await waitForFolderLineage(page);
      await page.until("!!document.querySelector('.sidebar [data-folder-state=saved]')");
      const state=()=>page.eval(`(()=>{
        const root=document.querySelector('.sidebar [data-folder-state=saved]');
        return {label:root?.querySelector('[data-folder-version-label]')?.textContent??null,
          datetime:root?.querySelector('time')?.dateTime??null,
          time:root?.querySelector('time')?.textContent??null,
          preceding:root?.previousElementSibling?.id??null};
      })()`);
      const {payload}=await decodeV2(Buffer.from(await readFolderFixture(page,'keeplocal-vault.keeplocal'),'base64'),PASSWORD);
      const localDate=await page.eval(`(new Date(${JSON.stringify(payload.exportedAt)})).getTime()`);
      assert.equal(await meta(page,'folderWrittenBy'),'Desktop');
      assert.equal(await meta(page,'folderWrittenAt'),localDate);
      for(const [lang,label] of [['en','From Desktop, version:'],['pt-BR','De Desktop, versão:']]){
        if((await page.eval('document.documentElement.lang'))!==lang){
          await page.eval(`(async()=>{
            const db=await import('./js/db.js');
            const i18n=await import('./js/i18n.js');
            const status=await import('./js/folder-status.js');
            db.setWriteMode('readOnly');
            try {await i18n.setLang(${JSON.stringify(lang)});}
            finally{db.setWriteMode('readWrite');}
            status.setFolderStatus('saved',{writtenAt:await db.getMeta('folderWrittenAt'),writtenBy:await db.getMeta('folderWrittenBy')});
          })()`);
          await page.until(`document.documentElement.lang===${JSON.stringify(lang)}&&document.querySelector('.sidebar [data-folder-version-label]')?.textContent===${JSON.stringify(label)}`);
        }
        const expected=await page.eval(`(()=>{
          const when=new Date(${JSON.stringify(payload.exportedAt)}),lang=${JSON.stringify(lang)};
          const date=new Intl.DateTimeFormat(lang,{year:'numeric',month:'2-digit',day:'2-digit'}).format(when);
          const hour=new Intl.DateTimeFormat(lang,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(when);
          return date+' '+hour;
        })()`);
        assert.deepEqual(await state(),{label,datetime:payload.exportedAt,time:expected,preceding:'write-now-btn'});
      }
      await page.eval("(await import('./js/db.js')).deleteMeta('deviceName')");
      await editNote(page,id,{content:'Fictional nameless revision'});
      await focus(page);
      await waitForRev(page,3);
      await waitForFolderLineage(page);
      await page.until("document.querySelector('.sidebar [data-folder-version-label]')?.textContent==='Versão:'");
      assert.equal(await meta(page,'folderWrittenBy'),null);
      assert.equal((await state()).label,'Versão:');
      assert.deepEqual(page.errors,[]);
    }finally{await browser.close();}
  });
}

export async function runP54({check,assert}){
  await check('P5.4 Refresh checks the folder, makes no unchanged writes and asks for no photo access',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const item=note({title:'Fictional refresh note',content:'Original'});
      await connectBoth(a,b,[item]);
      await b.eval(`(async()=>{
        const db=await import('./js/db.js');
        const photos=await (await navigator.storage.getDirectory()).getDirectoryHandle('KL-TEST-REFRESH-PHOTOS',{create:true});
        await db.saveMeta('photoFolder',photos);
      })()`);
      await relogin(b);
      await b.until("!!document.querySelector('.sidebar [data-folder-state=saved]')");
      await waitForFolderLineage(b);
      assert.equal(await b.eval("!!document.querySelector('[data-folder-refresh]')"),true);
      const waitButton=(disabled)=>b.until(`document.querySelector('[data-folder-refresh]')?.disabled===${disabled}`);
      await waitButton(false);
      const snapshot=()=>b.eval(`({
        text:document.querySelector('.sidebar [data-folder-version-label]').textContent,
        date:document.querySelector('.sidebar [data-folder-state=saved] time').dateTime,
        writes:folderTest.writes,attempts:folderTest.writeAttempts,
        permissionRequests:folderTest.events.filter(event=>event.kind==='request').length,
      })`);
      await b.eval(`(()=>{
        folderTest.clear();
        folderTest.permission='prompt';
        folderTest.requested='error';
        let hold=true;
        const getFile=FileSystemFileHandle.prototype.getFile;
        FileSystemFileHandle.prototype.getFile=async function(...args){
          if(hold&&this.name==='keeplocal-vault.keeplocal'){
            hold=false;
            await new Promise(resolve=>{window.finishRefreshRead=resolve;});
          }
          return getFile.apply(this,args);
        };
      })()`);
      const before=await snapshot();
      await b.eval("document.querySelector('[data-folder-refresh]').click()");
      await b.until("typeof window.finishRefreshRead==='function'");
      await waitButton(true);
      await b.eval('window.finishRefreshRead()');
      await waitButton(false);
      assert.deepEqual(await snapshot(),before);
      assert.deepEqual(before.writes,{});
      assert.equal(before.permissionRequests,0);

      await editNote(a,item.id,{content:'Edit received by Refresh'});
      await focus(a);
      await waitForRev(a,2);
      await waitForFolderLineage(a);
      await copyFolderFiles(a,b);
      await b.eval("folderTest.clear();document.querySelector('[data-folder-refresh]').click()");
      await waitForRev(b,2);
      await b.until("(await import('./js/app.js')).getNotes()[0]?.content==='Edit received by Refresh'");
      await waitButton(false);
      assert.equal((await snapshot()).permissionRequests,0);
      await b.eval(`(async()=>{
        (await import('./js/db.js')).setWriteMode('readOnly');
        (await import('./js/folder-status.js')).setFolderStatus('readOnly');
      })()`);
      await waitButton(true);
      assert.deepEqual(b.errors,[]);
    });
  });
}
