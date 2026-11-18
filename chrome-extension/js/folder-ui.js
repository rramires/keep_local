import {t} from './i18n.js';
import {focusPanel} from './form-ui.js';
import {confirmDialog} from './dialogs.js';
import {checkFolder,chooseSyncFolder,disconnectSyncFolder,enableFolderWrites,readSyncFolder,requestFolderAccess} from './folder-store.js';

function element(tag, className, text) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  if(text!==undefined) node.textContent=text;
  return node;
}

function action(name,handler,primary=false) {
  const button=element('button',primary?'btn-primary':'btn-secondary',t('folder.'+name));
  button.type='button';
  button.dataset.folderAction=name;
  button.addEventListener('click',handler);
  return button;
}

function folderReason(status) {
  if(status==='notFound'||status==='denied') return t('folder.'+status);
  return t('folder.other',{name:status.startsWith('error:')?status.slice(6):'Error'});
}

export function createFolderGate(root,{handle,status,key,signal,onOpen,onExit,notify}) {
  let busy=false, reading=false, issue=status;

  async function run(event,work) {
    if(busy||signal.aborted) return;
    const card=event.currentTarget.closest('[data-folder-controls]');
    const buttons=[...card.querySelectorAll('button')];
    busy=true;
    for(const button of buttons) button.disabled=true;
    try { await work(); }
    catch(error) {
      if(!signal.aborted&&error?.name!=='AbortError') notify(t(error?.code||'folder.actionFailed'));
    } finally {
      busy=false;
      for(const button of buttons) button.disabled=false;
    }
  }

  async function openVault() {
    if(signal.aborted) return;
    await onOpen();
    if(!signal.aborted) document.getElementById('search-input')?.focus();
  }

  async function retry() {
    const permissionFailure=await requestFolderAccess(handle);
    const result=await checkFolder(handle,permissionFailure);
    if(signal.aborted) return;
    if(result!=='ok'){ showIssue(result);return; }
    await enableFolderWrites({key,signal});
    await openVault();
  }

  async function choose() {
    const result=await chooseSyncFolder({key,signal});
    if(signal.aborted) return;
    if(result.status!=='ok'){ notify(folderReason(result.status));return; }
    await openVault();
  }

  function recoveryButtons() {
    return [
      action('retry',event=>void run(event,retry),true),
      action('chooseAnother',event=>void run(event,choose)),
    ];
  }

  function showIssue(status) {
    issue=status;
    if(reading) notify(folderReason(status));
    else renderBlock();
  }

  function renderBlock() {
    const wrapper=element('main','auth-view folder-block');
    wrapper.dataset.folderStatus=issue;
    const container=element('div','auth-container');
    const panel=element('section','auth-card folder-card');
    panel.dataset.folderControls='';
    const title=element('h1','',t('folder.blocked'));
    title.id='folder-block-title';
    const reason=element('p','folder-reason',folderReason(issue));
    reason.setAttribute('role','status');
    const controls=element('div','folder-actions');
    controls.append(...recoveryButtons(),action('openReadOnly',event=>void run(event,async()=>{
      reading=true;
      await openVault();
    })),action('exit',onExit));
    panel.append(title,element('p','folder-name',handle.name),reason,controls);
    container.append(panel);
    wrapper.append(container);
    root.replaceChildren(wrapper);
    focusPanel(panel,{signal,titleId:title.id,initial:'[data-folder-action=retry]'});
  }

  function renderBanner(main) {
    const banner=element('section','folder-banner notice notice-warning');
    banner.dataset.folderControls='';
    const status=element('strong','',t('vault.readOnly'));
    status.setAttribute('role','status');
    const controls=element('div','folder-actions');
    controls.append(...recoveryButtons());
    banner.append(status,controls);
    main.prepend(banner);
  }

  return {renderBlock,renderBanner};
}

export function quietReadOnlyCards(root) {
  for(const card of root.querySelectorAll('[draggable="true"]')) card.draggable=false;
}

