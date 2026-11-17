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
for(const file of ['model.js','backup.js','session.js','security.js']){if(existsSync(new URL(file,import.meta.url)))await import('./'+file);}
