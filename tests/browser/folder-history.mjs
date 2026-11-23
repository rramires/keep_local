import {launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {withTwoProfiles,connectBoth,editNote,focus,ready,waitForNotes,waitForRev,waitForFolderLineage} from './folder-merge.mjs';
import {connectedCopyPage,folderCopyEvidence,openCopyList,openSelectedCopy} from './folder-copy-view.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {HISTORY_DIR,historySlots} from '../../js/folder-history.js';
import {decodeV2,encodeV2} from '../../js/backup-v2.js';
import {MAX_BACKUP_BYTES,decryptRecords} from '../../js/backup-format.js';
import {backupFixture} from './backup-fixture.mjs';
import {rotate,NEW_PASSWORD} from './folder-salt.mjs';
import {signIn} from './folder-salt-login.mjs';
import {vaultFixture} from './vault-core.mjs';

const MAIN='keeplocal-vault.keeplocal';
const START='2026-01-12';
const slots=day=>historySlots(new Date(day+'T12:00:00'));
const MONDAY=slots(START).day.name;
const FIRST_WEEK=slots(START).week.name;

function installHistoryFixture(historyDir,start) {
  const NativeDate=Date;
  const fixture=window.historyTest={
    ops:[],
    setDay(day){this.time=NativeDate.parse(day+'T12:00:00');},
    async dir(create=false){return (await folderTest.directory()).getDirectoryHandle(historyDir,{create});},
    async read(name){
      try{
        const file=await (await this.dir()).getFileHandle(name);
        return new Uint8Array(await (await file.getFile()).arrayBuffer()).toBase64();
      }catch(error){if(error.name==='NotFoundError')return null;throw error;}
    },
    async seed(name,base64) {
      const file=await (await this.dir(true)).getFileHandle(name,{create:true});
      const stream=await file.createWritable();
      await stream.write(Uint8Array.fromBase64(base64));
      await stream.close();
    },
  };
  fixture.setDay(start);
  window.Date=class extends NativeDate {
    constructor(...args){super(...(args.length?args:[fixture.time]));}
  };
  const directoryHandle=FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  FileSystemDirectoryHandle.prototype.getDirectoryHandle=function(name,options) {
    if(name===historyDir)fixture.ops.push([options?.create?'mkdir':'directory',name]);
    return directoryHandle.call(this,name,options);
  };
  const fileHandle=FileSystemDirectoryHandle.prototype.getFileHandle;
  FileSystemDirectoryHandle.prototype.getFileHandle=function(name,options){
    if(this.name===historyDir)fixture.ops.push([options?.create?'create':'lookUp',name]);
    return fileHandle.call(this,name,options);
  };
  const isSlot=name=>/^keeplocal-(day|week)-/.test(name);
  const getFile=FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile=async function(...args){
    if(isSlot(this.name)){
      fixture.ops.push(['read',this.name]);
      if(fixture.holdRead===this.name){
        fixture.holdRead=null;
        await new Promise(resolve=>{fixture.resumeRead=resolve;});
      }
    }
    const file=await getFile.apply(this,args);
    if(fixture.corruptRead===this.name){
      fixture.corruptRead=null;
      const bytes=new Uint8Array(await file.arrayBuffer());
      bytes[bytes.length-1]^=1;
      return new File([bytes],file.name);
    }
    return file;
  };
  const createWritable=FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable=async function(...args){
    if(isSlot(this.name)){
      fixture.ops.push(['write',this.name]);
      if(fixture.failWrite===this.name)throw new DOMException('Fictional writer occupied','NoModificationAllowedError');
    }
    const stream=await createWritable.apply(this,args);
    if(fixture.corruptReadback===this.name){
      const close=stream.close.bind(stream);
      stream.close=async()=>{
        await close();
        fixture.corruptRead=this.name;
      };
    }
    return stream;
  };
}

async function historyFixture(page){
  const source=`(${installHistoryFixture})(${JSON.stringify(HISTORY_DIR)},${JSON.stringify(START)})`;
  await page.send('Emulation.setTimezoneOverride',{timezoneId:'America/Sao_Paulo'});
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source});
  await page.eval(source);
}

