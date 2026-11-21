import {assertWritable,readVault,recordFolderWrite,verifyFolderWrite,replaceVaultFromFolder,isReadOnly,setWriteMode,vaultIdentity} from './db.js';
import {getSessionKey,getSessionVaultId,storeSessionKey} from './session.js';
import {publishVaultEvent} from './vault-events.js';
import {MAIN_FILE,readFolderCandidate} from './folder-vault.js';
import {preserveFolderChoice,preserveLocalChoice} from './folder-preserve.js';
import {folderPullNotices,reconcileFolderNotes,sameTombstones} from './folder-merge.js';
import {hasPendingDrafts} from './backup.js';
import {descends} from './folder-clock.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {folderFailure,folderStamp,localFolderDirty,unsafeFolder} from './folder-write.js';

function sameRecords(local,remote) {
  if(local.length!==remote.length)return false;
  const indexed=new Map(remote.map(record=>[record.id,record]));
  return local.every(({id,iv,ciphertext,updatedAt})=>{
    const other=indexed.get(id);
    return other&&other.iv===iv&&other.ciphertext===ciphertext&&other.updatedAt===updatedAt;
  });
}

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
  const canMerge=!!meta.folderSyncedVersions;
  if(!meta.folderSyncedHash){
    if(state.divergent)return 'conflict';
    if(notes.length===0&&sameTombstones(meta.tombstones))return 'pull';
    return sameRecords(notes,head.payload.notes)&&sameTombstones(meta.tombstones,head.payload.tombstones)?'adopt':'conflict';
  }
  if(!state.divergent&&!localFolderDirty(meta)&&head.rev>(meta.folderSeenRev||0)&&
      descends(head,{hash:meta.folderSyncedHash,clock:meta.folderSyncedClock}))return 'pull';
  return canMerge?'merge':'conflict';
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
  const file=await withFolderReadTimeout(()=>handle.getFileHandle(head.name));
  const copy=await readFolderCandidate(file,key,salt);
  if(copy.status!=='valid'||copy.hash!==head.hash)throw folderFailure('folder.changed');
  return {name:head.name,...copy};
}

export async function pullFolderHead(handle,head,snapshot,key,signal,{notifyDeletions=false,resetBases=false}={}) {
  const copy=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
  const stats=notifyDeletions?folderPullNotices(snapshot,copy.payload):undefined;
  return {...await applyFolderCopy(copy,snapshot,key,signal,{resetBases}),stats};
}

async function applyFolderCopy(copy,snapshot,key,signal,{mergedHeads,resetBases}={}) {
  await requireFolderSession(snapshot,key,signal);
  const previous=snapshot.meta,prefs=copy.payload.preferences;
  const revision=(previous.revision||0)+1,vaultId=crypto.randomUUID();
  const meta={
    ...previous,...prefs,vaultId,revision,dirtySinceBackup:true,tombstones:copy.payload.tombstones,
    exportRev:Math.max(previous.exportRev||0,copy.rev),exportParent:copy.hash,exportAncestors:copy.payload.ancestors,
    exportClock:copy.payload.clock??{},
    folderSyncedHash:copy.hash,folderSyncedClock:copy.payload.clock??{},folderSyncedRevision:revision,
    folderSeenRev:Math.max(previous.folderSeenRev||0,copy.rev),folderWrittenAt:Date.parse(copy.exportedAt),
  };
  for(const name of ['theme','lang'])if(!Object.hasOwn(prefs,name))delete meta[name];
  await replaceVaultFromFolder({notes:copy.payload.notes,meta},previous,{signal,head:copy,mergedHeads,resetBases});
  if(signal.aborted)throw folderFailure('session.ended');
  storeSessionKey(key,vaultId);
  setWriteMode('readWrite');
  publishVaultEvent('vault-replaced',{vaultId});
  return {status:'pulled',head:copy};
}

