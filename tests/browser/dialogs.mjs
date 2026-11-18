import {create,add,PASSWORD} from './harness.mjs';
export async function run({browser,check,assert}) {

 await check('U4 launch controls remain fully visible and named at 390px instead of being clipped by overflow hiding',async()=>{
  for(const theme of ['dark','light'])for(const width of [390,1100]){const p=await browser.page();try{await p.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await create(p);await p.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);const controls=await p.eval("['menu-toggle','lang-toggle','theme-toggle','change-password-btn','lock-btn'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,x:r.x,right:r.right,width:r.width,name:e.getAttribute('aria-label')}})");for(const c of controls){assert.ok(c.x>=0&&c.right<=width&&c.width>=36,JSON.stringify(c));assert.ok(c.name,c.id+' accessible name');}assert.deepEqual(p.errors,[]);}finally{await p.close();}}
 });
 await check('U4 themed dialogs trap/return focus, support keyboard, exact typed words and session cancellation',async()=>{
  for(const theme of ['dark','light'])for(const width of [1100,390]){
   const p=await browser.page();try{await p.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await create(p);await p.eval("await import('./js/dialogs.js')");
    await p.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#change-password-btn').focus();window.dialogResult='pending';void import('./js/dialogs.js').then(d=>d.confirmDialog('Fictitious confirmation',{danger:true})).then(r=>window.dialogResult=r)`);await p.until("!!document.querySelector('.app-dialog')");
    assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'cancel');assert.equal(await p.eval("document.querySelector('#app-container').inert"),true);
    const geometry=await p.eval("(()=>{const d=document.querySelector('.dialog-card'),r=d.getBoundingClientRect();return {within:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,role:d.getAttribute('role'),danger:document.querySelector('[data-dialog-action=confirm]').classList.contains('btn-danger')}})()");assert.ok(geometry.within&&geometry.danger);assert.equal(geometry.role,'alertdialog');
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:1});assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'confirm');await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'cancel');
    await p.eval("document.querySelector('#change-password-btn').focus()");assert.equal(await p.eval("document.activeElement.closest('.app-dialog')!==null"),true);
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await p.until('dialogResult===false');assert.equal(await p.eval("document.activeElement.id"),'change-password-btn');assert.equal(await p.eval("document.querySelector('#app-container').inert"),false);
    const vaultBeforeEnter=await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");
    const openConfirmation=async()=>{
      await p.eval("window.dialogResult='pending';void import('./js/dialogs.js').then(d=>d.confirmDialog('Fictitious confirmation')).then(r=>window.dialogResult=r)");
      await p.until("!!document.querySelector('.app-dialog')");
      assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'cancel');
    };
    await openConfirmation();
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
    await p.until("dialogResult!=='pending'");
    assert.equal(await p.eval('dialogResult'),false);
    assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),vaultBeforeEnter);

    await openConfirmation();
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
    assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'confirm');
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
    await p.until("dialogResult!=='pending'");
    assert.equal(await p.eval('dialogResult'),true);
    await p.eval("window.dialogResult='pending';void import('./js/dialogs.js').then(d=>d.wordDialog('Fictitious erasure',{word:'ERASE',danger:true})).then(r=>window.dialogResult=r)");await p.until("!!document.querySelector('.app-dialog input')");assert.equal(await p.eval("document.activeElement.tagName"),'INPUT');await p.eval("const i=document.querySelector('.app-dialog input');i.value='erase';i.dispatchEvent(new Event('input'))");await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});assert.equal(await p.eval('dialogResult'),'pending');assert.equal(await p.eval("document.querySelector('[data-dialog-action=confirm]').disabled"),true);
    await p.eval("const i=document.querySelector('.app-dialog input');i.value='ERASE';i.dispatchEvent(new Event('input'))");await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await p.until("dialogResult==='ERASE'");
    await p.eval("window.dialogResult='pending';void import('./js/dialogs.js').then(d=>d.noticeDialog('Fictitious notice')).then(r=>window.dialogResult=r)");await p.until("!!document.querySelector('.app-dialog')");await p.eval("(await import('./js/session.js')).logout()");await p.until("!!document.querySelector('.auth-view')&&dialogResult===false");assert.equal(await p.eval("!!document.querySelector('.app-dialog')||document.querySelector('#app-container').inert"),false);assert.deepEqual(p.errors,[]);
   }finally{await p.close();}
  }
 });
 await check('B1 Enter on Cancel preserves the note in Trash',async()=>{
  const p=await browser.page();
  try{
    await create(p);
    await add(p,'Fictitious trashed note','Keep after Cancel');
    await p.eval("document.querySelector('.note-card [data-action=trash]').click()");
    await p.until("!document.querySelector('.note-card')");
    await p.eval("document.querySelector('[data-view=trash]').click()");
    await p.until("!!document.querySelector('[data-action=delete-forever]')");
    const before=await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");

    await p.eval("const button=document.querySelector('[data-action=delete-forever]');button.focus();button.click()");
    await p.until("!!document.querySelector('.app-dialog')");
    assert.equal(await p.eval("document.activeElement.dataset.dialogAction"),'cancel');
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
    await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await p.until("!document.querySelector('.app-dialog')");

    assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),1);
    assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),before);
    assert.equal(await p.eval("document.activeElement.dataset.action"),'delete-forever');
    assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
 });
 await check('U4 actual reset refuses wrong word and cancellation, then explicit exact word erases; pending export cancels on logout',async()=>{
  const p=await browser.page();try{await create(p);await add(p);const before=await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");await p.eval("document.querySelector('#lock-btn').click()");await p.until("!!document.querySelector('.auth-view')");await p.eval("document.querySelector('#reset-vault').click()");await p.until("!!document.querySelector('.app-dialog input')");await p.eval("document.querySelector('.app-dialog input').value='wrong';document.querySelector('.app-dialog input').dispatchEvent(new Event('input'))");await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),before);await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),before);
   await p.eval("document.querySelector('#reset-vault').click()");await p.until("!!document.querySelector('.app-dialog input')");await p.waitForNavigation(()=>p.eval("const i=document.querySelector('.app-dialog input');i.value=(await import('./js/i18n.js')).t('account.resetWord');i.dispatchEvent(new Event('input'));document.querySelector('[data-dialog-action=confirm]').click()"));await p.until("!!document.querySelector('#create-form')&&!document.querySelector('#create-form').classList.contains('hidden')&&!(await(await import('./js/db.js')).getMeta('salt'))");assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),0);assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
  const q=await browser.page();try{await create(q);await q.eval("await(await import('./js/db.js')).saveNoteRecord({id:crypto.randomUUID(),iv:'AAAA',ciphertext:'AAAA',updatedAt:1});window.downloads=0;HTMLAnchorElement.prototype.click=()=>downloads++;window.exportResult='pending';void import('./js/backup.js').then(b=>b.exportBackup()).then(r=>window.exportResult=r)");await q.until("!!document.querySelector('.app-dialog')");await q.eval("(await import('./js/session.js')).logout()");await q.until("!!document.querySelector('.auth-view')&&exportResult===null");assert.equal(await q.eval('downloads'),0);assert.deepEqual(q.errors,[]);}finally{await q.close();}
 });
 await check('U4 password rotation shows the themed notice after rendering the renewed session',async()=>{
  const p=await browser.page();try{await create(p);await add(p);const next='cedro neblina foguete vidro lontra';await p.eval("document.querySelector('#change-password-btn').click()");await p.until("!!document.querySelector('#current-password')");await p.eval(`document.querySelector('#current-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#next-password').value=${JSON.stringify(next)};document.querySelector('#next-confirm').value=${JSON.stringify(next)};document.querySelector('#change-password-form').requestSubmit()`);await p.until("!!document.querySelector('.app-dialog')");assert.equal(await p.eval("!!document.querySelector('.app-view')&&!document.querySelector('#change-password-form')"),true);await p.eval("document.querySelector('[data-dialog-action=confirm]').click()");assert.equal(await p.eval("document.activeElement.id"),'change-password-btn');await p.reload();await p.until("!!document.querySelector('#login-password')");await p.eval(`document.querySelector('#login-password').value=${JSON.stringify(next)};document.querySelector('#login-form').requestSubmit()`);await p.until("!!document.querySelector('.note-card')");assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
 });

 await check('U4 stacked dialogs keep unique IDs, escape literal markup and all cancel on session end',async()=>{
  const p=await browser.page();try{await create(p);await p.eval("window.dialogResults=[];const d=await import('./js/dialogs.js');void d.confirmDialog('<img src=x onerror=alert(1)> Fictitious').then(v=>dialogResults.push(v));void d.noticeDialog('Second fictitious notice').then(v=>dialogResults.push(v))");await p.until("document.querySelectorAll('.app-dialog').length===2");assert.equal(await p.eval("document.querySelectorAll('.app-dialog img').length"),0);assert.equal(await p.eval("(()=>{const ids=[...document.querySelectorAll('.app-dialog [id]')].map(e=>e.id);return ids.length===new Set(ids).size})()"),true);await p.eval("(await import('./js/session.js')).logout()");await p.until("dialogResults.length===2&&!!document.querySelector('.auth-view')");assert.deepEqual(await p.eval('dialogResults'),[false,false]);assert.equal(await p.eval("document.querySelector('#app-container').inert"),false);assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
 });

}
