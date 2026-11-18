import {create,add,PASSWORD} from './harness.mjs';
import {backupFixture,importExpression} from './backup-fixture.mjs';
export async function run({browser,check,assert}) {
 await check('T2.29 fabricated unsupported old vault fails clearly without writes and typed reset works',async()=>{
  const p=await browser.page();try{await create(p);await add(p,'Fictitious preserved note','Do not erase automatically');
   // The sole historical-field reference is a fabricated unsupported-meta fixture.
   await p.eval("const d=await import('./js/db.js'),v=await d.readVault();delete v.meta.keyCheck;v.meta.passwordVerifier=btoa('0'.repeat(32));await d.replaceVault(v,v.meta)");await p.reload();
   const before=await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");await p.eval(`window.derives=0;const old=crypto.subtle.deriveKey.bind(crypto.subtle);crypto.subtle.deriveKey=(...args)=>{derives++;return old(...args)};document.querySelector('#login-password').value=${JSON.stringify(PASSWORD)};document.querySelector('#login-form').requestSubmit()`);await p.until("!!document.querySelector('#login-error').textContent");assert.match(await p.eval("document.querySelector('#login-error').textContent"),/unsupported old version|versão antiga não suportada/i);assert.equal(await p.eval('derives'),0);assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),before);
   await p.eval("document.querySelector('#reset-vault').click()");await p.until("!!document.querySelector('.app-dialog input')");await p.waitForNavigation(()=>p.eval("const input=document.querySelector('.app-dialog input');input.value=(await import('./js/i18n.js')).t('account.resetWord');input.dispatchEvent(new Event('input'));document.querySelector('[data-dialog-action=confirm]').click()"));await p.until("!!document.querySelector('#create-form')&&!document.querySelector('#create-form').classList.contains('hidden')&&!(await(await import('./js/db.js')).getMeta('salt'))");assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),0);assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
 });
 await check('T2.29 unsupported JSON, short text and unknown binary files report unsupported format without DB mutation',async()=>{
  const p=await browser.page();try{await create(p);await add(p);const before=await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())");
   const oldDocument=await p.eval("const v=await(await import('./js/db.js')).readVault();JSON.stringify({app:'KeepLocal',version:1,meta:['salt','keyCheck'].map(key=>({key,value:v.meta[key]})),notes:v.notes})");
   for(const source of [oldDocument, 'not a backup', 'unknown fictional format '.repeat(4),Array(64).fill(0)]){
    await p.eval(`window.unsupportedResult=null;void(async()=>{try{const value=${JSON.stringify(source)};await(await import('./js/backup.js')).importBackup(new File([typeof value==='string'?value:new Uint8Array(value)],'unsupported.keeplocal'),${JSON.stringify(PASSWORD)});window.unsupportedResult='accepted'}catch(e){window.unsupportedResult=e.message}})()`);await p.until("unsupportedResult!==null||!!document.querySelector('.app-dialog')");
    if(await p.eval("!!document.querySelector('.app-dialog')")){await p.eval("document.querySelector('[data-dialog-action=cancel]').click()");await p.until('unsupportedResult!==null');}
    const message=await p.eval('unsupportedResult');assert.match(message,/unsupported.*format|format.*unsupported|formato.*não suportado/i);assert.equal(await p.eval("JSON.stringify(await(await import('./js/db.js')).readVault())"),before);
   }assert.deepEqual(p.errors,[]);
  }finally{await p.close();}
 });
 await check('T2.29 immutable v2 opens an older short passphrase and a salt starting with a JSON brace',async()=>{
  const password='tiny',fixture=await backupFixture(undefined,password,new Uint8Array(16).fill(0x7b)),p=await browser.page();try{await p.eval(importExpression(fixture.base64,password));await p.eval(`await(await import('./js/auth.js')).login(${JSON.stringify(password)})`);assert.equal(await p.eval("(await(await import('./js/db.js')).getAllNoteRecords()).length"),2);assert.deepEqual(p.errors,[]);}finally{await p.close();}
 });

}
