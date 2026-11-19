import {readVault,replaceVaultFromFolder,isReadOnly,setWriteMode,vaultIdentity} from './db.js';
import {getSessionKey,getSessionVaultId,storeSessionKey} from './session.js';
import {publishVaultEvent} from './vault-events.js';
import {MAIN_FILE,readFolderCandidate} from './folder-vault.js';
import {preserveFolderChoice,preserveLocalChoice} from './folder-preserve.js';
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

async function readReviewedCopy(handle,head,key,salt) {
  const copy=await readFolderCandidate(await handle.getFileHandle(head.name),key,salt);
  if(copy.status!=='valid'||copy.hash!==head.hash)throw folderFailure('folder.changed');
  return {name:head.name,...copy};
}

export async function pullFolderHead(handle,head,snapshot,key,signal) {
  const copy=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
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
  const head=state.candidates.find(row=>row.name===name&&row.status==='valid'&&row.rev===state.head?.rev);
  if(!head||unsafeFolder(state))throw folderFailure('folder.changed');
  const main=state.candidates.find(row=>row.name===MAIN_FILE);
  if(choice==='remote'){
    const preserved=[await preserveLocalChoice(handle,snapshot,key,signal)];
    let target=head;
    if(state.divergent){
      if(main)preserved.push(...await preserveFolderChoice(handle,[main],key,snapshot.meta.salt,signal));
      const selected=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
      await requireFolderSession(snapshot,key,signal);
      target=await writer.writeChosen(snapshot,state,selected);
    }else if(folderStamp(await writer.scan(snapshot.meta.salt))!==folderStamp(state)){
      throw folderFailure('folder.changed');
    }
    return {...await pullFolderHead(handle,target,snapshot,key,signal),preserved};
  }
  if(main?.status!=='valid')throw folderFailure('folder.changed');
  const copies=main.name===head.name?[main]:[main,head];
  const preserved=await preserveFolderChoice(handle,copies,key,snapshot.meta.salt,signal);
  await requireFolderSession(snapshot,key,signal);
  const reading=isReadOnly();
  setWriteMode('readWrite');
  try {
    const result=await writer.write(snapshot,{...state,head},{replace:true});
    return {status:'saved',result,preserved};
  }catch(error){
    if(reading&&!signal.aborted)setWriteMode('readOnly');
    throw error;
  }
}
