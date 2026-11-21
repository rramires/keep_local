import {base64ToArray} from './crypto.js';
import {encodeV2,makePayload,payloadHash} from './backup-v2.js';
import {decryptRecords,validateRecords} from './backup-format.js';
import {assertWritable,readVault,recordFolderWrite,verifyFolderWrite} from './db.js';
import {pruneTombstones} from './folder-merge.js';
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
  return !!(state.limitExceeded||(main&&!['valid','emptyMain'].includes(main.status))||
    (!state.head&&(state.otherSalt.length||state.unreadable.length||state.tooLarge.length)));
}

export function createFolderWriter(handle,key,signal) {
  const scan=salt=>readFolderState(handle,key,salt);

  async function writeFile(snapshot,state,{replace,selected,allowReadOnly=!!selected}={}) {
    const {meta}=snapshot;
    const notes=selected?selected.payload.notes:snapshot.notes;
    const assertCurrent=()=>{
      if(!allowReadOnly)assertWritable();
      if(signal?.aborted)throw folderFailure('session.ended');
    };
    assertCurrent();
    if(unsafeFolder(state)||(!replace&&state.divergent))throw folderFailure('folder.changed');
    try {validateRecords(notes);await decryptRecords(notes,key);}
    catch {throw folderFailure('folder.unreadable');}
    const rev=Math.max(meta.exportRev||0,meta.folderSeenRev||0,state.head?.rev||0)+1;
    if(!Number.isSafeInteger(rev))throw folderFailure('backup.invalidFile');
    const parentCopy=selected??state.head;
    const parent=replace?parentCopy?.hash??null:meta.exportParent||null;
    const parentAncestors=replace?parentCopy?.payload.ancestors:meta.exportAncestors;
    const preferences=selected?.payload.preferences??Object.fromEntries(['theme','lang'].filter(name=>meta[name]!==undefined).map(name=>[name,meta[name]]));
    const tombstones=pruneTombstones(selected?.payload.tombstones??meta.tombstones??[]);
    const payload=makePayload(notes,preferences,rev,parent,tombstones,parentAncestors);
    const hash=await payloadHash(JSON.stringify(payload));
    const bytes=await encodeV2(key,base64ToArray(meta.salt),payload);
    const expected=folderStamp(state);
    const verify=async(created)=>{
      assertCurrent();
      const current=await scan(meta.salt);
      if(created&&current.candidates.some(row=>row.status==='emptyMain')){
        const entry=await handle.getFileHandle(MAIN_FILE);
        if(await created.isSameEntry(entry))
          current.candidates=current.candidates.filter(row=>row.status!=='emptyMain');
      }
      if(folderStamp(current)!==expected)throw folderFailure('folder.changed');
      await verifyFolderWrite(meta,{signal,replaceLocal:!!selected});
    };
    await verify();
    let file,created;
    try {file=await handle.getFileHandle(MAIN_FILE);}
    catch(error){
      if(error.name!=='NotFoundError'||state.candidates.some(row=>row.name===MAIN_FILE))throw error;
      assertCurrent();
      file=await handle.getFileHandle(MAIN_FILE,{create:true});
      if((await file.getFile()).size!==0)throw folderFailure('folder.changed');
      created=file;
    }
    assertCurrent();
    const writable=await file.createWritable({mode:'exclusive'});
    try {
      await writable.write(bytes);
      await verify(created);
      assertCurrent();
      await writable.close();
    } catch(error) {
      await writable.abort().catch(()=>{});
      throw error;
    }
    const checked=await readFolderCandidate(file,key,meta.salt);
    if(checked.status!=='valid'||checked.hash!==hash)throw folderFailure('folder.readback');
    return {name:MAIN_FILE,...checked,replacedEmptyMain:state.candidates.some(row=>row.status==='emptyMain')};
  }

  async function write(snapshot,state,options) {
    const {rev,hash,parent,payload,exportedAt,replacedEmptyMain}=await writeFile(snapshot,state,options);
    const writtenAt=Date.parse(exportedAt);
    await recordFolderWrite(snapshot.meta,{rev,hash,parent,ancestors:payload.ancestors,writtenAt,records:snapshot.notes},{signal});
    return {rev,hash,writtenAt,replacedEmptyMain,hasNewChanges:localFolderDirty((await readVault()).meta)};
  }

  // The explicit replacement commits the chosen records and lineage together after readback.
  const writeChosen=(snapshot,state,selected,options)=>writeFile(snapshot,state,{...options,replace:true,selected});
  return {scan,write,writeChosen};
}
