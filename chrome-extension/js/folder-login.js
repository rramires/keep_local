import {arrayToBase64,base64ToArray,deriveKey,createKeyCheck,verifyKeyCheck} from './crypto.js';
import {readVault} from './db.js';
import {MAX_BACKUP_BYTES,decryptRecords} from './backup-format.js';
import {MAIN_FILE,decodeV2WithKey,readFolderState,readFolderCandidate} from './folder-vault.js';
import {folderFailure,localFolderDirty,unsafeFolder,withVaultLineage} from './folder-write.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {descends} from './folder-clock.js';
import {hasFolderDeletionProof} from './folder-merge.js';
import {applyFolderCopy} from './folder-reconcile.js';
import {passwordDialog} from './dialogs.js';
import {focusPanel} from './form-ui.js';
import {t} from './i18n.js';
import {openSaltReconciliation} from './folder-salt-ui.js';

export function canLoadChangedFolder({notes,meta},state) {
  const versions=meta.folderSyncedVersions,head=state.head;
  return !!(meta.folderSyncedHash&&versions&&!localFolderDirty(meta)&&head&&!state.divergent&&!unsafeFolder(state)&&
    head.rev>=(meta.folderSeenRev||0)&&notes.length===Object.keys(versions).length&&
    notes.every(note=>Object.hasOwn(versions,note.id)&&versions[note.id]===note.updatedAt)&&
    !state.candidates.some(copy=>copy.status==='otherSalt'&&copy.salt===meta.salt)&&
    descends(head,{hash:meta.folderSyncedHash,clock:meta.folderSyncedClock})&&
    hasFolderDeletionProof(notes,head.payload));
}

export async function tryChangedFolderPassword(password,handle,permissionFailure,signal) {
  if(permissionFailure)throw folderFailure('folder.loginUnavailable');
  const snapshot=await readVault();
  let file,bytes;
  try{
    file=await withFolderReadTimeout(()=>handle.getFileHandle(MAIN_FILE));
    bytes=await withFolderReadTimeout(async()=>{
      const source=await file.getFile();
      if(source.size>MAX_BACKUP_BYTES)return null;
      return new Uint8Array(await source.arrayBuffer());
    },'file');
  }catch{throw folderFailure('folder.loginUnavailable');}
  if(!bytes||bytes.length<44)return null;
  const salt=arrayToBase64(bytes.slice(0,16));
  if(salt===snapshot.meta.salt)return null;
  const key=await deriveKey(password,bytes.slice(0,16));
  const main=await decodeV2WithKey(bytes,key,salt);
  if(signal.aborted)throw folderFailure('session.ended');
  if(main.status!=='valid')return null;
  return withVaultLineage(async()=>{
    const state=await readFolderState(handle,key,salt);
    const observed=state.candidates.find(copy=>copy.name===MAIN_FILE);
    if(observed?.hash!==main.hash||observed.salt!==salt)throw folderFailure('folder.changed');
    const attempt={handle,snapshot,state,foreign:{salt,key}};
    if(!canLoadChangedFolder(snapshot,state))return {status:'needsLocalPassword',...attempt};
    const source=await withFolderReadTimeout(()=>handle.getFileHandle(state.head.name));
    const checked=await readFolderCandidate(source,key,salt);
    if(checked.status!=='valid'||checked.hash!==state.head.hash)throw folderFailure('folder.changed');
    const access={login:true,meta:{salt,keyCheck:await createKeyCheck(key)}};
    const outcome=await applyFolderCopy({name:state.head.name,...checked},snapshot,key,signal,{access});
    return {...outcome,key,changed:true};
  });
}

export function renderChangedPasswordGate(root,initial,{signal,onAuthenticated,onExit,onOpenCopy}) {
  let attempt=initial,busy=false;
  const finish=async(key,details)=>{
    clearTimeout(timer);
    attempt=null;
    await onAuthenticated(key,details);
  };
  const wrapper=document.createElement('main');
  wrapper.className='auth-view folder-block';
  wrapper.dataset.folderChanged='';
  const container=document.createElement('div');container.className='auth-container';
  const panel=document.createElement('section');panel.className='auth-card folder-card form-stack';
  const title=document.createElement('h1');title.id='changed-password-title';title.textContent=t('folder.passwordChanged');
  const message=document.createElement('p');message.textContent=t('folder.localPasswordNeeded');
  const report=document.createElement('p');report.className='form-error';report.setAttribute('role','alert');
  const actions=document.createElement('div');actions.className='folder-actions';
  const add=(name,work)=>{
    const button=document.createElement('button');button.type='button';button.className='btn-secondary';
    button.dataset.folderAction=name;button.textContent=t('folder.'+name);
    button.addEventListener('click',async()=>{
      if(busy||signal.aborted)return;
      busy=true;
      const buttons=[...actions.querySelectorAll('button')];buttons.forEach(node=>node.disabled=true);
      try{await work();}
      catch(error){if(!signal.aborted)report.textContent=t(error.code||'folder.actionFailed');}
      finally{busy=false;buttons.forEach(node=>node.disabled=false);if(!onOpenCopy)copy.disabled=true;}
    },{signal});
    actions.append(button);return button;
  };
  const enter=add('enterLocalPassword',async()=>{
    let password=await passwordDialog(t('folder.localPasswordNeeded'),{title:t('folder.enterLocalPassword'),label:t('account.current'),signal});
    if(password===null)return;
    let key;
    try{
      key=await deriveKey(password,base64ToArray(attempt.snapshot.meta.salt));
      if(!await verifyKeyCheck(key,attempt.snapshot.meta.keyCheck))throw folderFailure('login.wrongPassword');
      await decryptRecords(attempt.snapshot.notes,key);
    }finally{password='';}
    if(signal.aborted)return;
    await openSaltReconciliation({root,...attempt,key,signal,login:true,onApplied:outcome=>finish(outcome.access.key,{
      handle:attempt.handle,changed:true,head:outcome.head,stats:outcome.stats,target:outcome.access.target,
    }),onExit,onOpenReadOnly:()=>finish(key,{handle:attempt.handle,readOnly:true})});
  });
  enter.className='btn-primary';
  const copy=add('openFolderCopy',()=>onOpenCopy(attempt));copy.disabled=!onOpenCopy;
  add('exit',onExit);
  panel.append(title,message,report,actions);container.append(panel);wrapper.append(container);root.replaceChildren(wrapper);
  focusPanel(panel,{signal,titleId:title.id,initial:'[data-folder-action=enterLocalPassword]'});
  const timer=setTimeout(onExit,5*60*1000);
  signal.addEventListener('abort',()=>{clearTimeout(timer);attempt=null;},{once:true});
}
