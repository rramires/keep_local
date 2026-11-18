import {ensureVaultId,getAllMetaRecords,getMeta,readVault,setWriteMode,storeFolderConnection,vaultIdentity} from './db.js';
import {unreadableRecords} from './record-health.js';
import {getSessionKey,getSessionVaultId,setSessionVaultId} from './session.js';

const access = {mode:'readwrite'};

function failure(code) {
  return Object.assign(new Error(code),{code});
}

function folderError(error) {
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
    const permission=await handle.queryPermission(access);
    const result=permission==='prompt'?await handle.requestPermission(access):permission;
    return result==='granted'?null:'denied';
  } catch(error) {
    const status=folderError(error);
    return status==='notFound'?'error:NotFoundError':status;
  }
}

export async function probeFolder(handle) {
  try {
    for await (const entry of handle.keys()) break;
    return 'ok';
  } catch(error) {
    return folderError(error);
  }
}

export async function checkFolder(handle,permissionFailure) {
  if(permissionFailure==='denied') return permissionFailure;
  const actual=await probeFolder(handle);
  return actual==='ok'?(permissionFailure??actual):actual;
}

async function requireSession(key,signal) {
  if(signal?.aborted || !key || key!==await getSessionKey() || signal?.aborted) throw failure('session.ended');
}

export async function chooseSyncFolder({key,signal,hasUnreadable=false}={}) {
  if(!folderSupported()) throw failure('folder.unsupported');
  if(hasUnreadable) throw failure('folder.unreadable');
  const handle=await showDirectoryPicker({...access,id:'keeplocal-vault'});
  const status=await probeFolder(handle);
  if(status!=='ok') return {handle,status};
  await requireSession(key,signal);
  const snapshot=await readVault();
  if(vaultIdentity(snapshot.meta)!==getSessionVaultId()) throw failure('vault.changed');
  if((await unreadableRecords(snapshot.notes,key)).length) throw failure('folder.unreadable');
  await requireSession(key,signal);
  await enableFolderWrites({key,signal,selection:{handle,snapshot:snapshot.meta}});
  return {handle,status};
}

export async function disconnectSyncFolder({key,signal}={}) {
  if(!folderSupported()) throw failure('folder.unsupported');
  await requireSession(key,signal);
  const snapshot=Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
  if(vaultIdentity(snapshot)!==getSessionVaultId()) throw failure('vault.changed');
  await requireSession(key,signal);
  await storeFolderConnection(null,snapshot,null,{signal});
}

export async function enableFolderWrites({key,signal,selection}={}) {
  if(selection){
    await requireSession(key,signal);
    await storeFolderConnection(selection.handle,selection.snapshot,getSessionVaultId(),{signal,transition:true});
    await requireSession(key,signal);
    setWriteMode('readWrite');
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
