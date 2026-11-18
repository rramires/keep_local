import {base64ToArray} from './crypto.js';
import {BACKUP_PROFILES,decodePayloadV2,payloadHash} from './backup-v2.js';
import {MAX_BACKUP_BYTES,decryptRecords,validateRecords} from './backup-format.js';

export const MAIN_FILE='keeplocal-vault.keeplocal';
const MAX_CANDIDATES=32;

export async function listCandidates(handle) {
  const entries=[];
  for await(const [name,entry] of handle.entries()){
    if(entry.kind!=='file'||!/\.keeplocal$/i.test(name))continue;
    if(entries.length===MAX_CANDIDATES)return {entries,limitExceeded:true};
    entries.push({name,entry});
  }
  return {entries,limitExceeded:false};
}

export async function decodeV2WithKey(bytes,key,localSaltB64) {
  if(bytes.length<16)return {status:'unreadable'};
  const salt=base64ToArray(localSaltB64);
  if(salt.length!==16||salt.some((value,index)=>bytes[index]!==value))return {status:'otherSalt'};
  if(bytes.length<44||bytes.length>MAX_BACKUP_BYTES)return {status:'unreadable'};
  try{
    const {payload,payloadText}=await decodePayloadV2(bytes,key,BACKUP_PROFILES[0]);
    validateRecords(payload.notes);
    await decryptRecords(payload.notes,key);
    return {status:'valid',rev:payload.rev,parent:payload.parent,hash:await payloadHash(payloadText),payload,exportedAt:payload.exportedAt};
  }catch{return {status:'unreadable'};}
}

export async function readFolderCandidate(entry,key,salt) {
  const file=await entry.getFile();
  if(file.size>MAX_BACKUP_BYTES)return {status:'tooLarge'};
  return decodeV2WithKey(new Uint8Array(await file.arrayBuffer()),key,salt);
}

export async function readFolderState(handle,key,salt) {
  const {entries,limitExceeded}=await listCandidates(handle);
  const state={head:null,candidates:[],divergent:false,unreadable:[],otherSalt:[],tooLarge:[],limitExceeded};
  for(const {name,entry} of entries){
    const result=await readFolderCandidate(entry,key,salt);
    const {payload,...summary}=result;
    state.candidates.push({name,...summary});
    if(result.status!=='valid'){
      state[result.status].push(name);
      continue;
    }
    if(!state.head||result.rev>state.head.rev){
      state.head={name,...result};
      state.divergent=false;
    }else if(result.rev===state.head.rev){
      if(result.hash!==state.head.hash)state.divergent=true;
      if(name===MAIN_FILE)state.head={name,...result};
    }
  }
  return state;
}
