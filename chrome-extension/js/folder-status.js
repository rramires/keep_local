import {t} from './i18n.js';
import {createFolderRefresh,renderFolderVersion} from './folder-version.js';

let current=null;
let retry=null;
const refreshControls=new WeakMap();

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

export function createFolderIndicator({onRefresh,canRefresh}={}) {
  const root=document.createElement('div');
  root.className='folder-indicator';
  root.dataset.folderIndicator='';
  root.append(document.createElement('span'));
  if(onRefresh){
    const button=createFolderRefresh(onRefresh);
    refreshControls.set(root,{button,canRefresh});
    root.append(button);
  }
  render(root);
  return root;
}

function updateRefresh(root) {
  const control=refreshControls.get(root);
  if(control)control.button.disabled=!control.canRefresh();
}

export function updateFolderRefresh() {
  for(const root of document.querySelectorAll('[data-folder-indicator]'))updateRefresh(root);
}

function render(root) {
  const content=root.firstElementChild;
  content.replaceChildren();
  updateRefresh(root);
  root.hidden=!current;
  if(!current){
    delete root.dataset.folderState;
    return;
  }
  const {kind,detail}=current;
  root.dataset.folderState=kind;
  const text=document.createElement('span');
  text.setAttribute('role','status');
  if(kind==='saved')renderFolderVersion(text,detail);
  else text.textContent=t('folder.state.'+kind,kind==='error'?{reason:t(detail||'folder.actionFailed')}:{});
  content.append(text);
  if(kind==='error'&&retry){
    const button=document.createElement('button');
    button.type='button';
    button.className='btn-secondary';
    button.dataset.folderRetry='';
    button.textContent=t('folder.tryNow');
    button.addEventListener('click',retry);
    content.append(button);
  }
}
