import assert from 'node:assert/strict';
import {withArchivedProfile2} from './archived-profile2.mjs';
import {decodeV2,encodeV2,makePayload,payloadHash} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';
import {arrayToBase64,deriveKey,encrypt,generateSalt} from '../../js/crypto.js';

for(const ref of ['a968ee2','47310be']){
  await withArchivedProfile2(ref,async({backup:old,format:oldFormat})=>{
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
    assert.deepEqual(legacy.payload.clock,{});
    assert.deepEqual(await decryptRecords(legacy.payload.notes,legacy.key),[note]);

    const parent=await payloadHash(legacy.payloadText);
    const tombstones=[{id:crypto.randomUUID(),deletedAt:now}];
    const clock={[crypto.randomUUID()]:12};
    const payload=makePayload(records,{},2,parent,tombstones,[],clock);
    const newer=await old.decodeV2(await encodeV2(key,salt,payload),password);
    assert.deepEqual(newer.payload.ancestors,[parent]);
    assert.deepEqual(newer.payload.tombstones,tombstones);
    assert.deepEqual(newer.payload.clock,clock);
    oldFormat.validateRecords(newer.payload.notes);
    assert.deepEqual(await oldFormat.decryptRecords(newer.payload.notes,newer.key),[note]);
    console.log(`PASS archived master ${ref} opens profile 2 with ancestors, tombstones and clock in both reader directions`);
  });
}
