import {folderTime} from './folder-status.js';
import {t,tp} from './i18n.js';
import {wordDialog} from './dialogs.js';
import {focusPanel} from './form-ui.js';
import {exportBackup} from './backup.js';
import {readVault} from './db.js';
import {MAIN_FILE} from './folder-vault.js';
import {localFolderDirty} from './folder-write.js';

function tag(name,text,className) {
  const node=document.createElement(name);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
}

export async function confirmFolderReset({key,signal,onReset}) {
  const snapshot=await readVault(),meta=snapshot.meta;
  if(signal.aborted)return;
  const stamp=Math.max(meta.folderWrittenAt||0,meta.lastBackupAt||0);
  const date=stamp?new Intl.DateTimeFormat(document.documentElement.lang,{dateStyle:'short',timeStyle:'short'}).format(stamp):t('folder.noDate');
  const summary=t('folder.resetRevision',{rev:meta.exportRev||0,date});
  const word=t('account.resetWord');
  const confirmation=await wordDialog([summary,t('account.resetPrompt'),t('folder.resetPreservesCopy')].join(' '),{
    title:t('folder.startOver'),word,danger:true,signal,
  });
  if(confirmation!==word||signal.aborted)return;
  const {resetFromFolder}=await import('./account.js');
  await resetFromFolder(confirmation,meta,{key,signal});
  await onReset();
}

export function renderFolderReview(root,review,{handle,signal,resolve,onOpenReadOnly,onExit,onRefresh,onReset}) {
  const wrap=tag('main',undefined,'auth-view folder-block folder-review');
  wrap.dataset.folderStatus=review.status;
  const container=tag('div',undefined,'auth-container');
  const panel=tag('section',undefined,'auth-card folder-card');
  const heading=tag('h1',t('folder.'+review.status));
  heading.id='folder-review-title';
  const controls=tag('div',undefined,'folder-actions');
  const {state,snapshot}=review;
  const head=state.head;
  let busy=false;
  const report=tag('p',undefined,'folder-reason');
  report.setAttribute('role','status');
  panel.append(heading,tag('p',handle.name,'folder-name'));
  const diskSummary=tag('p');
  const describe=row=>{
    diskSummary.textContent=t('folder.diskSummary',{
      rev:row.rev,time:folderTime(row.exportedAt),notes:tp('backup.noteCount',row.noteCount),
    });
  };
  if(head){
    const format=localFolderDirty(snapshot.meta)?'folder.localDirtySummary':'folder.localSummary';
    describe({...head,noteCount:head.payload.notes.length});
    panel.append(tag('p',t(format,{notes:tp('backup.noteCount',snapshot.notes.length)})),diskSummary);
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
    selection.addEventListener('change',()=>{
      const candidate=state.candidates.find(row=>row.name===selection.value);
      if(candidate)describe(candidate);
    });
    label.append(selection);
    panel.append(label);
  }
  const canChoose=head&&['rollback','conflict'].includes(review.status);
  const main=state.candidates.find(row=>row.name===MAIN_FILE);
  const canOverwrite=canChoose&&['valid','emptyMain'].includes(main?.status);
  const useLocalWarning=t(main?.status==='emptyMain'?'folder.replaceEmptyMain':'folder.preserveFolder');
  const useFolderWarning=t('folder.preserveLocal')+(state.divergent?' '+t('folder.preserveTiedMain'):'');
  if(canChoose)panel.append(tag('p',useFolderWarning));
  if(canOverwrite)panel.append(tag('p',useLocalWarning));
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
    if(await exportBackup())report.textContent=t('folder.exportReady');
  });
  const confirm=async message=>await wordDialog(message+' '+t('folder.replacePrompt',{word:t('folder.replaceWord')}),{
    title:t('folder.replaceTitle'),word:t('folder.replaceWord'),danger:true,signal,
  })===t('folder.replaceWord');
  if(canChoose)button('useFolder',async()=>{
    if(await confirm(useFolderWarning))await resolve('remote',selection?.value??head.name);
  });
  if(canOverwrite)button('useLocal',async()=>{
    if(await confirm(useLocalWarning))await resolve('local',selection?.value??head.name);
  });
  button('openReadOnly',onOpenReadOnly);
  if(onReset)button('startOver',onReset);
  button('exit',onExit);
  container.append(panel);
  wrap.append(container);
  root.replaceChildren(wrap);
  focusPanel(panel,{signal,titleId:heading.id,initial:'[data-folder-action=exportLocal]'});
}
