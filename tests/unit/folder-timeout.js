import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {checkFolder,requestFolderAccess} from '../../js/folder-store.js';
import {listCandidates,readFolderCandidate} from '../../js/folder-vault.js';

async function outcome(operation) {
  return Promise.race([operation.then(value=>({value}),error=>({name:error.name})),nextTurn('pending')]);
}

test('G3.1 the permission query expires without retrying the listing or asking late',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const query=Promise.withResolvers();
  let requests=0;
  const handle={
    queryPermission:()=>query.promise,
    async requestPermission(){requests++;return 'granted';},
    keys(){assert.fail('A timed-out query should not trigger a listing');},
  };
  const access=requestFolderAccess(handle);
  context.mock.timers.tick(15000);
  assert.deepEqual(await outcome(access),{value:'unresponsive'});
  assert.equal(await checkFolder(handle,await access),'unresponsive');
  query.resolve('prompt');
  await nextTurn();
  assert.equal(requests,0);
});

test('G3.1 native permission requests keep waiting for an explicit choice',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const choice=Promise.withResolvers();
  let requested=false;
  const access=requestFolderAccess({
    async queryPermission(){return 'prompt';},
    requestPermission(){requested=true;return choice.promise;},
  });
  await nextTurn();
  assert.equal(requested,true);
  context.mock.timers.tick(120000);
  assert.equal(await outcome(access),'pending');
  choice.resolve('granted');
  assert.equal(await access,null);
});

test('G3.1 directory iteration and file bytes use separate read deadlines',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const never=new Promise(()=>{});
  const candidates=listCandidates({async *entries(){await never;}});
  const probe=checkFolder({async *keys(){await never;}},null);
  const file=Promise.withResolvers();
  const candidate=readFolderCandidate({getFile:()=>file.promise},null,'');
  context.mock.timers.tick(15000);
  assert.deepEqual(await outcome(candidates),{name:'TimeoutError'});
  assert.deepEqual(await outcome(probe),{value:'unresponsive'});
  assert.equal(await outcome(candidate),'pending');
  context.mock.timers.tick(44000);
  file.resolve({size:44,arrayBuffer:()=>never});
  await nextTurn();
  assert.equal(await outcome(candidate),'pending');
  context.mock.timers.tick(1000);
  assert.deepEqual(await outcome(candidate),{name:'TimeoutError'});
});

test('G3.1 the read helper resolves, rejects and drops late outcomes',async context=>{
  const {FOLDER_METADATA_TIMEOUT_MS,FOLDER_FILE_TIMEOUT_MS,withFolderReadTimeout}=await import('../../js/folder-timeout.js');
  assert.equal(FOLDER_METADATA_TIMEOUT_MS,15000);
  assert.equal(FOLDER_FILE_TIMEOUT_MS,60000);
  context.mock.timers.enable({apis:['setTimeout']});
  assert.equal(await withFolderReadTimeout(Promise.resolve('present')),'present');
  await assert.rejects(withFolderReadTimeout(async()=>{throw new DOMException('Denied','NotAllowedError');}),{name:'NotAllowedError'});
  for(const settle of ['resolve','reject']){
    const original=Promise.withResolvers();
    const pending=withFolderReadTimeout(()=>original.promise);
    const rejected=assert.rejects(pending,error=>error instanceof DOMException&&error.name==='TimeoutError');
    context.mock.timers.tick(FOLDER_METADATA_TIMEOUT_MS);
    await rejected;
    const late=settle==='resolve'?'late result':Error('late failure');
    original[settle](late);
    if(settle==='resolve')assert.equal(await original.promise,late);
    await nextTurn();
    await assert.rejects(pending,{name:'TimeoutError'});
  }
});
