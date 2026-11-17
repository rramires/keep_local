import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
test('extension action focuses its own context without permissions, otherwise creates one',async()=>{
 const source=readFileSync(new URL('../../chrome-extension/service-worker.js',import.meta.url),'utf8');
 for(const found of [true,false]){let click;const calls=[];const chrome={action:{onClicked:{addListener:f=>click=f}},runtime:{getURL:p=>'chrome-extension://fictional/'+p,getContexts:async()=>found?[{tabId:3,windowId:7}]:[]},tabs:{update:async(...args)=>calls.push(['tab',...args]),create:async(...args)=>calls.push(['create',...args])},windows:{update:async(...args)=>calls.push(['window',...args])}};vm.runInNewContext(source,{chrome});await click();assert.deepEqual(calls.map(c=>c[0]),found?['tab','window']:['create']);}
 const manifest=JSON.parse(readFileSync(new URL('../../chrome-extension/manifest.json',import.meta.url)));assert.deepEqual(manifest.permissions,[]);assert.equal(manifest.version,'1.0.0');
});
