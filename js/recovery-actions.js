import { validateNote } from './note-model.js';
import { exportBackup,setUnsaved } from './backup.js';
import { discardPreservedRecord,readVault } from './db.js';
import { payloadHash } from './backup-v2.js';
import { getSessionKey,getSessionVaultId } from './session.js';
import { publishVaultEvent } from './vault-events.js';
import { t } from './i18n.js';
const receipts = new WeakMap();
const changed = () => Object.assign(Error('recovery.changed'), {code:'recovery.changed'});
const serialize = vault => JSON.stringify(vault);
async function assertSession(key,signal) {
  if(signal?.aborted||!key||key!==await getSessionKey())throw Object.assign(Error('session.ended'),{code:'session.ended'});
}
export function recoveredNote(text) {
  const now=Date.now();
  return validateNote({id:crypto.randomUUID(),type:'text',title:t('recovery.newTitle'),content:text,color:'default',pinned:false,labels:[],createdAt:now,updatedAt:now,order:0,deletedAt:null,archivedAt:null});
}
export function forgetDiscardReceipt(receipt) { receipts.delete(receipt); }
export async function exportForDiscard(record,{signal,key}={}) {
  await assertSession(key,signal);
  const archive=await exportBackup({recovery:true});
  await assertSession(key,signal);
  const current=await readVault(),recordJSON=JSON.stringify(record);
  if(!archive||archive.meta.vaultId!==getSessionVaultId()||!archive.notes.some(r=>JSON.stringify(r)===recordJSON))throw changed();
  if(['salt','vaultId','revision','exportRev','exportParent'].some(name=>current.meta[name]!==archive.meta[name])||await payloadHash(JSON.stringify(current.notes))!==await payloadHash(JSON.stringify(archive.notes)))throw changed();
  const snapshotJSON=serialize(current),receipt=Object.freeze({unreadableCount:archive.unreadableCount});
  receipts.set(receipt,{key,meta:current.meta,recordJSON,snapshotJSON,hash:await payloadHash(snapshotJSON)});
  await assertSession(key,signal);return receipt;
}
async function requireReceipt(record,receipt,{signal,key}={}) {
  await assertSession(key,signal);
  const saved=receipts.get(receipt);
  if(!saved||saved.key!==key||saved.meta.vaultId!==getSessionVaultId()||saved.recordJSON!==JSON.stringify(record))throw changed();
  if(await payloadHash(serialize(await readVault()))!==saved.hash){forgetDiscardReceipt(receipt);throw changed();}
  await assertSession(key,signal);return saved;
}
export async function validateDiscardReceipt(record,receipt,options) {
  await requireReceipt(record,receipt,options);return true;
}
export async function discardRecord(record,confirmation,{signal,key,receipt,confirmedSaved=false}={}) {
  if(confirmation!==t('recovery.discardWord'))throw Object.assign(Error('recovery.confirmRequired'),{code:'recovery.confirmRequired'});
  if(confirmedSaved!==true)throw Object.assign(Error('recovery.confirmSavedRequired'),{code:'recovery.confirmSavedRequired'});
  try{
    const saved=await requireReceipt(record,receipt,{signal,key});
    await discardPreservedRecord(record,saved.meta,{signal,snapshotJSON:saved.snapshotJSON});
  }finally{forgetDiscardReceipt(receipt);}
  setUnsaved();publishVaultEvent('note-changed',{id:record.id});return true;
}
