import {listCandidates} from './folder-inventory.js';
import {base64ToArray,arrayToBase64,bytesHash} from './crypto.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {BACKUP_PROFILES,decodePayloadV2,payloadHash} from './backup-v2.js';
import {MAX_BACKUP_BYTES,decryptRecords,validateRecords} from './backup-format.js';

export const MAIN_FILE='keeplocal-vault.keeplocal';
export {listCandidates} from './folder-inventory.js';

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

export async function readFolderCandidate(entry,key,salt,{allowEmpty=false,secondary,includeBytes=false}={}) {
  const result=await withFolderReadTimeout(async()=>{
    const file=await entry.getFile();
    const fileStat=[file.size,file.lastModified];
    if(allowEmpty&&file.size===0)return {status:'emptyMain',fileStat};
    if(file.size>MAX_BACKUP_BYTES)return {status:'tooLarge',fileStat};
    return {bytes:new Uint8Array(await file.arrayBuffer()),fileStat};
  },'file');
  if(result.status)return result;
  const actualSalt=arrayToBase64(result.bytes.slice(0,16));
  const selected=secondary?.salt===actualSalt?secondary:{key,salt};
  const decoded=await decodeV2WithKey(result.bytes,selected.key,selected.salt);
  if(decoded.status==='otherSalt')decoded.bytesHash=await bytesHash(result.bytes);
  return {...decoded,salt:actualSalt,fileStat:result.fileStat,...(includeBytes?{bytes:result.bytes}:{})};
}

export async function readFolderState(handle,key,salt,secondary) {
  const {entries,limitExceeded}=await listCandidates(handle);
  const state={head:null,candidates:[],divergent:false,unreadable:[],otherSalt:[],tooLarge:[],limitExceeded,inventory:{limitExceeded,rows:[]}};
  for(const {name,entry} of entries){
    const result=await readFolderCandidate(entry,key,salt,{allowEmpty:name===MAIN_FILE,secondary});
    const {payload,fileStat,...summary}=result;
    state.inventory.rows.push([name,...fileStat]);
    state.candidates.push({name,...summary,...(payload?{noteCount:payload.notes.length}:{})});
    if(result.status!=='valid'){
      if(result.status!=='emptyMain')state[result.status].push(name);
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
