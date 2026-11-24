import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveKey,generateSalt,arrayToBase64,encrypt,arrayBufferToBase64} from '../../js/crypto.js';
import {encodeV2,makePayload} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';
import {readFolderState,MAIN_FILE} from '../../js/folder-vault.js';
import {note} from '../browser/harness.mjs';

const writer='12345678-1234-4234-8234-123456789abc';
const directory=files=>({async *entries(){
  for(const [name,bytes] of Object.entries(files))yield [name,{kind:'file',getFile:async()=>new Blob([bytes])}];
}});

async function fixture() {
  const localSalt=generateSalt(),folderSalt=generateSalt();
  const localKey=await deriveKey('fictional local passphrase',localSalt);
  const folderKey=await deriveKey('fictional folder passphrase',folderSalt);
  const value=note({title:'Fictional shared note',updatedAt:1700000000000});
  const {iv,ciphertext}=await encrypt(localKey,JSON.stringify(value));
  const record={id:value.id,updatedAt:value.updatedAt,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext)};
  return {localSalt,folderSalt,localKey,folderKey,value,record};
}

test('H2b.0 target passphrase follows the salt-change clock',async()=>{
  const {folderSaltTarget}=await import('../../js/folder-salt.js');
  const head={payload:{clock:{[writer]:3}}};
  for(const clock of [undefined,{}, {[writer]:2},{[writer]:3}])
    assert.equal(folderSaltTarget({folderSaltClock:clock},head),'folder');
  assert.equal(folderSaltTarget({folderSaltClock:{[writer]:4}},head),'local');
  assert.equal(folderSaltTarget({folderSaltClock:{[writer]:1}},{payload:{}}),'local');
});

test('H2b.0 two-key scan keeps salts, revision order and third-salt classification',async()=>{
  const f=await fixture();
  const local=arrayToBase64(f.localSalt),foreign=arrayToBase64(f.folderSalt);
  const first=await encodeV2(f.localKey,f.localSalt,makePayload([],{},2));
  const second=await encodeV2(f.folderKey,f.folderSalt,makePayload([],{},3));
  const third=await encodeV2(f.folderKey,generateSalt(),makePayload([],{},4));
  const handle=directory({'old.keeplocal':first,[MAIN_FILE]:second,'third.keeplocal':third});
  assert.equal((await readFolderState(handle,f.localKey,local)).head.rev,2);
  const state=await readFolderState(handle,f.localKey,local,{salt:foreign,key:f.folderKey});
  assert.equal(state.head.rev,3);
  assert.equal(state.head.salt,foreign);
  assert.deepEqual(state.otherSalt,['third.keeplocal']);
  assert.equal(state.candidates.find(row=>row.name==='old.keeplocal').salt,local);
});

test('H2b.0 conversion preserves plaintext, versions and original lineage without mutation',async()=>{
  const {convertFolderCopy,convertFolderSnapshot}=await import('../../js/folder-salt.js');
  const f=await fixture();
  const payload=makePayload([f.record],{},7,'a'.repeat(64),[],['b'.repeat(64)],{[writer]:5});
  const copy={hash:'c'.repeat(64),rev:7,parent:payload.parent,salt:arrayToBase64(f.localSalt),payload};
  const before=structuredClone(copy);
  const converted=await convertFolderCopy(copy,f.localKey,f.folderKey);
  assert.deepEqual(await decryptRecords(converted.payload.notes,f.folderKey),[f.value]);
  assert.notEqual(converted.payload.notes[0].iv,f.record.iv);
  assert.notEqual(converted.payload.notes[0].ciphertext,f.record.ciphertext);
  assert.deepEqual({...converted,payload:{...converted.payload,notes:payload.notes}},copy);
  assert.deepEqual(copy,before);
  const snapshot={notes:[f.record],meta:{salt:copy.salt,exportClock:payload.clock}};
  const result=await convertFolderSnapshot(snapshot,f.localKey,f.folderKey);
  assert.deepEqual(result.meta,snapshot.meta);
  assert.deepEqual(await decryptRecords(result.notes,f.folderKey),[f.value]);
  assert.equal(JSON.stringify(result.meta).includes(f.value.title),false);
  assert.equal(f.folderKey.extractable,false);
});

test('H2b.0 cross-salt decisions reuse pull, merge, conflict and rollback without saved',async()=>{
  const {decideSaltAction,convertFolderCopy}=await import('../../js/folder-salt.js');
  const f=await fixture();
  const original={hash:'new',parent:'prior',rev:3,salt:arrayToBase64(f.localSalt),payload:makePayload([f.record],{},3)};
  const head=await convertFolderCopy(original,f.localKey,f.folderKey);
  head.parent='prior';
  const snapshot={notes:[f.record],meta:{revision:2,folderSyncedRevision:2,folderSeenRev:2,folderSyncedHash:'prior'}};
  const state={head,candidates:[],divergent:false,otherSalt:[],unreadable:[],tooLarge:[]};
  assert.equal(await decideSaltAction(snapshot,state,f.localKey,f.folderKey),'pull');
  assert.equal(await decideSaltAction({...snapshot,meta:{...snapshot.meta,revision:3,folderSyncedVersions:{}}},state,f.localKey,f.folderKey),'merge');
  assert.equal(await decideSaltAction(snapshot,{...state,divergent:true},f.localKey,f.folderKey),'conflict');
  assert.equal(await decideSaltAction({...snapshot,meta:{...snapshot.meta,folderSeenRev:4}},state,f.localKey,f.folderKey),'rollback');
  assert.equal(await decideSaltAction({...snapshot,meta:{}},state,f.localKey,f.folderKey),'adopt');
  assert.equal(await decideSaltAction({...snapshot,meta:{...snapshot.meta,folderSyncedHash:'new'}},state,f.localKey,f.folderKey),'adopt');
});

