import {base64ToArray,deriveKey} from './crypto.js';
import {listCandidates,readFolderCandidate} from './folder-vault.js';
import {withFolderReadTimeout} from './folder-timeout.js';
import {isFolderCopyDirectory} from './folder-store.js';
import {passwordDialog} from './dialogs.js';
import {focusPanel} from './form-ui.js';
import {t,tp} from './i18n.js';

let current=null;

export const getFolderCopy=()=>current;
export function discardFolderCopy(){current=null;}
export function beginFolderCopy(previous){current={previous,copy:null};}
export function selectFolderCopy(copy){if(current)current.copy=copy;}

export async function pickFolderCopy() {
  try{return await showDirectoryPicker({mode:'read',id:'keeplocal-copy-view'});}
  catch(error){if(error.name==='AbortError')return null;throw error;}
}

function element(tag,className,text) {
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
}

function button(name,work,primary=false) {
  const node=element('button',primary?'btn-primary':'btn-secondary',t('copy.'+name));
  node.type='button';node.dataset.copyAction=name;
  node.addEventListener('click',work);
  return node;
}

export function renderFolderCopyBanner(container,{handle,name,rev,exportedAt},onBack) {
  const banner=element('section','folder-copy-banner notice notice-warning');
  const text=element('strong','',t('copy.banner',{file:name,folder:handle.name,rev,date:new Date(exportedAt).toLocaleString()}));
  text.setAttribute('role','status');
  banner.append(text,button('back',onBack));
  container.prepend(banner);
}

export async function renderFolderCopies(root,{handle,known,seenRev=0,signal,onOpen,onBack}) {
  const keys=new Map(known?.key?[[known.salt,known.key]]:[]);
  let rows=[],selected=null,busy=false;
  const panel=element('main','auth-view folder-copy-browser');
  panel.dataset.folderCopyList='';
  const card=element('section','panel-form folder-copy-list form-stack');
  const title=element('h1','',t('copy.title'));title.id='folder-copy-title';
  const name=element('p','folder-name',handle.name);
  const list=element('div','folder-copy-files');
  const warning=element('p','notice notice-warning');warning.dataset.copyWarning='';warning.hidden=true;
  const report=element('p','form-error');report.setAttribute('role','alert');
  const actions=element('div','folder-actions');
  const open=button('open',()=>void run(openSelected),true);
  actions.append(open,button('back',onBack));
  const hint=isFolderCopyDirectory(handle.name)?'copy.restoreReserved':'copy.restore';
  card.append(title,name,element('p','help-text',t(hint)),list,warning,report,actions);
  panel.append(card);root.replaceChildren(panel);
  signal.addEventListener('abort',()=>{keys.clear();rows=[];selected=null;},{once:true});

  async function run(work) {
    if(busy||signal.aborted)return;
    busy=true;
    const controls=[...card.querySelectorAll('button,input')];controls.forEach(node=>node.disabled=true);
    try{await work();}
    catch(error){
      if(!signal.aborted){
        const code=error.name==='TimeoutError'?'folder.unresponsive':typeof error.code==='string'?error.code:'copy.readFailed';
        report.textContent=t(code);
      }
    }
    finally{
      busy=false;
      if(!signal.aborted){controls.forEach(node=>node.disabled=false);open.disabled=!selected;}
    }
  }

  async function read(entry) {
    // An unknown salt is summarized without deriving a key or retaining its bytes.
    const first=await readFolderCandidate(entry,null,'');
    const key=keys.get(first.salt);
    if(first.status!=='otherSalt'||!key)return first;
    return readFolderCandidate(entry,key,first.salt);
  }

  async function refresh() {
    const {entries,limitExceeded}=await listCandidates(handle);
    const loaded=[];
    for(const {name,entry} of entries){
      const {payload,...summary}=await read(entry);
      if(signal.aborted)return;
      loaded.push({name,entry,...summary,...(payload?{noteCount:payload.notes.length}:{})});
    }
    if(signal.aborted)return;
    rows=loaded;
    selected=rows.filter(row=>row.status==='valid').sort((a,b)=>b.rev-a.rev||a.name.localeCompare(b.name))[0]??null;
    report.textContent=limitExceeded?t('copy.limit'):'';
    render();panel.dataset.ready='true';
  }

  function select(row) {
    selected=row;
    warning.hidden=row.rev>=seenRev;
    warning.textContent=warning.hidden?'':t('copy.older',{rev:seenRev});
    open.disabled=false;
  }

  function render() {
    list.replaceChildren();
    for(const row of rows){
      const item=element('section','folder-copy-row');
      item.dataset.copyName=row.name;item.dataset.copyStatus=row.status;
      const label=element('label','folder-copy-label');
      const input=element('input');input.type='radio';input.name='folder-copy';
      input.disabled=row.status!=='valid';input.checked=row===selected;
      input.addEventListener('change',()=>select(row));
      label.append(input,element('strong','',row.name));
      item.append(label);
      if(row.status==='valid'){
        item.append(element('p','help-text',t('copy.details',{rev:row.rev,date:new Date(row.exportedAt).toLocaleString(),count:tp('backup.noteCount',row.noteCount)})));
      }
      item.append(element('p','help-text',t('copy.'+row.status)));
      if(row.status==='otherSalt')item.append(button('password',()=>void run(()=>unlock(row.salt))));
      list.append(item);
    }
    if(!rows.length)list.append(element('p','',t('copy.empty')));
    open.disabled=!selected;
    warning.hidden=true;
    if(selected)select(selected);
  }

  async function unlock(salt) {
    let password=await passwordDialog(t('copy.passwordPrompt'),{title:t('copy.password'),label:t('auth.password'),signal});
    if(password===null)return;
    let key;
    try{key=await deriveKey(password,base64ToArray(salt));}
    finally{password='';}
    if(signal.aborted)return;
    const matching=rows.filter(row=>row.salt===salt);
    let valid=false;
    for(const row of matching){
      const result=await readFolderCandidate(row.entry,key,salt);
      if(signal.aborted)return;
      if(result.status==='valid'){valid=true;break;}
    }
    if(!valid)throw Object.assign(new Error('folder.wrongPassphrase'),{code:'folder.wrongPassphrase'});
    keys.set(salt,key);
    await refresh();
  }

  async function openSelected() {
    const row=selected;
    if(!row)return;
    const entry=await withFolderReadTimeout(()=>handle.getFileHandle(row.name));
    const key=keys.get(row.salt);
    const copy=await readFolderCandidate(entry,key,row.salt);
    if(signal.aborted)return;
    if(copy.status!=='valid'||copy.hash!==row.hash)throw Object.assign(new Error('folder.changed'),{code:'folder.changed'});
    await onOpen({handle,name:row.name,key,...copy});
    keys.clear();rows=[];selected=null;
  }

  await run(refresh);
  if(!signal.aborted)focusPanel(card,{signal,titleId:title.id,initial:'[data-copy-action=back]'});
}
