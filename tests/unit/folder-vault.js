import test from 'node:test';
import assert from 'node:assert/strict';
import * as vault from '../../js/folder-vault.js';
import {deriveKey,generateSalt,arrayToBase64} from '../../js/crypto.js';
import {encodeV2,makePayload} from '../../js/backup-v2.js';
import {MAX_BACKUP_BYTES} from '../../js/backup-format.js';

const dir=files=>({
  async *entries(){for(const [name,file] of Object.entries(files))yield [name,{kind:'file',getFile:async()=>file}];},
});

test('G1 strict session-key decoding preserves profile 2 and caps candidate reads',async()=>{
  const salt=generateSalt(),key=await deriveKey('fictional test vault phrase',salt);
  const bytes=await encodeV2(key,salt,makePayload([],{},11));
  const own=arrayToBase64(salt);
  const good=await vault.decodeV2WithKey(bytes,key,own);
  assert.equal(good.status,'valid');
  assert.equal(good.rev,11);
  assert.equal(good.payload.profile,2);
  assert.equal((await vault.decodeV2WithKey(bytes,key,arrayToBase64(generateSalt()))).status,'otherSalt');
  const bad=await encodeV2(key,salt,makePayload([{id:'invalid',iv:'',ciphertext:'',updatedAt:0}],{},12));
  assert.equal((await vault.decodeV2WithKey(bad,key,own)).status,'unreadable');
  const oversized={size:MAX_BACKUP_BYTES+1,arrayBuffer(){assert.fail('oversized file read');}};
  const file=new Blob([bytes]);
  const state=await vault.readFolderState(dir({['desktop.ini']:oversized,['big.keeplocal']:oversized,['head.keeplocal']:file}),key,own);
  assert.deepEqual(state.tooLarge,['big.keeplocal']);
  assert.equal(state.head.hash,good.hash);
  const extra=await vault.listCandidates(dir(Object.fromEntries(Array.from({length:33},(_,i)=>[i+'.keeplocal',file]))));
  assert.equal(extra.entries.length,32);
  assert.equal(extra.limitExceeded,true);
});

test('G3 reconciliation distinguishes dirty data, previous revisions and foreign copies',async()=>{
  const {decideFolderAction}=await import('../../js/folder-reconcile.js');
  const head={hash:'head',rev:3};
  const state={head,candidates:[{name:'keeplocal-vault.keeplocal',status:'valid'}],divergent:false,otherSalt:[],unreadable:[],tooLarge:[]};
  const clean={notes:[{}],meta:{revision:4,folderSyncedRevision:4,folderSeenRev:2,folderSyncedHash:'prior'}};
  assert.equal(decideFolderAction(clean,state),'pull');
  assert.equal(decideFolderAction({...clean,meta:{...clean.meta,revision:5}},state),'conflict');
  assert.equal(decideFolderAction({...clean,meta:{...clean.meta,folderSeenRev:4}},state),'rollback');
  assert.equal(decideFolderAction(clean,{...state,divergent:true}),'conflict');
  assert.equal(decideFolderAction({notes:[],meta:{}},state),'pull');
  assert.equal(decideFolderAction({notes:[{}],meta:{}},state),'conflict');
  assert.equal(decideFolderAction(clean,{...state,head:null,candidates:[]}), 'push');
  assert.equal(decideFolderAction(clean,{...state,candidates:[{name:'keeplocal-vault.keeplocal',status:'otherSalt'}],otherSalt:['keeplocal-vault.keeplocal']}),'otherSalt');
});
