import { decrypt,base64ToArray } from './crypto.js';
import { validateNote } from './note-model.js';
import { validateRecords } from './backup-format.js';
export async function inspectRecord(record,key) {
  let text,reason='decrypt';
  try {
    text=await decrypt(key,base64ToArray(record.iv),base64ToArray(record.ciphertext));reason='json';
    const value=JSON.parse(text);reason='model';
    validateRecords([record]);const note=validateNote(value);
    if(note.id!==record.id||note.updatedAt!==record.updatedAt)throw Error();
    return {note,text};
  } catch(error) {return {record,text,reason:error.code==='note.tooLarge'?'limit':reason};}
}
export async function unreadableRecords(records,key) {
  const issues=[];
  for(const record of records){const result=await inspectRecord(record,key);if(!result.note)issues.push(result);}
  return issues;
}
