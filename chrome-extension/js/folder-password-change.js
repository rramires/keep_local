import {getSessionKey} from './session.js';
import {readFolderState,readFolderCandidate,MAIN_FILE} from './folder-vault.js';
import {createFolderWriter,folderFailure} from './folder-write.js';
import {decideFolderAction,applyFolderCopy,requireFolderSession} from './folder-reconcile.js';
import {createSaltAccess} from './folder-salt-access.js';
import {bytesHash,preserveFolderChoice} from './folder-preserve.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {MAX_BACKUP_BYTES} from './backup-format.js';

async function readBytes(file) {
  return withFolderReadTimeout(async()=>{
    const stored=await file.getFile();
    if(stored.size>MAX_BACKUP_BYTES)throw folderFailure('folder.changed');
    return new Uint8Array(await stored.arrayBuffer());
  },'file');
}

function guardRotationReadback(access,handle,state,key,salt,signal) {
  let original;
  const preserve=access.preserve;
  access.preserve=async observed=>{
    const namesBySource=new Map();
    const names=await preserve(observed,namesBySource);
    const main=namesBySource.get(MAIN_FILE);
    if(main){
      const directory=await withFolderReadTimeout(()=>handle.getDirectoryHandle('keeplocal-preserved'));
      original=await readBytes(await withFolderReadTimeout(()=>directory.getFileHandle(main)));
    }else if(state.candidates.some(copy=>copy.name===MAIN_FILE))original=new Uint8Array();
    return names;
  };
  access.onReadbackFailure=async(file,written)=>{
    const hash=await bytesHash(written);
    const assertUnchanged=async()=>{
      signal.throwIfAborted();
      if(await bytesHash(await readBytes(file))!==hash)throw folderFailure('folder.changed');
    };
    await assertUnchanged();
    const copy=await readFolderCandidate(file,key,salt);
    if(copy.status!=='valid')throw folderFailure('folder.readback');
    await preserveFolderChoice(handle,[{name:MAIN_FILE,...copy}],key,salt,signal);
    await assertUnchanged();
    if(!original){await handle.removeEntry(MAIN_FILE);return;}
    const stream=await file.createWritable({mode:'exclusive'});
    try{
      await stream.write(original);
      await assertUnchanged();
      await stream.close();
    }catch(error){await stream.abort().catch(()=>{});throw error;}
    if(await bytesHash(await readBytes(file))!==await bytesHash(original))throw folderFailure('folder.readback');
  };
}

export async function checkFolderPasswordChange(snapshot,current,signal) {
  if(!snapshot.meta.syncFolder)return null;
  try{
    await requireFolderSession(snapshot,await getSessionKey(),signal);
    const state=await readFolderState(snapshot.meta.syncFolder,current,snapshot.meta.salt);
    const action=decideFolderAction(snapshot,state);
    if(!['saved','push'].includes(action))throw folderFailure('account.folderPending');
    return state;
  }catch(error){
    if(signal.aborted||error.code==='session.ended')throw error;
    throw folderFailure('account.folderPending');
  }
}

export async function changeFolderPassword({snapshot,state,current,key,salt,signal}) {
  const handle=snapshot.meta.syncFolder;
  const access=await createSaltAccess({handle,snapshot,key:current,foreign:{salt,key},target:'folder',signal});
  access.sessionKey=await getSessionKey();
  guardRotationReadback(access,handle,state,key,salt,signal);
  const writer=createFolderWriter(handle,key,signal,access);
  const selected={hash:state.head?.hash,payload:{
    notes:access.snapshot.notes,
    preferences:Object.fromEntries(['theme','lang'].filter(name=>snapshot.meta[name]!==undefined).map(name=>[name,snapshot.meta[name]])),
    tombstones:snapshot.meta.tombstones??[],ancestors:state.head?.payload.ancestors,
  }};
  const head=await writer.writeChosen(access.snapshot,state,selected,{allowReadOnly:false});
  try{
    await applyFolderCopy(head,access.snapshot,key,signal,{access});
  }catch{
    throw folderFailure('account.folderApplyFailed');
  }
  return key;
}
