import { MAX_NOTE_BYTES } from './note-model.js';
import { limitText } from './edit-session.js';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export function bindDraftLimits(title,body,onLimit) {
  title.maxLength=4096;
  limitText(body,MAX_NOTE_BYTES-1024,onLimit,value=>bytes({title:title.value,content:value}));
  limitText(title,MAX_NOTE_BYTES-1024,onLimit,value=>bytes({title:value,content:body.value}));
}
export function bindTextLimits(note,title,body,onLimit) {
  title.maxLength=4096;
  limitText(body,MAX_NOTE_BYTES,onLimit,value=>bytes({...note,title:title.value,content:value}));
  limitText(title,MAX_NOTE_BYTES,onLimit,value=>bytes({...note,title:value,content:body.value}));
}
export function bindTodoLimits(note,modal,onLimit) {
  const title=modal.querySelector('#modal-title'),add=modal.querySelector('#add-task-input');
  const fields=[...modal.querySelectorAll('.todo-text')];title.maxLength=4096;add.maxLength=65536;
  const measure=(input,value)=>{
    const tasks=note.tasks.map(task=>({...task,text:fields.find(f=>f.dataset.taskId===task.id)?.value??task.text}));
    if(input.dataset.taskId)tasks.find(t=>t.id===input.dataset.taskId).text=value;
    const pending=input===add?value:add.value;
    if(pending)tasks.push({id:'00000000-0000-4000-8000-000000000000',text:pending,done:false,order:tasks.length,parentId:null});
    return bytes({...note,title:input===title?value:title.value,tasks});
  };
  for(const input of [title,add,...fields]){
    if(input.dataset.taskId)input.maxLength=65536;
    limitText(input,MAX_NOTE_BYTES,onLimit,value=>measure(input,value));
  }
}
