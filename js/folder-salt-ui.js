import {reconcileSaltFolder} from './folder-salt-access.js';
import {withVaultLineage} from './folder-write.js';
import {resolveFolderReview} from './folder-reconcile.js';
import {renderFolderReview} from './folder-review.js';
import {exportBackup} from './backup.js';

export async function openSaltReconciliation({root,handle,snapshot,key,foreign,signal,target,login=false,onApplied,onExit,onOpenReadOnly}) {
  const outcome=await withVaultLineage(()=>reconcileSaltFolder({handle,snapshot,key,foreign,signal,target,login}));
  if(signal.aborted)return;
  if(!['conflict','rollback','otherSalt','unreadableCopy'].includes(outcome.status))return onApplied(outcome);
  renderFolderReview(root,outcome,{
    handle,signal,onExit,onOpenReadOnly,onRefresh:onExit,
    onExportLocal:()=>exportBackup({source:{key,snapshot}}),
    resolve:async(choice,name)=>{
      const resolved=await withVaultLineage(()=>resolveFolderReview({...outcome,review:outcome,choice,name}));
      if(!signal.aborted)await onApplied({...resolved,access:outcome.access});
    },
  });
}
