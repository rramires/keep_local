import {create,PASSWORD} from './harness.mjs';
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
}
