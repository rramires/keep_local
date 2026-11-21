import {confirmDialog} from './dialogs.js';
import {pruneTombstones} from './folder-merge.js';
import {folderUnloadWarning} from './folder-status.js';
import {withVaultLineage} from './folder-write.js';
// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { replaceVault, getMeta, readVault, recordExport, acknowledgeDownload, isReadOnly, assertWritable, vaultIdentity } from './db.js';
import { createKeyCheck, base64ToArray, arrayToBase64 } from './crypto.js';
import { encodeV2, decodeV2, makePayload, payloadHash } from './backup-v2.js';
import { publishVaultEvent } from './vault-events.js';
import { getSessionKey, getSessionVaultId, storeSessionKey, getSessionSignal } from './session.js';
import { t,tp } from './i18n.js';
import { unreadableRecords } from './record-health.js';
import { MAX_BACKUP_BYTES, decryptRecords, validateRecords } from './backup-format.js';

let unsavedChanges = false;
const drafts=new Set();
export function setDraftDirty(id,dirty){if(dirty)drafts.add(id);else drafts.delete(id);}
export function clearDrafts(){drafts.clear();}
export function hasPendingDrafts(){return drafts.size>0;}
export async function refreshBackupState(){unsavedChanges=!!await getMeta('dirtySinceBackup');}


const localChanges=new Set();
export function watchLocalChanges(listener) {
  localChanges.add(listener);
  return ()=>localChanges.delete(listener);
}

export function setUnsaved() {
  unsavedChanges = true;
  for(const listener of localChanges)listener();
}

export function clearUnsaved() {
  unsavedChanges = false;
}

export function isUnsaved() {
  return unsavedChanges||drafts.size>0;
}

export async function initBeforeUnload() {
  await refreshBackupState();
  window.addEventListener('beforeunload', (e) => {
    const folderWarning=folderUnloadWarning();
    if (folderWarning===null?isUnsaved():folderWarning||hasPendingDrafts()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export function exportBackup(options) {
  if(globalThis.location?.protocol==='chrome-extension:')return withVaultLineage(()=>makeBackupDownload(options));
  return makeBackupDownload(options);
}

async function makeBackupDownload({recovery=false}={}) {
  const key=await getSessionKey(),vaultId=getSessionVaultId(),signal=getSessionSignal();
  if(!key)throw new Error(t('login.noAccount'));
  const assertCurrent=async()=>{if(signal?.aborted||key!==await getSessionKey()||vaultId!==getSessionVaultId())throw new Error(t('session.exportCancelled'));};
  const {notes,meta}=await readVault();
  if(vaultIdentity(meta)!==vaultId)throw new Error(t('vault.changed'));
  const readOnly=isReadOnly();
  const unreadableCount=(await unreadableRecords(notes,key)).length;
  await assertCurrent();
  if(unreadableCount&&!recovery&&!await confirmDialog(tp('backup.unreadableConfirm',unreadableCount),{signal}))return null;
  const preferences=Object.fromEntries(['theme','lang'].filter(k=>meta[k]!==undefined).map(k=>[k,meta[k]]));
  const rev=(meta.exportRev||0)+1;
  if(!Number.isSafeInteger(rev))throw new Error(t('backup.invalidFile'));
  const payload=makePayload(notes,preferences,rev,meta.exportParent||null,pruneTombstones(meta.tombstones??[]),meta.exportAncestors);
  const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
  let receiptMeta=meta;
  if(!readOnly){
    const hash=await payloadHash(JSON.stringify(payload));
    await assertCurrent();
    await recordExport(meta,rev,hash,{signal,ancestors:payload.ancestors});
    receiptMeta={...meta,exportRev:rev,exportParent:hash,exportAncestors:payload.ancestors};
  }
  await assertCurrent();
  const blob=new Blob([bytes],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`keeplocal-backup-${new Date().toISOString().slice(0,10)}.keeplocal`;
  try{document.body.appendChild(a);a.click();}finally{a.remove();URL.revokeObjectURL(url);}
  await assertCurrent();
  if(!readOnly) unsavedChanges=!await acknowledgeDownload(receiptMeta,Date.now(),{signal});
  return {unreadableCount,meta:receiptMeta,notes};
}

export async function importBackup(file, password) {
  assertWritable();
  if (!file || file.size > MAX_BACKUP_BYTES) throw new Error(t('backup.tooLarge'));
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.length<44)throw new Error(t('backup.unrecognizedFormat'));
  // Reject recognizable JSON documents, without interpreting any historical schema.
  // Random binary salt can start with '{' or '['; only a complete JSON parse rejects it.
  const prefix=new TextDecoder().decode(bytes.slice(0,256)).trimStart();
  let jsonDocument=false;
  if(/^[{[]/.test(prefix)){try{JSON.parse(new TextDecoder().decode(bytes));jsonDocument=true;}catch{}}
  if(jsonDocument)throw new Error(t('backup.unrecognizedFormat'));
  let decoded;
  try{decoded=await decodeV2(bytes,password);}catch(error){throw new Error(t(error.message));}
  const key=decoded.key,backup={notes:decoded.payload.notes};
  const meta={...decoded.payload.preferences,tombstones:decoded.payload.tombstones,salt:arrayToBase64(decoded.salt),
    exportRev:decoded.payload.rev,exportParent:await payloadHash(decoded.payloadText),exportAncestors:decoded.payload.ancestors};
  try{validateRecords(backup.notes);await decryptRecords(backup.notes,key);}
  catch{throw new Error(t('backup.unreadableRecords'));}
  meta.keyCheck=await createKeyCheck(key);
  const previous=await readVault();
  const local=previous.notes;
  if ((local.length || await getMeta('salt')) && !await confirmDialog(t('backup.replaceConfirm',{local:tp('backup.noteCount',local.length),incoming:tp('backup.noteCount',backup.notes.length)}),{danger:true})) throw new Error(t('backup.cancelled'));
  meta.vaultId=crypto.randomUUID();meta.dirtySinceBackup=true;
  await replaceVault({notes:backup.notes,meta},previous.meta);
  storeSessionKey(key,meta.vaultId);publishVaultEvent('vault-replaced',{vaultId:meta.vaultId});
  return key;
}
