import {bytesHash} from './crypto.js';
import {MAX_BACKUP_BYTES} from './backup-format.js';
import {assertWritable,recordFolderHistory} from './db.js';
import {HISTORY_DIR,historySlots} from './folder-history.js';
import {preserveHistoryCopy} from './folder-preserve.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {decodeV2WithKey} from './folder-vault.js';

async function findEntry(read) {
  try {return await withFolderReadTimeout(read);}
  catch(error){
    if(error.name==='NotFoundError')return null;
    throw error;
  }
}

function readSlot(entry) {
  return withFolderReadTimeout(async()=>{
    const file=await entry.getFile();
    const bytes=file.size>MAX_BACKUP_BYTES?null:new Uint8Array(await file.arrayBuffer());
    return {size:file.size,bytes};
  },'file');
}

async function verifySlot(entry,observed) {
  const current=await readSlot(entry);
  if(!observed&&current.size===0)return;
  if(observed&&observed.size===current.size&&
      (!current.bytes||await bytesHash(current.bytes)===await bytesHash(observed.bytes)))return;
  throw new Error('folder.changed');
}

export async function writeFolderHistory(handle,key,meta,head,bytes,signal) {
  const slots=historySlots(new Date(head.exportedAt));
  const periods=[['day','folderHistoryDay'],['week','folderHistoryWeek']]
    .filter(([period,name])=>meta[name]!==slots[period].key);
  if(!periods.length)return;
  const assertCurrent=()=>{
    assertWritable();
    signal?.throwIfAborted();
  };
  assertCurrent();
  let directory=await findEntry(()=>handle.getDirectoryHandle(HISTORY_DIR));
  const hash=await bytesHash(bytes);
  const receipt={};
  for(const [period,name] of periods){
    assertCurrent();
    const slot=slots[period];
    const existing=directory&&await findEntry(()=>directory.getFileHandle(slot.name));
    const observed=existing&&await readSlot(existing);
    const old=observed?.bytes?.length?await decodeV2WithKey(observed.bytes,key,head.salt):null;
    const valid=old?.status==='valid';
    if(!valid||historySlots(new Date(old.exportedAt))[period].key!==slot.key){
      assertCurrent();
      directory??=await handle.getDirectoryHandle(HISTORY_DIR,{create:true});
      assertCurrent();
      const entry=existing??await directory.getFileHandle(slot.name,{create:true});
      assertCurrent();
      const stream=await entry.createWritable({mode:'exclusive'});
      try {
        // Recheck the bytes with the writer held before replacing an observed slot.
        await verifySlot(entry,observed);
        if(observed?.bytes?.length&&(!valid||old.rev>head.rev)){
          await preserveHistoryCopy(handle,observed.bytes,valid?old.rev:'unknown',assertCurrent);
        }
        assertCurrent();
        await stream.write(bytes);
        assertCurrent();
        await stream.close();
      }catch(error){
        await stream.abort().catch(()=>{});
        throw error;
      }
      const stored=await readSlot(entry);
      if(!stored.bytes||await bytesHash(stored.bytes)!==hash)throw new Error('folder.readback');
    }
    receipt[name]=slot.key;
    if(period==='day')receipt.folderHistoryAt=Date.now();
  }
  assertCurrent();
  await recordFolderHistory(meta,receipt,signal);
}
