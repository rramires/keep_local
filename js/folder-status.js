import {t} from './i18n.js';

let current=null;
let retry=null;

export function folderTime(timestamp) {
  return new Intl.DateTimeFormat(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',hour12:false})
    .format(new Date(timestamp));
}

export function setFolderStatus(kind,detail,{onRetry,conflict=false,failed=false}={}) {
  current=kind?{kind,detail,conflict,failed}:null;
  retry=onRetry??null;
  for(const root of document.querySelectorAll('[data-folder-indicator]'))render(root);
}

export function folderUnloadWarning() {
  return current?current.kind==='pending'||current.kind==='error'||current.conflict||current.failed:null;
}

export function createFolderIndicator() {
  const root=document.createElement('div');
  root.className='folder-indicator';
  root.dataset.folderIndicator='';
  render(root);
  return root;
}

function render(root) {
  root.replaceChildren();
  root.hidden=!current;
  if(!current){
    delete root.dataset.folderState;
    return;
  }
  const {kind,detail}=current;
  root.dataset.folderState=kind;
  const text=document.createElement('span');
  text.setAttribute('role','status');
  const parameters=kind==='saved'?{time:folderTime(detail)}:
    kind==='error'?{reason:t(detail||'folder.actionFailed')}:{};
  text.textContent=t('folder.state.'+kind,parameters);
  root.append(text);
  if(kind==='error'&&retry){
    const button=document.createElement('button');
    button.type='button';
    button.className='btn-secondary';
    button.dataset.folderRetry='';
    button.textContent=t('folder.tryNow');
    button.addEventListener('click',retry);
    root.append(button);
  }
}
