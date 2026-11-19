import { deriveKey, encrypt, decrypt, base64ToArray } from './crypto.js';
import { MAX_BACKUP_NOTES, MAX_BACKUP_BYTES } from './backup-format.js';

export const BACKUP_PROFILES=Object.freeze([Object.freeze({id:2,iterations:600000})]);
export function validateProfile(profile) {
  if(!Number.isSafeInteger(profile.id)||profile.id<1||profile.id>255||!Number.isSafeInteger(profile.iterations)||profile.iterations<600000||profile.iterations>5000000)throw new Error('backup.profile');
}
export function backupAAD(profile,salt,iv){validateProfile(profile);return new Uint8Array([profile.id,...salt,...iv]);}
export function validatePayload(payload,profile) {
  if(!payload||payload.v!==2||payload.profile!==profile.id||!Number.isSafeInteger(payload.rev)||payload.rev<0||(payload.parent!==null&&!/^[a-f0-9]{64}$/.test(payload.parent))||typeof payload.exportedAt!=='string'||!Number.isFinite(Date.parse(payload.exportedAt)))throw new Error('backup.invalidFile');
  const prefs=payload.preferences;
  if(!prefs||Object.keys(prefs).some(k=>!['theme','lang'].includes(k))||(prefs.lang!==undefined&&!['en','pt-BR'].includes(prefs.lang))||(prefs.theme!==undefined&&!['light','dark'].includes(prefs.theme)))throw new Error('backup.invalidFile');
  // Archive decoding preserves damaged records; strict record checks belong to import.
  if(!Array.isArray(payload.notes)||payload.notes.length>MAX_BACKUP_NOTES||payload.notes.some(n=>!n||typeof n!=='object'))throw new Error('backup.invalidFile');
  const manifest=payload.manifest,ids=payload.notes.map(n=>n.id);
  if(!manifest||manifest.count!==ids.length||JSON.stringify(manifest.ids)!==JSON.stringify(ids))throw new Error('backup.manifest');
  return payload;
}
export async function encodeV2(key,salt,payload,profile=BACKUP_PROFILES[0]) {
  validateProfile(profile);validatePayload(payload,profile);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const text=JSON.stringify(payload);
  if(new TextEncoder().encode(text).length+44>MAX_BACKUP_BYTES)throw new Error('backup.tooLarge');
  const {ciphertext}=await encrypt(key,text,backupAAD(profile,salt,iv),iv);
  const bytes=new Uint8Array(28+ciphertext.byteLength);bytes.set(salt);bytes.set(iv,16);bytes.set(new Uint8Array(ciphertext),28);
  if(bytes.length>MAX_BACKUP_BYTES)throw new Error('backup.tooLarge');
  return bytes;
}
export async function decodePayloadV2(bytes,key,profile) {
  if(bytes.length<44||bytes.length>MAX_BACKUP_BYTES)throw new Error('backup.invalidFile');
  const salt=bytes.subarray(0,16),iv=bytes.subarray(16,28),ciphertext=bytes.subarray(28);
  const payloadText=await decrypt(key,iv,ciphertext,backupAAD(profile,salt,iv));
  return {payload:validatePayload(JSON.parse(payloadText),profile),payloadText};
}

export async function decodeV2(bytes,password) {
  if(bytes.length<44||bytes.length>MAX_BACKUP_BYTES)throw new Error('backup.invalidFile');
  const salt=bytes.slice(0,16);
  for(const profile of BACKUP_PROFILES){
    validateProfile(profile);
    const key=await deriveKey(password,salt,false,profile.iterations);
    try {
      return {key,salt,profile,...await decodePayloadV2(bytes,key,profile)};
    } catch {}
  }
  throw new Error('backup.wrongPasswordOrCorrupted');
}
export function makePayload(notes,preferences,rev=0,parent=null){
  return {v:2,profile:BACKUP_PROFILES[0].id,rev,parent,exportedAt:new Date().toISOString(),preferences,notes,manifest:{count:notes.length,ids:notes.map(n=>n.id)}};
}

export async function payloadHash(text){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');}
