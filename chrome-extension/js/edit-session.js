export function serialQueue() {
  const pending=new Map();
  const enqueue=(id,action)=>{
    const result=(pending.get(id)||Promise.resolve()).catch(()=>{}).then(action);
    pending.set(id,result);
    result.finally(()=>{if(pending.get(id)===result)pending.delete(id);}).catch(()=>{});
    return result;
  };
  enqueue.has=id=>pending.has(id);
  return enqueue;
}
export function createEditSession({capture,save,delay=2000,onDirty=()=>{}}) {
  let timer,dirty=false,ended=false,version=0,running=Promise.resolve(true);
  const flush=()=>{
    clearTimeout(timer);
    if(ended||!dirty)return running;
    const current=version,snapshot=capture();
    running=running.then(async()=>{
      if(ended)return true;
      const ok=await save(snapshot);
      if(ok&&version===current){dirty=false;onDirty(false);}
      return ok;
    });
    return running;
  };
  return {schedule(){if(ended)return;dirty=true;onDirty(true);version++;clearTimeout(timer);timer=setTimeout(flush,delay);},flush,
    cancel(){ended=true;dirty=false;onDirty(false);clearTimeout(timer);},isDirty:()=>dirty,capture};
}
export function limitText(element,maxBytes,onLimit) {
  let previous=element.value;
  const bytes=s=>new TextEncoder().encode(s).length;
  element.addEventListener('beforeinput',e=>{
    if(e.inputType?.startsWith('delete'))return;
    if(e.data!==null&&e.data!==undefined){const next=element.value.slice(0,element.selectionStart)+e.data+element.value.slice(element.selectionEnd);if(bytes(next)>maxBytes){e.preventDefault();onLimit();}}
  });
  element.addEventListener('input',()=>{if(bytes(element.value)>maxBytes){element.value=previous;onLimit();}else previous=element.value;});
}
