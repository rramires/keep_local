import test from 'node:test';import assert from 'node:assert/strict';
const records=[1,2].map(updatedAt=>({id:crypto.randomUUID(),updatedAt,iv:btoa('0'.repeat(12)),ciphertext:btoa('0'.repeat(16))}));
import {encodeV2,decodeV2,makePayload,validateProfile,validatePayload,BACKUP_PROFILES} from '../../js/backup-v2.js';import {deriveKey,generateSalt} from '../../js/crypto.js';
test('binary v2 envelope authenticates salt, IV, ciphertext and manifest',async()=>{const salt=generateSalt(),key=await deriveKey('fictional',salt),payload=makePayload([],{},7),bytes=await encodeV2(key,salt,payload);assert.deepEqual(bytes.slice(0,16),salt);assert.deepEqual((await decodeV2(bytes,'fictional')).payload,payload);assert.equal(new TextDecoder().decode(bytes).includes('KeepLocal'),false);for(const offset of [0,16,28,bytes.length-1]){const changed=bytes.slice();changed[offset]^=1;await assert.rejects(decodeV2(changed,'fictional'));}await assert.rejects(decodeV2(bytes,'wrong'));for(const n of [0,599999,5000001,Infinity])assert.throws(()=>validateProfile({id:2,iterations:n}));assert.throws(()=>validatePayload({...payload,manifest:{count:1,ids:[]}},BACKUP_PROFILES[0]));});

test('v2 manifest rejects removed, duplicated and reordered records',()=>{const payload=makePayload(records,{});for(const notes of [payload.notes.slice(1),[payload.notes[0],payload.notes[0]],[...payload.notes].reverse()])assert.throws(()=>validatePayload({...payload,notes},BACKUP_PROFILES[0]));});
import {validateRecords} from '../../js/backup-format.js';
test('binary archive preserves unreadable records while import validation remains strict',async()=>{const record={id:crypto.randomUUID(),iv:'AAAA',ciphertext:'AAAA',updatedAt:1};const salt=generateSalt(),key=await deriveKey('archive fixture',salt);const bytes=await encodeV2(key,salt,makePayload([record],{}));assert.deepEqual((await decodeV2(bytes,'archive fixture')).payload.notes,[record]);assert.throws(()=>validateRecords([record]));});

test('H2a.1 the optional deletion list is sorted and validated independently of the manifest',()=>{
  const [first,second]=records.map(record=>({id:record.id,deletedAt:record.updatedAt})).sort((a,b)=>a.id.localeCompare(b.id));
  const payload=makePayload(records,{},4,null,[second,first]);
  assert.deepEqual(payload.tombstones,[first,second]);
  assert.deepEqual(payload.manifest.ids,records.map(record=>record.id));
  const {tombstones,...legacy}=payload;
  assert.deepEqual(validatePayload(legacy,BACKUP_PROFILES[0]).tombstones,[]);
  for(const invalid of [null,{},'deleted',Array(10001).fill(first),[null],[{id:'bad',deletedAt:1}],
    [{id:first.id,deletedAt:-1}],[{id:first.id,deletedAt:1.5}],[{id:first.id,deletedAt:'yesterday'}]]){
    assert.throws(()=>validatePayload({...legacy,tombstones:invalid},BACKUP_PROFILES[0]),/backup.invalidFile/);
  }
});

test('H2a.7a profile 2 links up to 32 ancestors, newest first',()=>{
  const hashes=Array.from({length:34},(_,i)=>i.toString(16).padStart(64,'0'));
  const [parent,...older]=hashes;
  const payload=makePayload(records,{},40,parent,[],[null,...older]);
  assert.deepEqual(payload.ancestors,hashes.slice(0,32));
  assert.equal(validatePayload(payload,BACKUP_PROFILES[0]),payload);
  const {ancestors,tombstones,...legacy}=payload;
  assert.deepEqual(validatePayload(legacy,BACKUP_PROFILES[0]).ancestors,[]);
  assert.deepEqual(makePayload([],{}).ancestors,[]);
});

test('H2a.7a profile 2 rejects malformed ancestor lists',()=>{
  const payload=makePayload([],{});
  const hash='a'.repeat(64);
  for(const ancestors of [null,undefined,{},hash,[null],[42],[hash.toUpperCase()],[hash.slice(1)],
    Array(1),Array(33).fill(hash)]){
    assert.throws(()=>validatePayload({...payload,ancestors},BACKUP_PROFILES[0]),/backup.invalidFile/);
  }
});
