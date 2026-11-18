import { base64ToArray, decrypt } from './crypto.js';
import { validateNote, MAX_NOTE_BYTES, UUID } from './note-model.js';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_NOTES = 10000;
const invalid = () => { throw new Error('backup.unrecognizedFormat'); };
export function base64Bytes(value, min, max = min) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) invalid();
  const bytes = base64ToArray(value);
  if (bytes.length < min || bytes.length > max) invalid();
  return bytes;
}
export function validateV1(backup) {
  if (!backup || backup.app !== 'KeepLocal' || backup.version !== 1 || !Array.isArray(backup.meta) || !Array.isArray(backup.notes) || backup.notes.length > MAX_BACKUP_NOTES || backup.meta.length > 5) invalid();
  const meta = {};
  for (const m of backup.meta) {
    if (!m || !['salt','passwordVerifier','keyCheck','theme','lang'].includes(m.key) || Object.hasOwn(meta,m.key)) invalid();
    meta[m.key] = m.value;
  }
  base64Bytes(meta.salt,16);
  if (meta.passwordVerifier !== undefined) base64Bytes(meta.passwordVerifier,32);
  if (meta.keyCheck) { base64Bytes(meta.keyCheck.iv,12);base64Bytes(meta.keyCheck.ct,16,256); }
  if (!meta.keyCheck && !meta.passwordVerifier) invalid();
  if (meta.theme !== undefined && !['light','dark'].includes(meta.theme)) invalid();
  if (meta.lang !== undefined && !['en','pt-BR'].includes(meta.lang)) invalid();
  validateRecords(backup.notes);
  return meta;
}
export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_BACKUP_NOTES) invalid();
  const ids = new Set();
  for (const r of records) {
    if (!r || (typeof r.id!=='string'||!UUID.test(r.id)) || ids.has(r.id) || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0) invalid();
    ids.add(r.id);base64Bytes(r.iv,12);base64Bytes(r.ciphertext,16,MAX_NOTE_BYTES+16);
  }
}
export async function decryptRecords(records,key) {
  const notes=[];
  for (const r of records) {
    let text,note;
    try{text=await decrypt(key,base64ToArray(r.iv),base64ToArray(r.ciphertext));}
    catch{throw Object.assign(new Error('record.decrypt'),{code:'record.decrypt'});}
    try{note=validateNote(JSON.parse(text));if(note.id!==r.id||note.updatedAt!==r.updatedAt)invalid();}
    catch{throw Object.assign(new Error('record.unreadable'),{code:'record.unreadable'});}
    notes.push(note);
  }
  return notes;
}
