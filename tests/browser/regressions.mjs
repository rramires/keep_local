import {create,add,note,PASSWORD,ROOT,unlock} from './harness.mjs';
import {readFile} from 'node:fs/promises';
export const cases=[];
export function scenario(name,run){cases.push({name,run});}
scenario('T1.1 active/archive/trash/label actions and permanent-delete guard',async({browser,assert})=>{
 const p=await browser.page();await create(p);await add(p);
 const id=await p.eval("(await import('./js/app.js')).getNotes()[0].id");
 const seed=note({pinned:true,labels:['Fixture label']});await p.eval(`await (await import('./js/app.js')).saveNote(${JSON.stringify(seed)});document.querySelector('#search-input').dispatchEvent(new Event('input'))`);await p.until("document.querySelectorAll('.note-card').length===2");
 assert.equal(await p.eval("document.querySelectorAll('[data-action=restore],[data-action=delete-forever]').length"),0);
 assert.equal(await p.eval(`(async()=>{try{await(await import('./js/app.js')).permanentDeleteNote(${JSON.stringify(id)});return false}catch{return true}})()`),true);
 await p.eval(`const a=await import('./js/app.js');const n=a.getNotes().find(n=>n.id===${JSON.stringify(id)});n.archivedAt=Date.now();await a.saveNote(n);document.querySelector('[data-view=archive]').click()`);await p.until("!!document.querySelector('[data-action=unarchive]')");
 await p.eval(`const a=await import('./js/app.js');const n=a.getNotes().find(n=>n.id===${JSON.stringify(id)});n.deletedAt=Date.now();await a.saveNote(n);document.querySelector('[data-view=trash]').click()`);await p.until("!!document.querySelector('[data-action=delete-forever]')");
 await p.eval("document.querySelector('[data-view=label]').click()");assert.equal(await p.eval("document.querySelectorAll('[data-action=delete-forever]').length"),0);assert.deepEqual(p.errors,[]);await p.close();
});
export async function run(context){for(const c of cases)await context.check(c.name,()=>c.run(context));}
scenario('T1.2 account recreation refuses atomically and hides Create',async({browser,assert})=>{
 const p=await browser.page();await create(p);await add(p);const before=await p.eval("JSON.stringify([await(await import('./js/db.js')).getAllMetaRecords(),await(await import('./js/db.js')).getAllNoteRecords()])");
 assert.equal(await p.eval(`(async()=>{try{await(await import('./js/auth.js')).createAccount('Another Fictitious Phrase 43!');return false}catch{return true}})()`),true);
 assert.equal(await p.eval("JSON.stringify([await(await import('./js/db.js')).getAllMetaRecords(),await(await import('./js/db.js')).getAllNoteRecords()])"),before);
 await p.eval("document.querySelector('#lock-btn').click()");await p.until("!document.querySelector('#login-form').classList.contains('hidden')");assert.equal(await p.eval("getComputedStyle(document.querySelector('[data-tab=create]')).display"),'none');await p.close();
});
scenario('T1.3/T1.7 unreadable decrypt, JSON and hostile model are retained and reported',async({browser,assert})=>{
 const p=await browser.page();await create(p);await add(p);const hostile=note({color:'"><img src=x onerror=window.injected=true>'});
 await p.eval(`const d=await import('./js/db.js'),c=await import('./js/crypto.js'),a=await import('./js/app.js');for(const value of ['not-json',JSON.stringify(${JSON.stringify(hostile)})]){const {iv,ciphertext}=await c.encrypt(a.getCryptoKey(),value);await d.saveNoteRecord({id:crypto.randomUUID(),iv:c.arrayToBase64(iv),ciphertext:c.arrayBufferToBase64(ciphertext),updatedAt:1});}await d.saveNoteRecord({id:crypto.randomUUID(),iv:'AAAA',ciphertext:'AAAA',updatedAt:1});`);
 await p.reload();if(await p.eval("!!document.querySelector('.auth-view')"))await unlock(p);await p.until("!!document.querySelector('.unreadable-warning')");
 assert.match(await p.eval("document.querySelector('.unreadable-warning').textContent"),/3/);assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),4);assert.equal(await p.eval("!!window.injected||!!document.querySelector('img[onerror]')"),false);await p.close();
});