async function withHistoryPage(run,{file=750}={}){
  const browser=await launchExtension();
  try{
    const name='KL-TEST-P1-HISTORY';
    const page=await browser.page(undefined,folderFixtureSource(name,{metadata:3000,file}));
    await historyFixture(page);
    await connectedCopyPage(browser,page);
    await saved(page,1);
    const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
    await run(page,id,browser,name);
  }finally{await browser.close();}
}

async function saved(page,rev){
  await waitForRev(page,rev);
  await waitForFolderLineage(page);
  await page.until("!!document.querySelector('[data-folder-state=saved]')");
}

async function editAndSave(page,id,rev){
  await editNote(page,id,{content:`Fictional history edit ${rev}`});
  await focus(page);
  await saved(page,rev);
  return readFolderFixture(page,MAIN);
}

const receipt=page=>page.eval(`(async()=>{
  const {meta}=await (await import('./js/db.js')).readVault();
  return Object.fromEntries(Object.entries(meta).filter(([key])=>key.startsWith('folderHistory')));
})()`);
const readSlot=(page,name)=>page.eval(`historyTest.read(${JSON.stringify(name)})`);
const seedSlot=(page,name,bytes)=>page.eval(`historyTest.seed(${JSON.stringify(name)},${JSON.stringify(bytes)})`);
const setDay=(page,day)=>page.eval(`historyTest.setDay(${JSON.stringify(day)})`);
const clearOps=page=>page.eval('historyTest.ops=[]');
const historyOps=page=>page.eval('historyTest.ops');
const toasts=page=>page.eval("document.querySelector('#toast-container').textContent");

