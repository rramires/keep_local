import assert from 'node:assert/strict';
import { launch, create, unlock, add, ROOT } from './harness.mjs';
import { existsSync } from 'node:fs';
import * as folderSaltReview from './folder-salt-review.mjs';
const browser=await launch();if(!browser){console.log('SKIP: Chromium unavailable; set CHROME_BIN. Browser acceptance is pending.');process.exit(0);}
export const checks=[];
const check=async(name,fn)=>{await fn();console.log('PASS '+name);};
try {
 await check('smoke: create vault, note, lock, unlock; no console errors',async()=>{const p=await browser.page();await create(p);await add(p);await p.eval("document.querySelector('#lock-btn').click()");await unlock(p);assert.equal(await p.eval("document.querySelectorAll('.note-card').length"),1);assert.deepEqual(p.errors,[]);await assert.rejects(p.eval("(()=>{throw Error('CDP failure must propagate')})()"),/CDP failure must propagate/);await p.close();});
 await folderSaltReview.runS3({check,assert});
 for(const file of ['regressions.mjs','phase-2b.mjs','action-failures.mjs','phase-2c.mjs','ui-layout.mjs','dialogs.mjs','batch-queue.mjs','compat-rejection.mjs','vault-core.mjs','vault-tools.mjs','recovery-tool.mjs']){if(existsSync(ROOT+'/tests/browser/'+file)){const m=await import('./'+file);await m.run({browser,check,assert});}}
} finally {await browser.close();}
const extension=await import('./extension.mjs');
await extension.run({check,assert});
const folderMerge=await import('./folder-merge.mjs');
await folderMerge.run({check,assert});
const folderHistory=await import('./folder-history.mjs');
await folderHistory.run({check,assert});
const folderSalt=await import('./folder-salt.mjs');
await folderSalt.run({check,assert});
const folderSaltLogin=await import('./folder-salt-login.mjs');
await folderSaltLogin.run({check,assert});
await folderSaltReview.run({check,assert});
const folderSaltConnect=await import('./folder-salt-connect.mjs');
await folderSaltConnect.run({check,assert});
const folderCopyView=await import('./folder-copy-view.mjs');
await folderCopyView.run({check,assert});
const folderSaltE2e=await import('./folder-salt-e2e.mjs');
await folderSaltE2e.run({check,assert});
