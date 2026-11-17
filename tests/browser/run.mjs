import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { launch, create, unlock, add, note, ROOT, PASSWORD } from './harness.mjs';
import { existsSync } from 'node:fs';
const browser=await launch();if(!browser){console.log('SKIP: Chromium unavailable; set CHROME_BIN. Browser acceptance is pending.');process.exit(0);}
export const checks=[];
const check=async(name,fn)=>{await fn();console.log('PASS '+name);};
try {
 const fixtures=ROOT+'/tests/fixtures/v1.json';
 if(!existsSync(fixtures)){
  const base=process.env.KL_BASE_ROOT;if(!base)throw Error('KL_BASE_ROOT is required to generate fixtures from git archive 571fcb7');browser.setRoot(base);const p=await browser.page();
  const generated=await p.eval(`(async()=>{const a=await import('./js/auth.js');const d=await import('./js/db.js');const c=await import('./js/crypto.js');const b=await import('./js/backup.js');const key=await a.createAccount(${JSON.stringify(PASSWORD)});const values=${JSON.stringify([note({title:'V1 A'}),note({title:'V1 B'})])};for(const n of values){const{iv,ciphertext}=await c.encrypt(key,JSON.stringify(n));await d.saveNoteRecord({id:n.id,iv:c.arrayToBase64(iv),ciphertext:c.arrayBufferToBase64(ciphertext),updatedAt:n.updatedAt});}let blob;URL.createObjectURL=b=>{blob=b;return 'blob:fixture'};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};await b.exportBackup();const withNotes=JSON.parse(await blob.text());await d.clearAllNotes();await b.exportBackup();return {password:${JSON.stringify(PASSWORD)},notes:values,withNotes,empty:JSON.parse(await blob.text())};})()`);
  generated.corruptSecond=structuredClone(generated.withNotes);generated.corruptSecond.notes[1].ciphertext='AAAA';generated.missingId=structuredClone(generated.withNotes);delete generated.missingId.notes[1].id;generated.duplicateIds=structuredClone(generated.withNotes);generated.duplicateIds.notes[1].id=generated.duplicateIds.notes[0].id;generated.unknownVersion=structuredClone(generated.withNotes);generated.unknownVersion.version=999;
  await writeFile(fixtures,JSON.stringify(generated,null,2)+'\n');await p.close();browser.setRoot(ROOT);console.log('PASS fixtures generated using original 571fcb7');
 }
 await check('smoke: create vault, note, lock, unlock; no console errors',async()=>{const p=await browser.page();await create(p);await add(p);await p.eval("document.querySelector('#lock-btn').click()");await unlock(p);assert.equal(await p.eval("document.querySelectorAll('.note-card').length"),1);assert.deepEqual(p.errors,[]);await assert.rejects(p.eval("(()=>{throw Error('CDP failure must propagate')})()"),/CDP failure must propagate/);await p.close();});
 for(const file of ['regressions.mjs','phase-2b.mjs','action-failures.mjs']){if(existsSync(ROOT+'/tests/browser/'+file)){const m=await import('./'+file);await m.run({browser,check,assert});}}
} finally {await browser.close();}
