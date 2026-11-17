import { validateNote } from './note-model.js';
import { exportBackup,setUnsaved } from './backup.js';
import { discardPreservedRecord } from './db.js';
import { getSessionKey,getSessionVaultId } from './session.js';
import { publishVaultEvent } from './vault-events.js';
import { t } from './i18n.js';
export function recoveredNote(text) {
  const now=Date.now();
  return validateNote({id:crypto.randomUUID(),type:'text',title:t('recovery.newTitle'),content:text,color:'default',pinned:false,labels:[],createdAt:now,updatedAt:now,order:0,deletedAt:null,archivedAt:null});
}
export async function discardRecord(record,confirmation,{signal,key}={}) {
  if(confirmation!==t('recovery.discardWord'))throw Error('recovery.confirmRequired');
  if(signal?.aborted||key!==await getSessionKey())throw Error('session.ended');
  const archive=await exportBackup();
  if(!archive)return false;
  if(signal?.aborted||key!==await getSessionKey()||archive.meta.vaultId!==getSessionVaultId())throw Error('session.ended');
  if(!archive.notes.some(r=>JSON.stringify(r)===JSON.stringify(record)))throw Error('recovery.changed');
  await discardPreservedRecord(record,archive.meta,{signal});
  setUnsaved();publishVaultEvent('note-changed',{id:record.id});return true;
}
