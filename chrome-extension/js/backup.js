// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { replaceVault, getMeta, readVault, recordExport, acknowledgeDownload } from './db.js';
import { deriveKey, hashPassword, createKeyCheck, verifyKeyCheck, base64ToArray, arrayToBase64 } from './crypto.js';
import { encodeV2, decodeV2, makePayload, payloadHash } from './backup-v2.js';
import { publishVaultEvent } from './vault-events.js';
import { getSessionKey, getSessionVaultId, storeSessionKey, getSessionSignal } from './session.js';
import { t } from './i18n.js';
import { unreadableRecords } from './record-health.js';
import { MAX_BACKUP_BYTES, validateV1, decryptRecords, validateRecords } from './backup-format.js';

let unsavedChanges = false;
const drafts=new Set();
export function setDraftDirty(id,dirty){if(dirty)drafts.add(id);else drafts.delete(id);}
export function clearDrafts(){drafts.clear();}
export async function refreshBackupState(){unsavedChanges=!!await getMeta('dirtySinceBackup');}


export function setUnsaved() {
  unsavedChanges = true;
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
    if (isUnsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export async function exportBackup({recovery=false}={}) {
  const key=await getSessionKey(),vaultId=getSessionVaultId(),signal=getSessionSignal();
  if(!key)throw new Error(t('login.noAccount'));
  const assertCurrent=async()=>{if(signal?.aborted||key!==await getSessionKey()||vaultId!==getSessionVaultId())throw new Error(t('session.exportCancelled'));};
  const {notes,meta}=await readVault();
  if(meta.vaultId!==getSessionVaultId())throw new Error(t('vault.changed'));
  const unreadableCount=(await unreadableRecords(notes,key)).length;
  await assertCurrent();
  if(unreadableCount&&!recovery&&!window.confirm(t('backup.unreadableConfirm',{count:unreadableCount})))return null;
  const preferences=Object.fromEntries(['theme','lang'].filter(k=>meta[k]!==undefined).map(k=>[k,meta[k]]));
  const rev=(meta.exportRev||0)+1;
  if(!Number.isSafeInteger(rev))throw new Error(t('backup.invalidFile'));
  const payload=makePayload(notes,preferences,rev,meta.exportParent||null);
  const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
  const hash=await payloadHash(JSON.stringify(payload));
  await assertCurrent();
  await recordExport(meta,rev,hash,{signal});
  await assertCurrent();
  const blob=new Blob([bytes],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`keeplocal-backup-${new Date().toISOString().slice(0,10)}.keeplocal`;
  try{document.body.appendChild(a);a.click();}finally{a.remove();URL.revokeObjectURL(url);}
  await assertCurrent();
  const clean=await acknowledgeDownload(meta,Date.now(),{signal});
  unsavedChanges=!clean;
  return {unreadableCount,meta:{...meta,exportRev:rev,exportParent:hash},notes};
}

export async function importBackup(file, password) {
  if (!file || file.size > MAX_BACKUP_BYTES) throw new Error(t('backup.tooLarge'));
  let backup,meta,key,legacy=false;
  const bytes=new Uint8Array(await file.arrayBuffer());
  const prefix=new TextDecoder().decode(bytes.slice(0,256)).trimStart();
  let parsed;
  if(prefix.startsWith('{')){try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{}}
  if(parsed!==undefined){
    legacy=true;
    try {backup=parsed;meta=validateV1(backup);}
    catch {throw new Error(t('backup.unrecognizedFormat'));}
    const salt=base64ToArray(meta.salt);key=await deriveKey(password,salt,false);
    if(meta.keyCheck&&!await verifyKeyCheck(key,meta.keyCheck))throw new Error(t('backup.wrongPassword'));
    if(!meta.keyCheck&&!backup.notes.length&&await hashPassword(password,salt)!==meta.passwordVerifier)throw new Error(t('backup.wrongPassword'));
    delete meta.passwordVerifier;
  }else{
    let decoded;
    try {decoded=await decodeV2(bytes,password);}
    catch(error){throw new Error(t(error.message));}
    key=decoded.key;backup={notes:decoded.payload.notes};
    meta={...decoded.payload.preferences,salt:arrayToBase64(decoded.salt),exportRev:decoded.payload.rev,exportParent:await payloadHash(decoded.payloadText)};
  }
  try {validateRecords(backup.notes);await decryptRecords(backup.notes,key);}
  catch(error){throw new Error(t(legacy&&!meta.keyCheck&&error.code!=='record.unreadable'?'backup.wrongPasswordOrCorrupted':'backup.unreadableRecords'));}
  meta.keyCheck=await createKeyCheck(key);
  const previous=await readVault();
  const local=previous.notes;
  if ((local.length || await getMeta('salt')) && !window.confirm(t('backup.replaceConfirm',{local:local.length,incoming:backup.notes.length}))) throw new Error(t('backup.cancelled'));
  // V1 cannot authenticate removal of whole records; only v2 authenticates the set.
  meta.vaultId=crypto.randomUUID();meta.dirtySinceBackup=true;
  await replaceVault({notes:backup.notes,meta},previous.meta);
  storeSessionKey(key,meta.vaultId);publishVaultEvent('vault-replaced',{vaultId:meta.vaultId});
  if(legacy)window.alert(t('backup.legacyWarning'));
  return key;
}
