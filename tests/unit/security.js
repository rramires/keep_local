import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
test('extension action focuses its own context without permissions, otherwise creates one',async()=>{
 const source=readFileSync(new URL('../../chrome-extension/service-worker.js',import.meta.url),'utf8');
 for(const found of [true,false]){let click;const calls=[];const chrome={action:{onClicked:{addListener:f=>click=f}},runtime:{getURL:p=>'chrome-extension://fictional/'+p,getContexts:async()=>found?[{tabId:3,windowId:7}]:[]},tabs:{update:async(...args)=>calls.push(['tab',...args]),create:async(...args)=>calls.push(['create',...args])},windows:{update:async(...args)=>calls.push(['window',...args])}};vm.runInNewContext(source,{chrome});await click();assert.deepEqual(calls.map(c=>c[0]),found?['tab','window']:['create']);}
 const manifest=JSON.parse(readFileSync(new URL('../../chrome-extension/manifest.json',import.meta.url)));assert.deepEqual(manifest.permissions,[]);assert.equal(manifest.version,'1.0.0');
});
import {createHash} from 'node:crypto';
test('vendored JS matches pinned SHA-256 checksums',()=>{const lines=readFileSync(new URL('../../lib/SHA256SUMS',import.meta.url),'utf8').trim().split('\n');assert.equal(lines.length,2);for(const line of lines){const[hash,file]=line.split(/\s+/);assert.match(file,/^(marked|purify)\.min\.js$/);assert.equal(createHash('sha256').update(readFileSync(new URL('../../lib/'+file,import.meta.url))).digest('hex'),hash);}});

test('P4.11 the obsolete generic HTML escape helper is absent',async()=>{
  const utils=await import('../../js/utils.js');
  assert.equal(Object.hasOwn(utils,'escapeHTML'),false);
});
