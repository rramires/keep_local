import {withFolderReadTimeout} from './folder-timeout.js';

const MAX_CANDIDATES=32;

async function candidates(handle,isCurrent=()=>true) {
  const entries=[];
  for await(const [name,entry] of handle.entries()){
    if(!isCurrent())return null;
    if(entry.kind!=='file'||!/\.keeplocal$/i.test(name))continue;
    if(entries.length===MAX_CANDIDATES)return {entries,limitExceeded:true};
    entries.push({name,entry});
  }
  return {entries,limitExceeded:false};
}

export function listCandidates(handle) {
  return withFolderReadTimeout(()=>candidates(handle));
}

export async function readFolderInventory(handle,canRead) {
  let live=true;
  const isCurrent=()=>live&&canRead();
  try{
    return await withFolderReadTimeout(async()=>{
      const found=await candidates(handle,isCurrent);
      if(!found)return null;
      const rows=[];
      for(const {name,entry} of found.entries){
        if(!isCurrent())return null;
        const file=await entry.getFile();
        rows.push([name,file.size,file.lastModified]);
      }
      return isCurrent()?{rows,limitExceeded:found.limitExceeded}:null;
    });
  }finally{live=false;}
}

export function folderInventoryStamp({rows,limitExceeded},replacement) {
  const entries=new Map(rows.map(([name,...metadata])=>[name,metadata]));
  if(replacement)entries.set(replacement[0],replacement.slice(1));
  return JSON.stringify([limitExceeded,[...entries].map(row=>JSON.stringify(row)).sort()]);
}
