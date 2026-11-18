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
      assert.equal(await p.eval("document.querySelectorAll('[data-folder-action]').length"),4);
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
      assert.match(await text(),/Automatic folder writes will arrive in a later stage/);
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
}
