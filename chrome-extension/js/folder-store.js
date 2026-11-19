import {ensureVaultId,getAllMetaRecords,getMeta,readVault,setWriteMode,storeFolderConnection,vaultIdentity} from './db.js';
import {unreadableRecords} from './record-health.js';
import {getSessionKey,getSessionVaultId,setSessionVaultId} from './session.js';
import {decideFolderAction} from './folder-reconcile.js';
import {readFolderState} from './folder-vault.js';
import {withVaultLineage} from './folder-write.js';
import {withFolderReadTimeout} from './folder-timeout.js';

const access = {mode:'readwrite'};

function failure(code) {
  return Object.assign(new Error(code),{code});
}

export function folderError(error) {
  if (error?.name==='TimeoutError') return 'unresponsive';
  if (error?.name==='NotFoundError') return 'notFound';
  if (error?.name==='NotAllowedError' || error?.name==='SecurityError') return 'denied';
  return 'error:'+(typeof error?.name==='string'?error.name:'Error');
}

export function folderSupported() {
  return globalThis.location?.protocol==='chrome-extension:' &&
    typeof globalThis.showDirectoryPicker==='function';
}

export function readSyncFolder() {
  return folderSupported()?getMeta('syncFolder'):null;
}

export async function requestFolderAccess(handle) {
  try {
    const permission=await withFolderReadTimeout(()=>handle.queryPermission(access));
    const result=permission==='prompt'?await handle.requestPermission(access):permission;
    return result==='granted'?null:'denied';
  } catch(error) {
    const status=folderError(error);
    return status==='notFound'?'error:NotFoundError':status;
  }
}

export async function probeFolder(handle) {
  try {
    await withFolderReadTimeout(async()=>{for await (const entry of handle.keys()) break;});
    return 'ok';
  } catch(error) {
    return folderError(error);
  }
}

export async function checkFolder(handle,permissionFailure) {
  if(permissionFailure==='denied'||permissionFailure==='unresponsive') return permissionFailure;
  const actual=await probeFolder(handle);
  return actual==='ok'?(permissionFailure??actual):actual;
}

async function requireSession(key,signal) {
  if(signal?.aborted || !key || key!==await getSessionKey() || signal?.aborted) throw failure('session.ended');
}

export async function chooseSyncFolder({key,signal,hasUnreadable=false,hold=false}={}) {
  if(!folderSupported()) throw failure('folder.unsupported');
  if(hasUnreadable) throw failure('folder.unreadable');
  const handle=await showDirectoryPicker({...access,id:'keeplocal-vault'});
  return withVaultLineage(async()=>{
    const status=await probeFolder(handle);
    if(status!=='ok')return {handle,status};
    await requireSession(key,signal);
    const snapshot=await readVault();
    if(vaultIdentity(snapshot.meta)!==getSessionVaultId())throw failure('vault.changed');
    if((await unreadableRecords(snapshot.notes,key)).length)throw failure('folder.unreadable');
    const observed=await readFolderState(handle,key,snapshot.meta.salt);
    const decision=decideFolderAction(snapshot,observed);
    if(decision==='otherSalt'||decision==='unreadableCopy')return {handle,status:decision};
    const alreadyAttached=snapshot.meta.syncFolder&&await withFolderReadTimeout(()=>handle.isSameEntry(snapshot.meta.syncFolder));
    if(!alreadyAttached||!hold){
      if(alreadyAttached)await enableFolderWrites({key,signal});
      else await enableFolderWrites({key,signal,selection:{handle,snapshot:snapshot.meta,hold}});
    }
    return {handle,status:'ok'};
  });
}

export async function disconnectSyncFolder({key,signal}={}) {
  if(!folderSupported()) throw failure('folder.unsupported');
  await requireSession(key,signal);
  const snapshot=Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
  if(vaultIdentity(snapshot)!==getSessionVaultId()) throw failure('vault.changed');
  await requireSession(key,signal);
  await withVaultLineage(()=>storeFolderConnection(null,snapshot,null,{signal}));
}

export async function enableFolderWrites({key,signal,selection}={}) {
  if(selection){
    await requireSession(key,signal);
    await storeFolderConnection(selection.handle,selection.snapshot,getSessionVaultId(),{signal,transition:true});
    await requireSession(key,signal);
    if(!selection.hold)setWriteMode('readWrite');
    return;
  }
  await requireSession(key,signal);
  const values=Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
  if(vaultIdentity(values)!==getSessionVaultId()) throw failure('vault.changed');
  await requireSession(key,signal);
  setWriteMode('readWrite');
  try {
    if(!values.vaultId){
      const id=await ensureVaultId(values.salt,{signal});
      if(!signal?.aborted) setSessionVaultId(id);
    }
  } catch(error) {
    if(!signal?.aborted) setWriteMode('readOnly');
    throw error;
  }
}
