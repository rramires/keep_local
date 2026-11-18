import {generateSalt,deriveKey,encrypt,arrayToBase64,arrayBufferToBase64} from '../../js/crypto.js';
import {makePayload,encodeV2,backupAAD,BACKUP_PROFILES} from '../../js/backup-v2.js';
import {note,PASSWORD} from './harness.mjs';
export async function backupFixture(values=[note({title:'Fixture A'}),note({title:'Fixture B'})],password=PASSWORD,salt=generateSalt()){
 const key=await deriveKey(password,salt),records=[];
 for(const value of values){const{iv,ciphertext}=await encrypt(key,JSON.stringify(value));records.push({id:value.id,updatedAt:value.updatedAt,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext)});}
 const payload=makePayload(records,{}),bytes=await encodeV2(key,salt,payload);
 // Deliberately bypass payload validation only to fabricate authenticated hostile files.
 const seal=async value=>{const iv=crypto.getRandomValues(new Uint8Array(12)),{ciphertext}=await encrypt(key,JSON.stringify(value),backupAAD(BACKUP_PROFILES[0],salt,iv),iv);return Buffer.concat([salt,iv,new Uint8Array(ciphertext)]).toString('base64');};
 return {values,records,payload,bytes,base64:Buffer.from(bytes).toString('base64'),seal};
}
export const importExpression=(base64,password=PASSWORD)=>`await(await import('./js/backup.js')).importBackup(new File([(await import('./js/crypto.js')).base64ToArray(${JSON.stringify(base64)})],'fixture.keeplocal'),${JSON.stringify(password)})`;
