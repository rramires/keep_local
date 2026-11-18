import {readVault,replaceVaultFromFolder,isReadOnly,setWriteMode,vaultIdentity} from './db.js';
import {getSessionKey,getSessionVaultId,storeSessionKey} from './session.js';
import {publishVaultEvent} from './vault-events.js';
import {MAIN_FILE,readFolderCandidate} from './folder-vault.js';
import {folderFailure,folderStamp,localFolderDirty,unsafeFolder} from './folder-write.js';

export function decideFolderAction(snapshot,state) {
  const {notes,meta}=snapshot;
  const {head}=state;
  if(unsafeFolder(state)){
    const main=state.candidates.find(row=>row.name===MAIN_FILE);
    return main?.status==='otherSalt'||(!head&&state.otherSalt.length)?'otherSalt':'unreadableCopy';
  }
  if(!head)return 'push';
  if(!state.divergent&&head.hash===meta.folderSyncedHash)return localFolderDirty(meta)?'push':'saved';
  if(head.rev<(meta.folderSeenRev||0))return 'rollback';
  if(state.divergent)return 'conflict';
  if(!meta.folderSyncedHash)return notes.length?'conflict':'pull';
  if(head.rev===(meta.folderSeenRev||0)||localFolderDirty(meta))return 'conflict';
  return 'pull';
}

export function folderLocalStamp({meta}) {
  return JSON.stringify(['salt','vaultId','revision','exportRev','exportParent','folderConnectionId',
    'folderSyncedHash','folderSyncedRevision','folderSeenRev','folderWrittenAt'].map(key=>meta[key]));
}

export async function requireFolderSession(snapshot,key,signal) {
  if(signal.aborted||key!==await getSessionKey()||signal.aborted||
     vaultIdentity(snapshot.meta)!==getSessionVaultId())throw folderFailure('session.ended');
}

export async function pullFolderHead(handle,head,snapshot,key,signal) {
  const copy=await readFolderCandidate(await handle.getFileHandle(head.name),key,snapshot.meta.salt);
  if(copy.status!=='valid'||copy.hash!==head.hash)throw folderFailure('folder.changed');
  await requireFolderSession(snapshot,key,signal);
  const previous=snapshot.meta,prefs=copy.payload.preferences;
  const revision=(previous.revision||0)+1,vaultId=crypto.randomUUID();
  const meta={
    ...previous,...prefs,vaultId,revision,dirtySinceBackup:true,
    exportRev:Math.max(previous.exportRev||0,copy.rev),exportParent:copy.hash,
    folderSyncedHash:copy.hash,folderSyncedRevision:revision,
    folderSeenRev:Math.max(previous.folderSeenRev||0,copy.rev),folderWrittenAt:Date.parse(copy.exportedAt),
  };
  for(const name of ['theme','lang'])if(!Object.hasOwn(prefs,name))delete meta[name];
  await replaceVaultFromFolder({notes:copy.payload.notes,meta},previous,{signal});
  if(signal.aborted)throw folderFailure('session.ended');
  storeSessionKey(key,vaultId);
  setWriteMode('readWrite');
  publishVaultEvent('vault-replaced',{vaultId});
  return {status:'pulled',head:copy};
}

export async function resolveFolderReview({handle,writer,review,choice,name,key,signal}) {
  const snapshot=await readVault();
  await requireFolderSession(snapshot,key,signal);
  if(!snapshot.meta.syncFolder||!await handle.isSameEntry(snapshot.meta.syncFolder))throw folderFailure('folder.changed');
  const state=await writer.scan(snapshot.meta.salt);
  if(folderLocalStamp(snapshot)!==folderLocalStamp(review.snapshot)||folderStamp(state)!==folderStamp(review.state))
    throw folderFailure('folder.changed');
  if(choice==='remote'){
    const head=state.candidates.find(row=>row.name===name&&row.status==='valid'&&row.rev===state.head.rev);
    if(!head)throw folderFailure('folder.changed');
    return pullFolderHead(handle,head,snapshot,key,signal);
  }
  const main=state.candidates.find(row=>row.name===MAIN_FILE);
  if(main?.status!=='valid'||unsafeFolder(state))throw folderFailure('folder.changed');
  const reading=isReadOnly();
  setWriteMode('readWrite');
  try {
    const parent=state.candidates.find(row=>row.name===name&&row.status==='valid'&&row.rev===state.head.rev);
    if(!parent)throw folderFailure('folder.changed');
    const result=await writer.write(snapshot,{...state,head:parent},{replace:true});
    return {status:'saved',result};
  }catch(error){
    if(reading&&!signal.aborted)setWriteMode('readOnly');
    throw error;
  }
}
