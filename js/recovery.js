import { decrypt,base64ToArray } from './crypto.js';
import { recoveredNote,discardRecord } from './recovery-actions.js';
import { t } from './i18n.js';
export function renderRecovery(container,issues,key,{signal,onClose,onCreate,onDiscard}) {
  container.replaceChildren();
  const title=document.createElement('h2');title.textContent=t('recovery.title');
  const help=document.createElement('p');help.textContent=t('recovery.help');
  const list=document.createElement('div');
  const status=document.createElement('p');status.role='status';
  const content=document.createElement('textarea');content.id='recovery-content';content.className='note-editor';content.readOnly=true;
  content.spellcheck=false;content.setAttribute('autocapitalize','off');content.setAttribute('autocomplete','off');content.setAttribute('aria-label',t('recovery.content'));
  const close=document.createElement('button');close.className='btn-secondary';close.id='modal-close';close.textContent=t('modal.close');close.addEventListener('click',onClose);
  signal.addEventListener('abort',()=>{content.value='';status.textContent='';},{once:true});
  const copy=document.createElement('button');copy.id='recovery-copy';copy.className='btn-secondary';copy.textContent=t('recovery.copy');copy.disabled=true;
  const confirmation=document.createElement('input');confirmation.id='recovery-confirmation';confirmation.autocomplete='off';confirmation.spellcheck=false;
  const label=document.createElement('label');label.textContent=t('recovery.discardPrompt',{word:t('recovery.discardWord')});label.append(confirmation);
  const discard=document.createElement('button');discard.id='recovery-discard';discard.className='btn-secondary';discard.textContent=t('recovery.discard');discard.disabled=true;
  let selected=0,active=null,note=null,busy=false;
  copy.addEventListener('click',async()=>{
    if(busy||!note||signal.aborted)return;busy=true;copy.disabled=discard.disabled=true;
    try{if(await onCreate(note))status.textContent=t('recovery.copied');else status.textContent=t('recovery.failed');}
    catch{if(!signal.aborted)status.textContent=t('recovery.failed');}
    finally{busy=false;if(!signal.aborted){copy.disabled=!note;discard.disabled=!active;}}
  });
  discard.addEventListener('click',async()=>{
    if(busy||!active||signal.aborted)return;
    if(confirmation.value!==t('recovery.discardWord')){status.textContent=t('recovery.confirmRequired');return;}
    busy=true;copy.disabled=discard.disabled=true;
    try{if(await discardRecord(active.record,confirmation.value,{signal,key})){if(!signal.aborted)await onDiscard(active.record);}}
    catch{if(!signal.aborted)status.textContent=t('recovery.failed');}
    finally{busy=false;if(!signal.aborted){copy.disabled=!note;discard.disabled=!active;}}
  });
  issues.forEach((issue,index)=>{
    const button=document.createElement('button');button.className='btn-secondary recovery-record';button.dataset.reason=issue.reason;button.textContent=t('recovery.record',{number:index+1});
    button.addEventListener('click',async()=>{
      if(busy)return;active=issue;note=null;confirmation.value='';copy.disabled=true;discard.disabled=false;
      const request=++selected;content.value='';status.textContent=t('recovery.reason.'+issue.reason);
      try{
        const text=await decrypt(key,base64ToArray(issue.record.iv),base64ToArray(issue.record.ciphertext));
        if(!signal.aborted&&request===selected&&container.isConnected){content.value=text;try{note=recoveredNote(text);copy.disabled=false;}catch{status.textContent=t('recovery.copyTooLarge');}}
      }catch{if(!signal.aborted&&request===selected)status.textContent=t('recovery.reason.decrypt');}
    });list.append(button);
  });
  container.append(title,help,list,status,content,copy,label,discard,close);
}
