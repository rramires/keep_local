import { decrypt,base64ToArray } from './crypto.js';
import { recoveredNote,discardRecord,exportForDiscard,validateDiscardReceipt,forgetDiscardReceipt } from './recovery-actions.js';
import { t,tp } from './i18n.js';
import { focusPanel } from './form-ui.js';
function needsExplicitReveal(text) {
  try {
    const record = JSON.parse(text);
    return record !== null && typeof record === 'object' &&
      (Object.hasOwn(record, 'blocks') || String(record.type).trim().toLowerCase() === 'vault');
  } catch {
    return true;
  }
}

export function renderRecovery(container,issues,key,{signal,secretUI,onClose,onCreate,onDiscard}) {
  container.replaceChildren();
  const sensitiveLabel=t('vault.recoveryReveal');
  const panel=document.createElement('div');panel.className='panel-form';
  const header=document.createElement('header');header.className='panel-header';
  const body=document.createElement('div');body.className='panel-body form-stack';
  const title=document.createElement('h2');title.textContent=t('recovery.title');title.id='recovery-title';
  const help=document.createElement('p');help.textContent=t('recovery.help');help.className='help-text';
  const warning=document.createElement('p');warning.textContent=t('recovery.exportWarning');warning.role='note';warning.className='notice notice-warning';
  const list=document.createElement('ul');list.className='recovery-records';list.setAttribute('aria-label',t('recovery.title'));
  const exportStep=document.createElement('section');exportStep.className='recovery-step form-stack';exportStep.setAttribute('aria-labelledby','recovery-export-title');
  const exportTitle=document.createElement('h3');exportTitle.id='recovery-export-title';exportTitle.textContent=t('recovery.exportStep');
  const discardStep=document.createElement('section');discardStep.className='recovery-step form-stack';discardStep.setAttribute('aria-labelledby','recovery-discard-title');
  const discardTitle=document.createElement('h3');discardTitle.id='recovery-discard-title';discardTitle.textContent=t('recovery.discardStep');
  const status=document.createElement('p');status.id='recovery-status';status.role='status';
  const content=document.createElement('textarea');content.id='recovery-content';content.className='note-editor';content.readOnly=true;
  content.spellcheck=false;content.setAttribute('autocapitalize','off');content.setAttribute('autocomplete','off');content.setAttribute('aria-label',t('recovery.content'));
  const reveal=document.createElement('button');
  reveal.id='recovery-show-sensitive';reveal.type='button';reveal.className='btn-secondary';
  reveal.hidden=true;reveal.textContent=sensitiveLabel;reveal.setAttribute('aria-pressed','false');
  content.setAttribute('autocorrect','off');
  panel.setAttribute('translate','no');
  const close=document.createElement('button');close.className='btn-secondary';close.id='modal-close';close.textContent=t('modal.close');close.addEventListener('click',onClose);
  const copy=document.createElement('button');copy.id='recovery-copy';copy.className='btn-secondary';copy.textContent=t('recovery.copy');copy.disabled=true;
  const exportButton=document.createElement('button');exportButton.id='recovery-export';exportButton.className='btn-primary button-full';exportButton.textContent=t('recovery.exportNow');exportButton.disabled=true;
  const saved=document.createElement('input');saved.type='checkbox';saved.id='recovery-saved';
  const savedLabel=document.createElement('label');savedLabel.className='check-field';savedLabel.append(saved,document.createTextNode(t('recovery.confirmSaved')));
  const confirmation=document.createElement('input');confirmation.id='recovery-confirmation';confirmation.autocomplete='off';confirmation.spellcheck=false;
  const label=document.createElement('label');label.htmlFor=confirmation.id;label.textContent=t('recovery.discardPrompt',{word:t('recovery.discardWord')});
  const confirmationField=document.createElement('div');confirmationField.className='form-field';confirmationField.append(label,confirmation);
  const discard=document.createElement('button');discard.id='recovery-discard';discard.className='btn-danger button-full';discard.textContent=t('recovery.discard');discard.disabled=true;
  let selected=0,active=null,note=null,busy=false,receipt=null,checks=0,sensitiveText=null;
  const clearSensitive=()=>{
    secretUI?.hide(content);
    sensitiveText=null;reveal.hidden=true;
  };
  reveal.addEventListener('click',()=>{
    if(sensitiveText!==null){
      secretUI?.toggle(content,reveal,sensitiveText,signal,{property:'value',mask:'',revealLabel:sensitiveLabel});
    }
  });
  const invalidate=()=>{forgetDiscardReceipt(receipt);receipt=null;saved.checked=false;confirmation.value='';checks++;discard.disabled=true;};
  const refresh=async()=>{
    const request=++checks;copy.disabled=busy||!note;exportButton.disabled=busy||!active;discard.disabled=true;
    if(busy||signal.aborted||!receipt||!active||!saved.checked||confirmation.value!==t('recovery.discardWord'))return;
    try{await validateDiscardReceipt(active.record,receipt,{key,signal});if(request===checks&&!signal.aborted)discard.disabled=false;}
    catch{if(request===checks&&!signal.aborted){invalidate();status.textContent=t('recovery.changed');}}
  };
  saved.addEventListener('change',()=>void refresh());confirmation.addEventListener('input',()=>void refresh());
  signal.addEventListener('abort',()=>{invalidate();clearSensitive();content.value='';status.textContent='';note=null;active=null;},{once:true});
  copy.addEventListener('click',async()=>{
    if(busy||!note||signal.aborted)return;busy=true;void refresh();
    try{if(await onCreate(note)){invalidate();status.textContent=t('recovery.copied');}else status.textContent=t('recovery.failed');}
    catch{if(!signal.aborted)status.textContent=t('recovery.failed');}
    finally{busy=false;if(!signal.aborted)void refresh();}
  });
  exportButton.addEventListener('click',async()=>{
    if(busy||!active||signal.aborted)return;busy=true;invalidate();void refresh();
    try{receipt=await exportForDiscard(active.record,{key,signal});if(!signal.aborted)status.textContent=tp('recovery.exported',receipt.unreadableCount);}
    catch(error){if(!signal.aborted)status.textContent=t(error.code==='recovery.changed'?'recovery.changed':'recovery.failed');}
    finally{busy=false;if(!signal.aborted)void refresh();else invalidate();}
  });
  discard.addEventListener('click',async()=>{
    if(busy||!active||signal.aborted||!receipt||!saved.checked||confirmation.value!==t('recovery.discardWord'))return;
    busy=true;void refresh();
    try{await discardRecord(active.record,confirmation.value,{signal,key,receipt,confirmedSaved:saved.checked});if(!signal.aborted)await onDiscard(active.record);}
    catch(error){if(!signal.aborted)status.textContent=t(error.code==='recovery.changed'?'recovery.changed':'recovery.failed');}
    finally{invalidate();busy=false;if(!signal.aborted)void refresh();}
  });
  issues.forEach((issue,index)=>{
    const button=document.createElement('button');button.className='btn-secondary recovery-record';button.dataset.reason=issue.reason;button.setAttribute('aria-pressed','false');button.textContent=t('recovery.record',{number:index+1});
    button.addEventListener('click',async()=>{
      if(busy)return;list.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));invalidate();active=issue;note=null;void refresh();
      const request=++selected;clearSensitive();content.value='';status.textContent=t('recovery.reason.'+issue.reason);
      try{
        const text=await decrypt(key,base64ToArray(issue.record.iv),base64ToArray(issue.record.ciphertext));
        if(!signal.aborted&&request===selected&&container.isConnected){
          if(needsExplicitReveal(text)){
            sensitiveText=text;
            reveal.hidden=false;
          } else {
            content.value=text;
            try{note=recoveredNote(text);}catch{status.textContent=t('recovery.copyTooLarge');}
          }
        }
      }catch{if(!signal.aborted&&request===selected)status.textContent=t('recovery.reason.decrypt');}
      if(!signal.aborted&&request===selected)void refresh();
    });const item=document.createElement('li');item.append(button);list.append(item);
  });
  header.append(title,close);exportStep.append(exportTitle,warning,exportButton);discardStep.append(discardTitle,savedLabel,confirmationField,discard);body.append(help,list,status,reveal,content,copy,exportStep,discardStep);panel.append(header,body);container.append(panel);
  focusPanel(container,{signal,trigger:()=>document.getElementById('recover-notes-btn'),titleId:'recovery-title',initial:'.recovery-record'});
}
