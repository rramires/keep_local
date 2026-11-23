import {assertWritable,getAllMetaRecords,storePhotoFolder} from './db.js';
import {requireFolderSession} from './folder-reconcile.js';
import {isFolderCopyDirectory} from './folder-store.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {withVaultLineage} from './folder-write.js';
import {MAX_PHOTO_BYTES,photoParts} from './photo-trailer.js';

const PHOTO_ACCESS={mode:'readwrite'};

export function photoFailure(code,params) {
  return Object.assign(new Error(code),{code,params});
}

export function photoErrorDetails(error) {
  if(error.name==='TimeoutError')return {code:'photo.unresponsive'};
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return {code:'photo.permission'};
  if(typeof error.code==='string')return {code:error.code,params:error.params};
  return {code:'photo.unavailable'};
}

export async function folderMetadata() {
  return Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
}

export function queryPhotoPermission(handle) {
  return withFolderReadTimeout(()=>handle.queryPermission(PHOTO_ACCESS));
}

export function requestPhotoPermission(handle) {
  return handle.requestPermission(PHOTO_ACCESS);
}

export function listPhotoNames(handle) {
  return withFolderReadTimeout(async()=>{
    const names=[];
    for await(const [name,entry] of handle.entries()){
      if(entry.kind==='file'&&/\.(jpe?g|png)$/i.test(name))names.push(name);
    }
    return names.sort();
  });
}

export function readPhotoBytes(entry) {
  return withFolderReadTimeout(async()=>{
    const file=await entry.getFile();
    if(file.size>MAX_PHOTO_BYTES)throw photoFailure('photo.tooLarge',{name:entry.name});
    return new Uint8Array(await file.arrayBuffer());
  },'file');
}

export async function choosePhotoFolder({key,signal,confirm}) {
  assertWritable();
  const handle=await showDirectoryPicker({id:'keeplocal-photos',...PHOTO_ACCESS});
  if(isFolderCopyDirectory(handle.name))throw photoFailure('folder.reservedFolder');
  signal.throwIfAborted();
  if(await requestPhotoPermission(handle)!=='granted')throw photoFailure('photo.permission');
  const meta=await folderMetadata();
  await requireFolderSession({meta},key,signal);
  if(!meta.syncFolder)throw photoFailure('photo.unavailable');
  if(await withFolderReadTimeout(()=>handle.isSameEntry(meta.syncFolder)))throw photoFailure('photo.sameFolder');
  const names=await listPhotoNames(handle);
  if(names.length!==7)throw photoFailure('photo.count',{count:names.length});
  for(const name of names){
    signal.throwIfAborted();
    const entry=await withFolderReadTimeout(()=>handle.getFileHandle(name));
    if(!photoParts(await readPhotoBytes(entry)))throw photoFailure('photo.unrecognized',{name});
  }
  if(signal.aborted||!await confirm(names))return;
  await withVaultLineage(async()=>{
    await requireFolderSession({meta},key,signal);
    await storePhotoFolder(meta,handle,names,signal);
  });
}

export async function disconnectPhotoFolder({key,signal}) {
  const meta=await folderMetadata();
  await withVaultLineage(async()=>{
    await requireFolderSession({meta},key,signal);
    await storePhotoFolder(meta,null,null,signal);
  });
}
