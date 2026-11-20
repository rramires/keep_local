import {t} from './i18n.js';
import {getSessionSignal} from './session.js';

const dialogs=new Set();
let sequence=0;
const background=new Map();
const top=()=>[...dialogs].at(-1);

// Used by the auth/session boundary as well as each dialog's AbortSignal.
export function closeDialogs(){for(const dialog of [...dialogs].reverse())dialog.cancel();}

function openDialog(message,{title=t('confirm.title'),signal=getSessionSignal(),danger=false,word=null,notice=false,returnFocus=null,choices=null}={}) {
  const canceled=choices||word!==null?null:false;
  if(signal?.aborted)return Promise.resolve(canceled);
  const trigger=document.activeElement,id='app-dialog-'+(++sequence);
  return new Promise(resolve=>{
    const overlay=document.createElement('div');overlay.className='app-dialog confirm-dialog';
    const card=document.createElement('form');card.className='dialog-card form-stack';card.tabIndex=-1;card.setAttribute('role',choices?'dialog':'alertdialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby',id+'-title');card.setAttribute('aria-describedby',id+'-message');
    const heading=document.createElement('h2');heading.id=id+'-title';heading.textContent=title;
    const text=document.createElement('p');text.id=id+'-message';text.className='dialog-message';text.textContent=message;card.append(heading,text);
    let input=null;
    if(word!==null){
      const field=document.createElement('div');field.className='form-field';
      const label=document.createElement('label');label.htmlFor=id+'-word';label.textContent=t('confirm.typeWord',{word});
      input=document.createElement('input');input.id=label.htmlFor;input.autocomplete='off';input.spellcheck=false;input.setAttribute('autocapitalize','off');input.setAttribute('aria-describedby',text.id);field.append(label,input);card.append(field);
    }
    const actions=document.createElement('div');actions.className='dialog-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='btn-secondary';cancel.id=id+'-cancel';cancel.dataset.dialogAction='cancel';cancel.textContent=t('confirm.cancel');
    const confirm=document.createElement('button');confirm.type='submit';confirm.className=danger?'btn-danger':'btn-primary';confirm.id=id+'-confirm';confirm.dataset.dialogAction='confirm';confirm.textContent=t('confirm.ok');confirm.disabled=word!==null;
    const choiceButtons=new Map();
    if(choices){
      actions.classList.add('dialog-choices');
      for(const {value,label} of choices){
        const button=document.createElement('button');
        button.type='button';button.className='btn-secondary';button.dataset.dialogChoice=value;button.textContent=label;
        choiceButtons.set(button,value);
        button.addEventListener('click',()=>finish(true,value));
        actions.append(button);
      }
    }
    if(!notice)actions.append(cancel);
    if(!choices)actions.append(confirm);
    card.append(actions);overlay.append(card);
    let done=false;
    const controls=()=>[...card.querySelectorAll('input,button')].filter(e=>!e.disabled);
    const focus=()=>{if(!done)(input||choiceButtons.keys().next().value||(!notice?cancel:confirm)).focus();};

    const finish=(accepted,choice)=>{
      if(done)return;done=true;
      const result=accepted?(choices?choice:word===null?true:input.value):canceled;
      if(input)input.value='';
      dialogs.delete(entry);overlay.remove();
      if(top())top().overlay.inert=false;else{for(const [element,inert] of background)element.inert=inert;background.clear();}
      document.removeEventListener('keydown',keydown,true);document.removeEventListener('focusin',keepFocus,true);signal?.removeEventListener('abort',abort);
      if(top())top().focus();else{const target=returnFocus?.()||trigger;if(target?.isConnected)target.focus();}
      resolve(result);
    };
    const abort=()=>finish(false);
    const keydown=event=>{
      if(top()!==entry)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);}
      else if(event.key==='Enter'){
        event.preventDefault();
        event.stopImmediatePropagation();
        const focused=document.activeElement;
        if(choiceButtons.has(focused))finish(true,choiceButtons.get(focused));
        else if(focused===cancel)finish(false);
        else if((focused===confirm||focused===input)&&!confirm.disabled)finish(true);
      }
      else if(event.key==='Tab'){
        event.preventDefault();event.stopImmediatePropagation();const items=controls(),index=items.indexOf(document.activeElement),next=(index+(event.shiftKey?-1:1)+items.length)%items.length;(items[next]||card).focus();
      }
    };
    const keepFocus=event=>{if(top()===entry&&!card.contains(event.target))focus();};
    const entry={cancel:abort,focus,overlay};dialogs.add(entry);
    cancel.addEventListener('click',abort);card.addEventListener('submit',event=>{event.preventDefault();if(!choices&&!confirm.disabled)finish(true);});
    input?.addEventListener('input',()=>{confirm.disabled=input.value!==word;});
    overlay.addEventListener('click',event=>{if(event.target===overlay)finish(false);});
    document.body.append(overlay);
    for(const sibling of document.body.children)if(sibling!==overlay){if(!sibling.classList.contains('app-dialog')&&!background.has(sibling))background.set(sibling,sibling.inert);sibling.inert=true;}
    document.addEventListener('keydown',keydown,true);document.addEventListener('focusin',keepFocus,true);signal?.addEventListener('abort',abort,{once:true});focus();
  });
}
export const confirmDialog=(message,options={})=>openDialog(message,options);
export const noticeDialog=(message,options={})=>openDialog(message,{...options,notice:true});
export function wordDialog(message,{word,...options}){
  if(typeof word!=='string'||!word)throw Error('A confirmation word is required');
  return openDialog(message,{...options,word});
}

export const choiceDialog=(message,choices,options={})=>openDialog(message,{...options,choices});
