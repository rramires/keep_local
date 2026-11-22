import {deriveKey,base64ToArray,arrayToBase64} from './crypto.js';
import {MAX_BACKUP_BYTES} from './backup-format.js';
import {readVault,recordFolderWrite,setWriteMode} from './db.js';
import {MAIN_FILE,decodeV2WithKey,readFolderState} from './folder-vault.js';
import {folderFailure,createFolderWriter,folderStamp,withVaultLineage} from './folder-write.js';
import {folderLocalStamp,requireFolderSession} from './folder-reconcile.js';
import {preserveOtherSaltChoice} from './folder-preserve.js';
import {passwordDialog} from './dialogs.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {t} from './i18n.js';

export async function askFolderPassword(handle,signal) {
  let password=await passwordDialog(t('folder.folderPasswordPrompt'),{
    title:t('folder.enterFolderPassword'),label:t('auth.password'),signal,
  });
  if(password===null)return null;
  try{
    const file=await withFolderReadTimeout(()=>handle.getFileHandle(MAIN_FILE));
    const bytes=await withFolderReadTimeout(async()=>{
      const value=await file.getFile();
      if(value.size>MAX_BACKUP_BYTES)throw folderFailure('folder.wrongPassphrase');
      return new Uint8Array(await value.arrayBuffer());
    },'file');
    if(bytes.length<44)throw folderFailure('folder.wrongPassphrase');
    const salt=arrayToBase64(bytes.slice(0,16));
    const key=await deriveKey(password,base64ToArray(salt));
    if(signal.aborted)throw folderFailure('session.ended');
    if((await decodeV2WithKey(bytes,key,salt)).status!=='valid')throw folderFailure('folder.wrongPassphrase');
    return {salt,key};
  }finally{password='';}
}

export function useBrowserFolder({handle,review,key,signal}) {
  return withVaultLineage(async()=>{
    const snapshot=await readVault();
    await requireFolderSession(snapshot,key,signal);
    if(!snapshot.meta.syncFolder||!await withFolderReadTimeout(()=>handle.isSameEntry(snapshot.meta.syncFolder)))
      throw folderFailure('folder.changed');
    const state=await readFolderState(handle,key,snapshot.meta.salt);
    if(folderLocalStamp(snapshot)!==folderLocalStamp(review.snapshot)||folderStamp(state)!==folderStamp(review.state))
      throw folderFailure('folder.changed');
    const main=state.candidates.find(copy=>copy.name===MAIN_FILE&&copy.status==='otherSalt');
    if(!main)throw folderFailure('folder.changed');
    const access={salt:snapshot.meta.salt,replaceUnknown:true,
      preserve:async()=>[await preserveOtherSaltChoice(handle,main,signal)]};
    const writer=createFolderWriter(handle,key,signal,access);
    const selected={hash:snapshot.meta.exportParent,payload:{notes:snapshot.notes,
      preferences:Object.fromEntries(['theme','lang'].filter(name=>snapshot.meta[name]!==undefined).map(name=>[name,snapshot.meta[name]])),
      tombstones:snapshot.meta.tombstones??[],ancestors:snapshot.meta.exportAncestors,clock:snapshot.meta.exportClock??{}}};
    const head=await writer.writeChosen(snapshot,state,selected);
    await requireFolderSession(snapshot,key,signal);
    await recordFolderWrite(snapshot.meta,head,{signal,adopt:true,resetBases:true,saltChanged:true});
    setWriteMode('readWrite');
    return {head,preserved:[],usedBrowser:true,access:{key,target:'local'}};
  });
}
