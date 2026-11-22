import {makePayload,encodeV2} from './backup-v2.js';
import {base64ToArray} from './crypto.js';
import {MAX_BACKUP_BYTES,decryptRecords,validateRecords} from './backup-format.js';
import {decodeV2WithKey} from './folder-vault.js';
import {pruneTombstones} from './folder-merge.js';
import {folderFailure} from './folder-write.js';
import {withFolderReadTimeout} from './folder-timeout.js';

const PRESERVED='keeplocal-preserved';

export async function bytesHash(bytes) {
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function allocateFile(directory,stem) {
  for(let suffix=1;;suffix++){
    const name=stem+(suffix===1?'':'-'+suffix)+'.keeplocal';
    try { await withFolderReadTimeout(()=>directory.getFileHandle(name)); }
    catch(error) {
      if(error.name==='NotFoundError')return directory.getFileHandle(name,{create:true});
      if(error.name!=='TypeMismatchError')throw error;
    }
  }
}

async function preserve(handle,{bytes,side,rev},key,salt,signal) {
  const hash=await bytesHash(bytes);
  const time=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  signal.throwIfAborted();
  const directory=await handle.getDirectoryHandle(PRESERVED,{create:true});
  const file=await allocateFile(directory,`preserved-${time}-${side}-r${rev}-${hash.slice(0,8)}`);
  let stream,writeStarted=false;
  try {
    stream=await file.createWritable({mode:'exclusive'});
    if((await withFolderReadTimeout(()=>file.getFile(),'file')).size!==0)throw folderFailure('folder.preserveFailed');
    writeStarted=true;
    await stream.write(bytes);
    signal.throwIfAborted();
    await stream.close();
    const reread=await withFolderReadTimeout(async()=>{
      const stored=await file.getFile();
      if(stored.size!==bytes.length)throw folderFailure('folder.preserveFailed');
      return new Uint8Array(await stored.arrayBuffer());
    },'file');
    if(await bytesHash(reread)!==hash||
       (await decodeV2WithKey(reread,key,salt)).status!=='valid')
      throw folderFailure('folder.preserveFailed');
    return file.name;
  } catch(error) {
    if(stream)await stream.abort().catch(()=>{});
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

export async function preserveFolderChoice(handle,copies,key,salt,signal) {
  try {
    const preserved=[];
    for(const copy of copies){
      const entry=await withFolderReadTimeout(()=>handle.getFileHandle(copy.name));
      const bytes=await withFolderReadTimeout(async()=>{
        const file=await entry.getFile();
        if(file.size>MAX_BACKUP_BYTES)throw folderFailure('folder.changed');
        return new Uint8Array(await file.arrayBuffer());
      },'file');
      if((await decodeV2WithKey(bytes,key,salt)).hash!==copy.hash)throw folderFailure('folder.changed');
      preserved.push(await preserve(handle,{bytes,side:'folder',rev:copy.rev},key,salt,signal));
    }
    return preserved;
  } catch(error) {
    if(error.code==='folder.changed'||error.name==='TimeoutError'||signal.aborted)throw error;
    throw folderFailure('folder.preserveFailed');
  }
}

export async function preserveLocalChoice(handle,{notes,meta},key,signal) {
  try {
    validateRecords(notes);
    await decryptRecords(notes,key);
    const preferences=Object.fromEntries(['theme','lang'].filter(name=>meta[name]!==undefined).map(name=>[name,meta[name]]));
    const rev=meta.exportRev||0;
    const payload=makePayload(notes,preferences,rev,meta.exportParent||null,pruneTombstones(meta.tombstones??[]),meta.exportAncestors,meta.exportClock);
    const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
    return await preserve(handle,{bytes,side:'local',rev},key,meta.salt,signal);
  } catch(error) {
    if(error.name==='TimeoutError'||signal.aborted)throw error;
    throw folderFailure('folder.preserveFailed');
  }
}
