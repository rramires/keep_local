import {isReadOnly,readVault,setWriteMode} from './db.js';
import {hasPendingDrafts,watchLocalChanges} from './backup.js';
import {enableFolderWrites} from './folder-store.js';
import {createFolderWriter,folderFailure,withVaultLineage} from './folder-write.js';
import {decideFolderAction,pullFolderHead,requireFolderSession,resolveFolderReview} from './folder-reconcile.js';

export function createFolderSync({handle,key,signal,onUnavailable,onStatus=()=>{},onReview=()=>{},onPulled=()=>{},onIgnored=()=>{}}) {
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
    if(!snapshot.meta.syncFolder||!await handle.isSameEntry(snapshot.meta.syncFolder))
      throw folderFailure('folder.changed');
    const state=await writer.scan(snapshot.meta.salt);
    await requireFolderSession(snapshot,key,lifetime);
    if(!admitting&&isReadOnly())return {status:'paused'};
    if(!admitting&&hasPendingDrafts())return {status:'push'};
    const decision=decideFolderAction(snapshot,state);
    if(['push','pull','saved'].includes(decision)){
      const ignored=[...state.unreadable,...state.tooLarge,...state.otherSalt].sort();
      const warning=JSON.stringify(ignored);
      if(ignored.length&&warning!==lastWarning)onIgnored();
      lastWarning=warning;
    }
    if(decision==='pull'){
      const reading=isReadOnly();
      setWriteMode('readOnly');
      try{return await pullFolderHead(handle,state.head,snapshot,key,lifetime);}
      catch(error){if(!lifetime.aborted&&!reading)setWriteMode('readWrite');throw error;}
    }
    if(decision!=='push'&&decision!=='saved'){
      setWriteMode('readOnly');
      return {status:decision,snapshot,state};
    }
    if(admitting)await enableFolderWrites({key,signal:lifetime});
    if(admitting||decision==='saved')return {status:decision,writtenAt:snapshot.meta.folderWrittenAt};
    const result=await writer.write(snapshot,state);
    return {status:'saved',writtenAt:result.writtenAt,hasNewChanges:result.hasNewChanges};
  }

  async function interpret(outcome) {
    if(lifetime.aborted)return false;
    if(['rollback','conflict','otherSalt','unreadableCopy'].includes(outcome.status)){
      onStatus('readOnly');
      onReview(outcome);
      return false;
    }
    if(outcome.status==='pulled'){
      onStatus('saved',Date.parse(outcome.head.exportedAt));
      await onPulled(outcome.head);
    }else if(outcome.status==='saved')onStatus('saved',outcome.writtenAt);
    else if(outcome.status==='push')schedule();
    return true;
  }

  function accessIssue(error) {
    if(!['NotFoundError','NotAllowedError','SecurityError'].includes(error.name))return false;
    setWriteMode('readOnly');
    onStatus('readOnly');
    onUnavailable(handle,error.name==='NotFoundError'?'notFound':'denied');
    return true;
  }

  async function admit() {
    try {return interpret(await withVaultLineage(()=>inspect(true)));}
    catch(error) {
      if(lifetime.aborted)return false;
      if(!accessIssue(error))throw error;
      return false;
    }
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
    const result=await withVaultLineage(()=>resolveFolderReview({handle,writer,review,choice,name,key,signal:lifetime}));
    if(result.status==='pulled')await interpret(result);
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
