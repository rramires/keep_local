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
}
