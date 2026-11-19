import * as harness from './harness.mjs';

async function pressEnter(page) {
  const key={key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13};
  await page.send('Input.dispatchKeyEvent',{...key,type:'keyDown',text:'\r',unmodifiedText:'\r'});
  await page.send('Input.dispatchKeyEvent',{...key,type:'keyUp'});
}

export async function submitExtensionLogin(page,password=harness.PASSWORD) {
  await page.until("!!document.querySelector('#login-form:not(.hidden)')");
  const {x,y}=await page.eval(`(()=>{
    document.querySelector('#login-password').value=${JSON.stringify(password)};
    const button=document.querySelector('#login-form [type=submit]');
    const rect=button.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x,y});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x,y});
}

function captureFolderBackup(page) {
  return page.eval(`(async()=>{
    let archive;
    URL.createObjectURL=blob=>{archive=blob;return 'blob:fixture';};
    URL.revokeObjectURL=()=>{};
    HTMLAnchorElement.prototype.click=()=>{};
    await(await import('./js/backup.js')).exportBackup();
    return new Uint8Array(await archive.arrayBuffer()).toBase64();
  })()`);
}

export async function run({check,assert}) {
  await check('F1 MV3 origin, OPFS selection and deterministic browser spies',async()=>{
    assert.equal(typeof harness.launchExtension,'function','Expected a real unpacked MV3 harness');
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    assert.ok(browser,'Chromium is required');
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      const id=await p.eval('chrome.runtime.id');
      assert.equal(id,browser.extensionId);
      assert.equal(await p.eval('location.href'),'chrome-extension://'+id+'/index.html');
      // The CDP evaluation is trusted only by the harness; the app never gets these hooks.
      const result=await p.eval(`(async()=>{
        const handle=await showDirectoryPicker({mode:'readwrite',id:'f1-fixture'});
        const initial=await handle.queryPermission({mode:'readwrite'});
        const requested=await handle.requestPermission({mode:'readwrite'});
        const material=await crypto.subtle.importKey('raw',new Uint8Array([42]),'PBKDF2',false,['deriveBits']);
        await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(8),iterations:1},material,128);
        const db=await import('./js/db.js');
        await db.saveMeta('f1FictionalHandle',handle);
        const restored=await db.getMeta('f1FictionalHandle');
        const same=await handle.isSameEntry(restored);
        const entries=await folderTest.entries();
        await folderTest.remove();
        let unavailable;
        try { await restored.keys().next(); } catch(error) { unavailable=error.name; }
        return {name:handle.name,initial,requested,same,entries,unavailable,events:folderTest.events,writes:folderTest.writes};
      })()`);
      assert.match(result.name,/^KL-TEST-[0-9a-f]+$/);
      assert.equal(result.initial,'prompt');
      assert.equal(result.requested,'granted');
      assert.equal(result.same,true);
      assert.deepEqual(result.entries,[]);
      assert.equal(result.unavailable,'NotFoundError');
      assert.deepEqual(result.events.slice(0,4).map(event=>event.kind),['picker','query','request','deriveBits']);
      assert.equal(result.events[2].active,true);
      assert.ok(result.writes.meta>0);
      await harness.create(p);
      await harness.add(p,'Extension smoke','Fictitious extension note');
      assert.equal(await p.eval("document.querySelectorAll('.note-card').length"),1);
      assert.ok(await p.eval('folderTest.writes.notes>0'));
      assert.deepEqual(p.errors,[]);
      assert.deepEqual(p.requests.filter(url=>/^https?:/.test(url)),[]);
    } finally { await browser.close(); }
  });
  await check('F1 the HTTP test server keeps ignored workspace artifacts private',async()=>{
    const web=await harness.launch();
    assert.ok(web,'Chromium is required');
    try {
      const response=await fetch(web.origin+'/_temp/execucao-etapa-f/F0/extension-id.txt');
      await response.body?.cancel();
      assert.equal(response.status,403);
    } finally { await web.close(); }
  });

  await check('F2 read-only blocks every IndexedDB write and still exports the same encrypted notes',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {vaultFixture}=await import('./vault-core.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      const ordinary=harness.note({title:'Read-only note'});
      const trashed=harness.note({title:'Expired fictional Trash entry',deletedAt:1});
      const vault=vaultFixture();
      const seeded=[ordinary,trashed,vault];
      const tested=await p.eval(`(async()=>{
        const db=await import('./js/db.js'), app=await import('./js/app.js'), backup=await import('./js/backup.js');
        const account=await import('./js/account.js'), recovery=await import('./js/recovery-actions.js'), i18n=await import('./js/i18n.js');
        const version=await import('./js/backup-v2.js');
        const seeded=${JSON.stringify(seeded)};
        for(const item of seeded) await app.saveNote(item);
        document.querySelector('[data-view=notes]').click();
        const previous=await db.readVault();
        db.setWriteMode('readOnly');
        folderTest.clear();
        const regular=app.getNotes().find(note=>note.id===seeded[0].id);
        const old=app.getNotes().find(note=>note.id===seeded[1].id);
        const record=previous.notes.find(note=>note.id===regular.id);
        const guard={expectedVaultId:previous.meta.vaultId,knownUpdatedAt:regular.updatedAt};
        const rejected={};
        for(const [name,operation] of Object.entries({
          editor:()=>app.saveNote({...regular,title:'Discarded draft'},{fields:['title']}),
          metadata:()=>app.saveNote(regular,{change:note=>{note.pinned=true;}}),
          batch:()=>db.guardedNoteBatch([{id:record.id,knownUpdatedAt:regular.updatedAt,record}],guard),
          trash:()=>app.saveNote(regular,{change:note=>{note.deletedAt=Date.now();}}),
          purge:()=>app.permanentDeleteNote(old.id),
          import:()=>backup.importBackup(new File([],'fictional.keeplocal'),${JSON.stringify(harness.PASSWORD)}),
          replace:()=>db.replaceVault(previous,previous.meta),
          rotation:()=>account.changePassword(${JSON.stringify(harness.PASSWORD)},'Fictitious Rotation Words 256'),
          reset:()=>account.resetVault(i18n.t('account.resetWord')),
          discard:()=>recovery.discardRecord(record,i18n.t('recovery.discardWord'),{confirmedSaved:true}),
          saveMeta:()=>db.saveMeta('theme','light'),
          removeMeta:()=>db.deleteMeta('lang'),
          exportLineage:()=>db.recordExport(previous.meta,1,'fictional'),
          downloadReceipt:()=>db.acknowledgeDownload(previous.meta,1),
        })) {
          try { await operation(); rejected[name]='accepted'; }
          catch(error) { rejected[name]=error.code||error.message; }
        }
        const id=await db.ensureVaultId(previous.meta.salt);
        const archived=[];
        URL.createObjectURL=blob=>{archived.push(blob);return 'blob:fixture';};
        URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        await backup.exportBackup();
        await backup.exportBackup();
        const payloads=[];
        for(const blob of archived) {
          payloads.push((await version.decodeV2(new Uint8Array(await blob.arrayBuffer()),${JSON.stringify(harness.PASSWORD)})).payload);
        }
        return {identity:id===previous.meta.vaultId,rejected,
          bytesEqual:JSON.stringify(await db.readVault())===JSON.stringify(previous),
          itemEqual:regular.title===seeded[0].title&&!regular.pinned,
          payloadsEqual:payloads.length===2&&payloads.every(payload=>payload.rev===(previous.meta.exportRev||0)+1&&
            payload.parent===(previous.meta.exportParent||null)&&JSON.stringify(payload.notes)===JSON.stringify(previous.notes)),
          writes:folderTest.writes,snapshot:JSON.stringify(previous)};
      })()`);
      assert.equal(Object.keys(tested.rejected).length,14);
      assert.deepEqual([...new Set(Object.values(tested.rejected))],['vault.readOnly']);
      assert.equal(tested.identity,true);
      assert.equal(tested.bytesEqual,true);
      assert.equal(tested.itemEqual,true);
      assert.equal(tested.payloadsEqual,true);
      assert.deepEqual(tested.writes,{});

      const selector='[data-id="'+ordinary.id+'"] [data-action=pin]';
      await p.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await p.until("[...document.querySelectorAll('.toast')].some(node=>node.textContent.includes('Read only: folder unavailable'))");
      assert.equal(await p.eval(`(await import('./js/app.js')).getNotes().find(note=>note.id===${JSON.stringify(ordinary.id)}).pinned`),false);
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("document.querySelector('#main-inner').innerText.includes('Expired fictional Trash entry')");
      await p.eval("document.querySelector('#theme-toggle').click();document.querySelector('#lang-toggle').click()");
      await p.until("document.documentElement.lang==='pt-BR'&&document.documentElement.dataset.theme==='light'");
      await p.eval("document.querySelector('[data-view=vault]').click();document.querySelector('[data-vault-layout=list]').click()");
      await p.until("document.querySelector('.vault-cards').dataset.layout==='list'");
      assert.deepEqual(await p.eval('folderTest.writes'),{});
      assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),tested.snapshot);

      await p.eval("(await import('./js/db.js')).setWriteMode('readWrite');document.querySelector('[data-view=notes]').click()");
      await p.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await p.until(`(await import('./js/app.js')).getNotes().find(note=>note.id===${JSON.stringify(ordinary.id)}).pinned`);
      assert.ok(await p.eval('folderTest.writes.notes>0'));
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('F2 a missing legacy vault identity stays in memory until writes are allowed',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      const outcome=await p.eval(`(async()=>{
        const db=await import('./js/db.js'),auth=await import('./js/auth.js');
        await db.deleteMeta('vaultId');
        const salt=await db.getMeta('salt');
        db.setWriteMode('readOnly');
        folderTest.clear();
        await auth.login(${JSON.stringify(harness.PASSWORD)});
        const first=await db.ensureVaultId(salt);
        const second=await db.ensureVaultId(salt);
        const before={first,second,stored:await db.getMeta('vaultId'),writes:{...folderTest.writes}};
        db.setWriteMode('readWrite');
        await db.ensureVaultId(salt);
        return {before,stored:await db.getMeta('vaultId')};
      })()`);
      assert.equal(outcome.before.first,outcome.before.second);
      assert.match(outcome.before.first,/^[0-9a-f-]{36}$/);
      assert.equal(outcome.before.stored,null);
      assert.deepEqual(outcome.before.writes,{});
      assert.match(outcome.stored,/^[0-9a-f-]{36}$/);
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('F3 extension login asks before PBKDF2 and checks the real directory after login',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      const selected=await p.eval(`(async()=>{
        const folders=await import('./js/folder-store.js'), app=await import('./js/app.js');
        const result=await folders.chooseSyncFolder({key:app.getCryptoKey()});
        const saved=await folders.readSyncFolder();
        return {supported:folders.folderSupported(),name:saved.name,status:result.status,
          picker:folderTest.events.find(event=>event.kind==='picker'),files:await folderTest.entries()};
      })()`);
      assert.equal(selected.supported,true);
      assert.match(selected.name,/^KL-TEST-/);
      assert.equal(selected.status,'ok');
      assert.deepEqual(selected.picker.options,{mode:'readwrite',id:'keeplocal-vault'});
      assert.deepEqual(selected.files,[]);

      await p.reload();
      await p.until("!document.querySelector('#login-form').classList.contains('hidden')");
      await submitExtensionLogin(p,'Fictitious wrong passphrase 713');
      await p.until("document.querySelector('#login-error').textContent.length>0");
      const failed=await p.eval("folderTest.events.map(event=>event.kind)");
      assert.deepEqual(failed,['query','request','deriveKey']);

      await p.reload();
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('.app-view')&&!!document.querySelector('#main-inner')?.firstElementChild");
      const granted=await p.eval('folderTest.events');
      assert.deepEqual(granted.map(event=>event.kind),['query','request','deriveKey','list']);
      assert.equal(granted[1].active,true);
      assert.deepEqual(await p.eval('folderTest.entries()'),[]);

      for(const [requested,status] of [['denied','denied'],['error','denied'],['granted','notFound']]) {
        await p.reload();
        if(status==='notFound') await p.eval("folderTest.permission='granted';await folderTest.remove()");
        else await p.eval(`folderTest.requested=${JSON.stringify(requested)}`);
        await submitExtensionLogin(p);
        await p.until(`!!document.querySelector('[data-folder-status=${status}]')`);
        assert.equal(await p.eval("!!document.querySelector('.app-view')"),false);
        assert.equal(await p.eval('!!(await import("./js/app.js")).getCryptoKey()'),true);
        assert.deepEqual(await p.eval('folderTest.writes'),{});
        if(status==='notFound') {
          assert.deepEqual(await p.eval("folderTest.events.map(event=>event.kind)"),['query','deriveKey','list']);
          assert.deepEqual(await p.eval(`(async()=>{
            const entries=[];
            for await(const name of (await navigator.storage.getDirectory()).keys()) entries.push(name);
            return entries;
          })()`),[]);
        } else {
          assert.deepEqual(await p.eval("folderTest.events.map(event=>event.kind)"),['query','request','deriveKey']);
          assert.deepEqual(await p.eval('folderTest.entries()'),[]);
        }
      }
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('F3 the folder feature is absent on HTTP and rejects unreadable records on MV3',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const web=await harness.launch();
    const extension=await harness.launchExtension();
    try {
      const p=await web.page(undefined,folderFixtureSource());
      await harness.create(p);
      assert.deepEqual(await p.eval(`(async()=>{
        const f=await import('./js/folder-store.js');
        let rejected;
        try{await f.chooseSyncFolder();}catch(error){rejected=error.code;}
        return {supported:f.folderSupported(),handle:await f.readSyncFolder(),rejected,
          controls:document.querySelectorAll('[data-folder-action], [data-folder-status], #folder-settings-btn').length,
          picker:folderTest.events.some(event=>event.kind==='picker')};
      })()`),{supported:false,handle:null,rejected:'folder.unsupported',controls:0,picker:false});

      const e=await extension.page(undefined,folderFixtureSource());
      await harness.create(e);
      const result=await e.eval(`(async()=>{
        const app=await import('./js/app.js'), db=await import('./js/db.js'), f=await import('./js/folder-store.js');
        await db.saveNoteRecord({id:crypto.randomUUID(),updatedAt:1,iv:'AAAA',ciphertext:'AAAA'});
        let rejected;
        try{await f.chooseSyncFolder({key:app.getCryptoKey()});}catch(error){rejected=error.code;}
        return {rejected,saved:await f.readSyncFolder(),files:await folderTest.entries()};
      })()`);
      assert.deepEqual(result,{rejected:'folder.unreadable',saved:null,files:[]});
      assert.deepEqual([...p.errors,...e.errors],[]);
    } finally { await extension.close();await web.close(); }
  });

  await check('F4 the folder blocker gates read-only, retry, replacement and sign out',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {vaultFixture}=await import('./vault-core.mjs');
    const browser=await harness.launchExtension();
    const english='Read only: folder unavailable';
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      await harness.add(p,'A fictitious note','Fictitious readable content');
      const vault=vaultFixture();
      const oldName=await p.eval(`(async()=>{
        const app=await import('./js/app.js'),f=await import('./js/folder-store.js');
        await app.saveNote(${JSON.stringify(vault)});
        const {handle}=await f.chooseSyncFolder({key:app.getCryptoKey()});
        return handle.name;
      })()`);

      await p.reload();
      await p.eval("folderTest.permission='granted';await folderTest.remove()");
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('[data-folder-status=notFound]')");
      assert.equal(await p.eval("document.querySelector('.folder-name').textContent"),oldName);
      assert.match(await p.eval("document.querySelector('.folder-reason').textContent"),/renamed, moved or disconnected/i);
      assert.equal(await p.eval("document.querySelectorAll('[data-folder-action]').length"),5);
      assert.deepEqual(await p.eval('folderTest.writes'),{});
      await p.send('Page.bringToFront');
      await p.until("document.activeElement.dataset.folderAction==='retry'&&document.hasFocus()");
      await p.eval("document.querySelector('[data-folder-action=openReadOnly]').focus()");
      assert.equal(await p.eval("document.activeElement.dataset.folderAction"),'openReadOnly');
      await pressEnter(p);
      await p.until("!!document.querySelector('.folder-banner')&&!!document.querySelector('.note-card')");
      assert.equal(await p.eval("document.querySelector('.folder-banner strong').textContent"),english);
      assert.equal(await p.eval("getComputedStyle(document.querySelector('.new-note-bar')).display"),'none');
      assert.equal(await p.eval("document.querySelector('.note-card').draggable"),false);
      assert.equal(await p.eval("getComputedStyle(document.querySelector('#backup-btn')).display")!=='none',true);
      await p.eval("document.querySelector('.note-card').click()");
      await p.until("!!document.querySelector('.folder-note-text')");
      assert.equal(await p.eval("document.querySelector('.folder-note-text').textContent"),'Fictitious readable content');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.folder-note-text')");
      await p.eval("document.querySelector('[data-view=vault]').click();document.querySelector('[data-vault-open]').click()");
      await p.until("!!document.querySelector('.vault-detail')");
      assert.equal(await p.eval("!!document.querySelector('[data-vault-edit]')"),false);
      await p.eval("document.querySelector('[data-vault-reveal]').click()");
      assert.equal(await p.eval("document.querySelector('.vault-secret-value').textContent"),'fictional-secret');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-detail')");
      await p.eval("document.querySelector('[data-folder-action=retry]').click()");
      await p.until("[...document.querySelectorAll('.toast')].some(node=>node.textContent.includes('Folder not found'))");
      assert.deepEqual(await p.eval('folderTest.writes'),{});
      const emptyRoot=await p.eval(`(async()=>{
        const entries=[];
        for await(const name of (await navigator.storage.getDirectory()).keys()) entries.push(name);
        return entries;
      })()`);
      assert.deepEqual(emptyRoot,[]);
      await p.eval("await folderTest.directory(true);folderTest.permission='prompt';folderTest.clear();document.querySelector('[data-folder-action=retry]').click()");
      await p.until("!!document.querySelector('.app-view')&&!document.querySelector('.folder-banner')");
      assert.equal(await p.eval("(await import('./js/db.js')).isReadOnly()"),false);
      assert.deepEqual(await p.eval("folderTest.events.map(event=>event.kind)"),['query','request','list']);
      assert.deepEqual(await p.eval('folderTest.entries()'),[]);

      await p.reload();
      await p.eval("folderTest.requested='denied'");
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('[data-folder-status=denied]')");
      assert.match(await p.eval("document.querySelector('.folder-reason').textContent"),/permission denied/i);
      await p.eval("folderTest.name='KL-TEST-replacement';folderTest.clear();document.querySelector('[data-folder-action=chooseAnother]').click()");
      await p.until("!!document.querySelector('.app-view')&&!document.querySelector('.folder-banner')");
      assert.equal(await p.eval("(await(await import('./js/folder-store.js')).readSyncFolder()).name"),'KL-TEST-replacement');
      assert.deepEqual(await p.eval("folderTest.events.map(event=>event.kind)"),['picker','list']);
      assert.deepEqual(await p.eval('folderTest.entries()'),[]);

      await p.reload();
      await p.eval("folderTest.permission='denied'");
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('[data-folder-status=denied]')");
      await p.eval("document.querySelector('[data-folder-action=exit]').click()");
      await p.until("!!document.querySelector('#login-form:not(.hidden)')");
      assert.equal(await p.eval("!!(await import('./js/app.js')).getCryptoKey()||!!(await(await import('./js/session.js')).getSessionKey())"),false);
      assert.deepEqual(await p.eval('folderTest.writes'),{});
      const folders=await p.eval(`(async()=>{
        const counts={};
        for await(const [name,dir] of (await navigator.storage.getDirectory()).entries()){
          counts[name]=0;
          for await(const entry of dir.keys()) counts[name]++;
        }
        return counts;
      })()`);
      assert.deepEqual(folders,{[oldName]:0,'KL-TEST-replacement':0});
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('F5 extension settings select, replace and disconnect folders in English and Portuguese',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      const open=async action=>{
        await p.eval("document.querySelector('#folder-settings-btn').click()");
        await p.until(`document.activeElement.id==='modal-close'&&!!document.querySelector('.folder-settings [data-folder-action=${action}]')`);
      };
      const close=async()=>{
        await p.eval("document.querySelector('#modal-close').click()");
        await p.until("!document.querySelector('.folder-settings')");
      };
      const text=()=>p.eval("document.querySelector('.folder-settings').innerText");
      const name=()=>p.eval("(await(await import('./js/folder-store.js')).readSyncFolder())?.name ?? null");
      await open('choose');
      assert.match(await text(),/Settings[\s\S]+Vault folder[\s\S]+Allow on every visit/);
      await p.eval("document.querySelector('[data-folder-action=choose]').focus()");
      await pressEnter(p);
      await p.until("!!document.querySelector('[data-folder-action=change]')");
      const selected=await name();
      assert.match(selected,/^KL-TEST-/);
      assert.equal(await p.eval("folderTest.events.find(event=>event.kind==='picker').active"),true);
      assert.match(await text(),new RegExp('Folder connected: '+selected));
      assert.match(await text(),/Folder write pending|Written to folder/);
      assert.doesNotMatch(await text(),/\bsynced\b|\bsynchronized\b/i);
      assert.deepEqual(await p.eval('folderTest.entries()'),[]);

      await p.eval("folderTest.name='KL-TEST-settings-replacement';document.querySelector('[data-folder-action=change]').click()");
      await p.until("document.querySelector('.folder-settings .folder-name')?.textContent.includes('KL-TEST-settings-replacement')");
      assert.deepEqual(await p.eval('folderTest.entries()'),[]);
      // Existing content stands in for unrelated user data without a file write.
      await p.eval("(await folderTest.directory()).getDirectoryHandle('FICTITIOUS-EXISTING-FOLDER',{create:true})");
      await close();
      await p.reload();
      await p.eval("folderTest.permission='granted'");
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('#folder-settings-btn')");
      assert.equal(await name(),'KL-TEST-settings-replacement');
      await p.eval("document.querySelector('#lang-toggle').click()");
      await p.until("document.documentElement.lang==='pt-BR'&&document.querySelector('#folder-settings-btn')?.textContent==='Configurações'");
      await open('disconnect');
      assert.match(await text(),/Configurações[\s\S]+Pasta do cofre[\s\S]+Pasta conectada: KL-TEST-settings-replacement/);

      const ask=async()=>{
        await p.eval("document.querySelector('[data-folder-action=disconnect]').click()");
        await p.until("document.activeElement.dataset.dialogAction==='cancel'");
      };
      await ask();
      await pressEnter(p);
      await p.until("!document.querySelector('.app-dialog')&&!document.querySelector('[data-folder-action=disconnect]').disabled");
      assert.equal(await name(),'KL-TEST-settings-replacement');
      await ask();
      await p.eval("document.querySelector('[data-dialog-action=confirm]').focus()");
      await pressEnter(p);
      await p.until("!!document.querySelector('[data-folder-action=choose]')");
      assert.equal(await name(),null);
      assert.match(await text(),/Escolher pasta…/);
      assert.match(await text(),/Permitir em todas as visitas/);
      const contents=await p.eval(`(async()=>{
        const root=await navigator.storage.getDirectory(), rows={};
        for await(const [name,dir] of root.entries()){
          rows[name]=[];
          for await(const child of dir.values()) rows[name].push([child.kind,child.name]);
        }
        return rows;
      })()`);
      assert.deepEqual(contents,{[selected]:[],'KL-TEST-settings-replacement':[['directory','FICTITIOUS-EXISTING-FOLDER']]});
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('F6 only a directory listing can classify a folder as unavailable by name',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      const result=await p.eval(`(async()=>{
        const f=await import('./js/folder-store.js');
        const handle=await folderTest.directory(true);
        const untouched=await folderTest.entries();
        folderTest.clear();
        FileSystemHandle.prototype.queryPermission=async()=>{
          throw new DOMException('Fictitious permission inspection error','NotFoundError');
        };
        const failure=await f.requestFolderAccess(handle);
        const existing=await f.checkFolder(handle,failure);
        await folderTest.remove();
        const missing=await f.checkFolder(handle,failure);
        return {existing,missing,untouched,events:folderTest.events.map(event=>event.kind),writes:folderTest.writes};
      })()`);
      assert.deepEqual(result,{
        existing:'error:NotFoundError',missing:'notFound',untouched:[],
        events:['list','list'],writes:{},
      });
      assert.deepEqual(p.errors,[]);
    } finally { await browser.close(); }
  });

  await check('G0 locked import explains the configured folder and typed reset preserves the directory',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      await harness.add(p,'Local reset fixture','Fictitious');
      await p.eval(`(async()=>{
        const folder=await import('./js/folder-store.js'),app=await import('./js/app.js');
        const {handle}=await folder.chooseSyncFolder({key:app.getCryptoKey()});
        const marker=await handle.getFileHandle('owner-fixture.txt',{create:true});
        const stream=await marker.createWritable();await stream.write('keep this');await stream.close();
      })()`);
      await p.reload();
      await p.until("!!document.querySelector('#login-form:not(.hidden)')");
      await p.eval(`(()=>{
        document.querySelector('[data-tab=import]').click();
        const data=new DataTransfer();data.items.add(new File(['fixture'],'test.keeplocal'));
        const input=document.querySelector('#import-file');input.files=data.files;input.dispatchEvent(new Event('change'));
        const password=document.querySelector('#import-password');password.value='fictional';password.dispatchEvent(new Event('input'));
        document.querySelector('#import-btn').click();
      })()`);
      await p.until("!!document.querySelector('#import-error').textContent");
      assert.match(await p.eval("document.querySelector('#import-error').textContent"),/disconnect the folder after signing in or reset/i);
      await p.eval("document.querySelector('[data-tab=login]').click();document.querySelector('#reset-vault').click()");
      await p.until("!!document.querySelector('.app-dialog input')");
      assert.match(await p.eval("document.querySelector('.app-dialog').innerText"),/copy in the folder will remain/i);
      await p.eval(`(async()=>{
        const {t}=await import('./js/i18n.js'),input=document.querySelector('.app-dialog input');
        input.value=t('account.resetWord');input.dispatchEvent(new Event('input'));
      })()`);
      await p.waitForNavigation(()=>p.eval("document.querySelector('[data-dialog-action=confirm]').click()"));
      await p.until("!!document.querySelector('#create-form:not(.hidden)')");
      assert.equal(await p.eval(`(async()=>{
        const {notes,meta}=await (await import('./js/db.js')).readVault();
        return !notes.length&&!meta.salt&&!meta.syncFolder;
      })()`),true);
      assert.deepEqual(await p.eval('folderTest.entries()'),['owner-fixture.txt']);
      assert.equal(await p.eval("(await (await (await folderTest.directory()).getFileHandle('owner-fixture.txt')).getFile()).text()"),'keep this');
    } finally {await browser.close();}
  });

  await check('G1 folder candidates are bounded, authenticated and ordered by encrypted revision',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {writeFolderFixture}=await import('./folder-transfer.mjs');
    const {backupFixture}=await import('./backup-fixture.mjs');
    const browser=await harness.launchExtension();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      await harness.add(p,'Encrypted candidate fixture','Fictitious');
      const read=()=>p.eval(`(async()=>{
        const f=await import('./js/folder-vault.js'),db=await import('./js/db.js'),app=await import('./js/app.js');
        const {head,candidates,divergent,unreadable,otherSalt,tooLarge,limitExceeded}=await f.readFolderState(await folderTest.directory(true),app.getCryptoKey(),await db.getMeta('salt'));
        return {top:head?.rev??null,candidates:candidates.map(row=>row.name).sort(),divergent,unreadable,otherSalt,tooLarge,limitExceeded};
      })()`);
      assert.deepEqual(await read(),{top:null,candidates:[],divergent:false,unreadable:[],otherSalt:[],tooLarge:[],limitExceeded:false});
      const bytes=await p.eval(`(async()=>{
        const {notes,meta}=await(await import('./js/db.js')).readVault();
        const {encodeV2,makePayload}=await import('./js/backup-v2.js');
        const key=(await import('./js/app.js')).getCryptoKey(),salt=Uint8Array.fromBase64(meta.salt);
        const encode=async(rev,preferences={})=>(await encodeV2(key,salt,makePayload(notes,preferences,rev))).toBase64();
        return {main:await encode(1),copy:await encode(2),tie:await encode(2,{lang:'pt-BR'})};
      })()`);
      const main='keeplocal-vault.keeplocal';
      await writeFolderFixture(p,main,bytes.main);
      assert.equal((await read()).top,1);
      await writeFolderFixture(p,'keeplocal-vault (1).keeplocal',bytes.copy);
      assert.equal((await read()).top,2);
      await writeFolderFixture(p,'tie.keeplocal',bytes.tie);
      const tampered=Buffer.from(bytes.main,'base64');tampered[tampered.length-1]^=1;
      await writeFolderFixture(p,'tampered.keeplocal',tampered.toString('base64'));
      await writeFolderFixture(p,'other.keeplocal',(await backupFixture()).base64);
      await writeFolderFixture(p,'desktop.ini',bytes.copy);
      await writeFolderFixture(p,'temporary.keeplocal.crswap',bytes.copy);
      await p.eval(`(async()=>{
        const dir=await folderTest.directory(),file=await dir.getFileHandle('oversized.keeplocal',{create:true});
        const writer=await file.createWritable();await writer.truncate(64*1024*1024+1);await writer.close();
      })()`);
      const state=await read();
      assert.equal(state.top,2);
      assert.equal(state.divergent,true);
      assert.deepEqual(state.unreadable,['tampered.keeplocal']);
      assert.deepEqual(state.otherSalt,['other.keeplocal']);
      assert.deepEqual(state.tooLarge,['oversized.keeplocal']);
      assert.equal(state.candidates.length,6);
      assert.equal(await p.eval("folderTest.events.filter(event=>event.kind==='deriveKey').length"),1);
    } finally {await browser.close();}
  });

  await check('G2 serial writes debounce edits, retry and verify a normal profile 2 import',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture}=await import('./folder-transfer.mjs');
    const {importExpression}=await import('./backup-fixture.mjs');
    const browser=await harness.launchExtension(),manual=await harness.launch();
    try {
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      await harness.add(p,'Local journey fixture','original');
      await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await p.reload();
      await p.eval("folderTest.failWrites=2");
      await submitExtensionLogin(p);
      await p.until("!!document.querySelector('.note-card')");
      await p.eval(`(async()=>{
        const app=await import('./js/app.js');
        for(let n=1;n<=20;n++)await app.saveNote({...app.getNotes()[0],content:'edit '+n});
      })()`);
      await p.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)",12000);
      const state=await p.eval(`(async()=>{
        const {meta}=await(await import('./js/db.js')).readVault();
        return {rev:meta.exportRev,folderRev:meta.folderSeenRev,hash:meta.folderSyncedHash,
          parent:meta.exportParent,local:meta.revision,confirmed:meta.folderSyncedRevision,
          dirty:meta.dirtySinceBackup,lastBackupAt:meta.lastBackupAt??null,attempts:folderTest.writeAttempts};
      })()`);
      assert.equal(state.rev,1);assert.equal(state.folderRev,1);assert.equal(state.parent,state.hash);
      assert.equal(state.local,state.confirmed);assert.equal(state.dirty,true);assert.equal(state.lastBackupAt,null);
      assert.equal(state.attempts,3);
      const b=await manual.page();
      await b.eval(importExpression(await readFolderFixture(p,'keeplocal-vault.keeplocal')));
      assert.equal(await b.eval("(await(await import('./js/db.js')).readVault()).notes.length"),1);
      await b.reload();
      await harness.unlock(b);
      assert.equal(await b.eval("(await import('./js/app.js')).getNotes()[0].content"),'edit 20');
    } finally {await Promise.all([browser.close(),manual.close()]);}
  });

  await check('G2 mismatch, unreadable records and a lost folder never advance lineage',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    for(const scenario of ['badReadback','unreadable','removeBeforeWrite']){
      const browser=await harness.launchExtension();
      try {
        const p=await browser.page(undefined,folderFixtureSource());
        await harness.create(p);
        await harness.add(p,'Preserved fixture',scenario);
        await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
        if(scenario==='unreadable')await p.eval("(await import('./js/db.js')).saveNoteRecord({id:crypto.randomUUID(),updatedAt:0,iv:'AAAA',ciphertext:'AAAA'})");
        await p.reload();
        if(scenario!=='unreadable')await p.eval(`folderTest.${scenario}=true`);
        await submitExtensionLogin(p);
        if(scenario==='badReadback'){
          await p.until('folderTest.tamperedReads===1');
          // The guarded database write must not run after mismatched readback.
          await p.until('folderTest.writeAttempts===1');
        }else if(scenario==='unreadable'){
          await p.until("document.body.innerText.includes('unreadable')");
          await p.until("Array.from(document.querySelectorAll('.toast')).some(node=>/before connecting/i.test(node.textContent))");
          assert.equal(await p.eval('folderTest.writeAttempts'),0);
        }else{
          await p.until("!!document.querySelector('.folder-banner')");
          assert.equal(await p.eval("(await import('./js/db.js')).isReadOnly()"),true);
        }
        const after=await p.eval(`(async()=>{
          const {meta,notes}=await(await import('./js/db.js')).readVault();
          return {rev:meta.exportRev??null,hash:meta.folderSyncedHash??null,notes:notes.length};
        })()`);
        assert.deepEqual(after,{rev:null,hash:null,notes:scenario==='unreadable'?2:1});
      } finally {await browser.close();}
    }
  });

  await check('G3 two extension profiles travel both ways and resolve divergence without erasing an unchosen copy',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture,writeFolderFixture,copyFolderFiles}=await import('./folder-transfer.mjs');
    const {backupFixture,importExpression}=await import('./backup-fixture.mjs');
    const a=await harness.launchExtension(),b=await harness.launchExtension();
    const primary='keeplocal-vault.keeplocal';
    const attach=p=>p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
    const relogin=async p=>{
      await p.reload();await p.eval("folderTest.permission='granted'");await submitExtensionLogin(p);
    };
    const rev=p=>p.eval("(await import('./js/db.js')).getMeta('folderSeenRev')");
    const waitForWrite=(p,n)=>p.until(`(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>${n})`);
    const hasNote=(p,title)=>p.until(`(await import('./js/app.js')).getNotes().some(note=>note.title===${JSON.stringify(title)})`);
    const confirm=async(p,action)=>{
      await p.eval(`document.querySelector('[data-folder-action=${action}]').click()`);
      await p.until("!!document.querySelector('.app-dialog input')");
      await p.eval("const input=document.querySelector('.app-dialog input');input.value='REPLACE';input.dispatchEvent(new Event('input'));document.querySelector('[data-dialog-action=confirm]').click()");
    };
    const preserved=p=>p.eval(`(async()=>{
      const directory=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
      const files={};
      for await(const [name,entry] of directory.entries())
        files[name]=new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64();
      return files;
    })()`);
    try{
      const pa=await a.page(undefined,folderFixtureSource('KL-TEST-PC-A'));
      const pb=await b.page(undefined,folderFixtureSource('KL-TEST-PC-B'));
      await harness.create(pa);
      await harness.add(pa,'Only on A initially','Fictitious A');
      await pb.eval(importExpression(await captureFolderBackup(pa)));
      await pb.reload();await harness.unlock(pb);
      await attach(pa);await relogin(pa);await waitForWrite(pa,0);
      await attach(pb);await copyFolderFiles(pa,pb);await relogin(pb);
      await hasNote(pb,'Only on A initially');
      const first=await rev(pb);
      assert.equal(await pb.eval('folderTest.writeAttempts'),0);
      await harness.add(pb,'Notebook edit','Fictitious B');
      await waitForWrite(pb,first);
      await copyFolderFiles(pb,pa);await relogin(pa);
      await hasNote(pa,'Notebook edit');
      const old=await readFolderFixture(pa,primary),common=await rev(pa);
      assert.equal(common,await rev(pb));

      await harness.add(pa,'Independent A','Fictitious branch A');
      await harness.add(pa,'Second independent A','Fictitious note count differs');
      await harness.add(pb,'Independent B','Fictitious branch B');
      await Promise.all([waitForWrite(pa,common),waitForWrite(pb,common)]);
      const independentA=await readFolderFixture(pa,primary),independentB=await readFolderFixture(pb,primary);
      await writeFolderFixture(pa,primary,independentB);
      await writeFolderFixture(pa,'keeplocal-vault (1).keeplocal',independentA);
      await writeFolderFixture(pb,primary,independentA);
      await relogin(pa);await relogin(pb);
      for(const p of [pa,pb]){
        await p.until("!!document.querySelector('[data-folder-status=conflict]')");
        assert.equal(await p.eval('folderTest.writeAttempts'),0);
        assert.deepEqual(await p.eval('folderTest.writes'),{});
        assert.equal(await p.eval("(await import('./js/db.js')).isReadOnly()"),true);
      }

      await pb.eval(`(()=>{
        URL.createObjectURL=blob=>{window.g3Archive=blob;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        document.querySelector('[data-folder-action=exportLocal]').click();
      })()`);
      await pb.until("document.querySelector('.folder-review [role=status]').textContent.includes('Verify the saved file')");
      const archive=await pb.eval(`(async()=>{
        const b=await import('./js/backup-v2.js'),f=await import('./js/backup-format.js');
        const result=await b.decodeV2(new Uint8Array(await g3Archive.arrayBuffer()),${JSON.stringify(harness.PASSWORD)});
        return (await f.decryptRecords(result.payload.notes,result.key)).map(note=>note.title);
      })()`);
      assert.ok(archive.includes('Independent B'));
      assert.deepEqual(await pb.eval('folderTest.writes'),{});
      assert.match(await pb.eval("document.querySelector('.folder-review').innerText"),/keeplocal-preserved/);
      await pb.eval('folderTest.failPreservation=true');
      await confirm(pb,'useFolder');
      await pb.until("document.querySelector('.folder-review [role=status]').textContent.includes('preserve')");
      assert.equal(await readFolderFixture(pb,primary),independentA);
      assert.deepEqual(await pb.eval('folderTest.writes'),{});
      assert.equal(await pb.eval("(await import('./js/db.js')).isReadOnly()"),true);
      await pb.eval('folderTest.failPreservation=false');
      await confirm(pb,'useFolder');
      await hasNote(pb,'Independent A');
      assert.equal(await pb.eval('folderTest.writeAttempts'),0);

      await pa.eval("const picker=document.querySelector('.folder-review select');picker.value='keeplocal-vault (1).keeplocal';picker.dispatchEvent(new Event('change'))");
      assert.match(await pa.eval("document.querySelector('.folder-review').innerText"),/Folder: revision [^\n]+4 notes/);
      await confirm(pa,'useLocal');
      await waitForWrite(pa,common+1);
      assert.equal(await readFolderFixture(pa,'keeplocal-vault (1).keeplocal'),independentA);
      await hasNote(pa,'Independent A');
      const copiesA=Object.values(await preserved(pa));
      const copiesB=Object.values(await preserved(pb)).filter(Boolean);
      assert.equal(copiesA.length,2);
      assert.ok(copiesA.includes(independentA));
      assert.ok(copiesA.includes(independentB));
      assert.equal(copiesB.length,1);
      for(const [base64,title] of [...copiesA.map(bytes=>[bytes,bytes===independentA?'Independent A':'Independent B']),[copiesB[0],'Independent B']]){
        const clean=await harness.launchExtension();
        try{
          const page=await clean.page();
          await page.eval(importExpression(base64));
          await page.reload();await harness.unlock(page);
          await hasNote(page,title);
        }finally{await clean.close();}
      }
      const written=await readFolderFixture(pa,primary);
      await writeFolderFixture(pb,'keeplocal-vault (2).keeplocal',written);
      await pb.eval("window.dispatchEvent(new Event('focus'))");
      await pb.until(`(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>${common+1})`);
      assert.deepEqual(await pb.eval('folderTest.entries()'),['keeplocal-preserved','keeplocal-vault (2).keeplocal',primary]);

      await writeFolderFixture(pa,primary,old);
      // Leave the old copy in place as an independent candidate. Both are now below the seen revision.
      await relogin(pa);
      await pa.until("!!document.querySelector('[data-folder-status=rollback]')");
      assert.equal(await pa.eval('folderTest.writeAttempts'),0);
      assert.deepEqual(await pa.eval('folderTest.writes'),{});
      await writeFolderFixture(pb,primary,(await backupFixture()).base64);
      await relogin(pb);
      await pb.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      assert.equal(await pb.eval('folderTest.writeAttempts'),0);
      assert.deepEqual(await pb.eval('folderTest.writes'),{});
    }finally{await Promise.all([a.close(),b.close()]);}
  });

  await check('G1.2 choosing a tied copy advances the main revision and keeps the prior file',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture,writeFolderFixture}=await import('./folder-transfer.mjs');
    const {backupFixture}=await import('./backup-fixture.mjs');
    const {decodeV2,payloadHash}=await import('../../js/backup-v2.js');
    const browser=await harness.launchExtension();
    const primary='keeplocal-vault.keeplocal',tie='keeplocal-vault (1).keeplocal';
    const decode=bytes=>decodeV2(Buffer.from(bytes,'base64'),harness.PASSWORD);
    try{
      const p=await browser.page(undefined,folderFixtureSource('KL-TEST-TIED-PULL'));
      const rev=()=>p.eval("(await import('./js/db.js')).getMeta('folderSeenRev')");
      const app=()=>p.until("!!document.querySelector('.app-view .note-card')&&!document.querySelector('.folder-banner')");
      const relogin=async()=>{
        await p.reload();await p.eval("folderTest.permission='granted'");await submitExtensionLogin(p);
      };
      await harness.create(p);
      await harness.add(p,'Local at start','Fictitious');
      await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await relogin();
      await p.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>0)");
      const tiedRev=(await rev())+1;
      const salt=Buffer.from(await p.eval("(await import('./js/db.js')).getMeta('salt')"),'base64');
      const make=async title=>{
        const fixture=await backupFixture([harness.note({title})],harness.PASSWORD,salt);
        return fixture.seal({...fixture.payload,rev:tiedRev});
      };
      const x=await make('Fictitious X'),y=await make('Fictitious Y');
      await writeFolderFixture(p,primary,x);
      await writeFolderFixture(p,tie,y);
      await relogin();
      await p.until("!!document.querySelector('[data-folder-status=conflict] select')");
      await p.eval(`document.querySelector('.folder-review select').value=${JSON.stringify(tie)};document.querySelector('[data-folder-action=useFolder]').click()`);
      await p.until("!!document.querySelector('.app-dialog input')");
      await p.eval("const input=document.querySelector('.app-dialog input');input.value='REPLACE';input.dispatchEvent(new Event('input'));document.querySelector('[data-dialog-action=confirm]').click()");
      await app();
      const afterPull=await p.eval("(await(await import('./js/db.js')).readVault()).meta");
      assert.equal(afterPull.revision,afterPull.folderSyncedRevision,'Opening a tied copy must not dirty an absent language preference');
      assert.equal(afterPull.lang,undefined);
      const next=await decode(await readFolderFixture(p,primary));
      const selected=await decode(y);
      assert.equal(next.payload.rev,tiedRev+1);
      assert.equal(next.payload.parent,await payloadHash(selected.payloadText));
      assert.deepEqual(next.payload.notes,selected.payload.notes);
      assert.equal(await readFolderFixture(p,tie),y);
      assert.equal(await p.eval(`(async()=>{
        const directory=await(await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        for await(const file of directory.values()){
          if(new Uint8Array(await(await file.getFile()).arrayBuffer()).toBase64()===${JSON.stringify(x)})return true;
        }
        return false;
      })()`),true);
      await p.eval("window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await navigator.locks.request('keeplocal-vault-lineage',()=>{})");
      await app();
      assert.equal(await rev(),tiedRev+1);
      await relogin();
      await app();
      assert.equal(await rev(),tiedRev+1);
      assert.deepEqual(await p.eval("(await import('./js/app.js')).getNotes().map(note=>note.title)"),['Fictitious Y']);
      await harness.add(p,'First edit after tie','Fictitious');
      await p.until(`(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>${tiedRev+1})`);
      assert.equal((await decode(await readFolderFixture(p,primary))).payload.rev,tiedRev+2);
    }finally{await browser.close();}
  });

  await check('G1.3 a first connection adopts identical backup records and rejects differing records',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {copyFolderFiles}=await import('./folder-transfer.mjs');
    const {importExpression}=await import('./backup-fixture.mjs');
    const a=await harness.launchExtension(),b=await harness.launchExtension();
    const connect=async p=>{
      await p.eval("document.querySelector('#folder-settings-btn').click()");
      await p.until("document.activeElement.id==='modal-close'&&!!document.querySelector('[data-folder-action=choose]')");
      await p.eval("document.querySelector('[data-folder-action=choose]').click()");
    };
    const meta=p=>p.eval("(await(await import('./js/db.js')).readVault()).meta");
    try{
      const pa=await a.page(undefined,folderFixtureSource('KL-TEST-ONBOARD-A'));
      const pb=await b.page(undefined,folderFixtureSource('KL-TEST-ONBOARD-B'));
      await harness.create(pa);
      await harness.add(pa,'In a real backup','Fictitious A');
      const backup=await captureFolderBackup(pa);
      await connect(pa);
      await pa.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)");
      const head=await meta(pa);

      await pb.eval(importExpression(backup));
      await pb.reload();await harness.unlock(pb);
      await copyFolderFiles(pa,pb);
      await pb.eval('folderTest.writeAttempts=0');
      const before=await meta(pb);
      await connect(pb);
      await pb.until("!!document.querySelector('[data-folder-status=conflict],.folder-settings [data-folder-state=saved]')");
      assert.equal(await pb.eval("!!document.querySelector('[data-folder-status=conflict]')"),false);
      const adopted=await meta(pb);
      assert.equal(adopted.folderSyncedHash,head.folderSyncedHash);
      assert.equal(adopted.folderSeenRev,head.folderSeenRev);
      assert.equal(adopted.folderSyncedRevision,before.revision??0);
      assert.equal(adopted.revision,before.revision);
      assert.equal(await pb.eval('folderTest.writeAttempts'),0);
      await pb.eval("document.querySelector('#modal-close').click()");
      await harness.add(pb,'First edit in profile B','Fictitious B');
      await pb.until(`(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev>${head.folderSeenRev})`);
      assert.equal((await meta(pb)).folderSeenRev,head.folderSeenRev+1);
    }finally{await Promise.all([a.close(),b.close()]);}

    const extra=await harness.launchExtension();
    try {
      const p=await extra.page(undefined,folderFixtureSource('KL-TEST-ONBOARD-EXTRA'));
      await harness.create(p);
      await harness.add(p,'One shared note','Fictitious');
      await connect(p);
      await p.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)");
      await p.eval("document.querySelector('#modal-close').click()");
      await p.eval("(await import('./js/folder-store.js')).disconnectSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await p.reload();await harness.unlock(p);
      await harness.add(p,'An extra local note','Fictitious');
      await connect(p);
      await p.until("!!document.querySelector('[data-folder-status=conflict]')");
      assert.equal(await p.eval('folderTest.writeAttempts'),0);
    }finally{await extra.close();}
  });

  await check('G1.4 a zero-byte main can be replaced while a one-byte main is blocked',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture,writeFolderFixture}=await import('./folder-transfer.mjs');
    const {decodeV2}=await import('../../js/backup-v2.js');
    const browser=await harness.launchExtension();
    const primary='keeplocal-vault.keeplocal';
    try{
      const p=await browser.page(undefined,folderFixtureSource('KL-TEST-EMPTY-MAIN'));
      const relogin=async()=>{
        await p.reload();await p.eval("folderTest.permission='granted'");await submitExtensionLogin(p);
      };
      await harness.create(p);
      await harness.add(p,'Survives an empty folder file','Fictitious');
      await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await writeFolderFixture(p,primary,'');
      await relogin();
      await p.until("!!document.querySelector('[data-folder-status=unreadableCopy], .sidebar [data-folder-state=saved]')");
      assert.equal(await p.eval("!!document.querySelector('[data-folder-status=unreadableCopy]')"),false);
      const main=await readFolderFixture(p,primary);
      assert.equal((await decodeV2(Buffer.from(main,'base64'),harness.PASSWORD)).payload.rev,1);
      assert.match(await p.eval("document.querySelector('#toast-container').innerText"),/empty main file was replaced/i);
      const junk=Buffer.from([0xa5]).toString('base64');
      await writeFolderFixture(p,primary,junk);
      await relogin();
      await p.until("!!document.querySelector('[data-folder-status=unreadableCopy]')");
      assert.equal(await readFolderFixture(p,primary),junk);
      assert.equal(await p.eval('folderTest.writeAttempts'),0);
      assert.deepEqual(await p.eval('folderTest.writes'),{});
    }finally{await browser.close();}
  });

  await check('G4 localized folder indicators and unload warnings follow verified writes',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {writeFolderFixture}=await import('./folder-transfer.mjs');
    const browser=await harness.launchExtension();
    try{
      const p=await browser.page(undefined,folderFixtureSource());
      const warns=()=>p.eval("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))");
      await harness.create(p);
      await harness.add(p,'Indicator fixture','Fictitious note');
      await p.eval("folderTest.failWrites=100;document.querySelector('#folder-settings-btn').click()");
      await p.until("!!document.querySelector('[data-folder-action=choose]')");
      await p.eval("document.querySelector('[data-folder-action=choose]').click()");
      await p.until("!!document.querySelector('.folder-settings [data-folder-state=pending]')");
      assert.match(await p.eval("document.querySelector('.sidebar [data-folder-indicator]').innerText"),/Folder write pending/);
      assert.equal(await warns(),true);
      await p.until("!!document.querySelector('.folder-settings [data-folder-state=error] [data-folder-retry]')");
      assert.match(await p.eval("document.querySelector('.folder-settings [data-folder-state=error]').innerText"),/Error writing to folder: NoModificationAllowedError/);
      assert.equal(await warns(),true);
      await p.eval("folderTest.failWrites=0;document.querySelector('.folder-settings [data-folder-retry]').click()");
      await p.until("!!document.querySelector('.folder-settings [data-folder-state=saved]')");
      assert.match(await p.eval("document.querySelector('.folder-settings [data-folder-state=saved]').innerText"),/Written to folder at \d\d:\d\d/);
      assert.equal(await p.eval("(await import('./js/backup.js')).isUnsaved()"),true);
      assert.equal(await warns(),false);
      assert.doesNotMatch(await p.eval("document.querySelector('.folder-settings').innerText"),/sync|cloud|sincroniz|nuvem/i);

      await writeFolderFixture(p,'unreadable-side-copy.keeplocal',Buffer.from('fictional').toString('base64'));
      await p.eval("window.dispatchEvent(new Event('focus'))");
      await p.until("document.querySelector('#toast-container').innerText.includes('unreadable folder copies')");
      await p.eval("document.querySelector('#modal-close').click();document.querySelector('#lang-toggle').click()");
      await p.until("document.documentElement.lang==='pt-BR'&&!!document.querySelector('.sidebar [data-folder-state=saved]')");
      assert.match(await p.eval("document.querySelector('.sidebar [data-folder-indicator]').innerText"),/Gravado na pasta às \d\d:\d\d/);

      await p.eval("await folderTest.remove();window.dispatchEvent(new Event('focus'))");
      await p.until("!!document.querySelector('.folder-banner')&&!!document.querySelector('.sidebar [data-folder-state=readOnly]')");
      assert.match(await p.eval("document.querySelector('.sidebar [data-folder-indicator]').innerText"),/Somente leitura/);
      assert.equal(await p.eval("(await import('./js/db.js')).isReadOnly()"),true);
    }finally{await browser.close();}
  });

  await check('G5 the unavailable screen rejects other vaults, reconciles a new path and resets only local data',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture,writeFolderFixture}=await import('./folder-transfer.mjs');
    const {backupFixture}=await import('./backup-fixture.mjs');
    const browser=await harness.launchExtension();
    const file='keeplocal-vault.keeplocal';
    try{
      const p=await browser.page(undefined,folderFixtureSource('KL-TEST-OLD'));
      const denied=async()=>{
        await p.reload();await p.eval("folderTest.permission='denied'");await submitExtensionLogin(p);
        await p.until("!!document.querySelector('[data-folder-status=denied]')");
      };
      const choose=async name=>{
        await p.eval(`folderTest.name=${JSON.stringify(name)};document.querySelector('[data-folder-action=chooseAnother]').click()`);
      };
      const currentFolder=()=>p.eval("(await(await import('./js/folder-store.js')).readSyncFolder())?.name??null");
      await harness.create(p);
      await harness.add(p,'Preserve the old directory','Fictitious');
      await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await p.reload();await p.eval("folderTest.permission='granted'");await submitExtensionLogin(p);
      await p.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)");
      const old=await readFolderFixture(p,file);
      await denied();
      const foreign=(await backupFixture()).base64;
      await p.eval("folderTest.name='KL-TEST-FOREIGN'");
      await writeFolderFixture(p,file,foreign);
      await choose('KL-TEST-FOREIGN');
      await p.until("document.querySelector('.folder-block')?.innerText.includes('Copy from another passphrase or vault')");
      assert.equal(await currentFolder(),'KL-TEST-OLD');
      assert.equal(await readFolderFixture(p,file),foreign);
      assert.deepEqual(await p.eval('folderTest.writes'),{});

      await p.eval("folderTest.name='KL-TEST-COPY'");
      await writeFolderFixture(p,file,old);
      await choose('KL-TEST-COPY');
      await p.until("!!document.querySelector('.note-card')&&!document.querySelector('.folder-banner')");
      assert.equal(await currentFolder(),'KL-TEST-COPY');
      assert.equal(await readFolderFixture(p,file),old);

      await denied();await choose('KL-TEST-NEW-EMPTY');
      await p.until("!!document.querySelector('.note-card')");
      await p.until("(await import('./js/db.js')).getMeta('folderSyncedHash').then(Boolean)");
      assert.equal(await currentFolder(),'KL-TEST-NEW-EMPTY');
      const pushed=await readFolderFixture(p,file);
      await denied();
      await p.eval("document.querySelector('[data-folder-action=startOver]').click()");
      await p.until("!!document.querySelector('.app-dialog input')");
      const message=await p.eval("document.querySelector('.app-dialog').innerText");
      assert.match(message,/This browser has revision \d+ dated/);
      assert.match(message,/copy in the folder will remain/i);
      await p.eval(`(async()=>{
        const {t}=await import('./js/i18n.js'),input=document.querySelector('.app-dialog input');
        input.value=t('account.resetWord');input.dispatchEvent(new Event('input'));
        document.querySelector('[data-dialog-action=confirm]').click();
      })()`);
      await p.until("!!document.querySelector('#create-form:not(.hidden)')");
      assert.equal(await currentFolder(),null);
      assert.equal(await p.eval("(await(await import('./js/db.js')).readVault()).notes.length"),0);
      for(const [name,expected] of [['KL-TEST-OLD',old],['KL-TEST-COPY',old],['KL-TEST-FOREIGN',foreign],['KL-TEST-NEW-EMPTY',pushed]]){
        await p.eval(`folderTest.name=${JSON.stringify(name)}`);
        assert.equal(await readFolderFixture(p,file),expected);
      }
    }finally{await browser.close();}
  });

  await check('G6 a write in flight confirms its own snapshot and schedules later edits',async()=>{
    const {folderFixtureSource}=await import('./folder-fixture.mjs');
    const {readFolderFixture}=await import('./folder-transfer.mjs');
    const {decodeV2}=await import('../../js/backup-v2.js');
    const {decryptRecords}=await import('../../js/backup-format.js');
    const browser=await harness.launchExtension();
    try{
      const p=await browser.page(undefined,folderFixtureSource());
      await harness.create(p);
      await harness.add(p,'Snapshot barrier fixture','original');
      await p.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await p.reload();await p.eval("folderTest.permission='granted'");await submitExtensionLogin(p);
      await p.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev===1)");
      const update=content=>p.eval(`(async()=>{
        const app=await import('./js/app.js');await app.saveNote({...app.getNotes()[0],content:${JSON.stringify(content)}});
      })()`);
      await p.eval('folderTest.holdWriteAttempt=2');
      await update('snapshot before the next edit');
      await p.until("typeof folderTest.releaseWrite==='function'");
      await update('newer committed local edit');
      await p.eval('folderTest.releaseWrite()');
      await p.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev===2)");
      const checkpoint=await p.eval(`(async()=>{
        const {meta}=await(await import('./js/db.js')).readVault();
        return {revision:meta.revision,confirmed:meta.folderSyncedRevision,dirty:meta.dirtySinceBackup};
      })()`);
      assert.equal(checkpoint.revision,checkpoint.confirmed+1);
      assert.equal(checkpoint.dirty,true);
      await p.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev=>rev===3)");
      const {payload,key}=await decodeV2(Buffer.from(await readFolderFixture(p,'keeplocal-vault.keeplocal'),'base64'),harness.PASSWORD);
      assert.equal((await decryptRecords(payload.notes,key))[0].content,'newer committed local edit');
      assert.equal(await p.eval('folderTest.writeAttempts'),3);
    }finally{await browser.close();}
  });
}