export async function run({check,assert}){
  await check('P1.2 first write copies exact main bytes and rotates seven days and four weeks',async()=>{
    await withHistoryPage(async(page,id)=>{
      const first=await readFolderFixture(page,MAIN);
      assert.equal(await readSlot(page,MONDAY),first);
      assert.equal(await readSlot(page,FIRST_WEEK),first);
      const firstReceipt=await receipt(page);
      assert.equal(firstReceipt.folderHistoryDay,START);
      assert.equal(firstReceipt.folderHistoryWeek,slots(START).week.key);
      assert.ok(firstReceipt.folderHistoryAt>0);

      await clearOps(page);
      assert.notEqual(await editAndSave(page,id,2),first);
      assert.deepEqual(await historyOps(page),[]);
      assert.deepEqual(await receipt(page),firstReceipt);

      await setDay(page,'2026-01-13');
      const next=await editAndSave(page,id,3);
      assert.equal(await readSlot(page,slots('2026-01-13').day.name),next);
      assert.equal(await readSlot(page,FIRST_WEEK),first);

      await setDay(page,'2026-01-19');
      const eighth=await editAndSave(page,id,4);
      assert.equal(await readSlot(page,MONDAY),eighth);
      assert.equal(await readSlot(page,FIRST_WEEK),first);

      await setDay(page,'2026-02-09');
      const fifthWeek=await editAndSave(page,id,5);
      assert.equal(await readSlot(page,MONDAY),fifthWeek);
      assert.equal(await readSlot(page,FIRST_WEEK),fifthWeek);
      const {payload}=await decodeV2(Buffer.from(fifthWeek,'base64'),PASSWORD);
      assert.ok(Object.keys(payload).every(name=>!name.startsWith('folderHistory')));
    });
  });

  await check('P1.2 a second computer keeps the first checked copy for the same day and week',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await historyFixture(a);
      await historyFixture(b);
      const item=note({title:'Fictional shared history'});
      const first=await connectBoth(a,b,[item]);
      await saved(a,1);
      for(const name of [MONDAY,FIRST_WEEK]){
        const bytes=await readSlot(a,name);
        assert.equal(bytes,first);
        await seedSlot(b,name,bytes);
      }
      await clearOps(b);
      assert.notEqual(await editAndSave(b,item.id,2),first);
      const operations=await historyOps(b);
      assert.ok(operations.some(([kind])=>kind==='read'));
      assert.ok(operations.every(([kind])=>!['write','mkdir','create'].includes(kind)));
      assert.equal(await readSlot(b,MONDAY),first);
      assert.equal(await readSlot(b,FIRST_WEEK),first);
      const checked=await receipt(b);
      assert.equal(checked.folderHistoryDay,START);
      assert.ok(checked.folderHistoryAt>0);
    });
  });

  await check('P1.2 a greater stale revision survives failed preservation and is verified before replacement',async()=>{
    await withHistoryPage(async(page,id)=>{
      const main=await readFolderFixture(page,MAIN);
      const {key,salt,payload}=await decodeV2(Buffer.from(main,'base64'),PASSWORD);
      const high=Buffer.from(await encodeV2(key,salt,{...payload,rev:80})).toString('base64');
      await seedSlot(page,MONDAY,high);
      await setDay(page,'2026-01-19');
      const previous=await receipt(page);
      const beforeToast=await toasts(page);
      await page.eval("folderTest.failPreservation='tamper'");
      assert.notEqual(await editAndSave(page,id,2),main);
      assert.equal(await readSlot(page,MONDAY),high);
      assert.deepEqual(await receipt(page),previous);
      assert.deepEqual(await page.eval('folderTest.preservationRemovals'),[]);
      assert.equal(await toasts(page),beforeToast);
      assert.deepEqual(page.errors,[]);

      await page.eval('folderTest.failPreservation=null');
      const next=await editAndSave(page,id,3);
      assert.equal(await readSlot(page,MONDAY),next);
      const copies=await page.eval(`(async()=>{
        const dir=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const copies=[];
        for await(const file of dir.values())copies.push(new Uint8Array(await (await file.getFile()).arrayBuffer()).toBase64());
        return copies;
      })()`);
      assert.ok(copies.includes(high));
      assert.equal((await receipt(page)).folderHistoryDay,'2026-01-19');
    });
  });

  await check('P1.2 failed weekly write leaves the whole receipt pending and retries without replacing the checked day',async()=>{
    await withHistoryPage(async(page,id)=>{
      const day='2026-01-19',week=slots(day).week.name;
      await setDay(page,day);
      const previous=await receipt(page);
      const beforeToast=await toasts(page);
      await page.eval(`historyTest.failWrite=${JSON.stringify(week)}`);
      const first=await editAndSave(page,id,2);
      assert.equal(await readSlot(page,MONDAY),first);
      assert.deepEqual(await receipt(page),previous);
      assert.equal(await toasts(page),beforeToast);
      assert.deepEqual(page.errors,[]);

      await page.eval('historyTest.failWrite=null');
      const next=await editAndSave(page,id,3);
      assert.equal(await readSlot(page,MONDAY),first);
      assert.equal(await readSlot(page,week),next);
      const checked=await receipt(page);
      assert.equal(checked.folderHistoryDay,day);
      assert.equal(checked.folderHistoryWeek,slots(day).week.key);
    });
  });

  await check('P1.2 a timed-out history read leaves a normal main receipt and retries on the next write',async()=>{
    await withHistoryPage(async(page,id)=>{
      const old=await readSlot(page,MONDAY);
      assert.ok(old);
      const previous=await receipt(page);
      const beforeToast=await toasts(page);
      await setDay(page,'2026-01-19');
      await page.eval(`historyTest.holdRead=${JSON.stringify(MONDAY)}`);
      assert.notEqual(await editAndSave(page,id,2),old);
      assert.equal(await page.eval('typeof historyTest.resumeRead'), 'function');
      await page.eval('historyTest.resumeRead()');
      assert.equal(await readSlot(page,MONDAY),old);
      assert.deepEqual(await receipt(page),previous);
      assert.equal(await toasts(page),beforeToast);
      assert.deepEqual(page.errors,[]);
      assert.equal(await editAndSave(page,id,3),await readSlot(page,MONDAY));
    });
  });

  await check('P1.2 invalid, oversized, empty and other-salt slots can be replaced by the exact main bytes',async()=>{
    await withHistoryPage(async(page,id)=>{
      const day='2026-01-19',week=slots(day).week.name;
      await setDay(page,day);
      await seedSlot(page,MONDAY,'eA==');
      await page.eval(`(async()=>{
        const entry=await (await historyTest.dir()).getFileHandle(${JSON.stringify(week)},{create:true});
        const stream=await entry.createWritable();
        await stream.truncate(${MAX_BACKUP_BYTES+1});
        await stream.close();
      })()`);
      const next=await editAndSave(page,id,2);
      assert.equal(await readSlot(page,MONDAY),next);
      assert.equal(await page.eval(`(async()=>{
        const entry=await (await historyTest.dir()).getFileHandle(${JSON.stringify(week)});
        return (await entry.getFile()).size;
      })()`),Buffer.from(next,'base64').length);
      assert.equal(await readSlot(page,week),next);

      const dayAfter='2026-01-26',laterWeek=slots(dayAfter).week.name;
      await setDay(page,dayAfter);
      await seedSlot(page,MONDAY,'');
      await seedSlot(page,laterWeek,(await backupFixture()).base64);
      const later=await editAndSave(page,id,3);
      assert.equal(await readSlot(page,MONDAY),later);
      assert.equal(await readSlot(page,laterWeek),later);
    });
  });

  await check('P1.2 mismatched history readback leaves its receipt pending',async()=>{
    await withHistoryPage(async(page,id)=>{
      const day='2026-01-13',name=slots(day).day.name;
      const previous=await receipt(page);
      assert.equal(previous.folderHistoryDay,START);
      await setDay(page,day);
      await page.eval(`historyTest.corruptReadback=${JSON.stringify(name)}`);
      const first=await editAndSave(page,id,2);
      assert.deepEqual(await receipt(page),previous);
      assert.equal(await readSlot(page,name),first);

      await page.eval('historyTest.corruptReadback=null');
      await editAndSave(page,id,3);
      assert.equal(await readSlot(page,name),first);
      assert.equal((await receipt(page)).folderHistoryDay,day);
    });
  });

  await check('P1.2 holding an exclusive slot in a different tab leaves the main saved without a notice',async()=>{
    await withHistoryPage(async(page,id,browser,name)=>{
      const old=await readSlot(page,MONDAY);
      assert.ok(old);
      const previous=await receipt(page);
      const beforeToast=await toasts(page);
      const holder=await browser.page(undefined,folderFixtureSource(name));
      try{
        await holder.eval(`(async()=>{
          const dir=await (await folderTest.directory()).getDirectoryHandle(${JSON.stringify(HISTORY_DIR)});
          const file=await dir.getFileHandle(${JSON.stringify(MONDAY)});
          window.slotLock=await file.createWritable({mode:'exclusive'});
        })()`);
        await setDay(page,'2026-01-19');
        assert.notEqual(await editAndSave(page,id,2),old);
        assert.equal(await readSlot(page,MONDAY),old);
        assert.deepEqual(await receipt(page),previous);
        assert.equal(await toasts(page),beforeToast);
        assert.deepEqual(page.errors,[]);
        await holder.eval('slotLock.abort()');
      }finally{await holder.close();}
      assert.equal(await editAndSave(page,id,3),await readSlot(page,MONDAY));
    });
  });

  await check('P1.2 locking during a history read prevents all later history writes',async()=>{
    await withHistoryPage(async(page,id)=>{
      const old=await readSlot(page,MONDAY);
      assert.ok(old);
      const previous=await receipt(page);
      await setDay(page,'2026-01-19');
      await clearOps(page);
      await page.eval(`historyTest.holdRead=${JSON.stringify(MONDAY)}`);
      await editNote(page,id,{content:'Fictional edit before locking'});
      await focus(page);
      await page.until("typeof historyTest.resumeRead==='function'");
      assert.equal(await page.eval("(await import('./js/db.js')).getMeta('folderSeenRev')"),2);
      await page.eval("document.querySelector('#lock-btn').click()");
      await page.until("!!document.querySelector('.auth-view')");
      await page.eval('historyTest.resumeRead()');
      await waitForFolderLineage(page);
      assert.ok((await historyOps(page)).every(([kind])=>!['write','mkdir','create'].includes(kind)));
      assert.equal(await readSlot(page,MONDAY),old);
      assert.deepEqual(await receipt(page),previous);
      assert.notEqual(await readFolderFixture(page,MAIN),old);
    },{file:8000});
  });

  await check('P1.2 eleven history copies stay outside root scans, and read-only and copy sessions write nothing',async()=>{
    await withHistoryPage(async(page)=>{
      const bytes=await readFolderFixture(page,MAIN);
      const names=[
        ...Array.from({length:7},(_,index)=>slots(`2026-01-${12+index}`).day.name),
        ...Array.from({length:4},(_,index)=>`keeplocal-week-${index+1}.keeplocal`),
      ];
      for(const name of names)await seedSlot(page,name,bytes);
      for(let index=1;index<32;index++)await writeFolderFixture(page,`fixture-${index}.keeplocal`,bytes);
      await clearOps(page);
      const state=await page.eval(`(async()=>{
        const {readFolderState}=await import('./js/folder-vault.js'),{getMeta}=await import('./js/db.js');
        const key=(await import('./js/app.js')).getCryptoKey();
        const state=await readFolderState(await folderTest.directory(),key,await getMeta('salt'));
        return {count:state.candidates.length,limitExceeded:state.limitExceeded,name:state.head.name};
      })()`);
      assert.deepEqual(state,{count:32,limitExceeded:false,name:MAIN});
      await focus(page);
      await waitForFolderLineage(page);
      assert.deepEqual(await historyOps(page),[]);
      assert.ok(await page.eval("!!document.querySelector('[data-folder-state=saved]')"));

      await page.reload();
      await page.until("!!document.querySelector('#login-form:not(.hidden)')");
      await page.eval(`folderTest.requested='denied';
        document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};
        document.querySelector('#login-form').requestSubmit()`);
      await page.until("!!document.querySelector('[data-folder-status=denied]')");
      const before=await folderCopyEvidence(page);
      await clearOps(page);
      await page.eval("folderTest.clear();document.querySelector('[data-folder-action=openReadOnly]').click()");
      await page.until("!!document.querySelector('.folder-banner')");
      await focus(page);
      await waitForFolderLineage(page);
      await openCopyList(page,assert,{gate:true});
      await openSelectedCopy(page);
      await focus(page);
      await waitForFolderLineage(page);
      assert.deepEqual(await historyOps(page),[]);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      assert.equal(await page.eval('folderTest.writeAttempts'),0);
      assert.deepEqual(await folderCopyEvidence(page),before);
    });
  });
}

