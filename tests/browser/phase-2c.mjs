import {create,add,note} from './harness.mjs';
export const cases=[];
export const scenario=(name,run)=>cases.push({name,run});
export async function run(ctx){for(const c of cases)await ctx.check(c.name,()=>c.run(ctx));}
scenario('T2.20 controlled action and editor writes preserve both intents in text and todo',async({browser,assert})=>{
 for(const type of ['text','todo'])for(const action of ['pin','color','archive','trash','label'])for(const first of ['action','editor']){
  const p=await browser.page();await create(p);
  if(type==='text')await add(p);else await p.eval(`await(await import('./js/app.js')).saveNote(${JSON.stringify(note({type:'todo',tasks:[{id:crypto.randomUUID(),text:'Existing',done:false,order:0,parentId:null}]}))});document.querySelector('#search-clear').click()`);
  await p.eval("const a=await import('./js/app.js');await a.saveNote({...a.getNotes()[0],labels:['Work']});document.querySelector('#search-clear').click();document.querySelector('.note-card').click()");await p.until("!!document.querySelector('#modal-title')");
  if(action==='color'){await p.eval("document.querySelector('#modal-color-btn').click()");await p.until("!!document.querySelector('.color-opt[data-color=coral]')");}
  if(action==='label'){await p.eval("document.querySelector('#modal-labels-btn').click()");await p.until("!!document.querySelector('.label-opt')");}
  const act={pin:"document.querySelector('#modal-pin').click()",color:"document.querySelector('.color-opt[data-color=coral]').click()",archive:"document.querySelector('#modal-archive-btn').click()",trash:"document.querySelector('#modal-delete-btn').click()",label:"document.querySelector('.label-opt').click()"}[action];
  await p.eval(`window.originalTimeout=window.setTimeout;window.setTimeout=function(fn,delay,...args){if(delay===2000){const id=originalTimeout(()=>{},60000);window.fireAutosave=()=>{clearTimeout(id);fn(...args)};return id;}return originalTimeout(fn,delay,...args)};window.puts=[];const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...args){if(this.name==='notes')puts.push(v.updatedAt);return put.call(this,v,...args)};window.originalEncrypt=crypto.subtle.encrypt.bind(crypto.subtle);window.encryptCalls=0;crypto.subtle.encrypt=async(...args)=>{if(++encryptCalls===1)await new Promise(resolve=>window.resumeFirst=resolve);return originalEncrypt(...args)};`);
  const edit=type==='text'?"document.querySelector('#modal-title').value='Pending title';document.querySelector('#modal-title').dispatchEvent(new Event('input'));fireAutosave()":"document.querySelector('#modal-title').value='Pending title';document.querySelector('.todo-text').value='Pending task';document.querySelector('.todo-text').dispatchEvent(new Event('blur'));document.querySelector('#modal-title').dispatchEvent(new Event('blur'))";
  if(first==='action')await p.eval(act);else await p.eval(edit);
  await p.until("typeof resumeFirst==='function'");
  await p.eval("window.clones=0;const clone=structuredClone;window.structuredClone=function(v,...args){if(v?.id&&['text','todo'].includes(v.type))clones++;return clone(v,...args)}");
  if(first==='action')await p.eval(edit);else await p.eval(act);
  await p.until('clones>0');await p.eval("crypto.subtle.encrypt=originalEncrypt;resumeFirst()");
  await p.until(`puts.length>=${type==='todo'?3:2}&&(await import('./js/app.js')).getNotes()[0].updatedAt===puts.at(-1)`);
  const state=await p.eval("const a=await import('./js/app.js'),d=await import('./js/db.js'),c=await import('./js/crypto.js');const r=(await d.getAllNoteRecords())[0];({memory:a.getNotes()[0],db:JSON.parse(await c.decrypt(a.getCryptoKey(),c.base64ToArray(r.iv),c.base64ToArray(r.ciphertext)))})");
  assert.deepEqual(state.memory,state.db,type+' '+first);if(action==='pin')assert.equal(state.db.pinned,true);if(action==='color')assert.equal(state.db.color,'coral');if(action==='archive')assert.ok(state.db.archivedAt);if(action==='trash')assert.ok(state.db.deletedAt);if(action==='label')assert.deepEqual(state.db.labels,[]);assert.equal(state.db.title,'Pending title',type+' '+first);if(type==='todo')assert.equal(state.db.tasks[0].text,'Pending task');assert.doesNotMatch(await p.eval("[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' ')"),/Another tab|Could not/);assert.deepEqual(p.errors,[]);await p.close();
 }
});

export async function controlledToolbarRegression({browser,assert}) {
 for(const mode of ['close','timer','archive-lock']){
  const p=await browser.page();await create(p);await add(p);await p.eval("document.querySelector('.note-card').click()");await p.until("!!document.querySelector('#modal-title')");
  await p.eval(`window.puts=[];const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...a){if(this.name==='notes')puts.push(v.updatedAt);return put.call(this,v,...a)};const originalTimeout=setTimeout;window.setTimeout=function(fn,delay,...args){if(delay===2000){const id=originalTimeout(()=>{},60000);window.fireAutosave=()=>{clearTimeout(id);fn(...args)};return id;}return originalTimeout(fn,delay,...args)};window.origEncrypt=crypto.subtle.encrypt.bind(crypto.subtle);let held=false;crypto.subtle.encrypt=async(...args)=>{if(!held){held=true;await new Promise(resolve=>window.resumeToolbar=resolve)}return origEncrypt(...args)};`);
  if(mode==='timer')await p.eval("document.querySelector('#modal-title').value='Pending title';document.querySelector('#modal-title').dispatchEvent(new Event('input'))");
  await p.eval(`document.querySelector('${mode==='archive-lock'?'#modal-archive-btn':'#modal-pin'}').click()`);await p.until("typeof window.resumeToolbar==='function'");
  if(mode==='close'){await p.eval("document.querySelector('#modal-close').click()");assert.equal(await p.eval("document.querySelector('#modal-overlay').classList.contains('open')"),true);}
  else if(mode==='timer'){await p.eval("window.queuedEditor=false;const clone=structuredClone;window.structuredClone=function(v,...a){if(v?.id&&v.title==='Pending title')queuedEditor=true;return clone(v,...a)};fireAutosave()");await p.until('queuedEditor');}
  else await p.eval("document.querySelector('#lock-btn').click()");
  await p.eval("crypto.subtle.encrypt=origEncrypt;resumeToolbar()");
  if(mode==='archive-lock')await p.until("!!document.querySelector('.auth-view')");
  else{await p.until(`puts.length>=${mode==='timer'?2:1}&&(await import('./js/app.js')).getNotes()[0].updatedAt===puts.at(-1)`);assert.equal(await p.eval("(await import('./js/app.js')).getNotes()[0].pinned"),true);assert.equal(await p.eval("document.querySelectorAll('.toast-action').length"),0);if(mode==='close')await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");else assert.equal(await p.eval("(await import('./js/app.js')).getNotes()[0].title"),'Pending title');}
  assert.deepEqual(p.errors,[]);await p.close();
 }
}
