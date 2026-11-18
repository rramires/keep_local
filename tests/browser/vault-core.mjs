import {create,add,unlock,note,PASSWORD} from './harness.mjs';

export function vaultFixture(patch={}) {
  const {content,...base}=note();
  return {
    ...base,type:'vault',title:'Fictitious vault entry',labels:[],
    blocks:[
      {id:crypto.randomUUID(),kind:'field',label:'Host',value:'example.invalid'},
      {id:crypto.randomUUID(),kind:'field',label:'Password',value:'fictional-secret',secret:true},
    ],
    ...patch,
  };
}

async function save(page,item) {
  await page.eval(`await(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
}


export async function mockVaultTimers(p) {
  await p.eval(`(()=>{
    const realSet=window.setTimeout.bind(window), realClear=window.clearTimeout.bind(window);
    const timers=new Map();
    let token=-1;
    window.setTimeout=(fn,ms,...args)=>{
      if(ms!==15000 && ms!==20000) return realSet(fn,ms,...args);
      const id=token--;
      timers.set(id,{ms,fn:()=>fn(...args)});
      return id;
    };
    window.clearTimeout=id=>{if(id<0) timers.delete(id); else realClear(id);};
    window.vaultTimers={
      has:ms=>[...timers.values()].some(timer=>timer.ms===ms),
      fire:ms=>{
        const entry=[...timers.entries()].find(([,timer])=>timer.ms===ms);
        if(!entry) throw Error('Expected vault timer');
        timers.delete(entry[0]);
        entry[1].fn();
      },
    };
  })()`);
}

async function openVaultFirst(p) {
  await p.eval("document.querySelector('[data-view=vault]').click();document.querySelector('[data-vault-open]').click()");
  await p.until("!!document.querySelector('.vault-detail')");
}

async function seedUnreadableVault(p,item) {
  const source=JSON.stringify({...item,blocks:[{...item.blocks[1],extra:true}]});
  await p.eval(`(async()=>{
    const c=await import('./js/crypto.js'),d=await import('./js/db.js'),a=await import('./js/app.js');
    const record=${JSON.stringify(item)};
    const {iv,ciphertext}=await c.encrypt(a.getCryptoKey(),${JSON.stringify(source)});
    await d.saveNoteRecord({id:record.id,updatedAt:record.updatedAt,iv:c.arrayToBase64(iv),ciphertext:c.arrayBufferToBase64(ciphertext)});
  })()`);
}

async function selectRecovery(p) {
  await p.eval("document.querySelector('#recover-notes-btn').click()");
  await p.until("!!document.querySelector('.recovery-record')");
  await p.eval("document.querySelector('.recovery-record').click()");
}

export async function run({browser,check,assert}) {
  await check('T4.1 vault records stay out of notes and round-trip in the existing v2 envelope',async()=>{
    const p=await browser.page();
    const q=await browser.page();
    try {
      await create(p);
      await add(p,'A visible note','Fictional note content');
      const archived=vaultFixture({title:'Vault archived marker',archivedAt:1});
      const item=vaultFixture({title:'Vault private marker',labels:['Work']});
      await save(p,note({title:'Visible Work note',labels:['Work']}));
      await save(p,item);
      await save(p,archived);
      await p.reload();
      await unlock(p);
      await p.until("document.querySelectorAll('.note-card').length===2");
      const outside=async()=>assert.equal(await p.eval("document.querySelector('#main-inner').textContent.includes('Vault private marker')||document.querySelector('#main-inner').textContent.includes('Vault archived marker')"),false);
      await outside();
      await p.eval("document.querySelector('[data-view=archive]').click()");
      await outside();
      await p.eval("document.querySelector('[data-view=label][data-label=Work]').click()");
      await p.until("document.querySelector('#main-inner').textContent.includes('Visible Work note')");
      await outside();
      await p.eval("document.querySelector('[data-view=notes]').click(); const f=document.querySelector('#search-input');f.value='private marker';f.dispatchEvent(new Event('input'))");
      await p.until("document.querySelectorAll('.note-card').length===0");
      await outside();
      const bytes=await p.eval(`(async()=>{
        let captured;
        URL.createObjectURL=blob=>{captured=blob;return 'blob:test';};
        URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        const result=await(await import('./js/backup.js')).exportBackup();
        if(result.unreadableCount!==0) throw Error('Vault item treated as unreadable');
        return Array.from(new Uint8Array(await captured.arrayBuffer()));
      })()`);
      await q.eval(`await(await import('./js/backup.js')).importBackup(new File([new Uint8Array(${JSON.stringify(bytes)})],'fictional.keeplocal'),${JSON.stringify(PASSWORD)})`);
      await q.reload();
      await unlock(q);
      const restored=await q.eval(`(await import('./js/app.js')).getNotes().find(n=>n.id===${JSON.stringify(item.id)})`);
      assert.deepEqual(restored.blocks,item.blocks);
      assert.equal(restored.type,'vault');
      assert.deepEqual([...p.errors,...q.errors],[]);
    } finally {await p.close();await q.close();}
  });
  await check('T4.2 vault list and grid persist and render only safe card content',async()=>{
    const p=await browser.page();
    try {
      await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await create(p);
      const item=vaultFixture({labels:['Fictional label']});
      item.blocks.unshift({id:crypto.randomUUID(),kind:'text',value:'fictional-text-only'});
      await save(p,item);
      assert.equal(await p.eval("!!document.querySelector('[data-view=vault]')"),true);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      assert.equal(await p.eval("document.querySelector('.vault-card-title').textContent"),item.title);
      assert.equal(await p.eval("document.querySelector('.vault-card-subtitle').textContent"),'example.invalid');
      assert.equal(await p.eval("document.querySelector('.vault-card').outerHTML.includes('fictional-secret') || document.querySelector('.vault-card').outerHTML.includes('fictional-text-only')"),false);
      assert.equal(await p.eval("document.documentElement.scrollWidth<=innerWidth"),true);
      assert.equal(await p.eval("document.querySelector('[data-vault-layout=grid]').getAttribute('aria-pressed')"),'true');

      await p.eval("document.querySelector('[data-vault-layout=list]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");
      assert.equal(await p.eval("await(await import('./js/db.js')).getMeta('vaultLayout')"),'list');
      await p.reload();
      await unlock(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");
      await p.eval("document.querySelector('#lock-btn').click()");
      await unlock(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");

      await p.eval("document.querySelector('[data-vault-action=pin]').click()");
      await p.until("document.querySelector('[data-vault-action=pin]').getAttribute('aria-pressed')==='true'");
      await p.eval("document.querySelector('[data-vault-action=trash]').click()");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      assert.equal(await p.eval("document.querySelector('.vault-card').outerHTML.includes('fictional-secret')"),false);
      await p.eval("document.querySelector('[data-vault-action=restore]').click()");
      await p.until("!document.querySelector('.vault-card')");
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.3 vault detail opens in reading mode with a fixed mask and returns focus',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      const item=vaultFixture();
      item.blocks.push(
        {id:crypto.randomUUID(),kind:'divider'},
        {id:crypto.randomUUID(),kind:'text',value:'<strong>Literal text</strong>'},
        {id:crypto.randomUUID(),kind:'field',label:'Public key example',value:'example line 1\nexample line 2',multiline:true,secret:false},
      );
      await save(p,item);
      await p.eval("document.querySelector('[data-view=vault]').click(); const opener=document.querySelector('[data-vault-open]'); opener.focus(); opener.click()");
      await p.until("!!document.querySelector('.vault-detail')");
      const read=await p.eval(`(()=>{
        const panel=document.querySelector('.vault-detail');
        const multi=panel.querySelector('.vault-multiline');
        return {
          inputs:panel.querySelectorAll('input,textarea').length,
          mask:panel.querySelector('.vault-secret-value').textContent,
          hasSecret:panel.outerHTML.includes('fictional-secret'),
          literal:panel.querySelector('.vault-text').textContent,
          strong:!!panel.querySelector('strong'),
          multi:multi.textContent,whiteSpace:getComputedStyle(multi).whiteSpace,
          edit:!!panel.querySelector('[data-vault-edit]'),
        };
      })()`);
      assert.deepEqual(read,{inputs:0,mask:'••••••••',hasSecret:false,literal:'<strong>Literal text</strong>',strong:false,multi:'example line 1\nexample line 2',whiteSpace:'pre-wrap',edit:true});
      await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
      await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");
      assert.equal(await p.eval("document.activeElement.dataset.vaultOpen"),item.id);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.5 reveal expires, hides on visibility and is cleared on lock',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      await save(p,vaultFixture());
      await mockVaultTimers(p);
      await openVaultFirst(p);
      await p.eval("document.querySelector('[data-vault-reveal]').click()");
      assert.equal(await p.eval("document.querySelector('.vault-secret-value').textContent==='fictional-secret' && vaultTimers.has(15000)"),true);
      await p.eval("vaultTimers.fire(15000)");
      assert.equal(await p.eval("document.querySelector('.vault-secret-value').textContent"),'••••••••');
      await p.eval("document.querySelector('[data-vault-reveal]').click();Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal(await p.eval("!document.documentElement.outerHTML.includes('fictional-secret')&&!vaultTimers.has(15000)"),true);
      await p.eval("delete document.visibilityState;document.querySelector('[data-vault-reveal]').click();document.querySelector('#lock-btn').click()");
      await p.until("!!document.querySelector('.auth-view')");
      assert.equal(await p.eval("!document.documentElement.outerHTML.includes('fictional-secret')&&!vaultTimers.has(15000)"),true);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.5 clipboard clears with focus and asks before clearing after lost focus',async()=>{
    const p=await browser.page();
    try {
      await browser.cdp.send('Browser.grantPermissions',{browserContextId:p.contextId,origin:browser.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
      await create(p);
      await save(p,vaultFixture());
      await mockVaultTimers(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      assert.equal(await p.eval("!!document.querySelector('.vault-clipboard-tip')"),true);
      await p.eval("document.querySelector('.vault-clipboard-tip button').click()");
      await p.until("!document.querySelector('.vault-clipboard-tip')");
      assert.equal(await p.eval("await(await import('./js/db.js')).getMeta('vaultClipboardWarningDismissed')"),true);
      await openVaultFirst(p);
      const copy="document.querySelector('.vault-secret-value').closest('.vault-read-field').querySelector('[data-vault-copy]').click()";
      await p.eval(copy);
      await p.until("vaultTimers.has(20000)");
      assert.equal(await p.eval("navigator.clipboard.readText()"),'fictional-secret');
      await p.eval("vaultTimers.fire(20000)");
      await p.until("(await navigator.clipboard.readText())===''");
      await p.eval(copy);
      await p.until("vaultTimers.has(20000)");
      await p.eval("window.vaultFocused=false;Object.defineProperty(document,'hasFocus',{value:()=>window.vaultFocused,configurable:true});vaultTimers.fire(20000)");
      assert.equal(await p.eval("navigator.clipboard.readText()"),'fictional-secret');
      assert.equal(await p.eval("!!document.querySelector('.vault-clipboard-pending')"),false);
      await p.eval("window.vaultFocused=true;window.dispatchEvent(new Event('focus'))");
      await p.until("!!document.querySelector('.vault-clipboard-pending')");
      assert.equal(await p.eval("navigator.clipboard.readText()"),'fictional-secret');
      await p.eval("document.querySelector('.vault-clipboard-pending button').click()");
      await p.until("(await navigator.clipboard.readText())===''&&!document.querySelector('.vault-clipboard-pending')");
      await p.eval(copy);
      await p.until("vaultTimers.has(20000)");
      await p.eval("document.querySelector('#lock-btn').click()");
      await p.until("!!document.querySelector('.auth-view')&&(await navigator.clipboard.readText())===''");
      assert.equal(await p.eval("vaultTimers.has(20000)"),false);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.5 recovery of an unreadable vault is masked until an explicit reveal',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      await seedUnreadableVault(p,vaultFixture());
      await p.reload();
      await unlock(p);
      await selectRecovery(p);
      await p.until("!!document.querySelector('#recovery-show-sensitive:not([hidden])')||document.querySelector('#recovery-content').value!==''");
      assert.equal(await p.eval("document.querySelector('#recovery-content').value"),'');
      assert.equal(await p.eval("document.querySelector('#recovery-copy').disabled"),true);
      await p.eval("document.querySelector('#recovery-show-sensitive').click()");
      assert.equal(await p.eval("document.querySelector('#recovery-content').value.includes('fictional-secret')"),true);
      await p.eval("document.querySelector('#recovery-show-sensitive').click()");
      assert.equal(await p.eval("document.querySelector('#recovery-content').value"),'');
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

}
