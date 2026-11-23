import {confirmDialog} from './dialogs.js';
import {pruneTombstones} from './folder-merge.js';
import {folderUnloadWarning} from './folder-status.js';
import {folderFailure,withVaultLineage} from './folder-write.js';
import {getFolderCopy} from './folder-copy-view.js';
import {preserveLocalChoice} from './folder-preserve.js';
import {requireFolderSession} from './folder-reconcile.js';
import {probeFolder} from './folder-store.js';
// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { replaceVault, getMeta, readVault, recordExport, acknowledgeDownload, isReadOnly, assertWritable, vaultIdentity,verifyFolderWrite } from './db.js';
import { createKeyCheck, base64ToArray, arrayToBase64 } from './crypto.js';
import { encodeV2, decodeV2, makePayload, payloadHash } from './backup-v2.js';
import { publishVaultEvent } from './vault-events.js';
import { getSessionKey, getSessionVaultId, storeSessionKey, getSessionSignal } from './session.js';
import { t,tp } from './i18n.js';
import { unreadableRecords } from './record-health.js';
import { MAX_BACKUP_BYTES, decryptRecords, validateRecords } from './backup-format.js';
import {MAX_PHOTO_BYTES,photoParts,photoType} from './photo-trailer.js';

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
  if(getFolderCopy())return Promise.reject(new Error(t('vault.readOnly')));
  if(globalThis.location?.protocol==='chrome-extension:')return withVaultLineage(()=>makeBackupDownload(options));
  return makeBackupDownload(options);
}

