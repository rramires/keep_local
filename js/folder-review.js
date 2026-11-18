import {t,tp} from './i18n.js';
import {wordDialog} from './dialogs.js';
import {focusPanel} from './form-ui.js';
import {exportBackup} from './backup.js';
import {MAIN_FILE} from './folder-vault.js';
import {folderLocalStamp} from './folder-reconcile.js';

function tag(name,text,className) {
  const node=document.createElement(name);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
}

export function folderTime(timestamp) {
  return new Intl.DateTimeFormat(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',hour12:false})
    .format(new Date(timestamp));
}

export function renderFolderReview(root,review,{handle,signal,resolve,onOpenReadOnly,onExit,notify,onRefresh}) {
  const wrap=tag('main',undefined,'auth-view folder-block folder-review');
  wrap.dataset.folderStatus=review.status;
  const container=tag('div',undefined,'auth-container');
  const panel=tag('section',undefined,'auth-card folder-card');
  const heading=tag('h1',t('folder.'+review.status));
  heading.id='folder-review-title';
  const controls=tag('div',undefined,'folder-actions');
  const {state,snapshot}=review;
  const head=state.head;
  let exported=false,busy=false;
  const report=tag('p',undefined,'folder-reason');
  report.setAttribute('role','status');
  panel.append(heading,tag('p',handle.name,'folder-name'));
  if(head){
    panel.append(tag('p',t('folder.localSummary',{notes:tp('backup.noteCount',snapshot.notes.length)})),
      tag('p',t('folder.diskSummary',{rev:head.rev,time:folderTime(head.exportedAt),notes:tp('backup.noteCount',head.payload.notes.length)})));
  }
  let selection;
  if(state.divergent&&head){
    const label=tag('label',t('folder.chooseCopy'),'form-field');
    selection=tag('select');
    for(const row of state.candidates.filter(row=>row.status==='valid'&&row.rev===head.rev)){
      const option=tag('option',row.name);
      option.value=row.name;
      selection.append(option);
    }
    selection.value=head.name;
    label.append(selection);
    panel.append(label);
  }
  panel.append(report,controls);

  const run=async work=>{
    if(busy||signal.aborted)return;
    busy=true;
    const buttons=[...controls.querySelectorAll('button')];
    for(const button of buttons)button.disabled=true;
    try{await work();}
    catch(error){
      if(!signal.aborted){
        report.textContent=t(error.code||'folder.actionFailed');
        if(error.code==='folder.changed')void onRefresh();
      }
    }finally{busy=false;for(const button of buttons)button.disabled=false;}
  };
  const button=(name,work)=>{
    const node=tag('button',t('folder.'+name),'btn-secondary');
    node.type='button';
    node.dataset.folderAction=name;
    node.addEventListener('click',()=>void run(work));
    controls.append(node);
    return node;
  };
  button('exportLocal',async()=>{
    const archive=await exportBackup();
    exported=!!archive&&folderLocalStamp(archive)===folderLocalStamp(snapshot)&&JSON.stringify(archive.notes)===JSON.stringify(snapshot.notes);
    if(exported)report.textContent=t('folder.exportReady');
  });
  const confirm=async()=>await wordDialog(t('folder.replacePrompt',{word:t('folder.replaceWord')}),{
    title:t('folder.replaceTitle'),word:t('folder.replaceWord'),danger:true,signal,
  })===t('folder.replaceWord');
  if(head&&['rollback','conflict'].includes(review.status)){
    button('useFolder',async()=>{
      if(exported||await confirm())await resolve('remote',selection?.value??head.name);
    });
    if(state.candidates.some(row=>row.name===MAIN_FILE&&row.status==='valid')){
      button('useLocal',async()=>{if(await confirm())await resolve('local');});
    }
  }
  button('openReadOnly',onOpenReadOnly);
  button('exit',onExit);
  container.append(panel);
  wrap.append(container);
  root.replaceChildren(wrap);
  focusPanel(panel,{signal,titleId:heading.id,initial:'[data-folder-action=exportLocal]'});
}
