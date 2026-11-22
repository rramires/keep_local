import {encrypt,arrayToBase64,arrayBufferToBase64} from './crypto.js';
import {decryptRecords} from './backup-format.js';
import {sameNotes} from './folder-merge.js';
import {descends} from './folder-clock.js';
import {decideFolderAction} from './folder-reconcile.js';

export function folderSaltTarget(meta,head) {
  if(!meta.folderSaltClock||Object.keys(meta.folderSaltClock).length===0)return 'folder';
  return descends(head,{clock:meta.folderSaltClock})?'folder':'local';
}

export async function convertFolderRecords(records,sourceKey,targetKey) {
  const notes=await decryptRecords(records,sourceKey);
  if(sourceKey===targetKey)return records;
  const converted=[];
  for(const note of notes){
    const {iv,ciphertext}=await encrypt(targetKey,JSON.stringify(note));
    converted.push({id:note.id,updatedAt:note.updatedAt,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext)});
  }
  return converted;
}

// The original hash describes the source plaintext payload, including its old ciphertext.
// Conversion prepares records for reconciliation without creating a new lineage head.
export async function convertFolderCopy(copy,sourceKey,targetKey) {
  return {...copy,payload:{...copy.payload,notes:await convertFolderRecords(copy.payload.notes,sourceKey,targetKey)}};
}

export async function convertFolderSnapshot(snapshot,sourceKey,targetKey) {
  return {...snapshot,notes:await convertFolderRecords(snapshot.notes,sourceKey,targetKey)};
}

export async function decideSaltAction(snapshot,state,localKey,folderKey) {
  let compared=state;
  if(state.head){
    const local=await decryptRecords(snapshot.notes,localKey);
    const remote=await decryptRecords(state.head.payload.notes,folderKey);
    if(sameNotes(local,remote)){
      compared={...state,head:{...state.head,payload:{...state.head.payload,notes:snapshot.notes}}};
    }
  }
  const decision=decideFolderAction(snapshot,compared);
  return decision==='saved'?'adopt':decision;
}
