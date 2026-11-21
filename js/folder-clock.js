import {UUID} from './note-model.js';

const MAX_WRITERS=64;
const invalid=()=>{throw new Error('backup.invalidFile');};

export function validateClock(clock) {
  if(!clock||typeof clock!=='object'||Array.isArray(clock))invalid();
  const prototype=Object.getPrototypeOf(clock);
  if(prototype!==Object.prototype&&prototype!==null)invalid();
  const entries=Object.entries(clock);
  if(entries.length>MAX_WRITERS||entries.some(([id,count])=>
    !UUID.test(id)||!Number.isSafeInteger(count)||count<1))invalid();
  return clock;
}

export function mergeClocks(...clocks) {
  const result={};
  for(const clock of clocks){
    for(const [id,count] of Object.entries(validateClock(clock))){
      result[id]=Math.max(result[id]??0,count);
    }
  }
  return validateClock(result);
}

export function nextFolderClock(meta,heads=[],{replace=false}={}) {
  const {writerId,writerCount=0,exportClock={}}=meta;
  if(typeof writerId!=='string'||!UUID.test(writerId)||
      !Number.isSafeInteger(writerCount)||writerCount<0)invalid();
  const clocks=heads.map(head=>head.payload.clock??{});
  const observed=mergeClocks(exportClock,...clocks);
  const count=Math.max(writerCount,observed[writerId]??0)+1;
  const clock=replace?observed:{...exportClock};
  clock[writerId]=count;
  return validateClock(clock);
}

export function folderWriterState(meta,payload) {
  if(!meta.writerId)return {};
  return {writerCount:Math.max(meta.writerCount??0,payload.clock?.[meta.writerId]??0)};
}

export function descends(head,ref) {
  if(!ref)return false;
  const lineage=[head.parent,...(head.payload?.ancestors??[])];
  if(ref.hash&&(head.hash===ref.hash||lineage.includes(ref.hash)))return true;
  const entries=Object.entries(ref.clock??{});
  return entries.length>0&&entries.every(([id,count])=>(head.payload?.clock?.[id]??0)>=count);
}
