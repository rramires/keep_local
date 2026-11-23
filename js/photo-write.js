import {bytesHash} from './crypto.js';
import {assertWritable,isReadOnly,recordPhotoWrite} from './db.js';
import {historySlots,localWeekdayIndex} from './folder-history.js';
import {preserveHistoryCopy} from './folder-preserve.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {decodeV2WithKey} from './folder-vault.js';
import {listPhotoNames,photoErrorDetails,photoFailure,queryPhotoPermission,readPhotoBytes,updatePhotoStatus} from './photo-folder.js';
import {buildPhoto,photoParts} from './photo-trailer.js';

const HOUR_MS=60*60*1000;

export async function writeFolderPhoto(meta,head,principal,key,signal) {
  const {photoFolder,photoNames,syncFolder}=meta;
  if(!photoFolder||!syncFolder||signal?.aborted||isReadOnly())return null;
  const date=new Date(head.exportedAt),day=historySlots(date).day.key;
  if(day===meta.photoWrittenDay&&Date.now()-meta.photoWrittenAt<HOUR_MS)return null;
  const assertCurrent=()=>{
    assertWritable();
    signal?.throwIfAborted();
  };
  try{
    if(await queryPhotoPermission(photoFolder)!=='granted')throw photoFailure('photo.permission');
    assertCurrent();
    const names=await listPhotoNames(photoFolder);
    if(names.length!==7||names.some((name,index)=>name!==photoNames?.[index]))
      throw photoFailure('photo.changed');
    const name=names[localWeekdayIndex(date)];
    assertCurrent();
    const entry=await withFolderReadTimeout(()=>photoFolder.getFileHandle(name));
    const observed=await readPhotoBytes(entry);
    const parts=photoParts(observed);
    if(!parts)throw photoFailure('photo.unrecognized',{name});
    const old=parts.copy?await decodeV2WithKey(parts.copy,key,head.salt):null;
    const output=buildPhoto(parts.image,principal);
    const [observedHash,outputHash]=await Promise.all([bytesHash(observed),bytesHash(output)]);

    assertCurrent();
    const stream=await entry.createWritable({mode:'exclusive'});
    try{
      assertCurrent();
      if(await bytesHash(await readPhotoBytes(entry))!==observedHash)
        throw photoFailure('photo.fileChanged',{name});
      if(old&&(old.status!=='valid'||old.rev>head.rev)){
        try{
          await preserveHistoryCopy(syncFolder,parts.copy,old.rev??'unknown',assertCurrent,{side:'photo'});
        }catch{throw photoFailure('photo.preserveFailed',{name});}
      }
      assertCurrent();
      await stream.write(output);
      assertCurrent();
      await stream.close();
    }catch(error){
      await stream.abort().catch(()=>{});
      throw error;
    }
    assertCurrent();
    if(await bytesHash(await readPhotoBytes(entry))!==outputHash)
      throw photoFailure('photo.readback',{name});
    const at=Date.now();
    assertCurrent();
    await recordPhotoWrite(meta,at,day,signal);
    updatePhotoStatus(meta);
    return {name,at};
  }catch(error){
    if(signal?.aborted||isReadOnly())return null;
    const failure=photoErrorDetails(error);
    updatePhotoStatus(meta,failure);
    return {failure};
  }
}
