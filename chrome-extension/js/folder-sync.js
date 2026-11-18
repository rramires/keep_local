import {isReadOnly,readVault} from './db.js';
import {watchLocalChanges} from './backup.js';
import {createFolderWriter,localFolderDirty,unsafeFolder,withVaultLineage} from './folder-write.js';

export function createFolderSync({handle,key,signal,onUnavailable,onStatus=()=>{},onReview=()=>{}}) {
  const controller=new AbortController(),lifetime=controller.signal;
  signal.addEventListener('abort',()=>controller.abort(),{once:true});
  const writer=createFolderWriter(handle,key,lifetime);
  let timer=null,running=false,queued=false,backoff=1000;

  function schedule(delay=1500) {
    if(lifetime.aborted||isReadOnly())return;
    clearTimeout(timer);
    onStatus('pending');
    timer=setTimeout(()=>void run(),delay);
  }

  async function run() {
    clearTimeout(timer);
    if(lifetime.aborted||isReadOnly())return;
    if(running){queued=true;return;}
    running=true;
    let retry;
    try {
      await withVaultLineage(async()=>{
        if(lifetime.aborted||isReadOnly())return;
        const snapshot=await readVault();
        if(!snapshot.meta.syncFolder||!await handle.isSameEntry(snapshot.meta.syncFolder))return;
        const state=await writer.scan(snapshot.meta.salt);
        if(lifetime.aborted||isReadOnly())return;
        const expected=snapshot.meta.folderSyncedHash;
        if(unsafeFolder(state)||state.divergent||(state.head?.hash??null)!==(expected??null)){
          onReview(snapshot,state);
          return;
        }
        if(expected&&!localFolderDirty(snapshot.meta)){
          onStatus('saved',snapshot.meta.folderWrittenAt);
          return;
        }
        const result=await writer.write(snapshot,state);
        backoff=1000;
        onStatus('saved',result.writtenAt);
        if(result.hasNewChanges)queued=true;
      });
    }catch(error){
      if(lifetime.aborted||error.code==='session.ended')return;
      if(['NotFoundError','NotAllowedError','SecurityError'].includes(error.name)){
        onUnavailable(handle,error.name==='NotFoundError'?'notFound':'denied');
        return;
      }
      onStatus('error',error.code||error.name);
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

  const flush=()=>void run();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();},{signal:lifetime});
  window.addEventListener('pagehide',flush,{signal:lifetime});
  const unwatch=watchLocalChanges(()=>schedule());
  lifetime.addEventListener('abort',()=>{clearTimeout(timer);unwatch();},{once:true});
  return {schedule,flush,dispose:()=>controller.abort()};
}