async function makeBackupDownload({recovery=false,source}={}) {
  const sessionKey=await getSessionKey(),vaultId=getSessionVaultId(),signal=getSessionSignal();
  const key=source?.key??sessionKey;
  if(!key)throw new Error(t('login.noAccount'));
  if(source&&!isReadOnly())throw new Error(t('vault.changed'));
  const assertCurrent=async()=>{
    if(signal?.aborted||sessionKey!==await getSessionKey()||vaultId!==getSessionVaultId())throw new Error(t('session.exportCancelled'));
    if(source)await verifyFolderWrite(source.snapshot.meta,{signal,replaceLocal:true});
  };
  const {notes,meta}=source?.snapshot??await readVault();
  if(!source&&vaultIdentity(meta)!==vaultId)throw new Error(t('vault.changed'));
  const readOnly=isReadOnly();
  const unreadableCount=(await unreadableRecords(notes,key)).length;
  await assertCurrent();
  if(unreadableCount&&!recovery&&!await confirmDialog(tp('backup.unreadableConfirm',unreadableCount),{signal}))return null;
  const preferences=Object.fromEntries(['theme','lang'].filter(k=>meta[k]!==undefined).map(k=>[k,meta[k]]));
  const rev=(meta.exportRev||0)+1;
  if(!Number.isSafeInteger(rev))throw new Error(t('backup.invalidFile'));
  const payload=makePayload(notes,preferences,rev,meta.exportParent||null,pruneTombstones(meta.tombstones??[]),meta.exportAncestors,meta.exportClock);
  const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
  let receiptMeta=meta;
  if(!readOnly){
    const hash=await payloadHash(JSON.stringify(payload));
    await assertCurrent();
    await recordExport(meta,rev,hash,{signal,ancestors:payload.ancestors,clock:payload.clock});
    receiptMeta={...meta,exportRev:rev,exportParent:hash,exportAncestors:payload.ancestors,exportClock:payload.clock};
  }
  await assertCurrent();
  const blob=new Blob([bytes],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`keeplocal-backup-${new Date().toISOString().slice(0,10)}.keeplocal`;
  try{document.body.appendChild(a);a.click();}finally{a.remove();URL.revokeObjectURL(url);}
  await assertCurrent();
  if(!readOnly) unsavedChanges=!await acknowledgeDownload(receiptMeta,Date.now(),{signal});
  return {unreadableCount,meta:receiptMeta,notes};
}

async function decodeImportFile(file,password,signal) {
  if(!file)throw new Error(t('backup.tooLarge'));
  if(file.size>MAX_BACKUP_BYTES){
    if(!photoType(new Uint8Array(await file.slice(0,8).arrayBuffer())))throw new Error(t('backup.tooLarge'));
    if(file.size>MAX_PHOTO_BYTES)throw new Error(t('backup.photoTooLarge'));
  }
  signal?.throwIfAborted();
  const bytes=new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  if(photoType(bytes)){
    const copy=photoParts(bytes)?.copy;
    let copyError;
    if(copy){
      try{return await decodeV2(copy,password);}
      catch(error){copyError=error;}
    }
    // The unchanged binary format has no magic. A salt can start with these same bytes.
    signal?.throwIfAborted();
    if(bytes.length>=44&&bytes.length<=MAX_BACKUP_BYTES){
      try{return await decodeV2(bytes,password);}
      catch{}
    }
    throw new Error(t(copyError?.message??'backup.photoNoCopy'));
  }
  if(bytes.length<44)throw new Error(t('backup.unrecognizedFormat'));
  // Reject recognizable JSON documents, without interpreting any historical schema.
  // Random binary salt can start with '{' or '['; only a complete JSON parse rejects it.
  const prefix=new TextDecoder().decode(bytes.slice(0,256)).trimStart();
  let jsonDocument=false;
  if(/^[{[]/.test(prefix)){try{JSON.parse(new TextDecoder().decode(bytes));jsonDocument=true;}catch{}}
  if(jsonDocument)throw new Error(t('backup.unrecognizedFormat'));
  try{return await decodeV2(bytes,password);}catch(error){throw new Error(t(error.message));}
}

export async function importBackup(file,password,{signal}={}) {
  assertWritable();
  signal?.throwIfAborted();
  const decoded=await decodeImportFile(file,password,signal);
  signal?.throwIfAborted();
  const key=decoded.key,backup={notes:decoded.payload.notes};
  const meta={...decoded.payload.preferences,tombstones:decoded.payload.tombstones,salt:arrayToBase64(decoded.salt),
    exportRev:decoded.payload.rev,exportParent:await payloadHash(decoded.payloadText),
    exportAncestors:decoded.payload.ancestors,exportClock:decoded.payload.clock};
  try{validateRecords(backup.notes);await decryptRecords(backup.notes,key);}
  catch{throw new Error(t('backup.unreadableRecords'));}
  meta.keyCheck=await createKeyCheck(key);
  const previous=await readVault();
  const local=previous.notes;
  const connected=!!previous.meta.syncFolder;
  const importSignal=signal??(connected?getSessionSignal()??new AbortController().signal:undefined);
  if(local.length||previous.meta.salt){
    const message=t(connected?'backup.replaceConnected':'backup.replaceConfirm',{
      local:tp('backup.noteCount',local.length),incoming:tp('backup.noteCount',backup.notes.length),
    });
    if(!await confirmDialog(message,{danger:true,signal:importSignal}))throw new Error(t('backup.cancelled'));
  }
  meta.vaultId=crypto.randomUUID();meta.dirtySinceBackup=true;
  const replacement={notes:backup.notes,meta};
  if(connected){
    await withVaultLineage(async()=>{
      const snapshot=await readVault();
      const {syncFolder,vaultId,folderConnectionId,salt}=snapshot.meta;
      if(!syncFolder||vaultId!==previous.meta.vaultId||
          folderConnectionId!==previous.meta.folderConnectionId||salt!==previous.meta.salt)
        throw folderFailure('vault.changed');
      const sessionKey=await getSessionKey();
      if(!sessionKey)throw folderFailure('session.ended');
      await requireFolderSession(snapshot,sessionKey,importSignal);
      if(await probeFolder(syncFolder)!=='ok')throw folderFailure('backup.preserveConnectedFailed');
      await requireFolderSession(snapshot,sessionKey,importSignal);
      assertWritable();
      try{await preserveLocalChoice(syncFolder,snapshot,sessionKey,importSignal,{allowUnreadable:true});}
      catch{
        importSignal.throwIfAborted();
        throw folderFailure('backup.preserveConnectedFailed');
      }
      await replaceVault(replacement,snapshot.meta,{signal:importSignal});
    });
  }else{
    await replaceVault(replacement,previous.meta,{signal:importSignal});
  }
  if(!importSignal?.aborted)storeSessionKey(key,meta.vaultId);
  publishVaultEvent('vault-replaced',{vaultId:meta.vaultId});
  importSignal?.throwIfAborted();
  return key;
}