async function openSettings(page,action='change'){
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until(`!!document.querySelector('.folder-settings [data-folder-action=${action}]')`);
}

async function pickReserved(page,name){
  await page.eval(`(async()=>{
    const directory=await folderTest.directory();
    const chosen=await directory.getDirectoryHandle(${JSON.stringify(name)},{create:true});
    window.showDirectoryPicker=async()=>chosen;
  })()`);
}

async function importHistoryFromSettings(page,name,password,assert){
  await openSettings(page);
  assert.ok(await page.eval("!!document.querySelector('[data-folder-action=importBackup]')"),
    'Settings must expose the existing backup import form');
  await page.eval("document.querySelector('[data-folder-action=importBackup]').click()");
  await page.until("!!document.querySelector('#import-file')");
  await page.eval(`(async()=>{
    const file=await (await historyTest.dir()).getFileHandle(${JSON.stringify(name)});
    const data=new DataTransfer();
    data.items.add(await file.getFile());
    const input=document.querySelector('#import-file');
    input.files=data.files;
    input.dispatchEvent(new Event('change'));
    const password=document.querySelector('#import-password');
    password.value=${JSON.stringify(password)};
    password.dispatchEvent(new Event('input'));
    document.querySelector('#import-btn').click();
  })()`);
}

export async function runSettings({check,assert}){
  await check('P1.3 settings and recovery reject reserved subfolders before examining or changing them',async()=>{
    await withHistoryPage(async(page)=>{
      for(const name of ['keeplocal-preserved',HISTORY_DIR]){
        await pickReserved(page,name);
        const before=await folderCopyEvidence(page);
        await openSettings(page);
        await page.eval("folderTest.clear();historyTest.ops=[];document.querySelector('[data-folder-action=change]').click()");
        await page.until("!!document.querySelector('[data-folder-action=change]:not(:disabled)')");
        assert.match(await toasts(page),/History and preserved folders/i);
        assert.deepEqual(await page.eval("folderTest.events.map(({kind})=>kind)"),[]);
        assert.deepEqual(await page.eval('folderTest.writes'),{});
        assert.deepEqual(await historyOps(page),[]);
        assert.deepEqual(await folderCopyEvidence(page),before);
        await page.eval("document.querySelector('#modal-close').click()");
        await page.until("!document.querySelector('.folder-settings')");
      }
      await page.reload();
      await page.until("!!document.querySelector('#login-form:not(.hidden)')");
      await page.eval(`folderTest.requested='denied';
        document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};
        document.querySelector('#login-form').requestSubmit()`);
      await page.until("!!document.querySelector('[data-folder-status=denied]')");
      await pickReserved(page,HISTORY_DIR);
      const before=await folderCopyEvidence(page);
      await page.eval("folderTest.clear();historyTest.ops=[];document.querySelector('[data-folder-action=chooseAnother]').click()");
      await page.until("!!document.querySelector('[data-folder-action=chooseAnother]:not(:disabled)')");
      assert.match(await page.eval("document.querySelector('[data-folder-message]').textContent"),/History and preserved folders/i);
      assert.deepEqual(await page.eval('folderTest.writes'),{});
      assert.deepEqual(await historyOps(page),[]);
      assert.deepEqual(await folderCopyEvidence(page),before);
    });
  });

  await check('P1.3 both reserved copy folders point to ordinary backup import',async()=>{
    await withHistoryPage(async(page)=>{
      const main=await readFolderFixture(page,MAIN);
      for(const name of [HISTORY_DIR,'keeplocal-preserved']){
        await pickReserved(page,name);
        if(name!==HISTORY_DIR)await page.eval(`(async()=>{
          const picked=await showDirectoryPicker();
          const file=await picked.getFileHandle('fictional-copy.keeplocal',{create:true});
          const stream=await file.createWritable();
          await stream.write(Uint8Array.fromBase64(${JSON.stringify(main)}));
          await stream.close();
        })()`);
        await openCopyList(page,assert);
        assert.match(await page.eval("document.querySelector('[data-folder-copy-list] .help-text').textContent"),
          /Settings → Import backup/);
        await openSelectedCopy(page);
        await page.eval("document.querySelector('[data-copy-action=back]').click()");
        await page.until("!!document.querySelector('#folder-settings-btn')");
      }
    });
  });

  await check('P1.3 folder settings show the checked day in both languages and clear it on disconnect',async()=>{
    await withHistoryPage(async(page)=>{
      const checked=(await receipt(page)).folderHistoryAt;
      assert.ok(checked>0);
      await openSettings(page);
      const status=()=>page.eval("document.querySelector('[data-folder-history]')?.textContent??''");
      const expectedDate=()=>page.eval(`new Intl.DateTimeFormat(document.documentElement.lang,
        {dateStyle:'medium',timeStyle:'short'}).format(new Date(${checked}))`);
      assert.equal(await status(),`Folder history: daily copy checked on ${await expectedDate()}`);
      await page.eval("document.querySelector('#modal-close').click()");
      await page.until("!document.querySelector('.folder-settings')");
      await page.eval("document.querySelector('#lang-toggle').click()");
      await page.until("document.documentElement.lang==='pt-BR'");
      await openSettings(page);
      assert.equal(await status(),`Histórico da pasta: cópia do dia conferida em ${await expectedDate()}`);
      await page.eval("document.querySelector('[data-folder-action=disconnect]').click()");
      await page.until("!!document.querySelector('.app-dialog')");
      await page.eval("document.querySelector('[data-dialog-action=confirm]').click()");
      await page.until("!!document.querySelector('.folder-settings [data-folder-action=choose]')");
      assert.equal(await status(),'Histórico da pasta: ainda sem cópia');
      assert.deepEqual(await receipt(page),{});
      assert.ok(await readSlot(page,MONDAY));
    });
  });

  await check('P1.3 connected import explains disconnection and a cancelled import leaves everything in place',async()=>{
    await withHistoryPage(async(page)=>{
      const before=await folderCopyEvidence(page);
      await importHistoryFromSettings(page,MONDAY,PASSWORD,assert);
      await page.until("!!document.querySelector('.app-dialog')");
      assert.match(await page.eval("document.querySelector('.app-dialog').textContent"),
        /will be disconnected[\s\S]*choose the folder again[\s\S]*compare/i);
      await page.eval("document.querySelector('[data-dialog-action=cancel]').click()");
      await page.until("!!document.querySelector('#import-error')?.textContent");
      assert.deepEqual(await folderCopyEvidence(page),before);
    });
  });
}

