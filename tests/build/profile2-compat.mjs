import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decodeV2,encodeV2,makePayload,payloadHash} from '../../js/backup-v2.js';
import {decryptRecords,validateRecords} from '../../js/backup-format.js';
import {arrayToBase64,deriveKey,encrypt,generateSalt} from '../../js/crypto.js';

const root=fileURLToPath(new URL('../..',import.meta.url));
const directory=await mkdtemp(join(tmpdir(),'keeplocal-profile2-'));
try {
  const archive=execFileSync('git',['archive','a968ee2','js'],{cwd:root});
  execFileSync('tar',['-xf','-','-C',directory],{input:archive});
  const old=await import(pathToFileURL(join(directory,'js/backup-v2.js')));
  const oldFormat=await import(pathToFileURL(join(directory,'js/backup-format.js')));
  const password='Fictitious compatibility test password';
  const salt=generateSalt(),key=await deriveKey(password,salt);
  const now=Date.now();
  const note={id:crypto.randomUUID(),type:'text',title:'Fictional profile 2 note',content:'Example',
    updatedAt:now,createdAt:now,color:'default',pinned:false,labels:[],deletedAt:null,archivedAt:null,order:0};
  const {iv,ciphertext}=await encrypt(key,JSON.stringify(note));
  const records=[{id:note.id,updatedAt:now,iv:arrayToBase64(iv),ciphertext:arrayToBase64(new Uint8Array(ciphertext))}];
  const oldBytes=await old.encodeV2(key,salt,old.makePayload(records,{},1));
  const legacy=await decodeV2(oldBytes,password);
  assert.deepEqual(legacy.payload.ancestors,[]);
  assert.deepEqual(legacy.payload.tombstones,[]);
  assert.deepEqual(await decryptRecords(legacy.payload.notes,legacy.key),[note]);

  const parent=await payloadHash(legacy.payloadText);
  const tombstones=[{id:crypto.randomUUID(),deletedAt:now}];
  const payload=makePayload(records,{},2,parent,tombstones);
  const newer=await old.decodeV2(await encodeV2(key,salt,payload),password);
  assert.deepEqual(newer.payload.ancestors,[parent]);
  assert.deepEqual(newer.payload.tombstones,tombstones);
  oldFormat.validateRecords(newer.payload.notes);
  assert.deepEqual(await oldFormat.decryptRecords(newer.payload.notes,newer.key),[note]);
  console.log('PASS archived master a968ee2 opens profile 2 with ancestors and tombstones in both reader directions');
} finally {
  await rm(directory,{recursive:true,force:true});
}
