import {isReadOnly,readVault,recordFolderWrite,setWriteMode} from './db.js';
import {hasPendingDrafts,watchLocalChanges} from './backup.js';
import {enableFolderWrites,folderError} from './folder-store.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {createFolderWriter,folderFailure,folderStamp,withVaultLineage} from './folder-write.js';
import {decideFolderAction,executeFolderMerge,pullFolderHead,requireFolderSession,resolveFolderReview} from './folder-reconcile.js';

export function createFolderSync({handle,key,signal,onUnavailable,onStatus=()=>{},onReview=()=>{},onPulled=()=>{},onMerged=()=>{},onIgnored=()=>{},onEmptyMainReplaced=()=>{}}) {
  const controller=new AbortController(),lifetime=controller.signal;
  signal.addEventListener('abort',()=>controller.abort(),{once:true});
  const writer=createFolderWriter(handle,key,lifetime);
  let timer=null,running=false,queued=false,backoff=1000,lastWarning=null;

  function schedule(delay=1500) {
    if(lifetime.aborted||isReadOnly())return;
    clearTimeout(timer);
    onStatus('pending');
    timer=setTimeout(()=>void run(),delay);
  }

  async function inspect(admitting=false) {
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
      const outcome=await executeFolderMerge({handle,writer,snapshot,state,key,signal:lifetime,allowReadOnly:admitting});
      if(admitting&&isReadOnly())await enableFolderWrites({key,signal:lifetime});
      return outcome;
    }
    if(decision==='pull'){
      const reading=isReadOnly();
      setWriteMode('readOnly');
      try{return await pullFolderHead(handle,state.head,snapshot,key,lifetime,{notifyDeletions:true});}
      catch(error){if(!lifetime.aborted&&!reading&&error.name!=='TimeoutError')setWriteMode('readWrite');throw error;}
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
    const result=await writer.write(snapshot,state);
    return {...result,status:'saved'};
  }

  async function interpret(outcome) {
    if(lifetime.aborted)return false;
    if(['rollback','conflict','otherSalt','unreadableCopy'].includes(outcome.status)){
      onStatus('readOnly');
      onReview(outcome);
      return false;
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

  function accessIssue(error) {
    const status=folderError(error);
    if(status.startsWith('error:'))return false;
    setWriteMode('readOnly');
    if(status==='unresponsive')controller.abort();
    onStatus('readOnly');
    onUnavailable(handle,status);
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
        if(!accessIssue(error))throw error;
        return false;
      }
    }
    return false;
  }

  async function run() {
    clearTimeout(timer);
    if(lifetime.aborted||isReadOnly())return;
    if(running){queued=true;return;}
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
      if(lifetime.aborted||error.code==='session.ended'||accessIssue(error))return;
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

  async function resolve(review,choice,name) {
    const result=await withVaultLineage(async()=>{
      const result=await resolveFolderReview({handle,writer,review,choice,name,key,signal:lifetime});
      if(result.status==='merged'&&isReadOnly())await enableFolderWrites({key,signal:lifetime});
      return result;
    });
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
  return {schedule,flush,admit,resolve,dispose:()=>controller.abort()};
}
