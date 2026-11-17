export function serialQueue() {
  const pending=new Map();
  const enqueue=(id,action)=>{
    const result=(pending.get(id)||Promise.resolve()).catch(()=>{}).then(action);
    pending.set(id,result);
    result.finally(()=>{if(pending.get(id)===result)pending.delete(id);}).catch(()=>{});
    return result;
  };
  enqueue.has=id=>pending.has(id);
  enqueue.drain=id=>pending.get(id)||Promise.resolve();
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
export function limitText(element,maxBytes,onLimit,measure=s=>new TextEncoder().encode(s).length) {
  let previous=element.value;
  const bytes=measure;
  element.addEventListener('beforeinput',e=>{
    if(e.inputType?.startsWith('delete'))return;
    if(e.data!==null&&e.data!==undefined){const next=element.value.slice(0,element.selectionStart)+e.data+element.value.slice(element.selectionEnd);if(bytes(next)>maxBytes){e.preventDefault();onLimit();}}
  });
  element.addEventListener('input',()=>{if(bytes(element.value)>maxBytes){element.value=previous;onLimit();}else previous=element.value;});
}

export function captureTodoDraft(note,modal,pendingId) {
  const draft=structuredClone(note);
  draft.title=modal.querySelector('#modal-title')?.value??note.title;
  for(const input of modal.querySelectorAll('.todo-text')){
    const task=draft.tasks.find(t=>t.id===input.dataset.taskId);if(task)task.text=input.value;
  }
  const text=modal.querySelector('#add-task-input')?.value.trim();
  if(text){
    const task=draft.tasks.find(t=>t.id===pendingId);
    if(task)task.text=text;else draft.tasks.push({id:pendingId,text,done:false,order:draft.tasks.length,parentId:null});
  }
  return draft;
}