test('H2b.0 salt access converts both sides while retaining the original guarded snapshot',async()=>{
  const {createSaltAccess}=await import('../../js/folder-salt-access.js');
  const f=await fixture();
  const foreign={salt:arrayToBase64(f.folderSalt),key:f.folderKey};
  const snapshot={notes:[f.record],meta:{salt:arrayToBase64(f.localSalt),vaultId:crypto.randomUUID()}};
  const converted=await (await import('../../js/folder-salt.js')).convertFolderRecords([f.record],f.localKey,f.folderKey);
  const bytes=await encodeV2(f.folderKey,f.folderSalt,makePayload(converted,{},3));
  const handle=directory({[MAIN_FILE]:bytes});
  handle.getFileHandle=async()=>({getFile:async()=>new Blob([bytes])});
  const access=await createSaltAccess({handle,snapshot,key:f.localKey,foreign,target:'folder',signal:new AbortController().signal});
  assert.equal(access.sessionKey,f.localKey);
  assert.equal(access.salt,foreign.salt);
  assert.equal(access.snapshot.meta,snapshot.meta);
  assert.deepEqual(await decryptRecords(access.snapshot.notes,f.folderKey),[f.value]);
  const state=await access.scan();
  assert.equal((await access.readCopy(state.head)).hash,state.head.hash);
  assert.deepEqual(await decryptRecords(state.head.payload.notes,f.folderKey),[f.value]);
  assert.deepEqual(Object.keys(access.meta).sort(),['keyCheck','salt']);
  assert.equal(JSON.stringify(access.meta).includes(f.value.title),false);
});

test('H2b.1 folder stamps detect a salt change even when the plaintext payload hash is unchanged',async()=>{
  const {folderStamp}=await import('../../js/folder-write.js');
  const state={candidates:[{name:MAIN_FILE,status:'valid',hash:'same',rev:2,salt:'old'}]};
  assert.notEqual(folderStamp(state),folderStamp({...state,candidates:[{...state.candidates[0],salt:'new'}]}));
});

test('H2b.2 direct replacement requires every receipt, version and lineage proof',async()=>{
  const {canLoadChangedFolder}=await import('../../js/folder-login.js');
  const snapshot={notes:[{id:'one',updatedAt:42}],meta:{salt:'local',revision:4,folderSyncedRevision:4,
    folderSyncedHash:'shared',folderSyncedClock:{[writer]:1},folderSyncedVersions:{one:42},folderSeenRev:2}};
  const state={head:{hash:'new',parent:'shared',rev:3,payload:{notes:snapshot.notes,clock:{[writer]:2}}},
    candidates:[{name:MAIN_FILE,status:'valid',salt:'foreign'}],otherSalt:[],unreadable:[],tooLarge:[],divergent:false};
  assert.equal(canLoadChangedFolder(snapshot,state),true);
  const omitted={...state,head:{...state.head,payload:{...state.head.payload,notes:[]}}};
  assert.equal(canLoadChangedFolder(snapshot,omitted),false,'A new password does not prove deletion');
  for(const patch of [
    {folderSyncedHash:undefined},{folderSyncedVersions:undefined},{revision:5},
    {folderSyncedVersions:{one:41}},{folderSyncedVersions:{two:42}},{folderSeenRev:4},
  ])assert.equal(canLoadChangedFolder({...snapshot,meta:{...snapshot.meta,...patch}},state),false);
  assert.equal(canLoadChangedFolder({...snapshot,notes:[]},state),false);
  assert.equal(canLoadChangedFolder(snapshot,{...state,divergent:true}),false);
  assert.equal(canLoadChangedFolder(snapshot,{...state,limitExceeded:true}),false);
  assert.equal(canLoadChangedFolder(snapshot,{...state,head:{...state.head,parent:null,payload:{}}}),false);
  assert.equal(canLoadChangedFolder(snapshot,{...state,candidates:[...state.candidates,{name:'local-copy.keeplocal',status:'otherSalt',salt:'local'}]}),false);
});

test('H2b.3 foreign-envelope changes with the same salt change the folder stamp',async()=>{
  const {folderStamp}=await import('../../js/folder-write.js');
  const f=await fixture();
  const one=await encodeV2(f.folderKey,f.folderSalt,makePayload([],{},3));
  const two=await encodeV2(f.folderKey,f.folderSalt,makePayload([],{},4));
  const first=await readFolderState(directory({[MAIN_FILE]:one}),f.localKey,arrayToBase64(f.localSalt));
  const second=await readFolderState(directory({[MAIN_FILE]:two}),f.localKey,arrayToBase64(f.localSalt));
  assert.notEqual(folderStamp(first),folderStamp(second));
});
