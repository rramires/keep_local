import {t} from './i18n.js';

export function versionFromHead(head) {
  return {writtenAt:Date.parse(head.exportedAt),writtenBy:head.payload.writtenBy??null};
}

export function renderFolderVersion(root,{writtenAt,writtenBy}) {
  const label=document.createElement('span');
  label.dataset.folderVersionLabel='';
  label.textContent=writtenBy?t('folder.version.from',{name:writtenBy}):t('folder.version.label');
  root.classList.add('folder-version');
  root.append(label);
  if(writtenAt==null||!Number.isFinite(writtenAt))return;
  const timestamp=new Date(writtenAt),locale=document.documentElement.lang;
  const date=new Intl.DateTimeFormat(locale,{year:'numeric',month:'2-digit',day:'2-digit'}).format(timestamp);
  const clock=new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(timestamp);
  const time=document.createElement('time');
  time.dateTime=timestamp.toISOString();
  time.textContent=date+' '+clock;
  root.append(time);
}

export function createFolderRefresh(onRefresh) {
  const button=document.createElement('button');
  button.type='button';
  button.className='icon-btn folder-version-refresh';
  button.dataset.folderRefresh='';
  const label=t('folder.version.refresh');
  button.setAttribute('aria-label',label);
  button.dataset.tooltip=label;
  const icon=document.createElement('span');
  icon.setAttribute('aria-hidden','true');
  icon.textContent='↻';
  button.append(icon);
  button.addEventListener('click',()=>void onRefresh());
  return button;
}