async function confirmImport(page,assert){
  await page.until("!!document.querySelector('.app-dialog')");
  assert.match(await page.eval("document.querySelector('.app-dialog').textContent"),/will be disconnected/i);
  await page.eval("document.querySelector('[data-dialog-action=confirm]').click()");
  await page.until("!document.querySelector('#import-form')&&!(await (await import('./js/db.js')).getMeta('syncFolder'))");
  await ready(page);
}

async function useThisBrowser(page){
  await page.eval("document.querySelector('[data-folder-action=useLocal]').click()");
  await page.until("!!document.querySelector('.app-dialog input')");
  await page.eval(`(async()=>{
    const input=document.querySelector('.app-dialog input');
    input.value=(await import('./js/i18n.js')).t('folder.replaceWord');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.closest('form').requestSubmit();
  })()`);
}

export async function runRestore({check,assert}){
  await check('P1.4 restoring the daily copy preserves the damaged bytes and the other PC pulls directly',async()=>{
    await withTwoProfiles(async(a,b)=>{
      await historyFixture(a);
      await historyFixture(b);
      const field={id:crypto.randomUUID(),kind:'field',label:'Password',value:'Fictional original vault value',secret:true};
      const damaged='Fictional accidentally overwritten vault value';
      const item=vaultFixture({title:'Fictional history restoration',blocks:[field]});
      const original=await connectBoth(a,b,[item]);
      await saved(a,1);
      assert.equal(await readSlot(a,MONDAY),original);
      const values=notes=>notes.map(note=>note.blocks?.[0]?.value);
      await waitForNotes(b,[field.value],values);

      await editNote(a,item.id,{blocks:[{...field,value:damaged}]});
      await focus(a);
      await saved(a,2);
      const damagedBytes=await readFolderFixture(a,MAIN);
      assert.notEqual(damagedBytes,original);
      assert.equal(await readSlot(a,MONDAY),original);
      await writeFolderFixture(b,MAIN,damagedBytes);
      await focus(b);
      await saved(b,2);
      await waitForNotes(b,[damaged],values);

      await importHistoryFromSettings(a,MONDAY,PASSWORD,assert);
      await confirmImport(a,assert);
      await waitForNotes(a,[field.value],values);
      assert.deepEqual(await receipt(a),{});
      assert.equal(await readFolderFixture(a,MAIN),damagedBytes);

      await openSettings(a,'choose');
      await a.eval("document.querySelector('[data-folder-action=choose]').click()");
      await a.until("!!document.querySelector('[data-folder-status=conflict]')");
      await useThisBrowser(a);
      await saved(a,3);
      const restoredBytes=await readFolderFixture(a,MAIN);
      const {key,payload}=await decodeV2(Buffer.from(restoredBytes,'base64'),PASSWORD);
      assert.equal(payload.rev,3);
      assert.deepEqual(values(await decryptRecords(payload.notes,key)),[field.value]);
      const preserved=await a.eval(`(async()=>{
        const dir=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const bytes=[];
        for await(const entry of dir.values())bytes.push(new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64());
        return bytes;
      })()`);
      assert.ok(preserved.includes(damagedBytes));
      assert.equal(await readSlot(a,MONDAY),original);

      await writeFolderFixture(b,MAIN,restoredBytes);
      await b.eval('folderTest.writeAttempts=0');
      assert.equal(await b.eval(`(async()=>{
        const snapshot=await (await import('./js/db.js')).readVault();
        const key=(await import('./js/app.js')).getCryptoKey();
        const state=await (await import('./js/folder-vault.js')).readFolderState(await folderTest.directory(),key,snapshot.meta.salt);
        return (await import('./js/folder-reconcile.js')).decideFolderAction(snapshot,state);
      })()`),'pull');
      await focus(b);
      await saved(b,3);
      await waitForNotes(b,[field.value],values);
      assert.equal(await b.eval('folderTest.writeAttempts'),0);
      assert.equal(await b.eval("!!document.querySelector('.folder-review')"),false);
      assert.equal(await readFolderFixture(b,MAIN),restoredBytes);
    });
  });

  await check('P1.4 a history copy from before rotation restores with its original passphrase',async()=>{
    await withHistoryPage(async(page)=>{
      const beforeRotation=await readSlot(page,MONDAY);
      assert.ok(beforeRotation);
      await rotate(page);
      await waitForRev(page,2);
      await signIn(page,NEW_PASSWORD);
      await ready(page);
      assert.equal(await readSlot(page,MONDAY),beforeRotation);
      const before=await folderCopyEvidence(page);

      await importHistoryFromSettings(page,MONDAY,NEW_PASSWORD,assert);
      await page.until("!!document.querySelector('#import-error')?.textContent");
      assert.equal(await page.eval("document.querySelector('#import-error').textContent"),
        await page.eval("(await import('./js/i18n.js')).t('backup.wrongPasswordOrCorrupted')"));
      assert.deepEqual(await folderCopyEvidence(page),before);
      await page.eval(`(()=>{
        const password=document.querySelector('#import-password');
        password.value=${JSON.stringify(PASSWORD)};
        password.dispatchEvent(new Event('input'));
        document.querySelector('#import-btn').click();
      })()`);
      await confirmImport(page,assert);
      assert.deepEqual((await folderCopyEvidence(page)).files,before.files);

      await signIn(page,NEW_PASSWORD);
      assert.equal(await page.eval("document.querySelector('#login-error').textContent"),'Incorrect passphrase.');
      await signIn(page,PASSWORD);
      await ready(page);
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0]?.title"),'Fictional browser notes');
    });
  });
}