export function renderReadOnlyNote(container,note,{signal,trigger,onClose}) {
  const panel=element('section','panel-form folder-note');
  const header=element('header','panel-header');
  const title=element('h2','',note.title||t('vault.untitled'));
  title.id='folder-note-title';
  const close=element('button','btn-secondary',t('modal.close'));
  close.id='modal-close';
  close.type='button';
  close.addEventListener('click',onClose);
  header.append(title,close);
  const body=element('div','panel-body');
  if(note.type==='text') body.append(element('pre','folder-note-text',note.content));
  else{
    const list=element('ul','folder-task-list');
    const tasks=note.tasks.toSorted((left,right)=>left.order-right.order);
    for(const parent of tasks.filter(task=>!task.parentId)){
      const root=taskLine(parent);
      const children=tasks.filter(task=>task.parentId===parent.id);
      if(children.length){
        const sub=element('ul','folder-task-list');
        sub.append(...children.map(taskLine));
        root.append(sub);
      }
      list.append(root);
    }
    body.append(list);
  }
  panel.append(header,body);
  container.replaceChildren(panel);
  focusPanel(container,{signal,trigger,titleId:title.id,initial:'#modal-close'});
}

function taskLine(task) {
  const line=element('li');
  const label=element('label');
  const check=element('input');
  check.type='checkbox';
  check.checked=task.done;
  check.disabled=true;
  label.append(check,element('span','',task.text));
  line.append(label);
  return line;
}

export function addFolderSettingsTrigger(anchor,onOpen) {
  const trigger=element('button','sidebar-item folder-settings-trigger',t('folder.settings'));
  trigger.type='button';
  trigger.id='folder-settings-btn';
  trigger.addEventListener('click',()=>onOpen(trigger));
  anchor.before(trigger);
}

export function renderFolderSettings(container,{key,signal,trigger,onClose,notify,hasUnreadable}) {
  const panel=element('section','panel-form folder-settings');
  const header=element('header','panel-header');
  const title=element('h2','',t('folder.settings'));
  title.id='folder-settings-title';
  const close=element('button','btn-secondary',t('modal.close'));
  close.type='button';
  close.id='modal-close';
  close.addEventListener('click',onClose);
  header.append(title,close);
  const body=element('section','panel-body form-stack');
  panel.append(header,body);
  container.replaceChildren(panel);
  focusPanel(container,{signal,trigger,titleId:title.id,initial:'#modal-close'});

  let busy=false;
  async function refresh(focus) {
    const handle=await readSyncFolder();
    if(signal.aborted) return;
    const heading=element('h3','',t('folder.section'));
    const groups=[
      heading,
      handle
        ? element('p','folder-name',t('folder.connected',{name:handle.name}))
        : element('p','',t('folder.description')),
    ];
    if(!handle) groups.push(element('p','help-text',t('folder.permissionTip')));
    groups.push(element('p','help-text',t('folder.future')));
    const controls=element('div','folder-actions');
    const choose=action(handle?'change':'choose',()=>void run(async()=>{
      const chosen=await chooseSyncFolder({key,signal,hasUnreadable:hasUnreadable()});
      if(signal.aborted) return;
      if(chosen.status!=='ok'){notify(folderReason(chosen.status));return;}
      await refresh(true);
    }),true);
    controls.append(choose);
    if(handle){
      controls.append(action('disconnect',()=>void run(async()=>{
        if(!await confirmDialog(t('folder.disconnectConfirm',{name:handle.name}),{signal}))return;
        await disconnectSyncFolder({key,signal});
        await refresh(true);
      })));
    }
    body.replaceChildren(...groups,controls);
    if(focus) choose.focus();
  }

  async function run(work) {
    if(busy||signal.aborted) return;
    const buttons=[...body.querySelectorAll('button')];
    busy=true;
    for(const button of buttons) button.disabled=true;
    try {await work();}
    catch(error) {
      if(!signal.aborted&&error?.name!=='AbortError') notify(t(error?.code||'folder.actionFailed'));
    } finally {
      busy=false;
      for(const button of buttons) button.disabled=false;
    }
  }

  void refresh(false).catch(()=>{if(!signal.aborted)notify(t('folder.actionFailed'));});
}
