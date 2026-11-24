import {getMeta,isReadOnly,readVault,recordFolderWrite,setWriteMode,verifyFolderWrite} from './db.js';
import {hasPendingDrafts,watchLocalChanges} from './backup.js';
import {enableFolderWrites,folderError} from './folder-store.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {createFolderWriter,folderFailure,folderStamp,localFolderDirty,withVaultLineage} from './folder-write.js';
import {decideFolderAction,executeFolderMerge,pullFolderHead,requireFolderSession,resolveFolderReview} from './folder-reconcile.js';
import {MAIN_FILE,readFolderCandidate} from './folder-vault.js';
import {PHOTO_FOLDER_CHANGE,photoErrorDetails,requestPhotoPermission,updatePhotoStatus} from './photo-folder.js';
import {writeFolderPhoto} from './photo-write.js';

export function createFolderSync({handle,key,signal,photoFolder,onUnavailable,onStatus=()=>{},onReview=()=>{},onPulled=()=>{},onPullCommit=()=>{},onMerged=()=>{},onIgnored=()=>{},onEmptyMainReplaced=()=>{}}) {
  const controller=new AbortController(),lifetime=controller.signal;
  signal.addEventListener('abort',()=>controller.abort(),{once:true});
  const writer=createFolderWriter(handle,key,lifetime);
  let timer=null,running=false,queued=false,backoff=1000,lastWarning=null,writingNow=false;
  window.addEventListener(PHOTO_FOLDER_CHANGE,event=>{photoFolder=event.detail;},{signal:lifetime});

  function schedule(delay=1500) {
    if(lifetime.aborted||isReadOnly())return;
    if(writingNow){queued=true;return;}
    clearTimeout(timer);
    onStatus('pending');
    timer=setTimeout(()=>void run(),delay);
  }

  async function inspect(admitting=false,skipPhoto=false) {
    const snapshot=await readVault();
    await requireFolderSession(snapshot,key,lifetime);
    if(!snapshot.meta.syncFolder||!await withFolderReadTimeout(()=>handle.isSameEntry(snapshot.meta.syncFolder)))
      throw folderFailure('folder.changed');
    const state=await writer.scan(snapshot.meta.salt);
    await requireFolderSession(snapshot,key,lifetime);
    if(!admitting&&isReadOnly())return {status:'paused'};
    if(!admitting&&hasPendingDrafts())return {status:'push'};
    const decision=decideFolderAction(snapshot,state);
    if(['push','pull','saved','adopt','merge'].includes(decision)){
      const ignored=[...state.unreadable,...state.tooLarge,...state.otherSalt].sort();
      const warning=JSON.stringify(ignored);
      if(ignored.length&&warning!==lastWarning)onIgnored();
      lastWarning=warning;
    }
    if(decision==='merge'){
      const outcome=await executeFolderMerge({handle,writer,snapshot,state,key,signal:lifetime,allowReadOnly:admitting,skipPhoto});
      if(admitting&&isReadOnly())await enableFolderWrites({key,signal:lifetime});
      return outcome;
    }
    if(decision==='pull'){
      const reading=isReadOnly();
      let restoreInput;
      try{
        const outcome=await pullFolderHead(handle,state.head,snapshot,key,lifetime,{
          notifyDeletions:true,
          beforeReplace:()=>{
            if(!admitting&&hasPendingDrafts())throw folderFailure('folder.pendingDrafts');
            setWriteMode('readOnly');
            restoreInput=onPullCommit();
          },
        });
        return {...outcome,restoreInput};
      }catch(error){
        restoreInput?.();
        if(error.code==='folder.pendingDrafts')return {status:'push'};
        if(!lifetime.aborted&&!reading&&error.name!=='TimeoutError')setWriteMode('readWrite');
        throw error;
      }
    }
    if(decision==='adopt'){
      if(folderStamp(await writer.scan(snapshot.meta.salt))!==folderStamp(state))
        throw folderFailure('folder.changed');
      await requireFolderSession(snapshot,key,lifetime);
      const writtenAt=Date.parse(state.head.exportedAt);
      await recordFolderWrite(snapshot.meta,state.head,{signal:lifetime,adopt:true});
      if(admitting)await enableFolderWrites({key,signal:lifetime});
      return {status:'saved',writtenAt};
    }
    if(decision!=='push'&&decision!=='saved'){
      setWriteMode('readOnly');
      return {status:decision,snapshot,state};
    }
    if(admitting)await enableFolderWrites({key,signal:lifetime});
    if(admitting||decision==='saved')return {status:decision,writtenAt:snapshot.meta.folderWrittenAt};
    const result=await writer.write(snapshot,state,{skipPhoto});
    return {...result,status:'saved'};
  }

  async function interpret(outcome) {
    try{return await interpretOutcome(outcome);}
    finally{outcome.restoreInput?.();}
  }

  async function interpretOutcome(outcome) {
    if(lifetime.aborted)return false;
    if(['rollback','conflict','otherSalt','unreadableCopy'].includes(outcome.status)){
      onStatus('readOnly');
      onReview(outcome);
      return false;
    }
    if(outcome.applied||outcome.status==='pulled'){
      photoFolder=await getMeta('photoFolder');
      if(lifetime.aborted)return false;
    }
    if(outcome.status==='merged'){
      onStatus('saved',Date.parse(outcome.head.exportedAt));
      if(outcome.applied)await onPulled(outcome.head,outcome.stats);
      else onMerged(outcome.stats);
      if(outcome.replacedEmptyMain)onEmptyMainReplaced();
    }else if(outcome.status==='pulled'){
      onStatus('saved',Date.parse(outcome.head.exportedAt));
      await onPulled(outcome.head,outcome.stats);
    }else if(outcome.status==='saved'){
      onStatus('saved',outcome.writtenAt);
      if(outcome.replacedEmptyMain)onEmptyMainReplaced();
    }
    else if(outcome.status==='push')schedule();
    return true;
  }

  async function accessIssue(error) {
    const status=folderError(error);
    if(status.startsWith('error:'))return false;
    setWriteMode('readOnly');
    if(status==='unresponsive')controller.abort();
    onStatus('readOnly');
    await onUnavailable(handle,status);
    return true;
  }

  async function admit() {
    while(!lifetime.aborted){
      try {return interpret(await withVaultLineage(()=>inspect(true)));}
      catch(error) {
        if(lifetime.aborted)return false;
        // A guarded replacement may have raced an edit in another tab.
        // Inspecting again also rechecks the session identity before any write.
        if(error.code==='vault.changed')continue;
        if(!await accessIssue(error))throw error;
        return false;
      }
    }
    return false;
  }

  async function run() {
    clearTimeout(timer);
    if(lifetime.aborted||isReadOnly())return;
    if(running||writingNow){queued=true;return;}
    if(hasPendingDrafts()){schedule();return;}
    running=true;
    let retry;
    try {
      const outcome=await withVaultLineage(async()=>{
        if(lifetime.aborted||isReadOnly())return {status:'paused'};
        return inspect();
      });
      await interpret(outcome);
      backoff=1000;
      if(outcome.hasNewChanges)queued=true;
    }catch(error){
      if(lifetime.aborted||error.code==='session.ended'||await accessIssue(error))return;
      onStatus('error',typeof error.code==='string'?error.code:error.name);
      if(error.code!=='folder.unreadable'){
        retry=backoff;
        backoff=Math.min(backoff*2,30000);
      }
    }finally{
      running=false;
      if(queued){queued=false;schedule();}
      else if(retry!==undefined&&!lifetime.aborted&&!isReadOnly())timer=setTimeout(()=>void run(),retry);
    }
  }

  async function finishWriteNow(permissionFailure) {
    const {meta}=await readVault();
    photoFolder=meta.photoFolder;
    if(isReadOnly()||hasPendingDrafts()||localFolderDirty(meta))throw folderFailure('writeNow.pending');
    const verify=async()=>{
      await requireFolderSession({meta},key,lifetime);
      if(isReadOnly()||hasPendingDrafts())throw folderFailure('writeNow.pending');
      await verifyFolderWrite(meta,{signal:lifetime,replaceLocal:true});
    };
    await verify();
    const entry=await withFolderReadTimeout(()=>handle.getFileHandle(MAIN_FILE));
    const primary=await readFolderCandidate(entry,key,meta.salt,{includeBytes:!!photoFolder});
    if(primary.status!=='valid'||primary.hash!==meta.folderSyncedHash)throw folderFailure('folder.changed');
    await verify();
    let photo=null;
    if(photoFolder){
      if(permissionFailure){
        updatePhotoStatus(meta,permissionFailure);
        photo={failure:permissionFailure};
      }else photo=await writeFolderPhoto(meta,primary,primary.bytes,key,lifetime,{force:true,verify});
    }
    return {writtenAt:meta.folderWrittenAt,photo};
  }

  async function writeNow(flushDrafts) {
    if(writingNow||lifetime.aborted||isReadOnly())return null;
    writingNow=true;
    clearTimeout(timer);
    try{
      // Ask in the click's user activation, before flushing drafts or waiting for the lock.
      let permissionFailure;
      if(photoFolder){
        try{
          if(await requestPhotoPermission(photoFolder)!=='granted')permissionFailure={code:'photo.permission'};
        }catch(error){permissionFailure=photoErrorDetails(error);}
      }
      if(lifetime.aborted)return null;
      if(!await flushDrafts())return {reason:'writeNow.pending'};
      const {outcome,result}=await withVaultLineage(async()=>{
        const outcome=await inspect(false,true);
        if(['rollback','conflict','otherSalt','unreadableCopy'].includes(outcome.status))return {outcome};
        if(outcome.status==='push')return {outcome,result:{reason:'writeNow.pending'}};
        try{return {outcome,result:await finishWriteNow(permissionFailure)};}
        catch(error){outcome.restoreInput?.();throw error;}
      });
      if(!await interpret(outcome))return lifetime.aborted?null:{review:true};
      return result;
    }catch(error){
      if(lifetime.aborted||error.code==='session.ended')return null;
      const access=folderError(error);
      if(await accessIssue(error))return {reason:'folder.'+access};
      const reason=typeof error.code==='string'?error.code:'writeNow.failed';
      onStatus('error',reason);
      return {reason};
    }finally{
      writingNow=false;
      if(queued&&!running){
        queued=false;
        schedule();
      }
    }
  }

  async function resolve(review,choice,name) {
    const result=await withVaultLineage(async()=>{
      const result=await resolveFolderReview({handle,writer,review,choice,name,key,signal:lifetime});
      if(result.status==='merged'&&isReadOnly())await enableFolderWrites({key,signal:lifetime});
      return result;
    });
    photoFolder=await getMeta('photoFolder');
    if(['pulled','merged'].includes(result.status))await interpret(result);
    else onStatus('saved',result.result.writtenAt);
    return result;
  }

  const flush=()=>void run();
  document.addEventListener('visibilitychange',flush,{signal:lifetime});
  window.addEventListener('focus',flush,{signal:lifetime});
  window.addEventListener('pagehide',flush,{signal:lifetime});
  const unwatch=watchLocalChanges(()=>schedule());
  lifetime.addEventListener('abort',()=>{clearTimeout(timer);unwatch();},{once:true});
  return {schedule,flush,admit,resolve,writeNow,writingNow:()=>writingNow,dispose:()=>controller.abort()};
}
