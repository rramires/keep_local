import test from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import {deriveKey,encrypt,decrypt,generateSalt,arrayToBase64,base64ToArray} from '../../js/crypto.js';
import {validatePassword} from '../../js/auth.js';
import {createHistory} from '../../js/history.js';
test('AES-GCM round trip and wrong key rejection',async()=>{const key=await deriveKey('Fictitious Vault Phrase 42!',generateSalt());const value='Fictitious á 🚀';const {iv,ciphertext}=await encrypt(key,value);assert.equal(await decrypt(key,iv,ciphertext),value);await assert.rejects(decrypt(await deriveKey('wrong',generateSalt()),iv,ciphertext));});
test('base64 byte round trip',()=>{const a=Uint8Array.from([0,255,1,128]);assert.deepEqual(base64ToArray(arrayToBase64(a)),a);});
test('password validation rejects short passwords',()=>assert.equal(validatePassword('a').valid,false));
test('history round trip',()=>{const h=createHistory('a');h.push('b');assert.equal(h.undo(),'a');assert.equal(h.redo(),'b');});
for(const file of ['model.js','backup.js','session.js','security.js','password-policy.js','note-write-queue.js','queue-fuzz.js','vault-model.js','db-write-mode.js','folder-vault.js']){if(existsSync(new URL(file,import.meta.url)))await import('./'+file);}

test('large base64 and unique IV authentication',async()=>{for(const size of [65536,131072,1048576]){const bytes=new Uint8Array(size).fill(193);assert.deepEqual(base64ToArray(arrayToBase64(bytes)),bytes);}const key=await deriveKey('test',generateSalt());const a=await encrypt(key,'á🚀'),b=await encrypt(key,'á🚀');assert.notDeepEqual(a.iv,b.iv);const changed=new Uint8Array(a.ciphertext);changed[0]^=1;await assert.rejects(decrypt(key,a.iv,changed));});
test('passphrase policy accepts length without composition and rejects common phrases',()=>{for(const pw of ['Senha123!','short','passwordpassword','1234567890123456','aaaaaaaaaaaaaa',' '.repeat(14),'🚀'.repeat(14)])assert.equal(validatePassword(pw).valid,false,pw);for(const pw of ['cafe chuva livro rio','four words enough here'])assert.equal(validatePassword(pw).valid,true,pw);});
