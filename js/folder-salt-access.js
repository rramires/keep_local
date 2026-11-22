import {createKeyCheck} from './crypto.js';
import {readFolderState,readFolderCandidate,MAIN_FILE} from './folder-vault.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {convertFolderCopy,convertFolderSnapshot,decideSaltAction,folderSaltTarget} from './folder-salt.js';
import {createFolderWriter,folderFailure} from './folder-write.js';
import {preserveFolderChoice,preserveLocalChoice} from './folder-preserve.js';
import {applyFolderCopy,executeFolderMerge} from './folder-reconcile.js';

export async function createSaltAccess({handle,snapshot,key,foreign,target,signal}) {
  const sourceFor=salt=>salt===foreign.salt?foreign:{salt:snapshot.meta.salt,key};
  target??=folderSaltTarget(snapshot.meta,await readForeignHead());
  const destination=target==='folder'?foreign:{salt:snapshot.meta.salt,key};
  const convertSnapshot=value=>convertFolderSnapshot(value,key,destination.key);

  async function readForeignHead() {
    const state=await readFolderState(handle,key,snapshot.meta.salt,foreign);
    const main=state.candidates.find(copy=>copy.name===MAIN_FILE&&copy.salt===foreign.salt&&copy.status==='valid');
    if(!main)throw folderFailure('folder.changed');
    return readCopySource(main);
  }

  async function readCopySource(copy) {
    const file=await withFolderReadTimeout(()=>handle.getFileHandle(copy.name));
    const source=sourceFor(copy.salt);
    const result=await readFolderCandidate(file,source.key,source.salt);
    if(result.status!=='valid'||result.hash!==copy.hash)throw folderFailure('folder.changed');
    return {name:copy.name,...result};
  }

  async function readCopy(copy) {
    const original=await readCopySource(copy);
    return convertFolderCopy(original,sourceFor(original.salt).key,destination.key);
  }

  async function scan() {
    const state=await readFolderState(handle,key,snapshot.meta.salt,foreign);
    if(state.head)state.head=await convertFolderCopy(state.head,sourceFor(state.head.salt).key,destination.key);
    return state;
  }

  async function preserve(state) {
    const copies=state.candidates.filter(copy=>copy.status==='valid'&&(copy.name===MAIN_FILE||copy.rev===state.head?.rev));
    const names=[];
    for(const copy of copies){
      const source=sourceFor(copy.salt);
      names.push(...await preserveFolderChoice(handle,[copy],source.key,source.salt,signal));
    }
    return names;
  }

  return {
    target,salt:destination.salt,key:destination.key,sessionKey:key,
    meta:{salt:destination.salt,keyCheck:await createKeyCheck(destination.key)},
    snapshot:await convertSnapshot(snapshot),convertSnapshot,scan,readCopy,preserve,
    preserveLocal:()=>preserveLocalChoice(handle,snapshot,key,signal),
  };
}

export async function reconcileSaltFolder({handle,snapshot,key,foreign,signal,target,login=false}) {
  const access=await createSaltAccess({handle,snapshot,key,foreign,signal,target});
  access.login=login;
  const state=await access.scan();
  const prepared=access.snapshot;
  const decision=await decideSaltAction(prepared,state,access.key,access.key);
  const writer=createFolderWriter(handle,access.key,signal,access);
  const context={handle,snapshot:prepared,state,key:access.key,writer,signal,access};
  if(['conflict','rollback','unreadableCopy','otherSalt'].includes(decision))
    return {...context,status:decision};
  if(decision==='merge')return {...await executeFolderMerge({...context,allowReadOnly:true}),access};
  let head=state.head;
  if(decision==='push'||head.salt!==access.salt){
    const selected=decision==='push'?{...head,payload:{...head?.payload,notes:prepared.notes,
      preferences:Object.fromEntries(['theme','lang'].filter(name=>prepared.meta[name]!==undefined).map(name=>[name,prepared.meta[name]])),
      tombstones:prepared.meta.tombstones??[]}}:head;
    head=await writer.writeChosen(prepared,state,selected);
  }else head=await access.readCopy(head);
  return {...await applyFolderCopy(head,prepared,access.key,signal,{access}),access};
}
