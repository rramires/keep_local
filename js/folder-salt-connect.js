import {readVault,storeFolderConnection,setWriteMode} from './db.js';
import {requireFolderSession} from './folder-reconcile.js';
import {withVaultLineage} from './folder-write.js';
import {askFolderPassword} from './folder-other-salt.js';
import {openSaltReconciliation} from './folder-salt-ui.js';

export async function connectSaltFolder({root,selection,key,signal,onApplied,onExit,onOpenReadOnly}) {
  const foreign=await askFolderPassword(selection.handle,signal);
  if(!foreign||signal.aborted)return false;
  const snapshot=await withVaultLineage(async()=>{
    await requireFolderSession(selection.snapshot,key,signal);
    await storeFolderConnection(selection.handle,selection.snapshot.meta,selection.snapshot.meta.vaultId,{signal,transition:true});
    setWriteMode('readOnly');
    return readVault();
  });
  await openSaltReconciliation({root,handle:selection.handle,snapshot,key,foreign,signal,target:'folder',onApplied,onExit,onOpenReadOnly});
  return true;
}
