import {create,add,note} from './harness.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function run({browser,check,assert}) {
 await check('T2.16 failed card and modal actions preserve memory, storage and visible state',async()=>{
  const cases=[
   ['card pin',null,"document.querySelector('[data-action=pin]').click()"],
   ['archive',null,"document.querySelector('[data-action=archive]').click()"],
   ['trash',null,"document.querySelector('[data-action=trash]').click()"],
   ['unarchive',"const a=await import('./js/app.js');await a.saveNote({...a.getNotes()[0],archivedAt:Date.now()});document.querySelector('[data-view=archive]').click()","document.querySelector('[data-action=unarchive]').click()"],
   ['restore',"const a=await import('./js/app.js');await a.saveNote({...a.getNotes()[0],deletedAt:Date.now()});document.querySelector('[data-view=trash]').click()","document.querySelector('[data-action=restore]').click()"],
   ['card color',"document.querySelector('[data-action=color]').click()","document.querySelector('.color-opt[data-color=coral]').click()"],
   ['modal pin','modal',"document.querySelector('#modal-pin').click()"],
   ['modal archive','modal',"document.querySelector('#modal-archive-btn').click()"],
   ['modal trash','modal',"document.querySelector('#modal-delete-btn').click()"],
   ['modal color','color',"document.querySelector('.color-opt[data-color=coral]').click()"],
   ['label add','labels',"document.querySelector('#new-label-input').value='Failed label';document.querySelector('#new-label-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"],
   ['label toggle','labels',"document.querySelector('.label-opt').click()"],
   ['label rename','manager',"document.querySelector('.label-name-input').value='Renamed';document.querySelector('.label-name-input').dispatchEvent(new Event('blur'))"],
   ['label delete','manager',"document.querySelector('.label-delete-btn').click()"],
   ['drag order',null,"const cards=[...document.querySelectorAll('.note-card')];const dt=new DataTransfer();dt.setData('text/plain',cards[0].dataset.id);cards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))"],
   ['undo archive',"document.querySelector('[data-action=archive]').click()","document.querySelector('.toast-action').click()"],
   ['undo trash',"document.querySelector('[data-action=trash]').click()","document.querySelector('.toast-action').click()"],
  ];
  for(const [name,setup,action] of cases){
   const p=await browser.page();await create(p);await add(p,'Action note','Stored content');await p.eval("const a=await import('./js/app.js');await a.saveNote({...a.getNotes()[0],labels:['Existing']});document.querySelector('#search-clear').click()");
   if(name==='drag order')await add(p,'Other note','Other');
   if(['modal','color','labels'].includes(setup)){await p.eval("document.querySelector('.note-card').click()");await p.until("!!document.querySelector('#modal-editor')");if(setup!=='modal'){await p.eval(`document.querySelector('#modal-${setup==='color'?'color':'labels'}-btn').click()`);await p.until(`!!document.querySelector('.${setup==='color'?'color-picker':'labels-picker'}-popup')`);}}
   else if(setup==='manager'){await p.eval("document.querySelector('#edit-labels-btn').click()");await p.until("!!document.querySelector('.label-name-input')");}
   else if(setup){await p.eval(setup);if(name.startsWith('undo'))await p.until("!!document.querySelector('.toast-action')");}
   await pause(80);
   const memory=await p.eval("JSON.stringify((await import('./js/app.js')).getNotes())"),stored=await p.eval("JSON.stringify(await(await import('./js/db.js')).getAllNoteRecords())");
   await p.eval("window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')throw Error('injected write failure');return originalPut.apply(this,args)}");await p.eval(action);await pause(180);
   assert.equal(await p.eval("JSON.stringify((await import('./js/app.js')).getNotes())"),memory,name+' memory');assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).getAllNoteRecords())"),stored,name+' database');
   assert.match(await p.eval("[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' ')") ,/action|change/i,name+' error context');assert.doesNotMatch(await p.eval("[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' ')") ,/draft is still open/i,name+' error context');
   await p.eval("IDBObjectStore.prototype.put=originalPut;document.querySelector('#search-clear').click()");
   if(name==='card pin')assert.equal(await p.eval("!!document.querySelector('.card-pin.pinned')"),false);
   if(['modal','color','labels'].includes(setup)){
    assert.equal(await p.eval("document.querySelector('#modal-card').dataset.color||'default'"),'default',name+' modal color');
    await p.eval("document.querySelector('#modal-editor').value='Later edit';document.querySelector('#modal-editor').dispatchEvent(new Event('input'));document.querySelector('#modal-close').click()");await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");const after=await p.eval("const n=(await import('./js/app.js')).getNotes()[0];({pinned:n.pinned,archivedAt:n.archivedAt,deletedAt:n.deletedAt,color:n.color,labels:n.labels})");assert.deepEqual(after,{pinned:false,archivedAt:null,deletedAt:null,color:'default',labels:['Existing']},name+' no delayed promotion');
   }
   assert.deepEqual(p.errors,[],name);await p.close();
  }
 });
 await check('T2.16 collective label and order changes abort on the second record',async()=>{
  for(const action of ['labels','order']){
   const p=await browser.page();await create(p);await add(p,'First','One');await add(p,'Second','Two');
   await p.eval("const a=await import('./js/app.js');for(const n of [...a.getNotes()])await a.saveNote({...n,labels:['Shared']});document.querySelector('#search-clear').click()");
   if(action==='labels')await p.eval("document.querySelector('#edit-labels-btn').click()");
   const before=await p.eval("JSON.stringify({notes:(await import('./js/app.js')).getNotes(),db:await(await import('./js/db.js')).readVault()})");
   await p.eval("window.originalPut=IDBObjectStore.prototype.put;let writes=0;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes'&&++writes===2)throw Error('injected second put');return originalPut.apply(this,args)}");
   await p.eval(action==='labels'?"document.querySelector('.label-delete-btn').click()":"const cards=[...document.querySelectorAll('.note-card')];const dt=new DataTransfer();dt.setData('text/plain',cards[0].dataset.id);cards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))");await p.until("!!document.querySelector('.toast')");
   assert.equal(await p.eval("JSON.stringify({notes:(await import('./js/app.js')).getNotes(),db:await(await import('./js/db.js')).readVault()})"),before,action+' transaction rollback');assert.deepEqual(p.errors,[]);await p.close();
  }
 });
}
