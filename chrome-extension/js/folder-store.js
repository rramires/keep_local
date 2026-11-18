import {ensureVaultId,getAllMetaRecords,getMeta,isReadOnly,readVault,setWriteMode,vaultIdentity,vaultTransaction} from './db.js';
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

function writeSyncFolder(handle,expected,signal,vaultId) {
  return vaultTransaction(({tx,meta},done,fail)=>{
    if(signal?.aborted){fail(failure('session.ended'));return;}
    const abort=()=>fail(failure('session.ended'));
    signal?.addEventListener('abort',abort,{once:true});
    for(const event of ['complete','abort']) {
      tx.addEventListener(event,()=>signal?.removeEventListener('abort',abort),{once:true});
    }
    const query=meta.getAll();
    query.onsuccess=()=>{
      try {
        const actual=Object.fromEntries(query.result.map(({key,value})=>[key,value]));
        if(actual.salt!==expected.salt || actual.vaultId!==expected.vaultId ||
           (actual.revision||0)!==(expected.revision||0)) throw failure('vault.changed');
        if(!actual.vaultId && vaultId) meta.put({key:'vaultId',value:vaultId});
        if(handle) meta.put({key:'syncFolder',value:handle});
        else meta.delete('syncFolder');
        done();
      } catch(error) {fail(error);}
    };
  });
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
  const readOnly=isReadOnly(),vaultId=getSessionVaultId();
  if(readOnly) setWriteMode('readWrite');
  try {
    await writeSyncFolder(handle,snapshot.meta,signal,vaultId);
  } catch(error) {
    if(readOnly&&!signal?.aborted) setWriteMode('readOnly');
    throw error;
  }
  return {handle,status};
}

export async function disconnectSyncFolder({key,signal}={}) {
  if(!folderSupported()) throw failure('folder.unsupported');
  await requireSession(key,signal);
  const snapshot=Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
  if(vaultIdentity(snapshot)!==getSessionVaultId()) throw failure('vault.changed');
  await requireSession(key,signal);
  await writeSyncFolder(null,snapshot,signal);
}

export async function enableFolderWrites({key,signal}={}) {
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
