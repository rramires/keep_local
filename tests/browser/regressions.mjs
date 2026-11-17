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
