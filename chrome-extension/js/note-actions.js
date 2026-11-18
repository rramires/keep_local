import { validateNote } from './note-model.js';
import { encrypt,arrayToBase64,arrayBufferToBase64 } from './crypto.js';
import { guardedNoteBatch } from './db.js';
export function planNoteChange(note,change,captured) {
  const next=structuredClone(captured||note),before=structuredClone(next);change(next);
  const fields=Object.fromEntries(Object.keys(next).filter(k=>JSON.stringify(next[k])!==JSON.stringify(before[k])).map(k=>[k,structuredClone(next[k])]));
  return {source:note,next,fields};
}
export async function persistNoteBatch(plans,{enqueue,getVersion,key,vaultId,signal,onCommitted=()=>{},assertCurrent=()=>{},replan=()=>{}}) {
  const ids=[...new Set(plans.map(p=>p.next.id))].sort();
  const lock=index=>index<ids.length?enqueue(ids[index],()=>lock(index+1)):write();
  const write=async()=>{
    if(signal?.aborted)throw Error('session.ended');
    assertCurrent();replan();assertCurrent();
    const records=[];
    for(const {next} of plans){
      const known=getVersion(next.id);
      if(known!==undefined&&next.updatedAt!==known)throw Object.assign(Error('note.conflict'),{code:'note.conflict'});
      next.updatedAt=Math.max(Date.now(),(known||0)+1);validateNote(next);
      const {iv,ciphertext}=await encrypt(key,JSON.stringify(next));
      records.push({id:next.id,knownUpdatedAt:known,record:{id:next.id,updatedAt:next.updatedAt,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext)}});
    }
    assertCurrent();
    await guardedNoteBatch(records,{expectedVaultId:vaultId,signal});
    onCommitted();
  };
  await lock(0);
}

export function replaceExistingNotes(notes,plans) {
  const replacements=new Map(plans.map(({next})=>[next.id,next]));
  if(plans.some(({next})=>!notes.some(note=>note.id===next.id)))throw Object.assign(Error('note.conflict'),{code:'note.conflict'});
  return notes.map(note=>replacements.get(note.id)||note);
}
