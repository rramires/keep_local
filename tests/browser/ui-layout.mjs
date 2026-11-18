import {create,unlock as unlockRecovery,PASSWORD} from './harness.mjs';
export async function run({browser,check,assert}) {
 await check('U1 password form has real stacked geometry, live policy feedback and accessible close in both themes at 390/1100px',async()=>{
  for(const theme of ['dark','light'])for(const width of [1100,390]){
   const p=await browser.page();try{
    await p.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await create(p);
    await p.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#change-password-btn').focus();document.querySelector('#change-password-btn').click()`);await p.until("document.activeElement.id==='current-password'");
    const layout=await p.eval(`(()=>{const form=document.querySelector('#change-password-form'),inputs=[...form.querySelectorAll('input')],rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},close=form.querySelector('[data-panel-close]');return {inputs:inputs.map(i=>({input:rect(i),label:rect(document.querySelector('label[for="'+i.id+'"]')),field:rect(i.closest('.form-field'))})),submit:rect(form.querySelector('[type=submit]')),close:close&&rect(close),focus:document.activeElement.id,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.equal(layout.inputs.length,3);assert.equal(layout.focus,'current-password');assert.equal(layout.overflow,false);
    for(let i=0;i<3;i++){const {input,label,field}=layout.inputs[i];assert.ok(input.y>=label.bottom,'label above input');assert.ok(Math.abs(input.width-field.width)<2,'full-width field');assert.ok(input.x>=0&&input.right<=width,'input within viewport');if(i)assert.ok(input.y>layout.inputs[i-1].input.bottom,'stacked fields');}
    assert.ok(layout.close&&layout.close.y>=0&&layout.close.bottom<850,'visible close control');assert.ok(Math.abs(layout.submit.width-layout.inputs[0].input.width)<2,'full-width primary');
    await p.eval("document.querySelector('#next-password').value='aaaaaaaaaaaaaa';document.querySelector('#next-password').dispatchEvent(new Event('input'))");assert.equal(await p.eval("document.querySelector('#change-password-strength').dataset.strength"),'weak');
    await p.eval(`document.querySelector('#current-password').value='wrong';document.querySelector('#next-password').value=${JSON.stringify(PASSWORD+' new')};document.querySelector('#next-confirm').value=${JSON.stringify(PASSWORD+' new')};document.querySelector('#next-password').dispatchEvent(new Event('input'));document.querySelector('#change-password-form').requestSubmit()`);
    await p.until("!!document.querySelector('#change-password-error').textContent");
    assert.equal(await p.eval("document.querySelector('#change-password-error').getAttribute('role')"),'alert');
    assert.equal(await p.eval("(()=>{const e=document.querySelector('#change-password-error'),probe=document.createElement('span');probe.style.color='var(--error-color)';e.append(probe);const match=getComputedStyle(e).color===getComputedStyle(probe).color;probe.remove();return match})()"),true);
    await p.eval("document.querySelector('[data-panel-close]').click()");await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");await p.until("document.activeElement.id==='change-password-btn'");
    await p.eval("document.querySelector('#change-password-btn').click()");await p.until("document.activeElement.id==='current-password'");await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");assert.deepEqual(p.errors,[]);
   }finally{await p.close();}
  }
 });
 await check('U2 recovery uses distinct steps, list semantics, full-width confirmation and visible disabled danger controls',async()=>{
  for(const theme of ['dark','light'])for(const width of [1100,390]){
   const p=await browser.page();try{await p.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await create(p);
    await p.eval(`const c=await import('./js/crypto.js'),d=await import('./js/db.js'),a=await import('./js/app.js');const e=await c.encrypt(a.getCryptoKey(),'fictitious invalid JSON');await d.saveNoteRecord({id:crypto.randomUUID(),iv:c.arrayToBase64(e.iv),ciphertext:c.arrayBufferToBase64(e.ciphertext),updatedAt:1})`);await p.reload();await unlockRecovery(p);
    await p.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#recover-notes-btn').click()`);await p.until("!!document.querySelector('#recovery-confirmation')");await p.until("document.activeElement.classList.contains('recovery-record')");
    const v=await p.eval(`(()=>{const step=[...document.querySelectorAll('.recovery-step')],i=document.querySelector('#recovery-confirmation'),label=i.labels[0],d=document.querySelector('#recovery-discard'),c=document.querySelector('#recovery-saved'),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width}};return {steps:step.map(rect),input:rect(i),label:rect(label),field:rect(i.parentElement),checkbox:rect(c),checkboxLabel:rect(c.parentElement),disabled:d.disabled,opacity:+getComputedStyle(d).opacity,border:getComputedStyle(d).borderColor,kind:d.className,list:document.querySelector('.recovery-record').parentElement.parentElement.tagName,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.equal(v.steps.length,2);assert.ok(v.steps[1].y>v.steps[0].bottom);assert.ok(v.input.y>=v.label.bottom);assert.ok(Math.abs(v.input.width-v.field.width)<2);assert.ok(v.input.right<=width);assert.ok(v.checkbox.width<=20);assert.ok(Math.abs(v.checkbox.y-v.checkboxLabel.y)<5);assert.equal(v.disabled,true);assert.ok(v.opacity<1);assert.match(v.kind,/btn-danger/);assert.equal(v.list,'UL');assert.equal(v.overflow,false);
    await p.eval("document.querySelector('#modal-close').click()");await p.until("document.activeElement.id==='recover-notes-btn'");assert.deepEqual(p.errors,[]);
   }finally{await p.close();}
  }
 });

 await check('U3 unreadable banner flows above new-note bar and uses actual singular/plural in EN/pt-BR',async()=>{
  for(const [lang,theme,width,count] of [['en','dark',1100,1],['en','light',390,2],['pt-BR','light',1100,1],['pt-BR','dark',390,2]]){
   const p=await browser.page();try{await p.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await create(p);
    await p.eval(`await(await import('./js/i18n.js')).setLang(${JSON.stringify(lang)});const c=await import('./js/crypto.js'),d=await import('./js/db.js'),a=await import('./js/app.js');for(let i=0;i<${count};i++){const e=await c.encrypt(a.getCryptoKey(),'fictitious invalid JSON');await d.saveNoteRecord({id:crypto.randomUUID(),iv:c.arrayToBase64(e.iv),ciphertext:c.arrayBufferToBase64(e.ciphertext),updatedAt:1})}`);await p.reload();await unlockRecovery(p);
    await p.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    const v=await p.eval(`(()=>{const w=document.querySelector('.unreadable-warning'),n=document.querySelector('.new-note-bar'),r=w.getBoundingClientRect();return {text:w.textContent,icon:!!w.querySelector('[aria-hidden=true]'),role:w.getAttribute('role'),border:parseFloat(getComputedStyle(w).borderTopWidth),gap:parseFloat(getComputedStyle(w).gap),above:r.bottom<n.getBoundingClientRect().top,within:r.x>=0&&r.right<=innerWidth}})()`);
    assert.equal(v.role,'alert');assert.equal(v.icon,true);assert.ok(v.border>=1&&v.gap>=8);assert.ok(v.above&&v.within);assert.match(v.text,new RegExp(lang==='en'?`${count} note${count===1?' could':'s could'}`:`${count} nota${count===1?' não':'s não'}`));
    await p.eval("document.querySelector('#recover-notes-btn').click()");await p.until("!!document.querySelector('.recovery-record')");await p.eval("HTMLAnchorElement.prototype.click=()=>{};document.querySelector('.recovery-record').click();document.querySelector('#recovery-export').click()");await p.until("!document.querySelector('#recovery-export').disabled&&document.querySelector('#recovery-status').textContent.includes('Download')");assert.match(await p.eval("document.querySelector('#recovery-status').textContent"),new RegExp(lang==='en'?`${count} unreadable record${count===1?'\\.':'s'}`:`${count} registro${count===1?' ilegível':'s ilegíveis'}`));assert.deepEqual(p.errors,[]);
   }finally{await p.close();}
  }
 });

}
