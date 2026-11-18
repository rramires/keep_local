import {base64ToArray} from './crypto.js';
import {encodeV2,makePayload,payloadHash} from './backup-v2.js';
import {decryptRecords,validateRecords} from './backup-format.js';
import {assertWritable,readVault,recordFolderWrite,verifyFolderWrite} from './db.js';
import {MAIN_FILE,readFolderCandidate,readFolderState} from './folder-vault.js';

export function folderFailure(code) {
  return Object.assign(new Error(code),{code});
}

export function withVaultLineage(operation) {
  return globalThis.navigator?.locks?.request('keeplocal-vault-lineage',operation) ?? operation();
}

export function folderStamp(state) {
  return JSON.stringify([state.limitExceeded,state.candidates.map(({name,status,rev,hash})=>[name,status,rev,hash])
    .sort(([left],[right])=>left.localeCompare(right))]);
}

export function localFolderDirty(meta) {
  return (meta.revision||0)!==(meta.folderSyncedRevision||0);
}

export function unsafeFolder(state) {
  const main=state.candidates.find(row=>row.name===MAIN_FILE);
  return !!(state.limitExceeded||(main&&main.status!=='valid')||
    (!state.head&&(state.otherSalt.length||state.unreadable.length||state.tooLarge.length)));
}

export function createFolderWriter(handle,key,signal) {
  let placeholder=null;

  async function scan(salt) {
    const state=await readFolderState(handle,key,salt);
    if(placeholder&&state.unreadable.includes(MAIN_FILE)){
      const current=await handle.getFileHandle(MAIN_FILE);
      if(await placeholder.isSameEntry(current)&&(await current.getFile()).size===0){
        state.candidates=state.candidates.filter(row=>row.name!==MAIN_FILE);
        state.unreadable=state.unreadable.filter(name=>name!==MAIN_FILE);
      }
    }
    return state;
  }

  async function write(snapshot,state,{replace=false}={}) {
    const {notes,meta}=snapshot;
    assertWritable();
    if(signal?.aborted)throw folderFailure('session.ended');
    if(unsafeFolder(state)||(!replace&&state.divergent))throw folderFailure('folder.changed');
    try {validateRecords(notes);await decryptRecords(notes,key);}
    catch {throw folderFailure('folder.unreadable');}
    const rev=Math.max(meta.exportRev||0,meta.folderSeenRev||0,state.head?.rev||0)+1;
    if(!Number.isSafeInteger(rev))throw folderFailure('backup.invalidFile');
    const parent=replace?state.head?.hash??null:meta.exportParent||null;
    const preferences=Object.fromEntries(['theme','lang'].filter(name=>meta[name]!==undefined).map(name=>[name,meta[name]]));
    const payload=makePayload(notes,preferences,rev,parent);
    const hash=await payloadHash(JSON.stringify(payload));
    const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
    const expected=folderStamp(state);
    const verify=async()=>{
      assertWritable();
      if(signal?.aborted)throw folderFailure('session.ended');
      if(folderStamp(await scan(meta.salt))!==expected)throw folderFailure('folder.changed');
      await verifyFolderWrite(meta,{signal});
    };
    await verify();
    let file;
    try {file=await handle.getFileHandle(MAIN_FILE);}
    catch(error){
      if(error.name!=='NotFoundError'||state.candidates.some(row=>row.name===MAIN_FILE))throw error;
      assertWritable();
      if(signal?.aborted)throw folderFailure('session.ended');
      file=await handle.getFileHandle(MAIN_FILE,{create:true});
      if((await file.getFile()).size!==0)throw folderFailure('folder.changed');
      placeholder=file;
    }
    assertWritable();
    if(signal?.aborted)throw folderFailure('session.ended');
    const writable=await file.createWritable({mode:'exclusive'});
    try {
      await writable.write(bytes);
      await verify();
      assertWritable();
      if(signal?.aborted)throw folderFailure('session.ended');
      await writable.close();
    } catch(error) {
      await writable.abort().catch(()=>{});
      throw error;
    }
    placeholder=null;
    const checked=await readFolderCandidate(file,key,meta.salt);
    if(checked.status!=='valid'||checked.hash!==hash)throw folderFailure('folder.readback');
    const writtenAt=Date.parse(payload.exportedAt);
    await recordFolderWrite(meta,{rev,hash,writtenAt},{signal});
    return {rev,hash,writtenAt,hasNewChanges:localFolderDirty((await readVault()).meta)};
  }

  return {scan,write};
}
