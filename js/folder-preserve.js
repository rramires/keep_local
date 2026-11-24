import {BACKUP_PROFILES,decodePayloadV2,makePayload,encodeV2} from './backup-v2.js';
import {base64ToArray,bytesHash} from './crypto.js';
export {bytesHash} from './crypto.js';
import {MAX_BACKUP_BYTES,decryptRecords,validateRecords} from './backup-format.js';
import {decodeV2WithKey} from './folder-vault.js';
import {pruneTombstones} from './folder-merge.js';
import {folderFailure} from './folder-write.js';
import {withFolderReadTimeout} from './folder-timeout.js';

export const PRESERVED_DIR='keeplocal-preserved';

async function allocateFile(directory,stem,beforeWrite) {
  for(let suffix=1;;suffix++){
    const name=stem+(suffix===1?'':'-'+suffix)+'.keeplocal';
    try { await withFolderReadTimeout(()=>directory.getFileHandle(name)); }
    catch(error) {
      if(error.name==='NotFoundError'){
        beforeWrite();
        return directory.getFileHandle(name,{create:true});
      }
      if(error.name!=='TypeMismatchError')throw error;
    }
  }
}

async function verifyPreserved(file,size,hash,key,salt,allowUnreadable=false) {
  const reread=await withFolderReadTimeout(async()=>{
    const stored=await file.getFile();
    if(stored.size!==size)throw folderFailure('folder.preserveFailed');
    return new Uint8Array(await stored.arrayBuffer());
  },'file');
  if(await bytesHash(reread)!==hash)throw folderFailure('folder.preserveFailed');
  if(!key)return;
  if(allowUnreadable){
    await decodePayloadV2(reread,key,BACKUP_PROFILES[0]);
  }else if((await decodeV2WithKey(reread,key,salt)).status!=='valid'){
    throw folderFailure('folder.preserveFailed');
  }
}

async function preserve(handle,{bytes,side,rev},key,salt,signal,
  {beforeWrite=()=>signal.throwIfAborted(),cleanFailure=true,allowUnreadable=false}={}) {
  const hash=await bytesHash(bytes);
  const time=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  beforeWrite();
  const directory=await handle.getDirectoryHandle(PRESERVED_DIR,{create:true});
  const file=await allocateFile(directory,`preserved-${time}-${side}-r${rev}-${hash.slice(0,8)}`,beforeWrite);
  let stream,writeStarted=false;
  try {
    beforeWrite();
    stream=await file.createWritable({mode:'exclusive'});
    if((await withFolderReadTimeout(()=>file.getFile(),'file')).size!==0)throw folderFailure('folder.preserveFailed');
    beforeWrite();
    writeStarted=true;
    await stream.write(bytes);
    beforeWrite();
    await stream.close();
    await verifyPreserved(file,bytes.length,hash,key,salt,allowUnreadable);
    return file.name;
  } catch(error) {
    if(stream)await stream.abort().catch(()=>{});
    if(!cleanFailure)throw error;
    try {
      const current=await withFolderReadTimeout(()=>directory.getFileHandle(file.name));
      if(await withFolderReadTimeout(()=>file.isSameEntry(current))&&
          (writeStarted||(await withFolderReadTimeout(()=>current.getFile(),'file')).size===0))
        await directory.removeEntry(file.name);
    } catch {
      // Keep the original failure if the directory cannot undo this attempt.
    }
    throw error;
  }
}

export function preserveHistoryCopy(handle,bytes,rev,beforeWrite,{side='history'}={}) {
  return preserve(handle,{bytes,side,rev},null,null,null,{beforeWrite,cleanFailure:false});
}

export async function preserveOtherSaltChoice(handle,copy,signal) {
  try{
    const entry=await withFolderReadTimeout(()=>handle.getFileHandle(copy.name));
    const bytes=await withFolderReadTimeout(async()=>{
      const file=await entry.getFile();
      if(file.size>MAX_BACKUP_BYTES)throw folderFailure('folder.changed');
      return new Uint8Array(await file.arrayBuffer());
    },'file');
    if(await bytesHash(bytes)!==copy.bytesHash)throw folderFailure('folder.changed');
    return await preserve(handle,{bytes,side:'folder',rev:'unknown'},null,null,signal);
  }catch(error){
    if(error.code==='folder.changed'||error.name==='TimeoutError'||signal.aborted)throw error;
    throw folderFailure('folder.preserveFailed');
  }
}

export async function preserveFolderChoice(handle,copies,key,salt,signal,preservedBytes=new Map()) {
  try {
    const preserved=[];
    for(const copy of copies){
      signal.throwIfAborted();
      const entry=await withFolderReadTimeout(()=>handle.getFileHandle(copy.name));
      const bytes=await withFolderReadTimeout(async()=>{
        const file=await entry.getFile();
        if(file.size>MAX_BACKUP_BYTES)throw folderFailure('folder.changed');
        return new Uint8Array(await file.arrayBuffer());
      },'file');
      if((await decodeV2WithKey(bytes,key,salt)).hash!==copy.hash)throw folderFailure('folder.changed');
      const hash=await bytesHash(bytes);
      let name=preservedBytes.get(hash);
      // Reuse only files whose exact bytes still pass verified readback.
      preservedBytes.delete(hash);
      if(name){
        const directory=await withFolderReadTimeout(()=>handle.getDirectoryHandle(PRESERVED_DIR));
        const file=await withFolderReadTimeout(()=>directory.getFileHandle(name));
        await verifyPreserved(file,bytes.length,hash,key,salt);
      }else name=await preserve(handle,{bytes,side:'folder',rev:copy.rev},key,salt,signal);
      signal.throwIfAborted();
      preservedBytes.set(hash,name);
      preserved.push(name);
    }
    return [...new Set(preserved)];
  } catch(error) {
    if(error.code==='folder.changed'||error.name==='TimeoutError'||signal.aborted)throw error;
    throw folderFailure('folder.preserveFailed');
  }
}

export async function preserveLocalChoice(handle,{notes,meta},key,signal,{allowUnreadable=false}={}) {
  try {
    if(!allowUnreadable){
      validateRecords(notes);
      await decryptRecords(notes,key);
    }
    const preferences=Object.fromEntries(['theme','lang'].filter(name=>meta[name]!==undefined).map(name=>[name,meta[name]]));
    const rev=meta.exportRev||0;
    const payload=makePayload(notes,preferences,rev,meta.exportParent||null,pruneTombstones(meta.tombstones??[]),meta.exportAncestors,meta.exportClock);
    const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
    return await preserve(handle,{bytes,side:'local',rev},key,meta.salt,signal,{allowUnreadable});
  } catch(error) {
    if(error.name==='TimeoutError'||signal.aborted)throw error;
    throw folderFailure('folder.preserveFailed');
  }
}
