import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {connectBoth,editNote,focus,waitForFolderLineage,waitForRev,withTwoProfiles} from './folder-merge.mjs';
import {copyFolderFiles} from './folder-transfer.mjs';
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