export async function executeFolderMerge({handle,writer,snapshot,state,key,signal,allowReadOnly=false,manual=false}) {
  const {meta}=snapshot;
  const head=state.head;
  const candidates=state.candidates.filter(copy=>copy.status==='valid'&&copy.rev===head.rev);
  const seen=new Set([meta.folderSyncedHash]);
  const otherHeads=[];
  const copies=[head,...candidates.filter(copy=>copy.name!==head.name)
    .sort((a,b)=>a.hash.localeCompare(b.hash)||a.name.localeCompare(b.name))];
  for(const copy of copies){
    if(seen.has(copy.hash))continue;
    seen.add(copy.hash);
    otherHeads.push(await readReviewedCopy(handle,copy,key,meta.salt));
  }
  const {records,tombstones,stats,now,sameLocalNotes,sameHeadNotes}=await reconcileFolderNotes(snapshot,head,otherHeads,key);
  const preferences=Object.fromEntries(['theme','lang'].filter(name=>meta[name]!==undefined).map(name=>[name,meta[name]]));
  const samePreferences=['theme','lang'].every(name=>preferences[name]===head.payload.preferences[name]);
  const equalsLocal=sameLocalNotes&&sameTombstones(tombstones,meta.tombstones,now);
  const equalsHead=samePreferences&&sameHeadNotes&&
    sameTombstones(tombstones,head.payload.tombstones,now);
  const assertCurrent=async()=>{
    if(!allowReadOnly)assertWritable();
    await requireFolderSession(snapshot,key,signal);
    if(hasPendingDrafts())throw folderFailure('folder.changed');
    await verifyFolderWrite(meta,{signal,replaceLocal:true});
  };
  await assertCurrent();
  if(folderStamp(await writer.scan(meta.salt))!==folderStamp(state))throw folderFailure('folder.changed');
  if(!manual&&equalsLocal&&equalsHead&&meta.folderSyncedHash===head.hash&&!localFolderDirty(meta))
    return {status:'saved',writtenAt:meta.folderWrittenAt};

  const preserved=[];
  if(manual||stats.conflicts){
    const toPreserve=state.candidates.filter(copy=>copy.status==='valid'&&(copy.rev===head.rev||copy.name===MAIN_FILE));
    preserved.push(await preserveLocalChoice(handle,snapshot,key,signal));
    preserved.push(...await preserveFolderChoice(handle,toPreserve,key,meta.salt,signal));
  }
  let target=head;
  if(!equalsHead){
    await assertCurrent();
    const selected={hash:head.hash,payload:{notes:records,preferences,tombstones,
      ancestors:head.payload.ancestors,clock:head.payload.clock}};
    target=await writer.writeChosen(snapshot,state,selected,{allowReadOnly,sourceHeads:otherHeads});
  }else{
    target=await readReviewedCopy(handle,head,key,meta.salt);
  }
  await assertCurrent();
  if(equalsLocal){
    await recordFolderWrite(meta,target,{signal,adopt:true,mergedHeads:[head,...otherHeads]});
  }else{
    await applyFolderCopy(target,snapshot,key,signal,{mergedHeads:[head,...otherHeads]});
  }
  return {status:'merged',head:target,applied:!equalsLocal,stats,preserved,replacedEmptyMain:target.replacedEmptyMain};
}

export async function resolveFolderReview({handle,writer,review,choice,name,key,signal}) {
  const snapshot=await readVault();
  await requireFolderSession(snapshot,key,signal);
  if(!snapshot.meta.syncFolder||!await withFolderReadTimeout(()=>handle.isSameEntry(snapshot.meta.syncFolder)))throw folderFailure('folder.changed');
  const state=await writer.scan(snapshot.meta.salt);
  if(folderLocalStamp(snapshot)!==folderLocalStamp(review.snapshot)||folderStamp(state)!==folderStamp(review.state))
    throw folderFailure('folder.changed');
  const head=state.candidates.find(row=>row.name===name&&row.status==='valid'&&row.rev===state.head?.rev);
  if(!head||unsafeFolder(state))throw folderFailure('folder.changed');
  if(choice==='merge'){
    const chosen=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
    return executeFolderMerge({handle,writer,snapshot,state:{...state,head:chosen},key,signal,allowReadOnly:true,manual:true});
  }
  const main=state.candidates.find(row=>row.name===MAIN_FILE);
  if(choice==='remote'){
    const preserved=[await preserveLocalChoice(handle,snapshot,key,signal)];
    let target=head;
    if(state.divergent){
      if(main?.status==='valid')preserved.push(...await preserveFolderChoice(handle,[main],key,snapshot.meta.salt,signal));
      const selected=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
      await requireFolderSession(snapshot,key,signal);
      target=await writer.writeChosen(snapshot,state,selected);
    }else if(folderStamp(await writer.scan(snapshot.meta.salt))!==folderStamp(state)){
      throw folderFailure('folder.changed');
    }
    return {...await pullFolderHead(handle,target,snapshot,key,signal,{resetBases:true}),preserved,replacedEmptyMain:target.replacedEmptyMain};
  }
  if(!['valid','emptyMain'].includes(main?.status))throw folderFailure('folder.changed');
  const copies=main.status==='valid'?(main.name===head.name?[main]:[main,head]):[];
  const preserved=await preserveFolderChoice(handle,copies,key,snapshot.meta.salt,signal);
  const chosen=await readReviewedCopy(handle,head,key,snapshot.meta.salt);
  await requireFolderSession(snapshot,key,signal);
  const reading=isReadOnly();
  setWriteMode('readWrite');
  try {
    const result=await writer.write(snapshot,{...state,head:chosen},{replace:true,resetBases:true});
    return {status:'saved',result,preserved,replacedEmptyMain:result.replacedEmptyMain};
  }catch(error){
    if(reading&&!signal.aborted)setWriteMode('readOnly');
    throw error;
  }
}
