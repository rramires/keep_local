import {create,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {pollFixture} from './folder-poll-fixture.mjs';
import {connectBoth,editNote,focus,relogin,waitForFolderLineage,waitForRev,withTwoProfiles} from './folder-merge.mjs';
import {copyFolderFiles,readFolderFixture} from './folder-transfer.mjs';
import {connectedCopyPage,openCopyList,openSelectedCopy} from './folder-copy-view.mjs';
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

export async function runP55({check,assert}){
  await check('P5.5 a metadata tick watches only the active foreground folder and never reads unchanged bytes',async()=>{
    const browser=await launchExtension();
    try{
      const source=pollFixture(folderFixtureSource('KL-TEST-POLL',{metadata:450,file:3000}));
      const page=await browser.page(undefined,source);
      await connectedCopyPage(browser,page);
      assert.equal(await page.eval("typeof window.pollTest.tick==='function'"),true);
      const stats=()=>page.eval('({lists:pollTest.lists,metadata:pollTest.metadata,reads:pollTest.reads})');
      const tick=()=>page.eval('pollTest.tick()');
      await page.until("!!document.querySelector('.sidebar [data-folder-state=saved]')&&!document.querySelector('[data-folder-refresh]').disabled");
      const before=await stats();
      await tick();
      assert.deepEqual(await stats(),{lists:before.lists+1,metadata:before.metadata+1,reads:before.reads});

      await page.eval("(await folderTest.directory()).getFileHandle('ordinary.txt',{create:true})");
      const ignored=await stats();
      await tick();
      assert.deepEqual(await stats(),{lists:ignored.lists+1,metadata:ignored.metadata+1,reads:ignored.reads});
      const dormant=await stats();
      for(const mode of ['hidden','unfocused','readOnly']){
        await page.eval(`(async()=>{
          const db=await import('./js/db.js');
          pollTest.visible=${mode!=='hidden'};pollTest.focused=${mode!=='unfocused'};
          db.setWriteMode(${JSON.stringify(mode==='readOnly'?'readOnly':'readWrite')});
        })()`);
        await tick();
        assert.deepEqual(await stats(),dormant,mode);
      }
      await page.eval("(await import('./js/db.js')).setWriteMode('readWrite');folderTest.stalls.add('entries')");
      const time=await page.eval("(async()=>{const start=performance.now();await pollTest.tick();return performance.now()-start;})()");
      assert.ok(time>=300&&time<2500,time);
      assert.equal(await page.eval("!!document.querySelector('.sidebar [data-folder-state=saved]')"),true);
      assert.equal(await page.eval("!!document.querySelector('[data-folder-status=unresponsive], [data-folder-state=error]')"),false);
      assert.deepEqual(await page.eval("folderTest.stalls.clear();folderTest.release()"),['entries']);
      await page.until("folderTest.events.some(event=>event.kind==='settled:entries')");
      const after=await stats();
      assert.equal(after.reads,dormant.reads);
      assert.equal(after.metadata,dormant.metadata);
      await tick();
      assert.equal((await stats()).reads,dormant.reads);

      await page.eval(`(async()=>{
        const directory=await folderTest.directory();
        const original=await directory.getFileHandle('keeplocal-vault.keeplocal');
        const duplicate=await directory.getFileHandle('Fictional late delivery.keeplocal',{create:true});
        const writer=await duplicate.createWritable();
        await writer.write(await original.getFile());
        await writer.close();
      })()`);
      const changed=await stats();
      const writes=await page.eval('folderTest.writeAttempts');
      await tick();
      assert.ok((await stats()).reads>changed.reads);
      assert.equal(await page.eval('folderTest.writeAttempts'),writes);
      const settled=await stats();
      await tick();
      assert.equal((await stats()).reads,settled.reads);
      assert.deepEqual(page.errors,[]);
    }finally{await browser.close();}
  });
}

async function changeDeviceName(page,name){
  await openSettings(page,'change');
  await page.until("!!document.querySelector('[data-device-name]')");
  await page.eval(`(()=>{
    const input=document.querySelector('[data-device-name]');
    input.value=${JSON.stringify(name)};
    input.dispatchEvent(new Event('input'));
    input.form.requestSubmit();
  })()`);
  await page.until(`(await import('./js/db.js')).getMeta('deviceName').then(value=>value===${JSON.stringify(name)})`);
  await page.eval("document.querySelector('#modal-close').click()");
  await page.until("!document.querySelector('.folder-settings')");
}

const MAIN='keeplocal-vault.keeplocal';
const versionLabel=".sidebar [data-folder-version-label]";
const stateLabel=page=>page.eval(`document.querySelector(${JSON.stringify(versionLabel)})?.textContent??null`);
const waitForAuthor=(page,name)=>page.until(`document.querySelector(${JSON.stringify(versionLabel)})?.textContent===${JSON.stringify(`From ${name}, version:`)}`);
const folderPayload=async page=>(await decodeV2(Buffer.from(await readFolderFixture(page,MAIN),'base64'),PASSWORD)).payload;
async function editAndCheck(page,id,content,rev){
  await editNote(page,id,{content});
  await focus(page);
  await waitForRev(page,rev);
  await waitForFolderLineage(page);
}

export async function runP56({check,assert}){
  await check('P5.6 two named computers see a delayed delivery by interval, then author a draft merge',async()=>{
    const interval=1000;
    const source=(name,timeouts)=>pollFixture(folderFixtureSource(name,timeouts),{manual:false,interval})+
      ";pollTest.focused=false;pollTest.focusEvents=0;window.addEventListener('focus',()=>pollTest.focusEvents++);";
    await withTwoProfiles(async(a,b)=>{
      const left=note({title:'Fictional left note',content:'Original left'});
      const right=note({title:'Fictional right note',content:'Original right'});
      await connectBoth(a,b,[left,right]);
      await changeDeviceName(a,'Desktop');
      await changeDeviceName(b,'Notebook');
      await b.until(`document.querySelector(${JSON.stringify(versionLabel)})?.textContent==='Version:'`);
      const oldDate=await b.eval("document.querySelector('.sidebar [data-folder-state=saved] time').dateTime");
      await editAndCheck(a,left.id,'Fictional edit on Desktop',2);
      await waitForAuthor(a,'Desktop');
      const fresh=await folderPayload(a);
      assert.equal(fresh.writtenBy,'Desktop');
      assert.equal(await stateLabel(b),'Version:');
      assert.equal(await b.eval("document.querySelector('.sidebar [data-folder-state=saved] time').dateTime"),oldDate);
      assert.equal(await meta(b,'folderSeenRev'),1);

      await copyFolderFiles(a,b);
      const focusEvents=await b.eval('pollTest.focusEvents');
      const ticks=await b.eval('pollTest.onlyNext=true;pollTest.focused=true;pollTest.ticks');
      await waitForRev(b,2);
      await waitForAuthor(b,'Desktop');
      await b.until('!pollTest.focused');
      assert.ok(await b.eval('pollTest.ticks')>ticks);
      assert.equal(await b.eval('pollTest.focusEvents'),focusEvents);
      assert.equal(await b.eval("document.querySelector('.sidebar [data-folder-state=saved] time').dateTime"),fresh.exportedAt);
      assert.equal(await meta(b,'deviceName'),'Notebook');
      await b.eval('pollTest.focused=false');
      await editAndCheck(b,right.id,'Fictional edit on Notebook',3);
      await waitForAuthor(b,'Notebook');
      assert.equal((await folderPayload(b)).writtenBy,'Notebook');
      await copyFolderFiles(b,a);
      await a.eval("document.querySelector('[data-folder-refresh]').click()");
      await waitForRev(a,3);
      await waitForAuthor(a,'Notebook');
      assert.equal(await meta(a,'deviceName'),'Desktop');

      await editAndCheck(a,left.id,'Fictional newer Desktop edit',4);
      await b.eval(`[...document.querySelectorAll('.note-card')].find(card=>card.textContent.includes(${JSON.stringify(right.title)})).click()`);
      await b.until("!!document.querySelector('#modal-editor')");
      const draft='Fictional draft still being edited on Notebook';
      await b.eval(`(()=>{
        const set=window.setTimeout.bind(window);
        window.setTimeout=(action,delay,...args)=>delay===2000&&document.querySelector('#modal-editor')
          ?set(action,30000,...args):set(action,delay,...args);
        const field=document.querySelector('#modal-editor');
        field.value=${JSON.stringify(draft)};
        field.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await copyFolderFiles(a,b);
      await b.eval("pollTest.beforeDraftList=pollTest.lists;pollTest.beforeDraftTick=pollTest.completed;pollTest.focused=true");
      await b.until("pollTest.lists>pollTest.beforeDraftList&&pollTest.completed>pollTest.beforeDraftTick");
      assert.equal(await meta(b,'folderSeenRev'),3);
      assert.equal(await b.eval("document.querySelector('#modal-editor').value"),draft);
      await b.eval("document.querySelector('#modal-close').click()");
      await waitForRev(b,5);
      await waitForAuthor(b,'Notebook');
      const merged=await folderPayload(b);
      assert.equal(merged.writtenBy,'Notebook');
      assert.equal(await meta(b,'deviceName'),'Notebook');
      await b.until(`(await import('./js/app.js')).getNotes().some(note=>note.content==='Fictional newer Desktop edit')`);
      assert.deepEqual(await b.eval("(await import('./js/app.js')).getNotes().map(note=>note.content).sort()"),
        ['Fictional newer Desktop edit',draft].sort());
      assert.deepEqual([...a.errors,...b.errors],[]);
    },undefined,source);
  });

  await check('P5.6 the sidebar treats a hostile computer name as text and hides the version in copy view',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      const name='<img src=x onerror=fixture>';
      await changeDeviceName(page,name);
      const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
      await editAndCheck(page,id,'Fictional note with a literal writer name',2);
      await waitForAuthor(page,name);
      assert.equal(await stateLabel(page),`From ${name}, version:`);
      assert.equal(await page.eval("document.querySelectorAll('.sidebar [data-folder-indicator] img').length"),0);
      assert.equal((await folderPayload(page)).writtenBy,name);
      const attempts=await page.eval('folderTest.writeAttempts');
      await openCopyList(page,assert);
      await openSelectedCopy(page);
      assert.equal(await page.eval("!!document.querySelector('.sidebar [data-folder-indicator]')"),false);
      assert.equal(await page.eval('folderTest.writeAttempts'),attempts);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      assert.deepEqual(page.errors,[]);
    }finally{await browser.close();}
  });
}

export async function runP58Idle({check,assert}){
  const source=(name,timeouts)=>pollFixture(folderFixtureSource(name,timeouts))+`;(()=>{
    let now=Date.now();
    Date.now=()=>now;
    window.advanceIdleClock=milliseconds=>{now+=milliseconds;};
  })()`;
  for(const route of ['tick pull','focus pull','applied merge']){
    await check(`P5.8 the ${route} keeps the Passwords & Keys idle deadline`,async()=>{
      await withTwoProfiles(async(a,b)=>{
        const left=note({title:'Fictional remote note',content:'Before delivery'});
        const right=note({title:'Fictional local note',content:'Before editing'});
        await connectBoth(a,b,[left,right]);
        await editAndCheck(a,left.id,'Delivered edit',2);
        const merged=route==='applied merge';
        if(merged)await editAndCheck(b,right.id,'Independent local edit',2);
        await b.until("!document.querySelector('[data-folder-refresh]').disabled");
        await b.eval("document.querySelector('[data-view=vault]').click()");
        await b.until("!!document.querySelector('[data-vault-lock]')");
        await b.eval(`(()=>{
          const lock=document.querySelector('[data-vault-lock]');
          lock.value='1';
          lock.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        await b.until("(await import('./js/db.js')).getMeta('vaultLockMinutes').then(value=>value===1)");
        const priorId=await meta(b,'vaultId');
        await b.eval("window.beforeDelivery=document.querySelector('.app-view');advanceIdleClock(2000)");
        await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',modifiers:8});
        await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft'});

        await copyFolderFiles(a,b);
        await b.eval('advanceIdleClock(40000)');
        if(route==='focus pull')await focus(b);
        else await b.eval('pollTest.tick()');
        await waitForRev(b,merged?3:2);
        await b.until("!beforeDelivery.isConnected&&!!document.querySelector('.vault-section [data-vault-lock]')");
        assert.notEqual(await meta(b,'vaultId'),priorId);
        assert.deepEqual(await b.eval("Object.fromEntries((await import('./js/app.js')).getNotes().map(note=>[note.title,note.content]))"),{
          [left.title]:'Delivered edit',
          [right.title]:merged?'Independent local edit':right.content,
        });
        const activeAt=milliseconds=>b.eval(`advanceIdleClock(${milliseconds});(await import('./js/session.js')).checkDeadline()`);
        assert.equal(await activeAt(19_999),true,'the session stays open before the original deadline');
        assert.equal(await activeAt(1),false,'the session locks at the original deadline');
        await b.until("!!document.querySelector('#login-form:not(.hidden)')");
        assert.deepEqual([...a.errors,...b.errors],[]);
      },undefined,source);
    });
  }
}

export async function runP58Divider({check,assert}){
  await check('P5.8 the sidebar version has a divider matching the other sidebar dividers',async()=>{
    const browser=await launchExtension();
    try{
      const page=await connectedCopyPage(browser);
      await page.until("!!document.querySelector('.sidebar [data-folder-state=saved]')&&!!document.querySelector('#write-now-btn')");
      for(const theme of ['dark','light']){
        const evidence=await page.eval(`(()=>{
          document.documentElement.dataset.theme=${JSON.stringify(theme)};
          const block=document.querySelector('.sidebar [data-folder-state=saved]');
          const reference=getComputedStyle(document.querySelector('.sidebar .sidebar-divider'));
          const style=getComputedStyle(block);
          return {
            atTop:[style.borderTopWidth,style.borderTopStyle,style.borderTopColor],
            divider:[reference.height,'solid',reference.backgroundColor],
            belowWriteNow:block.previousElementSibling.id==='write-now-btn',
          };
        })()`);
        assert.equal(evidence.belowWriteNow,true);
        assert.deepEqual(evidence.atTop,evidence.divider,`version divider in ${theme} theme`);
      }
      assert.deepEqual(page.errors,[]);
    }finally{await browser.close();}
  });
}
