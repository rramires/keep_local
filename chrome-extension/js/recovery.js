import { decrypt,base64ToArray } from './crypto.js';
import { t } from './i18n.js';
export function renderRecovery(container,issues,key,{signal,onClose}) {
  container.replaceChildren();
  const title=document.createElement('h2');title.textContent=t('recovery.title');
  const help=document.createElement('p');help.textContent=t('recovery.help');
  const list=document.createElement('div');
  const status=document.createElement('p');status.role='status';
  const content=document.createElement('textarea');content.id='recovery-content';content.className='note-editor';content.readOnly=true;
  content.spellcheck=false;content.setAttribute('autocapitalize','off');content.setAttribute('autocomplete','off');content.setAttribute('aria-label',t('recovery.content'));
  const close=document.createElement('button');close.className='btn-secondary';close.id='modal-close';close.textContent=t('modal.close');close.addEventListener('click',onClose);
  signal.addEventListener('abort',()=>{content.value='';status.textContent='';},{once:true});
  let selected=0;
  issues.forEach((issue,index)=>{
    const button=document.createElement('button');button.className='btn-secondary recovery-record';button.dataset.reason=issue.reason;button.textContent=t('recovery.record',{number:index+1});
    button.addEventListener('click',async()=>{
      const request=++selected;content.value='';status.textContent=t('recovery.reason.'+issue.reason);
      try{
        const text=await decrypt(key,base64ToArray(issue.record.iv),base64ToArray(issue.record.ciphertext));
        if(!signal.aborted&&request===selected&&container.isConnected)content.value=text;
      }catch{if(!signal.aborted&&request===selected)status.textContent=t('recovery.reason.decrypt');}
    });list.append(button);
  });
  container.append(title,help,list,status,content,close);
}
