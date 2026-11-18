import * as harness from './harness.mjs';

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
}
