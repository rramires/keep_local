import {backupFixture,importExpression} from './backup-fixture.mjs';
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
  await seedUnreadable(p,item,JSON.stringify({...item,blocks:[{...item.blocks[1],extra:true}]}));
}

async function seedUnreadable(p,item,source) {
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


async function enterVaultEditor(p,assert) {
  await openVaultFirst(p);
  assert.equal(await p.eval("document.querySelector('[data-vault-edit]').disabled"),false);
  await p.eval("document.querySelector('[data-vault-edit]').click()");
  await p.until("!!document.querySelector('.vault-editor')");
}

export async function fillVaultInput(p,selector,value) {
  await p.until(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return !!input&&getComputedStyle(input).visibility==='visible';})()`);
  await p.eval(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    input.focus();
    if(document.activeElement!==input) throw Error('Editor input did not receive focus');
    input.value=${JSON.stringify(value)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}

const testSentinel=()=> 'SENTINEL-'+crypto.randomUUID().replaceAll('-','').slice(0,24);

async function makeVaultScanner(browser,p,assert,values) {
  const markers=values.flatMap(value=>[value,value.slice(13,21)]).map(value=>value.toLowerCase());
  const alerts=[];
  const listener=message=>{
    if(['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'].includes(message.method)) {
      alerts.push(JSON.stringify(message.params));
    }
  };
  browser.cdp.listeners.push(listener);
  // Capture message arguments at every level, including structured console values.
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const entries=[];
    Object.defineProperty(window,'vaultConsoleEntries',{value:entries});
    for(const key of ['log','info','debug','warn','error','trace','dir','table','assert','group','groupCollapsed']) {
      const original=console[key].bind(console);
      console[key]=(...args)=>{
        for(const value of args) {
          try {entries.push(value instanceof Error?value.stack:JSON.stringify(value));}
          catch {entries.push(String(value));}
        }
        original(...args);
      };
    }
  })()`});
  await p.reload();
  const scan=async(label,allowed=null)=>{
    const readout=await p.eval(`(async()=>{
      const markers=${JSON.stringify(markers)};
      const allowed=${JSON.stringify(allowed)};
      const element=allowed && document.querySelector(allowed.selector);
      const clone=document.documentElement.cloneNode(true);
      let innerText=document.documentElement.innerText;
      if(element&&allowed.property==='textContent'){
        clone.querySelector(allowed.selector).textContent='';
        innerText=innerText.replace(element.textContent,'');
      }
      const inputs=[...document.querySelectorAll('input,textarea')].filter(input =>
        !(element===input && allowed?.property==='value' && document.activeElement===input)
      );
      const attributes=[...document.querySelectorAll('*')].flatMap(node=>
        [...node.attributes].filter(attr=>/^(title|aria-|data-|placeholder)/.test(attr.name)).map(attr=>attr.value)
      );
      const db=await import('./js/db.js');
      const channels={
        html:clone.outerHTML,
        innerText,
        inputs:inputs.map(input=>input.value),
        attributes,
        title:document.title,
        toasts:[...document.querySelectorAll('.toast')].map(node=>node.textContent),
        local:Object.entries(localStorage),
        session:Object.entries(sessionStorage),
        meta:await db.getAllMetaRecords(),
        console:window.vaultConsoleEntries,
      };
      return Object.entries(channels).filter(([,value])=>{
        const serialized=String(JSON.stringify(value)).toLowerCase();
        return markers.some(marker=>serialized.includes(marker));
      }).map(([name])=>name);
    })()`);
    const browserMessages=JSON.stringify([...alerts,...p.errors]).toLowerCase();
    if(markers.some(marker=>browserMessages.includes(marker))) readout.push('CDP console');
    assert.deepEqual(readout,[],label);
  };
  return {
    scan,
    dispose() { browser.cdp.listeners.splice(browser.cdp.listeners.indexOf(listener),1); },
  };
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

  await check('T4.4 block editor persists operations and keeps secrets out of blurred inputs',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      assert.equal(await p.eval("document.querySelector('#vault-new-item').disabled"),false);
      await p.eval("document.querySelector('#vault-new-item').click()");
      await p.until("!!document.querySelector('.vault-editor')");
      assert.equal(await p.eval("document.querySelectorAll('[data-vault-block=field]').length"),1);
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),0);
      await p.eval("document.querySelector('#vault-new-item').click()");
      await p.until("!!document.querySelector('.vault-editor')");
      await fillVaultInput(p,'[data-vault-title]','Fictional Login');
      await fillVaultInput(p,'[data-vault-label]','Senha');
      assert.equal(await p.eval("document.querySelector('[data-vault-toggle-secret]').getAttribute('aria-pressed')"),'true');
      await fillVaultInput(p,'[data-vault-value]','fictional-editor-secret');
      assert.equal(await p.eval("getComputedStyle(document.querySelector('[data-vault-value]')).webkitTextSecurity"),'disc');
      assert.equal(await p.eval("document.querySelector('[data-vault-value]').type"),'text');
      await p.eval("document.querySelector('[data-vault-edit-reveal]').click()");
      assert.equal(await p.eval("getComputedStyle(document.querySelector('[data-vault-value]')).webkitTextSecurity"),'none');
      await p.eval("document.querySelector('[data-vault-title]').focus()");
      assert.equal(await p.eval("document.querySelector('[data-vault-value]').value"),'');
      await p.eval("document.querySelector('[data-vault-multiline]').click()");
      await fillVaultInput(p,'textarea[data-vault-value]','fictional-editor-secret\nfictional-second-line');
      await p.eval("document.querySelector('[data-vault-add=field]').click()");
      const second='[data-vault-block=field]:nth-child(2)';
      await fillVaultInput(p,second+' [data-vault-label]','API key');
      assert.equal(await p.eval(`document.querySelector(${JSON.stringify(second+' [data-vault-toggle-secret]')}).getAttribute('aria-pressed')`),'true');
      await p.eval(`document.querySelector(${JSON.stringify(second+' [data-vault-toggle-secret]')}).click()`);
      await fillVaultInput(p,second+' [data-vault-label]','chave pública');
      assert.equal(await p.eval(`document.querySelector(${JSON.stringify(second+' [data-vault-toggle-secret]')}).getAttribute('aria-pressed')`),'false');
      await fillVaultInput(p,second+' [data-vault-value]','Publishable fictional key');
      await p.eval("document.querySelector('[data-vault-add=text]').click()");
      await fillVaultInput(p,'[data-vault-block=text] textarea','Temporary fictional text');
      await p.eval("document.querySelector('[data-vault-add=divider]').click();document.querySelector('[data-vault-block=divider] [data-vault-move=up]').click();document.querySelector('[data-vault-block=text] [data-vault-remove]').click();document.querySelector('[data-vault-add=text]').click()");
      await fillVaultInput(p,'[data-vault-block=text] textarea','Final fictional text');
      assert.equal(await p.eval(`[...document.querySelectorAll('.vault-editor input,.vault-editor textarea')].every(input =>
        input.spellcheck===false && ['autocomplete','autocapitalize','autocorrect'].every(attr=>input.getAttribute(attr)==='off') && !input.hasAttribute('name'))
        && document.querySelector('.vault-editor').getAttribute('translate')==='no'`),true);
      assert.equal(await p.eval("document.querySelector('textarea[data-vault-value]').value"),'');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      await p.reload();
      await unlock(p);
      const restored=await p.eval("(await import('./js/app.js')).getNotes().find(note=>note.type==='vault')");
      assert.equal(restored.title,'Fictional Login');
      assert.deepEqual(restored.blocks.map(block=>block.kind),['field','field','divider','text']);
      assert.deepEqual({hasSecret:Object.hasOwn(restored.blocks[0],'secret'),multiline:restored.blocks[0].multiline,value:restored.blocks[0].value},
        {hasSecret:false,multiline:true,value:'fictional-editor-secret\nfictional-second-line'});
      assert.equal(restored.blocks[1].secret,false);
      assert.equal(restored.blocks[3].value,'Final fictional text');
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.4 pin queued during editing preserves blocks saved on close',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      await save(p,vaultFixture());
      await enterVaultEditor(p,assert);
      await p.eval(`(()=>{
        const original=crypto.subtle.encrypt.bind(crypto.subtle);
        crypto.subtle.encrypt=async(...args)=>{
          crypto.subtle.encrypt=original;
          await new Promise(resolve=>{window.releaseVaultPin=resolve;});
          return original(...args);
        };
      })()`);
      await fillVaultInput(p,'[data-vault-value]','fictional after toolbar edit');
      await p.eval("document.querySelector('.vault-editor [data-vault-action=pin]').click()");
      await p.until("typeof window.releaseVaultPin==='function'");
      await p.eval("document.querySelector('#modal-close').click();window.releaseVaultPin()");
      await p.until("!document.querySelector('.vault-editor')");
      await p.reload();
      await unlock(p);
      const saved=await p.eval("(await import('./js/app.js')).getNotes().find(note=>note.type==='vault')");
      assert.equal(saved.pinned,true);
      assert.equal(saved.blocks[0].value,'fictional after toolbar edit');
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.4 vault block edit refuses a newer write from another tab',async()=>{
    const p=await browser.page();
    let q;
    try {
      await create(p);
      const item=vaultFixture();
      await save(p,item);
      await enterVaultEditor(p,assert);
      q=await browser.page(p.contextId);
      await unlock(q);
      await q.eval(`(async()=>{
        const app=await import('./js/app.js');
        const edited=structuredClone(app.getNotes().find(note=>note.type==='vault'));
        edited.blocks[0].value='remote.example.invalid';
        await app.saveNote(edited);
      })()`);
      await p.send('Page.bringToFront');
      await p.until("document.visibilityState==='visible'");
      await fillVaultInput(p,'[data-vault-value]','local.example.invalid');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!!document.querySelector('.vault-editor')&&!!document.querySelector('.toast-action')");
      await q.reload();
      await unlock(q);
      assert.equal(await q.eval("(await import('./js/app.js')).getNotes().find(note=>note.type==='vault').blocks[0].value"),'remote.example.invalid');
      assert.deepEqual([...p.errors,...q.errors],[]);
    } finally {if(q) await q.close();await p.close();}
  });

  await check('T4.6 vault search only returns safe matches and Trash only matches vault titles',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      const item=vaultFixture({title:'Fictitious credentials',labels:['Search Label']});
      item.blocks.push(
        {id:crypto.randomUUID(),kind:'text',value:'private scratch text'},
        {id:crypto.randomUUID(),kind:'field',label:'User',value:'fictitious-login'},
      );
      await save(p,item);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      const search=async query=>{
        await p.eval(`(()=>{const input=document.querySelector('#search-input');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await p.until("document.querySelector('#search-input').value===''&&document.querySelector('.vault-section').dataset.vaultSearchActive==='true'");
      };
      for(const query of ['fictional-secret','CTIONAL-SE','private scratch']) {
        await search(query);
        assert.equal(await p.eval("document.querySelectorAll('.vault-card').length"),0);
      }
      for(const query of ['EXAMPLE.INVALID','fictitious-login','Host','Search Label']) {
        await search(query);
        assert.equal(await p.eval("document.querySelectorAll('.vault-card').length"),1);
        assert.equal(await p.eval("!!document.querySelector('.vault-card mark')"),false);
      }
      await p.eval("document.querySelector('[data-vault-action=trash]').click()");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      await p.eval("const q=document.querySelector('#search-input');q.value='example.invalid';q.dispatchEvent(new Event('input'))");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("const q=document.querySelector('#search-input');q.value='fictitious credentials';q.dispatchEvent(new Event('input'))");
      await p.until("!!document.querySelector('.vault-card')");
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.10 note and vault labels stay isolated in selectors, managers and filters',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      const regular=note({title:'Regular item',labels:['Work','Notes Only']});
      const vaultWork=vaultFixture({title:'Fictional work credential',labels:['Work','Vault Only']});
      const vaultOther=vaultFixture({title:'Other fictional credential',labels:['Personal Vault']});
      await save(p,regular);
      await save(p,vaultWork);
      await save(p,vaultOther);
      await p.eval("document.querySelector('[data-view=notes]').click()");
      assert.equal(await p.eval("document.querySelector('#sidebar-labels').textContent.includes('Vault Only')"),false);
      assert.equal(await p.eval("document.querySelector('#sidebar-labels').textContent.includes('Notes Only')"),true);

      await p.eval("document.querySelector('.note-card').click()");
      await p.until("!!document.querySelector('#modal-labels-btn')");
      await p.eval("document.querySelector('#modal-labels-btn').click()");
      await p.until("!!document.querySelector('.labels-picker-popup')");
      assert.equal(await p.eval("document.querySelector('.labels-picker-popup').textContent.includes('Vault Only')"),false);
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");

      await p.eval("document.querySelector('#edit-labels-btn').click()");
      await p.until("!!document.querySelector('#labels-manager')");
      assert.equal(await p.eval("[...document.querySelectorAll('#labels-manager [data-label]')].some(el=>el.dataset.label==='Vault Only')"),false);
      await p.eval("document.querySelector('.label-delete-btn[data-label=Work]').click()");
      await p.until("(await import('./js/app.js')).getNotes().some(n=>n.type==='text'&&!n.labels.includes('Work'))");
      assert.equal(await p.eval("(await import('./js/app.js')).getNotes().some(n=>n.type==='vault'&&n.labels.includes('Work'))"),true);
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");
      await p.eval("document.querySelector('[data-view=vault]').click()");
      assert.equal(await p.eval("document.querySelector('.vault-label-filters').textContent.includes('Notes Only')"),false);
      await p.eval("document.querySelector('[data-vault-filter=Work]').click()");
      assert.equal(await p.eval("document.querySelectorAll('.vault-card').length"),1);
      assert.equal(await p.eval("document.querySelector('.vault-card-title').textContent"),vaultWork.title);
      await p.eval("const label=document.querySelector('.vault-card [data-vault-label=Work]');label.closest('details').open=true;label.click()");
      await p.until("!(await import('./js/app.js')).getNotes().some(n=>n.type==='vault'&&n.labels.includes('Work'))");
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.12 distinct random sentinel strings stay out of all closed and masked surfaces',async()=>{
    const p=await browser.page();
    const single=testSentinel(), multi=testSentinel();
    const {scan,dispose}=await makeVaultScanner(browser,p,assert,[single,multi]);
    try {
      const item=vaultFixture({title:'Fictitious credentials for scan',labels:['Vault audit'],
        blocks:[
          {id:crypto.randomUUID(),kind:'field',label:'Password',value:single,secret:true},
          {id:crypto.randomUUID(),kind:'field',label:'Private key',value:'FICTIONAL DATA\n'+multi+'\nEND FICTIONAL DATA',secret:true,multiline:true},
          {id:crypto.randomUUID(),kind:'field',label:'Host',value:'example.invalid',secret:false},
        ],
      });
      await create(p);
      await save(p,item);
      await p.eval("document.querySelector('[data-view=notes]').click()");
      await scan('Notes');
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await scan('Vault grid');
      await p.eval("document.querySelector('[data-vault-layout=list]').click()");
      await p.until("document.querySelector('.vault-cards').dataset.layout==='list'");
      await scan('Vault list');
      await p.eval(`(()=>{
        const search=document.querySelector('#search-input');
        search.value=${JSON.stringify(single.slice(13,21))};
        search.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await p.until("document.querySelector('#search-input').value===''&&document.querySelector('.vault-section').dataset.vaultSearchActive==='true'&&!document.querySelector('.vault-card')");
      await scan('Search with a secret substring');
      await p.eval("document.querySelector('#search-clear').click();document.querySelector('[data-vault-filter]').click()");
      await scan('Vault labels');

      await mockVaultTimers(p);
      await p.eval("document.querySelector('[data-vault-open]').click()");
      await p.until("!!document.querySelector('.vault-detail')&&getComputedStyle(document.querySelector('.vault-detail')).visibility==='visible'");
      await scan('Masked reading detail');
      await p.eval("document.querySelector('[data-vault-reveal]').click()");
      assert.equal(await p.eval(`document.querySelector('.vault-secret-value').textContent===${JSON.stringify(single)}`),true);
      await scan('Intentional reveal', {selector:'.vault-secret-value',property:'textContent'});
      await p.eval("vaultTimers.fire(15000)");
      await scan('Detail after auto-hide');
      await p.eval("document.querySelector('[data-vault-edit]').click()");
      await p.until("!!document.querySelector('.vault-editor')&&getComputedStyle(document.querySelector('.vault-editor')).visibility==='visible'");
      await p.until("document.activeElement.hasAttribute('data-vault-title')");
      await scan('Editor with secrets outside focus');
      await p.eval("document.querySelector('[data-vault-value]').focus()");
      assert.equal(await p.eval(`document.activeElement.value===${JSON.stringify(single)}`),true);
      await scan('Intentional editing', {selector:'[data-vault-value]',property:'value'});
      await p.eval("window.dispatchEvent(new Event('blur'))");
      await scan('Editor after window focus loss');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      await p.eval("document.querySelector('[data-vault-action=trash]').click()");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      await scan('Trash');
      await p.eval("document.querySelector('#edit-labels-btn').click()");
      await scan('Note labels manager');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('#labels-manager')");

      const invalid=vaultFixture({blocks:item.blocks});
      await seedUnreadableVault(p,invalid);
      await p.reload();
      await unlock(p);
      await selectRecovery(p);
      await p.until("!!document.querySelector('#recovery-show-sensitive:not([hidden])')");
      await scan('Recovery before explicit click');
      await p.eval("document.querySelector('#lock-btn').click()");
      await p.until("!!document.querySelector('.auth-view')");
      await scan('Login after lock');
      assert.deepEqual(p.errors,[]);
    } finally {
      dispose();
      await p.close();
    }
  });

  await check('T4.12 Trash keeps a vault card together across desktop columns',async()=>{
    const p=await browser.page();
    try {
      await p.send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
      await create(p);
      await save(p,vaultFixture({deletedAt:Date.now(),labels:['Fixture']}));
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.notes-grid .vault-card')");
      const {columns,fragments}=await p.eval(`(()=>{
        const card=document.querySelector('.notes-grid .vault-card');
        return {columns:Number(getComputedStyle(card.parentElement).columnCount),fragments:card.getClientRects().length};
      })()`);
      assert.ok(columns>1);
      assert.equal(fragments,1,'The title and Trash actions must stay on the same card');
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.12 existing v2 note-only backup opens and vault preferences stay out of the envelope',async()=>{
    const p=await browser.page();
    try {
      const existing=note({title:'Fictional note from a pre-vault backup'});
      const fixture=await backupFixture([existing]);
      await p.eval(importExpression(fixture.base64));
      await p.reload();
      await unlock(p);
      const notes=await p.eval("(await import('./js/app.js')).getNotes()");
      assert.deepEqual(notes,[existing]);
      await p.eval("const db=await import('./js/db.js');await db.saveMeta('vaultLayout','list');await db.saveMeta('vaultClipboardWarningDismissed',true)");
      const inspected=await p.eval(`(async()=>{
        let blob;
        URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};
        URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        const result=await(await import('./js/backup.js')).exportBackup();
        const decoded=await(await import('./js/backup-v2.js')).decodeV2(new Uint8Array(await blob.arrayBuffer()),${JSON.stringify(PASSWORD)});
        return {unreadable:result.unreadableCount,profile:decoded.payload.profile,preferences:Object.keys(decoded.payload.preferences)};
      })()`);
      assert.equal(inspected.unreadable,0);
      assert.equal(inspected.profile,2);
      assert.ok(inspected.preferences.every(key=>['theme','lang'].includes(key)));
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('D1.1 an unlabeled field from the new item stays out of masked surfaces',async()=>{
    const p=await browser.page();
    const sentinel=testSentinel();
    const {scan,dispose}=await makeVaultScanner(browser,p,assert,[sentinel]);
    try {
      await create(p);
      await p.eval("document.querySelector('[data-view=vault]').click();document.querySelector('#vault-new-item').click()");
      await fillVaultInput(p,'[data-vault-title]','An unlabeled fictional credential');
      await fillVaultInput(p,'[data-vault-value]',sentinel);
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')&&!!document.querySelector('.vault-card')");
      await scan('New item, vault grid');
      await p.eval("document.querySelector('[data-vault-layout=list]').click()");
      await p.until("document.querySelector('.vault-cards').dataset.layout==='list'");
      await scan('New item, vault list');
      await p.eval("document.querySelector('[data-vault-open]').click()");
      await p.until("!!document.querySelector('.vault-detail')");
      await scan('New item, masked detail');
      assert.equal(await p.eval("document.querySelector('.vault-secret-value').textContent"),'••••••••');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-detail')");
      await p.eval(`(()=>{
        const search=document.querySelector('#search-input');
        search.value=${JSON.stringify(sentinel.slice(13,21))};
        search.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await p.until("document.querySelector('.vault-section').dataset.vaultSearchActive==='true'&&document.querySelector('#search-input').value===''");
      assert.equal(await p.eval("document.querySelectorAll('.vault-card').length"),0);
      await scan('New item, search for the eight-character fragment');
      assert.deepEqual(p.errors,[]);
    } finally {dispose();await p.close();}
  });

  await check('D1.1 Q6 public labels show and ambiguous or sensitive labels stay masked',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      const hidden=['PIN','pwd','CVV','OTP','Credencial','Seed phrase','Recovery code','Passphrase','Private Key','Access Key ID','Host key'];
      const visible=['Host','Usuário'];
      const entries=[...hidden,...visible].map((label,order)=>vaultFixture({
        title:'Case '+order,order,blocks:[{id:crypto.randomUUID(),kind:'field',label,value:'fixture-'+order}],
      }));
      for(const entry of entries) await save(p,entry);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      const subtitles=await p.eval("[...document.querySelectorAll('.vault-card')].map(card=>card.querySelector('.vault-card-subtitle')?.textContent ?? null)");
      assert.deepEqual(subtitles,[...hidden.map(()=>null),...visible.map((_,i)=>'fixture-'+(hidden.length+i))]);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('D1.1 editor follows the label until the user persists either lock choice',async()=>{
    const p=await browser.page();
    const locked=()=>p.eval("document.querySelector('[data-vault-toggle-secret]').getAttribute('aria-pressed')==='true'");
    const toggle=()=>p.eval("document.querySelector('[data-vault-toggle-secret]').click()");
    const label=value=>fillVaultInput(p,'[data-vault-label]',value);
    const close=async()=>{
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
    };
    const savedBlock=()=>p.eval("(await import('./js/app.js')).getNotes().find(item=>item.type==='vault').blocks[0]");
    try {
      await create(p);
      await save(p,vaultFixture({blocks:[{id:crypto.randomUUID(),kind:'field',label:'Host',value:'env.example.invalid'}]}));
      await enterVaultEditor(p,assert);
      assert.equal(await locked(),false);
      await label('Password');
      assert.equal(await locked(),true);
      assert.equal(await p.eval("document.querySelector('[data-vault-value]').value"),'');
      await close();
      assert.equal(Object.hasOwn(await savedBlock(),'secret'),false,'Automatic masking must not persist a flag');
      await enterVaultEditor(p,assert);
      await label('Host');
      assert.equal(await locked(),false);
      await toggle();
      await close();
      assert.equal((await savedBlock()).secret,true);
      await p.reload();
      await unlock(p);
      await enterVaultEditor(p,assert);
      await label('Usuário');
      assert.equal(await locked(),true);
      await close();
      assert.equal((await savedBlock()).secret,true);

      await p.eval("document.querySelector('#vault-new-item').click()");
      await fillVaultInput(p,'[data-vault-title]','Explicitly public fictional entry');
      assert.equal(await locked(),true);
      await toggle();
      assert.equal(await locked(),false);
      await fillVaultInput(p,'[data-vault-value]','public-fictitious');
      await close();
      const block=await p.eval("(await import('./js/app.js')).getNotes().find(item=>item.title==='Explicitly public fictional entry').blocks[0]");
      assert.equal(block.label,'');
      assert.equal(block.secret,false);
      assert.equal(await p.eval("document.querySelector('#main-inner').innerText.includes('public-fictitious')"),true);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('D1.2 recovery masks all four unreadable shapes until explicit reveal',async()=>{
    const p=await browser.page();
    const sentinels=Array.from({length:4},testSentinel);
    const {scan,dispose}=await makeVaultScanner(browser,p,assert,sentinels);
    try {
      await create(p);
      for(const [index,marker] of sentinels.entries()) {
        const item=vaultFixture({blocks:[{id:crypto.randomUUID(),kind:'field',label:'Password',value:marker,secret:true}]});
        const types=['vault','Vault',' vault ','text'];
        const json=JSON.stringify({...item,type:types[index]});
        await seedUnreadable(p,item,index===0?json.slice(0,-2):json);
      }
      await p.reload();
      await unlock(p);
      await mockVaultTimers(p);
      await p.eval("document.querySelector('#recover-notes-btn').click()");
      await p.until("document.querySelectorAll('.recovery-record').length===4");
      const revealed=new Set();
      for(let index=0;index<sentinels.length;index++) {
        await p.eval(`document.querySelectorAll('.recovery-record')[${index}].click()`);
        await p.until("!document.querySelector('#recovery-show-sensitive').hidden||document.querySelector('#recovery-content').value!==''");
        await scan('Recovery record '+index+' before explicit reveal');
        assert.equal(await p.eval("document.querySelector('#recovery-copy').disabled"),true);
        await p.eval("document.querySelector('#recovery-show-sensitive').click()");
        const content=await p.eval("document.querySelector('#recovery-content').value");
        const marker=sentinels.find(marker=>content.includes(marker));
        assert.ok(marker);
        revealed.add(marker);
        await p.eval("vaultTimers.fire(15000)");
        await scan('Recovery record '+index+' after auto-hide');
      }
      assert.equal(revealed.size,sentinels.length);
      assert.deepEqual(p.errors,[]);
    } finally {dispose();await p.close();}
  });

  await check('D1.3 a label alone saves a new item, while empty or whitespace-only items are discarded',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      const records=()=>p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length");
      const createWithLabel=async label=>{
        await p.eval("document.querySelector('#vault-new-item').click()");
        await p.until("!!document.querySelector('.vault-editor')");
        if(label!==null) await fillVaultInput(p,'[data-vault-label]',label);
        await p.eval("document.querySelector('#modal-close').click()");
        await p.until("!document.querySelector('.vault-editor')");
      };
      await createWithLabel(null);
      await createWithLabel('   ');
      assert.equal(await records(),0);
      await createWithLabel('Host');
      assert.equal(await records(),1);
      await p.reload();
      await unlock(p);
      const item=await p.eval("(await import('./js/app.js')).getNotes().find(item=>item.type==='vault')");
      assert.equal(item.title,'');
      assert.equal(item.blocks.length,1);
      assert.equal(item.blocks[0].label,'Host');
      assert.equal(item.blocks[0].value,'');
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

}
