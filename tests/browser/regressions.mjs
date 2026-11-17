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
scenario('T1.4 keyCheck, one derivation on wrong password and real v1 migration rollback',async({browser,assert})=>{
 const p=await browser.page();await create(p);const meta=await p.eval("Object.fromEntries((await(await import('./js/db.js')).getAllMetaRecords()).map(r=>[r.key,r.value]))");assert.ok(meta.keyCheck);assert.equal(meta.passwordVerifier,undefined);
 const exported=await p.eval(`(async()=>{const original=URL.createObjectURL;let blob;URL.createObjectURL=b=>{blob=b;return original(b)};try{await(await import('./js/backup.js')).exportBackup();return await blob.text()}finally{URL.createObjectURL=original}})()`);
 const fast=await p.eval(`await(await import('./js/crypto.js')).hashPassword(${JSON.stringify(PASSWORD)},(await import('./js/crypto.js')).base64ToArray(${JSON.stringify(meta.salt)}))`);assert.equal(exported.includes(fast),false);assert.equal(exported.includes('passwordVerifier'),false);await p.close();
 browser.setRoot(process.env.KL_BASE_ROOT);const legacy=await browser.page();await create(legacy);await add(legacy,'Legacy v1','Original fixture');await legacy.eval("(await import('./js/auth.js')).clearSession()");browser.setRoot(ROOT);await legacy.reload();
 const before=await legacy.eval("JSON.stringify(await(await import('./js/db.js')).getAllMetaRecords())");
 const wrong=await legacy.eval(`(async()=>{let calls=0;const original=crypto.subtle.deriveKey.bind(crypto.subtle);crypto.subtle.deriveKey=(...args)=>{calls++;return original(...args)};try{await(await import('./js/auth.js')).login('incorrect')}catch{}finally{crypto.subtle.deriveKey=original;}return calls;})()`);assert.equal(wrong,1);assert.equal(await legacy.eval("JSON.stringify(await(await import('./js/db.js')).getAllMetaRecords())"),before);
 assert.equal(await legacy.eval(`(async()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value.key==='keyCheck')throw Error('injected migration failure');return original.call(this,value,...args)};try{await(await import('./js/auth.js')).login(${JSON.stringify(PASSWORD)});return false}catch{return true}finally{IDBObjectStore.prototype.put=original}})()`),true);
 assert.equal(await legacy.eval("JSON.stringify(await(await import('./js/db.js')).getAllMetaRecords())"),before);await unlock(legacy);assert.match(await legacy.eval("document.querySelector('.card-title').textContent"),/Legacy/);assert.equal(await legacy.eval("await(await import('./js/db.js')).getMeta('passwordVerifier')"),null);await legacy.close();
 for(const name of ['withNotes','empty']){const p=await browser.page();const fixture=JSON.parse(await readFile(ROOT+'/tests/fixtures/v1.json','utf8'))[name];assert.equal(await p.eval(`(async()=>{const b=await import('./js/backup.js');try{await b.importBackup(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.json'),'wrong');return false}catch{return true}})()`),true);await p.eval(`await(await import('./js/backup.js')).importBackup(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.json'),${JSON.stringify(PASSWORD)})`);assert.ok(await p.eval("await(await import('./js/db.js')).getMeta('keyCheck')"));assert.equal(await p.eval("await(await import('./js/db.js')).getMeta('passwordVerifier')"),null);await p.close();}
});

scenario('T1.5 validate every legacy record before an atomic replacement',async({browser,assert})=>{
 const fixtures=JSON.parse(await readFile(ROOT+'/tests/fixtures/v1.json','utf8'));const p=await browser.page();await create(p);await add(p,'Preserved','Previous vault');
 const snapshot=()=>p.eval("JSON.stringify([await(await import('./js/db.js')).getAllMetaRecords(),await(await import('./js/db.js')).getAllNoteRecords()])");const before=await snapshot();
 const mismatch=structuredClone(fixtures.withNotes);mismatch.notes[1].id=crypto.randomUUID();const unexpected=structuredClone(fixtures.withNotes);unexpected.meta.push({key:'unknown',value:'bad'});
 for(const fixture of [fixtures.corruptSecond,fixtures.missingId,fixtures.duplicateIds,fixtures.unknownVersion,mismatch,unexpected]){assert.equal(await p.eval(`(async()=>{try{await(await import('./js/backup.js')).importBackup(new File([${JSON.stringify(JSON.stringify(fixture))}],'bad.json'),${JSON.stringify(PASSWORD)});return false}catch{return true}})()`),true);assert.equal(await snapshot(),before);}
 await p.eval('window.confirm=()=>false');assert.equal(await p.eval(`(async()=>{try{await(await import('./js/backup.js')).importBackup(new File([${JSON.stringify(JSON.stringify(fixtures.withNotes))}],'valid.json'),${JSON.stringify(PASSWORD)});return false}catch{return true}})()`),true);assert.equal(await snapshot(),before);
 await p.eval('window.confirm=()=>true');assert.equal(await p.eval(`(async()=>{const original=IDBObjectStore.prototype.put;let writes=0;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='notes'&&++writes===2)throw Error('injected second write');return original.call(this,value,...args)};try{await(await import('./js/backup.js')).importBackup(new File([${JSON.stringify(JSON.stringify(fixtures.withNotes))}],'valid.json'),${JSON.stringify(PASSWORD)});return false}catch{return true}finally{IDBObjectStore.prototype.put=original}})()`),true);assert.equal(await snapshot(),before);
 await p.reload();if(await p.eval("!!document.querySelector('.auth-view')"))await unlock(p);assert.match(await p.eval("document.querySelector('.card-title').textContent"),/Preserved/);await p.close();
});
