import {readVault,replaceFolderHandle,storeFolderConnection,setWriteMode} from './db.js';
import {requireFolderSession} from './folder-reconcile.js';
import {withVaultLineage} from './folder-write.js';
import {askFolderPassword} from './folder-other-salt.js';
import {openSaltReconciliation} from './folder-salt-ui.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {offerDeviceName} from './device-name-ui.js';

export async function connectSaltFolder({root,selection,key,signal,onApplied,onExit,onOpenReadOnly,notify}) {
  const foreign=await askFolderPassword(selection.handle,signal);
  if(!foreign||signal.aborted)return false;
  const connection=await withVaultLineage(async()=>{
    await requireFolderSession(selection.snapshot,key,signal);
    const attached=selection.snapshot.meta.syncFolder;
    const sameFolder=attached&&await withFolderReadTimeout(()=>selection.handle.isSameEntry(attached));
    await requireFolderSession(selection.snapshot,key,signal);
    if(sameFolder){
      await replaceFolderHandle(selection.handle,selection.snapshot.meta,{signal});
      const snapshot={...selection.snapshot,meta:{...selection.snapshot.meta,syncFolder:selection.handle}};
      return {snapshot};
    }
    await storeFolderConnection(selection.handle,selection.snapshot.meta,selection.snapshot.meta.vaultId,{signal,transition:true});
    setWriteMode('readOnly');
    return {snapshot:await readVault(),target:'folder'};
  });
  const deviceName=await offerDeviceName(signal,notify);
  if(signal.aborted)return false;
  if(deviceName)connection.snapshot.meta={...connection.snapshot.meta,deviceName};
  await openSaltReconciliation({root,handle:selection.handle,...connection,key,foreign,signal,onApplied,onExit,onOpenReadOnly});
  return true;
}
