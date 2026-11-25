import {createVaultTemplate,VAULT_TEMPLATE_IDS} from './vault-templates.js';
import {newVaultItem, renderVaultEditor} from './vault-editor.js';
import {createSecretUI} from './secret-ui.js';
import {focusPanel} from './form-ui.js';
import {renderVaultCard, renderVaultSection, renderVaultDetail} from './vault-view.js';
import {choiceDialog,confirmDialog,closeDialogs} from './dialogs.js';
import { createNoteWriteQueue,editorFields,metadataFields } from './note-write-queue.js';
import { planNoteChange,persistNoteBatch,replaceExistingNotes } from './note-actions.js';
import { requestPersistence } from './storage.js';
import { setDraftDirty, clearDrafts, refreshBackupState, setUnsaved } from './backup.js';
import { purgeTrash } from './trash.js';
import { folderMergeMessages } from './folder-merge.js';
import {checkFolder,folderSupported,readSyncFolder} from './folder-store.js';
import {createFolderSync} from './folder-sync.js';
import {askFolderPassword,useBrowserFolder} from './folder-other-salt.js';
import {openSaltReconciliation} from './folder-salt-ui.js';
import {connectSaltFolder} from './folder-salt-connect.js';
import {beginFolderCopy,discardFolderCopy,getFolderCopy,pickFolderCopy,renderFolderCopies,renderFolderCopyBanner,selectFolderCopy} from './folder-copy-view.js';
import {confirmFolderReset,renderFolderReview} from './folder-review.js';
import {createFolderIndicator,folderTime,setFolderStatus} from './folder-status.js';
import {addFolderSettingsTrigger,createFolderGate,quietReadOnlyCards,renderFolderSettings,renderReadOnlyNote} from './folder-ui.js';
import {renderSettingsImport} from './import-ui.js';
import { ensureVaultId, getMeta, saveMeta, isReadOnly, setWriteMode,readVault } from './db.js';
import {withVaultLineage} from './folder-write.js';
import { getSessionVaultId, setSessionVaultId, setSessionSignal, setIdleTimeout,startReadOnlySession } from './session.js';
import { publishVaultEvent, watchVaultEvents } from './vault-events.js';
import { renderMarkdown } from './markdown.js';
import { createScope } from './lifecycle.js';
import { clearSession, storeSessionKey } from './session.js';
import { createEditSession, serialQueue, captureTodoDraft } from './edit-session.js';
import { bindDraftLimits, bindTextLimits, bindTodoLimits } from './editor-limits.js';
import { validateNote } from './note-model.js';
// app.js — Bootstrap, SPA router, view switching

import { openDB, isFirstUse } from './db.js';
import { renderAuthView, getSessionKey, startSessionTimer, stopSessionTimer, logout } from './auth.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';
import { initBeforeUnload } from './backup.js';
import { icons } from './icons.js';
import { createHistory } from './history.js';
import { t, tp, getLang, setLang, initI18n } from './i18n.js';

// App state
let todoHistory = null;
let activeEdit=null;
let scope=null;
let modalController=null;
let sessionController=null;
let sessionGeneration=0;
const enqueueWrite=serialQueue();
const knownVersions=new Map();
let loadedVaultId=null;
let folderGate=null,folderSync=null,folderKey=null,folderLoaded=null;
let newDraft={title:'',content:'',expanded:false};
let barSaving=null;
const newTodoIds=new Set();
let searchText='';
let vaultSearch='';
let cryptoKey = null;
let currentView = 'notes'; // notes | archive | trash | label
let currentLabel = null;
let vaultLayout = 'grid';
let vaultLockMinutes=null;
let vaultLabel = null;
let vaultClipboardWarningDismissed = false;
let sidebarCollapsed = false;
let unreadableCount = 0;
let unreadableRecords=[];
let notes = []; // Decrypted notes in memory

// DOM references
const appContainer = document.getElementById('app-container');
const secretUI = createSecretUI({notify: showToast});

// --- Bootstrap ---

document.addEventListener('DOMContentLoaded', async () => {
  try { sessionStorage.removeItem('keeplocal_session_key');sessionStorage.removeItem('keeplocal_session_ts'); } catch {}
  await openDB();
  if(folderSupported() && await readSyncFolder()) setWriteMode('readOnly');
  await initI18n();
  await initTheme();
  await initBeforeUnload();
  document.title = t('app.title');

  // Try to restore session
  const sessionKey = await getSessionKey();
  if (sessionKey) {
    cryptoKey = sessionKey;
    await showApp();
  } else {
    showAuth();
  }
});

// --- Auth View ---

function teardownSession() {
  discardFolderCopy();
  secretUI.dispose();
  folderGate=null;
  setFolderStatus(null);
  folderSync?.dispose();folderSync=null;folderKey=null;folderLoaded=null;
  setWriteMode('readWrite');
  closeDialogs();
  stopSessionTimer();clearSession();sessionController?.abort();sessionController=null;modalController?.abort();modalController=null;scope?.dispose();scope=null;
  sessionGeneration++;
  activeEdit?.cancel();activeEdit?.cleanup?.();activeEdit=null;todoHistory=null;
  const modal=document.querySelector('.modal-card');
  if(modal?._keyHandler)document.removeEventListener('keydown',modal._keyHandler);
  document.querySelectorAll('.color-picker-popup,.labels-picker-popup,.card-menu-popup,.confirm-dialog').forEach(p=>p.remove());
  newDraft={title:'',content:'',expanded:false};newTodoIds.clear();clearDrafts();searchText='';vaultSearch='';vaultLabel=null;
  cryptoKey=null;notes=[];knownVersions.clear();loadedVaultId=null;unreadableCount=0;unreadableRecords=[];
}
async function showAuth(message='') {
  teardownSession();
  appContainer.replaceChildren();
  const generation=sessionGeneration;
  const supported=folderSupported();
  if(supported) setWriteMode('readOnly');
  const folder=supported?await readSyncFolder():null;
  if(generation!==sessionGeneration)return;
  setWriteMode(folder?'readOnly':'readWrite');
  sessionController=new AbortController();
  setSessionSignal(sessionController.signal);
  renderAuthView(appContainer,{folder,signal:sessionController.signal,onExit:showAuth,onOpenCopy:attempt=>openFolderCopies(attempt),onAuthenticated:async(key,attempt)=>{
    if(generation!==sessionGeneration)return;
    cryptoKey=key;storeSessionKey(key);
    if(attempt){
      sessionController ||= new AbortController();
      setSessionSignal(sessionController.signal);
      const signal=sessionController.signal;
      startSessionTimer(expired=>showAuth(expired?t('toast.sessionExpired'):''));
      if(attempt.readOnly){
        folderGate=folderGateFor(attempt.handle,'otherSalt',key,signal);
        setFolderStatus('readOnly');
        await showApp();
        return;
      }
      const status=await checkFolder(attempt.handle,attempt.permissionFailure);
      if(signal.aborted)return;
      if(status!=='ok'){
        setFolderStatus('readOnly');
        folderGate=folderGateFor(attempt.handle,status,key,signal);
        folderGate.renderBlock();
        return;
      }
      try {if(!await configureFolderSync({admit:true,selected:attempt.handle}))return;}
      catch {if(!signal.aborted)void showAuth(t('vault.changed'));return;}
      if(signal.aborted)return;
    }
    await showApp();
    if(attempt?.changed){
      showToast(t(attempt.target==='local'?'folder.saltUseLocal':'folder.passwordLoaded',{rev:attempt.head.rev,time:folderTime(attempt.head.exportedAt)}),undefined,undefined,12000);
      if(attempt.stats)showMergeNotice(attempt.stats);
    }
  }});
  const error=document.getElementById('login-error');if(error)error.textContent=message;
}

// --- App View ---

async function showApp({reload=true}={}) {
  const generation=sessionGeneration;
  sessionController ||= new AbortController();
  setSessionSignal(sessionController.signal);
  scope?.dispose();scope=createScope();
  const vaultId=getSessionVaultId()||await ensureVaultId(await getMeta('salt'));
  const currentId=isReadOnly()?await ensureVaultId(await getMeta('salt')):await getMeta('vaultId');
  if(generation!==sessionGeneration)return;
  if(vaultId!==currentId){showAuth(t('vault.changed'));return;}
  loadedVaultId=vaultId;setSessionVaultId(vaultId);
  const unwatch=watchVaultEvents(event=>{
    if(getFolderCopy())return;
    if(event?.type==='vault-replaced'&&event.vaultId!==loadedVaultId)showAuth(t('vault.changed'));
    else if(event?.type==='note-changed'){void refreshChangedNote(event.id);folderSync?.schedule();}
  });
  scope.signal.addEventListener('abort',unwatch,{once:true});
  startSessionTimer(expired=>showAuth(expired?t('toast.sessionExpired'):''));

  renderAppShell();
  if(reload)await loadNotes();
  if(generation!==sessionGeneration)return;
  await purgeExpiredTrash();
  if(generation!==sessionGeneration)return;
  await refreshBackupState();
  if(reload || !isReadOnly()){
    const [layout, warningDismissed, lockMinutes] = await Promise.all([
      getMeta('vaultLayout'),getMeta('vaultClipboardWarningDismissed'),getMeta('vaultLockMinutes'),
    ]);
    if(generation!==sessionGeneration)return;
    vaultLayout = layout === 'list' ? 'list' : 'grid';
    vaultClipboardWarningDismissed = warningDismissed === true;
    vaultLockMinutes=lockMinutes===1||lockMinutes===2?lockMinutes:null;
  }
  renderCurrentView();
  if(folderLoaded){
    const {rev,exportedAt,stats}=folderLoaded;
    folderLoaded=null;
    if(stats)showMergeNotice(stats);
    else showToast(t('folder.loaded',{rev,time:folderTime(exportedAt)}));
  }
  if(!isReadOnly()) await requestPersistence();
  if(generation===sessionGeneration&&!isReadOnly()&&folderKey!==cryptoKey) await configureFolderSync();
}

function showMergeNotice(stats) {
  for(const message of folderMergeMessages(stats))showToast(message,undefined,undefined,12000);
}

function folderGateFor(handle,status,key,signal) {
  return createFolderGate(appContainer,{
    handle,status,key,signal,onOpen:showApp,onExit:logout,notify:showToast,
    onResume:selected=>configureFolderSync({admit:true,selected}),
    onReset:()=>confirmFolderReset({key,signal,onReset:showAuth}),
    onOtherSalt:connectOtherSaltSelection,
    onBrowseCopies:openFolderCopies,
  });
}

async function configureFolderSync({admit=false,selected}={}) {
  folderSync?.dispose();
  folderSync=null;
  renderWriteNow();
  folderKey=cryptoKey;
  const signal=sessionController?.signal,key=cryptoKey;
  if(getFolderCopy()||!folderSupported()||!key||(!admit&&isReadOnly()))return false;
  const [handle,photoFolder]=await Promise.all([selected??readSyncFolder(),getMeta('photoFolder')]);
  if(signal?.aborted||key!==cryptoKey)return false;
  if(!handle){setFolderStatus(null);return false;}
  const rerenderPulled=async(head,stats)=>{
    modalController?.abort();modalController=null;
    if(activeEdit){activeEdit.cancel();activeEdit.cleanup?.();activeEdit=null;}
    await initI18n({persistDefault:false});await initTheme();
    document.title=t('app.title');
    if(signal.aborted)return;
    folderLoaded={...head,stats};
    if(document.querySelector('.app-view'))await showApp();
  };
  const sync=createFolderSync({
    handle,key,signal,photoFolder,onPulled:rerenderPulled,
    onPullCommit:()=>{
      const view=appContainer.querySelector('.app-view');
      if(!view||view.inert)return;
      view.inert=true;
      return ()=>{view.inert=false;};
    },
    onMerged:stats=>{
      if(document.querySelector('.app-view'))showMergeNotice(stats);
      else folderLoaded={stats};
    },onIgnored:()=>showToast(t('folder.ignoredCopies')),
    onEmptyMainReplaced:()=>showToast(t('folder.emptyMainReplaced')),
    onUnavailable:(folder,status)=>{
      folderGate=folderGateFor(folder,status,key,signal);
      if(document.querySelector('.app-view'))return showApp();
      else folderGate.renderBlock();
    },
    onReview:review=>{
      modalController?.abort();modalController=null;
      setFolderStatus('readOnly',undefined,{conflict:review.status==='conflict'});
      folderGate=folderGateFor(handle,review.status,key,signal);
      renderFolderReview(appContainer,review,{
        handle,signal,onExit:logout,onOpenReadOnly:showApp,
        onEnterPassword:async()=>{
          const foreign=await askFolderPassword(handle,signal);
          if(!foreign||signal.aborted)return;
          await openSaltReconciliation({root:appContainer,handle,snapshot:review.snapshot,key,foreign,signal,
            onExit:logout,onOpenReadOnly:showApp,onApplied:outcome=>finishSaltReview(outcome,handle,signal)});
        },
        onUseLocal:async()=>finishSaltReview(await useBrowserFolder({handle,review,key,signal}),handle,signal),
        onReset:()=>confirmFolderReset({key,signal,onReset:showAuth}),
        onRefresh:async()=>{if(await configureFolderSync({admit:true,selected:handle}))await showApp();},
        resolve:async(choice,name)=>{
          const {preserved,replacedEmptyMain}=await sync.resolve(review,choice,name);
          await showApp();
          if(!signal.aborted){
            if(preserved.length)showToast(t('folder.preserved',{files:preserved.join(', ')}),undefined,undefined,12000);
            if(replacedEmptyMain)showToast(t('folder.emptyMainReplaced'));
          }
        },
      });
    },
    onStatus:(status,detail)=>{
      setFolderStatus(status,detail,{onRetry:()=>folderSync?.flush()});
      if(detail==='folder.unreadable')showToast(t(detail));
    },
  });
  folderSync=sync;
  if(admit){
    const ready=await sync.admit();
    if(sync===folderSync)renderWriteNow();
    return ready;
  }
  renderWriteNow();
  sync.schedule();
  return true;
}

async function finishSaltReview(outcome,handle,signal) {
  if(signal.aborted)return;
  cryptoKey=outcome.access.key;
  await closeModal();
  folderKey=null;
  if(!await configureFolderSync({admit:true,selected:handle}))return;
  await showApp();
  const message=outcome.usedBrowser?'folder.useBrowserConfirmed':outcome.access.target==='folder'?'folder.saltUseFolder':'folder.saltUseLocal';
  showToast(t(message),undefined,undefined,12000);
  if(outcome.stats)showMergeNotice(outcome.stats);
}

function connectOtherSaltSelection(selection) {
  const signal=sessionController.signal;
  return connectSaltFolder({root:appContainer,selection,key:cryptoKey,signal,
    notify:showToast,onExit:logout,onOpenReadOnly:async()=>{
      folderGate=folderGateFor(selection.handle,'otherSalt',cryptoKey,signal);
      await closeModal();
      await showApp();
    },
    onApplied:outcome=>finishSaltReview(outcome,selection.handle,signal)});
}

async function openFolderCopies(attempt) {
  const generation=sessionGeneration;
  const selection=attempt?Promise.resolve(attempt.handle):pickFolderCopy();
  const previous={key:cryptoKey,readOnly:isReadOnly(),status:folderGate?.status,
    view:currentView,label:currentLabel,search:searchText,vaultSearch,vaultLabel,draft:{...newDraft}};
  folderSync?.dispose();
  setWriteMode('readOnly');
  try{
    const snapshot=attempt?.snapshot??await readVault();
    const handle=await selection;
    if(generation!==sessionGeneration)return;
    if(!handle){
      setWriteMode(previous.readOnly?'readOnly':'readWrite');
      if(!previous.readOnly)await configureFolderSync();
      return;
    }
    previous.meta=snapshot.meta;
    const known=attempt?.foreign??{salt:snapshot.meta.salt,key:previous.key};
    teardownSession();
    beginFolderCopy(previous);
    setWriteMode('readOnly');
    sessionController=new AbortController();
    setSessionSignal(sessionController.signal);
    startReadOnlySession(snapshot.meta.vaultId);
    startSessionTimer(expired=>showAuth(expired?t('toast.sessionExpired'):''));
    const signal=sessionController.signal;
    await withVaultLineage(()=>{});
    if(signal.aborted)return;
    await renderFolderCopies(appContainer,{handle,known,seenRev:snapshot.meta.folderSeenRev||0,signal,
      onBack:returnFromFolderCopy,onOpen:async copy=>{
        if(signal.aborted)return;
        selectFolderCopy(copy);cryptoKey=copy.key;
        currentView='notes';currentLabel=null;searchText='';vaultSearch='';vaultLabel=null;
        await showApp();
      }});
  }catch(error){
    if(getFolderCopy())await returnFromFolderCopy();
    else if(generation===sessionGeneration){
      setWriteMode(previous.readOnly?'readOnly':'readWrite');
      if(!previous.readOnly)await configureFolderSync();
    }
    showToast(t(typeof error.code==='string'?error.code:'copy.readFailed'));
  }
}

async function returnFromFolderCopy() {
  const previous=getFolderCopy()?.previous;
  teardownSession();
  appContainer.replaceChildren();
  const generation=sessionGeneration;
  if(!previous?.key){await showAuth();return;}
  setWriteMode('readOnly');
  const meta=(await readVault()).meta;
  if(generation!==sessionGeneration)return;
  if(meta.salt!==previous.meta.salt||meta.vaultId!==previous.meta.vaultId){await showAuth(t('vault.changed'));return;}
  cryptoKey=previous.key;storeSessionKey(cryptoKey,meta.vaultId);
  sessionController=new AbortController();setSessionSignal(sessionController.signal);
  setWriteMode(previous.readOnly?'readOnly':'readWrite');
  currentView=previous.view;currentLabel=previous.label;searchText=previous.search;
  vaultSearch=previous.vaultSearch;vaultLabel=previous.vaultLabel;newDraft=previous.draft;
  setDraftDirty('bar',!!(newDraft.title||newDraft.content));
  if(previous.readOnly&&meta.syncFolder)folderGate=folderGateFor(meta.syncFolder,previous.status||'denied',cryptoKey,sessionController.signal);
  await showApp();
}

function renderAppShell() {
  appContainer.innerHTML = `
    <div class="app-view">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <button class="icon-btn menu-btn" data-tooltip="${t('header.menu')}" id="menu-toggle" aria-label="${t('header.menu')}">
            ${icons.menu}
          </button>
          <div class="app-title">Keep<span>Local</span></div>
        </div>
        <div class="header-search">
          <div class="search-container">
            <span class="search-icon">${icons.search}</span>
            <input type="text" placeholder="${t('header.search')}" id="search-input" translate="no" autocorrect="off" aria-label="${t('header.search')}" autocomplete="off" spellcheck="false" autocapitalize="off">
            <button class="icon-btn search-clear" id="search-clear" aria-label="${t('header.clearSearch')}" data-tooltip="${t('header.clearSearch')}">
              ${icons.close}
            </button>
          </div>
        </div>
        <div class="header-right">
          <button class="icon-btn" data-tooltip="${t('header.language')}" id="lang-toggle" aria-label="${t('header.language')}">
            ${icons.language}
          </button>
          <button class="icon-btn" data-tooltip="${t('header.theme')}" id="theme-toggle" aria-label="${t('header.theme')}">
            ${icons.brightness}
          </button>
          <button class="icon-btn" data-tooltip="${t('account.change')}" id="change-password-btn" aria-label="${t('account.change')}">${icons.edit}</button>
          <button class="icon-btn" data-tooltip="${t('header.lock')}" id="lock-btn" aria-label="${t('header.lock')}">
            ${icons.lock}
          </button>
        </div>
      </header>

      <!-- Sidebar overlay (mobile) -->
      <div class="sidebar-overlay" id="sidebar-overlay"></div>

      <!-- Sidebar -->
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-nav">
          <div class="sidebar-item ${currentView==='notes'?'active':''}" data-view="notes">
            <span class="sidebar-icon">${icons.lightbulb}</span>
            <span class="sidebar-item-text">${t('sidebar.notes')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <div class="sidebar-section-title" id="labels-section-title">${t('sidebar.labels')}</div>
          <div id="sidebar-labels"></div>
          <div class="sidebar-item" id="edit-labels-btn">
            <span class="sidebar-icon">${icons.edit}</span>
            <span class="sidebar-item-text">${t('sidebar.editLabels')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <button type="button" class="sidebar-item ${currentView==='vault'?'active':''}" data-view="vault">
            <span class="sidebar-icon">${icons.vault_key}</span>
            <span class="sidebar-item-text">${t('vault.section')}</span>
          </button>
          <div class="sidebar-item ${currentView==='archive'?'active':''}" data-view="archive">
            <span class="sidebar-icon">${icons.archive}</span>
            <span class="sidebar-item-text">${t('sidebar.archive')}</span>
          </div>
          <div class="sidebar-item ${currentView==='trash'?'active':''}" data-view="trash">
            <span class="sidebar-icon">${icons.delete_icon}</span>
            <span class="sidebar-item-text">${t('sidebar.trash')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <div class="sidebar-item" id="backup-btn">
            <span class="sidebar-icon">${icons.backup}</span>
            <span class="sidebar-item-text">${t('sidebar.backup')}</span>
          </div>
          <a class="sidebar-footer" href="https://github.com/rramires" target="_blank" rel="noopener noreferrer">© 2026 github.com/rramires</a>
        </div>
      </nav>

      <!-- Main content -->
      <main class="main-content" id="main-content">
        <div id="main-inner"></div>
      </main>

      <!-- Modal overlay -->
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-card" id="modal-card"></div>
      </div>

      <!-- Toast container -->
      <div class="toast-container" id="toast-container"></div>
    </div>
  `;

  document.getElementById('search-input').value=currentView==='vault'?'':searchText;
  const copy=getFolderCopy()?.copy;
  if(isReadOnly()){
    appContainer.querySelector('.app-view').setAttribute('data-vault-read-only','');
    if(copy){
      appContainer.querySelector('.app-view').setAttribute('data-folder-copy-view','');
      renderFolderCopyBanner(document.getElementById('main-content'),copy,returnFromFolderCopy);
    }else folderGate?.renderBanner(document.getElementById('main-content'));
  } else if(folderSupported()){
    addFolderSettingsTrigger(document.getElementById('backup-btn'),openFolderSettings);
  }
  if(folderSupported()&&!copy)document.getElementById('backup-btn').after(createFolderIndicator());
  renderWriteNow();
  initAppListeners();
}

function renderWriteNow() {
  const existing=document.getElementById('write-now-btn');
  const backup=document.getElementById('backup-btn');
  if(!backup||!folderSync||folderKey!==cryptoKey||isReadOnly()||getFolderCopy()){
    existing?.remove();
    return;
  }
  if(existing)return;
  const sync=folderSync,signal=sessionController.signal;
  const button=document.createElement('button');
  button.id='write-now-btn';
  button.type='button';
  button.className='sidebar-item';
  button.innerHTML=`<span class="sidebar-icon" aria-hidden="true">${icons.check_all}</span>
    <span class="sidebar-item-text">${t('writeNow.button')}</span>`;
  button.disabled=sync.writingNow();
  button.addEventListener('click',async()=>{
    if(button.disabled||sync!==folderSync)return;
    button.disabled=true;
    try{
      const result=await sync.writeNow(async()=>await flushNewNoteBar()&&(!activeEdit||await activeEdit.flush()));
      if(!result||signal.aborted)return;
      closeMobileSidebar();
      showWriteNowResult(result);
    }finally{
      const current=document.getElementById('write-now-btn');
      if(current&&sync===folderSync)current.disabled=false;
    }
  });
  backup.after(button);
}

function showWriteNowResult({review,reason,writtenAt,photo}) {
  let message;
  if(review){
    message=t('writeNow.review');
    if(!document.getElementById('toast-container')){
      const host=document.createElement('div');
      host.id='toast-container';
      host.className='toast-container';
      appContainer.append(host);
    }
  }else if(reason)message=t('writeNow.notWritten',{reason:t(reason)});
  else{
    const time=folderTime(writtenAt);
    message=photo?.name?t('writeNow.writtenWithPhoto',{time,name:photo.name}):t('writeNow.written',{time});
    if(photo?.failure)message+=' '+t('photo.notSaved',{reason:t(photo.failure.code,photo.failure.params)});
  }
  showToast(message,undefined,undefined,12000);
}

async function openFolderSettings(trigger) {
  if(!await closeModal()||!cryptoKey||!trigger.isConnected) return;
  closeMobileSidebar();
  const key=cryptoKey;
  const returnFocus=()=>matchMedia('(max-width: 768px)').matches?document.getElementById('menu-toggle'):trigger;
  modalController=new AbortController();
  renderFolderSettings(document.getElementById('modal-card'),{
    key:cryptoKey,signal:modalController.signal,onClose:closeModal,notify:showToast,
    trigger:returnFocus,
    hasUnreadable:()=>unreadableCount>0,pauseFolder:()=>folderSync?.dispose(),
    onOtherSalt:connectOtherSaltSelection,
    onBrowseCopies:openFolderCopies,
    onImportBackup:()=>openSettingsImport(returnFocus),
    onFolderChange:selected=>key===cryptoKey?configureFolderSync({admit:!!selected,selected}):undefined,
  });
  document.getElementById('modal-overlay').classList.add('open');
}

async function openSettingsImport(trigger) {
  if(!await flushNewNoteBar()||!await closeModal()||!cryptoKey||isReadOnly())return;
  modalController=new AbortController();
  renderSettingsImport(document.getElementById('modal-card'),{
    signal:modalController.signal,trigger,onClose:closeModal,
    onImported:async key=>{
      cryptoKey=key;
      await closeModal();
      await initI18n({persistDefault:false});
      await initTheme();
      await showApp();
    },
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function initAppListeners() {
  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('main-content');
    const overlay = document.getElementById('sidebar-overlay');

    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
      overlay.classList.toggle('visible');
    } else {
      sidebarCollapsed = !sidebarCollapsed;
      sidebar.classList.toggle('collapsed', sidebarCollapsed);
      main.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    }
  });

  // Sidebar overlay (mobile close)
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Language toggle
  document.getElementById('lang-toggle').addEventListener('click', async () => {
    if(!await closeModal())return;
    const newLang = getLang() === 'pt-BR' ? 'en' : 'pt-BR';
    await setLang(newLang);
    document.title = t('app.title');
    await showApp({reload:false});
  });

  document.getElementById('change-password-btn').addEventListener('click',async()=>{
    if(!await flushNewNoteBar()||!await closeModal())return;
    const {renderPasswordChange}=await import('./account.js');
    const controller=new AbortController();modalController=controller;
    scope.signal.addEventListener('abort',()=>controller.abort(),{once:true});
    renderPasswordChange(document.getElementById('modal-card'),async key=>{if(controller.signal.aborted)return;cryptoKey=key;await closeModal();await showApp();},{signal:controller.signal,onClose:closeModal,onRecovery:()=>document.getElementById('recover-notes-btn')?.click()});
    document.getElementById('modal-overlay').classList.add('open');
  });

  // Lock
  document.getElementById('lock-btn').addEventListener('click', async () => {
    const saved=await flushNewNoteBar()&&await closeModal();
    if(!saved&&!await confirmDialog(t('session.discardAndLock'),{danger:true}))return;
    logout();
  });

  // Sidebar navigation
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.addEventListener('click', async () => {
      const view = item.dataset.view;
      if (currentView !== view && (currentView === 'vault' || view === 'vault')) {
        clearTimeout(searchTimeout);
        resetVaultSearch();
      }
      currentView = view;
      if(currentView==='trash')await purgeExpiredTrash();
      currentLabel = null;
      updateSidebarActive(item);
      renderCurrentView();
      closeMobileSidebar();
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  let searchTimeout;

  searchClear.classList.toggle('visible', !!(currentView === 'vault' ? vaultSearch : searchText));
  searchInput.addEventListener('input', () => {
    const inVault = currentView === 'vault';
    if (inVault) vaultSearch = searchInput.value.trim();
    else searchText = searchInput.value;
    clearTimeout(searchTimeout);
    searchClear.classList.toggle('visible', searchInput.value.length > 0);
    searchTimeout = scope.later(() => {
      if (inVault) searchInput.value = '';
      renderCurrentView();
    }, 300);
  });
  searchInput.addEventListener('blur', () => {
    if (currentView === 'vault') searchInput.value = '';
  });
  searchClear.addEventListener('click', () => {
    clearTimeout(searchTimeout);
    resetVaultSearch();
    renderCurrentView();
  });

  // Backup
  document.getElementById('backup-btn').addEventListener('click', async () => {
    if(getFolderCopy())return;
    const { exportBackup } = await import('./backup.js');
    if(!await flushNewNoteBar()||activeEdit&&!await activeEdit.flush())return;
    try{const result=await exportBackup();if(result)showToast(t(result.unreadableCount?'backup.unreadableExported':'toast.backupExported'));}catch(error){showToast(t('backup.failed'));}
    closeMobileSidebar();
  });

  // Edit labels
  document.getElementById('edit-labels-btn').addEventListener('click', () => {
    openLabelsManager();
    closeMobileSidebar();
  });

  // Modal overlay click to close
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      closeModal();
    }
  });

  // Escape key to close modal
  scope.listen('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-overlay');
      if (modal?.classList.contains('open')) {
        closeModal();
      }
    }
  }, 'escape');
}

function resetVaultSearch() {
  vaultSearch = '';
  searchText = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.remove('visible');
}

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

function updateSidebarActive(activeItem) {
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  activeItem.classList.add('active');
}

// --- Notes Management ---

async function loadNotes({refreshNotes=true}={}) {
  const generation=sessionGeneration,key=cryptoKey;
  const {getAllNoteRecords}=await import('./db.js');
  const {decrypt,base64ToArray}=await import('./crypto.js');
  const records=getFolderCopy()?.copy?.payload.notes??await getAllNoteRecords(),loaded=[],versions=new Map(),failed=[];let failures=0;
  for(const record of records){
    let reason='decrypt';
    try{
      const text=await decrypt(key,base64ToArray(record.iv),base64ToArray(record.ciphertext));reason='json';
      const value=JSON.parse(text);reason='model';
      const note=validateNote(value);
      if(note.id!==record.id||note.updatedAt!==record.updatedAt)throw new Error('note.invalid');
      loaded.push(note);versions.set(note.id,record.updatedAt);
    }catch(error){failures++;failed.push({record,reason:error.code==='note.tooLarge'?'limit':reason});}
    if(generation!==sessionGeneration)return;
  }
  if(generation!==sessionGeneration)return;
  unreadableCount=failures;unreadableRecords=failed;
  if(refreshNotes){notes=loaded;for(const[id,version]of versions)knownVersions.set(id,version);}
}

const noteWrites=createNoteWriteQueue({enqueue:enqueueWrite,read:id=>notes.find(n=>n.id===id),version:id=>knownVersions.get(id),session:()=>sessionGeneration,
  persist:async(snapshot,{known,token})=>{
    const key=cryptoKey,vaultId=loadedVaultId,signal=sessionController?.signal;
    if(!key||token!==sessionGeneration)throw Error('session.ended');
    snapshot.updatedAt=Math.max(Date.now(),(known||0)+1);validateNote(snapshot);
    const {encrypt,arrayToBase64,arrayBufferToBase64}=await import('./crypto.js');
    const {guardedNoteWrite}=await import('./db.js');
    const {iv,ciphertext}=await encrypt(key,JSON.stringify(snapshot));
    if(token!==sessionGeneration)throw Error('session.ended');
    try{await guardedNoteWrite({id:snapshot.id,record:{id:snapshot.id,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext),updatedAt:snapshot.updatedAt},expectedVaultId:vaultId,knownUpdatedAt:known,signal});}
    catch(error){if(token===sessionGeneration&&error.code==='vault.changed')showAuth(t('vault.changed'));throw error;}
    return snapshot;
  },
  publish:snapshot=>{
    knownVersions.set(snapshot.id,snapshot.updatedAt);
    const i=notes.findIndex(n=>n.id===snapshot.id);if(i>=0)notes[i]=snapshot;else notes.push(snapshot);
    setUnsaved();publishVaultEvent('note-changed',{id:snapshot.id});
  }
});
export function saveNote(note,{sourceEdit=null,fields=null,change=null}={}) {
  return noteWrites(note,{fields,change,baseVersion:sourceEdit?.capture().updatedAt??note.updatedAt,committed:snapshot=>{
    note.updatedAt=snapshot.updatedAt;
    if(change)Object.assign(note,metadataFields(snapshot));
    if(sourceEdit&&sourceEdit===activeEdit)sourceEdit.applyFields?.(metadataFields(snapshot));
  }});
}
async function saveFromUI(note,{mergeDraft=true,context='editor',change=null}={}) {
  const generation=sessionGeneration;
  const sourceEdit=activeEdit?.id===note.id?activeEdit:null;
  if(sourceEdit&&mergeDraft)Object.assign(note,sourceEdit.capture());
  if(newTodoIds.has(note.id)&&isEmptyTodo(note))return true;
  try { await saveNote(note,{sourceEdit,change,fields:context==='editor'&&sourceEdit?editorFields(note):null});return generation===sessionGeneration; }
  catch(error){
    if(generation!==sessionGeneration)return false;
    if(error.code==='note.conflict'&&context==='action'&&error.origin==='local'){showToast(t('note.actionLocalConflict'));return false;}
    if(error.code==='note.conflict')showToast(t(context==='action'?'note.actionConflict':'note.conflict'),t(note.type==='vault'?'vault.saveAsNew':'note.saveAsNew'),async()=>{
      if(generation!==sessionGeneration)return;
      const edit=activeEdit?.id===note.id?activeEdit:null;
      const source=edit?(edit.captureDraft?.()||edit.capture()):structuredClone(note),captured=JSON.stringify(source);
      const copy={...source,id:crypto.randomUUID(),createdAt:Date.now(),order:Math.min(0,...notes.map(n=>n.order))-1};
      if(!await saveFromUI(copy)||generation!==sessionGeneration)return;
      if(edit&&activeEdit===edit&&JSON.stringify(edit.captureDraft?.()||edit.capture())===captured){
        edit.cancel();edit.cleanup?.();activeEdit=null;await closeModal();
      }
      await refreshChangedNote(note.id);
    });
    else showToast(t(error.code||(context==='action'?'note.actionFailed':'note.saveFailed')));
    return false;
  }
}

async function changeFromUI(source,change) {
  if(newTodoIds.has(source.id)&&isEmptyTodo(source)&&activeEdit?.id===source.id){const draft=structuredClone(source);change(draft);activeEdit.applyFields?.(metadataFields(draft));return true;}
  return saveFromUI(source,{mergeDraft:false,context:'action',change});
}
async function changeManyFromUI(sources,change) {
  const generation=sessionGeneration,captures=sources.map(n=>noteWrites.capture(n)),plans=sources.map(n=>({next:{id:n.id}}));
  if(!plans.length)return true;
  try{await persistNoteBatch(plans,{replan:()=>{plans.splice(0,plans.length,...captures.map(capture=>planNoteChange(capture(),change)));},enqueue:enqueueWrite,getVersion:id=>knownVersions.get(id),key:cryptoKey,vaultId:loadedVaultId,signal:sessionController?.signal,assertCurrent:()=>replaceExistingNotes(notes,plans),onCommitted:()=>{
    if(generation!==sessionGeneration)return;
    notes=replaceExistingNotes(notes,plans);
    for(const {next,fields} of plans){noteWrites.recordCommit(next.id,next.updatedAt,knownVersions.get(next.id));knownVersions.set(next.id,next.updatedAt);if(activeEdit?.id===next.id)activeEdit.applyFields?.({...fields,updatedAt:next.updatedAt});publishVaultEvent('note-changed',{id:next.id});}
    setUnsaved();
  }});return generation===sessionGeneration;}
  catch(error){if(generation===sessionGeneration){if(error.code==='vault.changed')showAuth(t('vault.changed'));else showToast(t(error.code==='vault.readOnly'?error.code:error.code==='note.conflict'?(error.origin==='local'?'note.actionLocalConflict':'note.actionConflict'):'note.actionFailed'));}return false;}
}

export async function permanentDeleteNote(id) {
  if (!notes.find(n => n.id === id)?.deletedAt) throw new Error(t('security.trashOnly'));
  const generation=sessionGeneration,vaultId=loadedVaultId,knownUpdatedAt=knownVersions.get(id),signal=sessionController?.signal;
  const { guardedNoteWrite } = await import('./db.js');
  const { setUnsaved } = await import('./backup.js');

  try{await guardedNoteWrite({id,expectedVaultId:vaultId,knownUpdatedAt,signal});}catch(error){if(generation===sessionGeneration&&error.code==='vault.changed')showAuth(t('vault.changed'));throw error;}
  if(generation!==sessionGeneration)return;
  publishVaultEvent('note-changed',{id});
  notes = notes.filter(n => n.id !== id);
  setUnsaved();
}

async function deleteFromUI(id){
  const generation=sessionGeneration;
  try{await permanentDeleteNote(id);return generation===sessionGeneration;}
  catch(error){if(generation===sessionGeneration)showToast(t(error.code==='vault.readOnly'?error.code:'note.deleteFailed'));return false;}
}

async function refreshChangedNote(id) {
  if(getFolderCopy()||!cryptoKey||activeEdit?.id===id||enqueueWrite.has(id))return;
  const generation=sessionGeneration,key=cryptoKey;
  try{
    const {getNoteRecord}=await import('./db.js'),{decrypt,base64ToArray}=await import('./crypto.js');
    const record=await getNoteRecord(id);
    const note=record?validateNote(JSON.parse(await decrypt(key,base64ToArray(record.iv),base64ToArray(record.ciphertext)))):null;
    if(generation!==sessionGeneration||activeEdit?.id===id||enqueueWrite.has(id))return;
    if(note&&note.id!==id)throw new Error('note.invalid');
    notes=notes.filter(n=>n.id!==id);
    if(note){notes.push(note);knownVersions.set(id,record.updatedAt);}
    await refreshBackupState();if(generation===sessionGeneration)renderCurrentView();
  }catch{if(generation===sessionGeneration&&cryptoKey&&!activeEdit){await loadNotes();if(generation===sessionGeneration)renderCurrentView();}}
}

export function getNotes() {
  return notes;
}

export function getCryptoKey() {
  return cryptoKey;
}

// --- View Rendering ---

function renderCurrentView() {
  if(!cryptoKey||!document.getElementById('main-inner'))return;
  const searchQuery = document.getElementById('search-input')?.value?.trim().toLowerCase() || '';

  switch (currentView) {
    case 'notes':
      renderNotesView(searchQuery);
      break;
    case 'vault':
      renderVaultSection(document.getElementById('main-inner'), {
        items: notes.filter(note => note.type === 'vault' && !note.deletedAt),
        query: vaultSearch,
        selectedLabel: vaultLabel, onLabel: label => { vaultLabel=label; renderCurrentView(); },
        layout: vaultLayout, onLayout: setVaultLayout, ...vaultCardActions,
        lockMinutes:vaultLockMinutes,onLockMinutes:isReadOnly()?null:setVaultLockMinutes,
        onNew: chooseNewVaultItem,
        onDismissWarning: vaultClipboardWarningDismissed ? null : dismissVaultClipboardWarning,
      });
      break;
    case 'archive':
      renderArchiveView(searchQuery);
      break;
    case 'trash':
      renderTrashView(searchQuery);
      break;
    case 'label':
      renderLabelView(currentLabel, searchQuery);
      break;
  }

  if(isReadOnly()) quietReadOnlyCards(document.getElementById('main-inner'));
  if (unreadableCount) {
    const warning = document.createElement('div');
    warning.className = 'unreadable-warning notice notice-warning';
    warning.setAttribute('role', 'alert');
    const icon=document.createElement('span');icon.className='notice-icon';icon.setAttribute('aria-hidden','true');icon.textContent='⚠';
    const message=document.createElement('p');message.textContent=tp('notes.unreadable',unreadableCount);warning.append(icon,message);
    const recover=document.createElement('button');recover.id='recover-notes-btn';recover.className='btn-secondary';recover.textContent=t('recovery.open');
    recover.addEventListener('click',async()=>{
      if(!await closeModal())return;
      const controller=new AbortController();modalController=controller;
      scope.signal.addEventListener('abort',()=>controller.abort(),{once:true});
      const {renderRecovery}=await import('./recovery.js');
      await loadNotes({refreshNotes:false});
      if(controller.signal.aborted||!cryptoKey)return;
      renderCurrentView();
      if(!unreadableRecords.length){await closeModal();return;}
      renderRecovery(document.getElementById('modal-card'),unreadableRecords,cryptoKey,{signal:controller.signal,secretUI,onClose:closeModal,onCreate:note=>saveFromUI(note),onDiscard:async()=>{await closeModal();await loadNotes();renderCurrentView();}});
      document.getElementById('modal-overlay').classList.add('open');
    });
    warning.append(recover);document.getElementById('main-inner').prepend(warning);
  }
  updateSidebarLabels();
  applyVaultIdleTimeout();
}

const vaultCardActions = {
  open: openNoteModal,
  copyField: value=>secretUI.copy(value,sessionController?.signal),
  async change(item, intent) {
    if (await changeFromUI(item, intent)) renderCurrentView();
  },
  async remove(item) {
    if (await showConfirm(t('confirm.deletePermanently'), {danger:true}) && await deleteFromUI(item.id)) {
      renderCurrentView();
      showToast(t('toast.noteDeletedForever'));
    }
  },
};

async function dismissVaultClipboardWarning() {
  const signal = scope.signal;
  try {
    await saveMeta('vaultClipboardWarningDismissed', true);
    if (signal.aborted) return;
    vaultClipboardWarningDismissed = true;
    if (currentView === 'vault') renderCurrentView();
  } catch {
    if (!signal.aborted) showToast(t('note.saveFailed'));
  }
}

async function setVaultLayout(layout) {
  const signal = scope.signal;
  try {
    if(!isReadOnly()) await saveMeta('vaultLayout', layout);
    if (signal.aborted) return;
    vaultLayout = layout;
    if (currentView === 'vault') {
      renderCurrentView();
      document.querySelector(`[data-vault-layout="${layout}"]`)?.focus();
    }
  } catch {
    if (!signal.aborted) showToast(t('note.saveFailed'));
  }
}

function applyVaultIdleTimeout() {
  const inside=currentView==='vault'||document.querySelector('#modal-overlay.open :is(.vault-detail,.vault-editor)');
  setIdleTimeout(inside&&vaultLockMinutes?vaultLockMinutes*60_000:undefined);
}

async function setVaultLockMinutes(minutes) {
  const signal=scope?.signal;
  if(!signal||signal.aborted||isReadOnly()||![null,1,2].includes(minutes))return;
  try {
    await saveMeta('vaultLockMinutes',minutes);
    if(signal.aborted)return;
    vaultLockMinutes=minutes;
    applyVaultIdleTimeout();
  } catch {
    if(!signal.aborted){
      renderCurrentView();
      showToast(t('note.saveFailed'));
    }
  }
}

function filterNotes(notesList, searchQuery) {
  const visibleNotes = notesList.filter(note => note.type !== 'vault');
  if (!searchQuery) return visibleNotes;
  return visibleNotes.filter(n => {
    const titleMatch = n.title?.toLowerCase().includes(searchQuery);
    const contentMatch = n.type === 'text' && n.content?.toLowerCase().includes(searchQuery);
    const taskMatch = n.type === 'todo' && n.tasks?.some(t => t.text?.toLowerCase().includes(searchQuery));
    return titleMatch || contentMatch || taskMatch;
  });
}

function renderNotesView(searchQuery) {
  const active = notes.filter(n => !n.deletedAt && !n.archivedAt);
  const filtered = filterNotes(active, searchQuery);
  const pinned = filtered.filter(n => n.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const unpinned = filtered.filter(n => !n.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const mainInner = document.getElementById('main-inner');
  let html = renderNewNoteBar();

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.lightbulb}</div>
      <div class="empty-text">${t('notes.empty')}</div>
    </div>`;
  } else {
    if (pinned.length > 0) {
      html += `<div class="section-header">${t('notes.pinned')}</div>`;
      html += `<div class="notes-grid" id="pinned-grid">${pinned.map(n => renderNoteCard(n, { view: 'notes' })).join('')}</div>`;
    }
    if (pinned.length > 0 && unpinned.length > 0) {
      html += `<div class="section-header">${t('notes.others')}</div>`;
    }
    if (unpinned.length > 0) {
      html += `<div class="notes-grid" id="unpinned-grid">${unpinned.map(n => renderNoteCard(n, { view: 'notes' })).join('')}</div>`;
    }
  }

  mainInner.innerHTML = html;
  initNewNoteBar();
  initCardListeners();
}

function renderArchiveView(searchQuery) {
  const archived = notes.filter(n => n.archivedAt && !n.deletedAt);
  const filtered = filterNotes(archived, searchQuery);

  const mainInner = document.getElementById('main-inner');
  let html = '';

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.archive}</div>
      <div class="empty-text">${t('archive.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${filtered.map(n => renderNoteCard(n, { view: 'archive' })).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  initCardListeners();
}

async function purgeExpiredTrash(){
  if(isReadOnly()) return;
  try{await purgeTrash(notes,permanentDeleteNote);}catch(error){showToast(t(error.code||'note.saveFailed'));}
}

function renderTrashView(searchQuery) {
  const trashed = notes.filter(n => n.deletedAt);
  const filtered = filterNotes(trashed, searchQuery);

  const valid=filtered;
  const vaultItems = trashed.filter(note => note.type === 'vault' && note.title.toLowerCase().includes(searchQuery));

  const mainInner = document.getElementById('main-inner');
  let html = '';

  if (trashed.length > 0) {
    html += `<div style="padding: 8px 8px 16px; color: var(--text-secondary); font-size: 13px;">
      ${t('trash.autoDelete')}
      <button class="btn-secondary" id="empty-trash-btn" style="margin-left: 8px; padding: 4px 12px; font-size: 13px;">${t('trash.emptyTrash')}</button>
    </div>`;
  }

  if (valid.length === 0 && vaultItems.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.delete_icon}</div>
      <div class="empty-text">${t('trash.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${valid.map(n => renderNoteCard(n, { view: 'trash' })).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  const grid = mainInner.querySelector('.notes-grid');
  for (const item of vaultItems) grid.append(renderVaultCard(item, {...vaultCardActions, trash:true}));
  initCardListeners();

  document.getElementById('empty-trash-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('trash.confirmEmpty'),{danger:true})) {
      const trashedNotes = notes.filter(n => n.deletedAt);
      for (const n of trashedNotes) {
        if(!await deleteFromUI(n.id))return;
      }
      renderCurrentView();
      showToast(t('trash.emptied'));
    }
  });
}

function renderLabelView(label, searchQuery) {
  const labeled = notes.filter(n => !n.deletedAt && !n.archivedAt && n.labels?.includes(label));
  const filtered = filterNotes(labeled, searchQuery);

  const mainInner = document.getElementById('main-inner');
  let html = `<div class="section-header">${escapeHTMLString(label)}</div>`;

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.label}</div>
      <div class="empty-text">${t('labels.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${filtered.map(n => renderNoteCard(n, { view: 'notes' })).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  initCardListeners();
}

// --- Card Rendering ---

function renderNoteCard(note, { view = 'notes' } = {}) {
  const isArchiveView = view === 'archive';
  const isTrashView = view === 'trash';
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${escapeAttr(note.color)}"` : '';
  const pinClass = note.pinned ? 'pinned' : '';

  let contentHtml = '';
  if (note.type === 'text') {
    const preview = (note.content || '').replace(/[#*_`~\[\]]/g, '').slice(0, 200);
    contentHtml = `<div class="card-content">${escapeHTMLString(preview)}</div>`;
  } else if (note.type === 'todo') {
    const tasks = note.tasks || [];
    const pending = tasks.filter(t => !t.done && !t.parentId).slice(0, 5);
    const done = tasks.filter(t => t.done && !t.parentId);
    contentHtml = '<div class="card-tasks">';
    for (const t of pending) {
      contentHtml += `<div class="card-task-item"><span class="task-check"></span><span class="task-text">${escapeHTMLString(t.text)}</span></div>`;
    }
    for (const t of done.slice(0, 3)) {
      contentHtml += `<div class="card-task-item"><span class="task-check checked"></span><span class="task-text done">${escapeHTMLString(t.text)}</span></div>`;
    }
    const remaining = tasks.length - pending.length - Math.min(done.length, 3);
    if (remaining > 0) {
      contentHtml += `<div class="card-tasks-more">${tp('card.itemCount', remaining)}</div>`;
    }
    contentHtml += '</div>';
  }

  const labelsHtml = note.labels?.length
    ? `<div class="card-labels">${note.labels.map(l => `<span class="label-chip">${escapeHTMLString(l)}</span>`).join('')}</div>`
    : '';

  let toolbarHtml = '';
  if (isTrashView) {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="restore" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.restore')}">${icons.restore}</button>
      <button class="icon-btn card-action" data-action="delete-forever" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.deletePermanently')}">${icons.delete_forever}</button>
    `;
  } else if (isArchiveView) {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="unarchive" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.unarchive')}">${icons.unarchive}</button>
      <button class="icon-btn card-action" data-action="trash" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.delete')}">${icons.delete_icon}</button>
    `;
  } else {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="color" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.color')}">${icons.palette}</button>
      <button class="icon-btn card-action" data-action="archive" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.archive')}">${icons.archive}</button>
      <button class="icon-btn card-action" data-action="trash" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.delete')}">${icons.delete_icon}</button>
      <button class="icon-btn card-action" data-action="more" data-id="${escapeAttr(note.id)}" data-tooltip="${t('card.more')}">${icons.more_vert}</button>
    `;
  }

  return `
    <div class="note-card" data-id="${escapeAttr(note.id)}" ${colorAttr} draggable="true">
      <button class="icon-btn card-pin ${pinClass} card-action" data-action="pin" data-id="${escapeAttr(note.id)}" data-tooltip="${note.pinned ? t('card.unpin') : t('card.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
      <div class="card-inner">
        ${note.title ? `<div class="card-title">${escapeHTMLString(note.title)}</div>` : ''}
        ${contentHtml}
      </div>
      ${labelsHtml}
      <div class="card-footer">
        <div class="card-toolbar">${toolbarHtml}</div>
        <div class="card-timestamp">${formatDateShort(note.updatedAt)}</div>
      </div>
    </div>
  `;
}

function initCardListeners() {
  // Card click to open modal
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open if clicking action buttons
      if (e.target.closest('.card-action') || e.target.closest('.card-toolbar')) return;
      const id = card.dataset.id;
      const note = notes.find(n => n.id === id);
      if (note) openNoteModal(note);
    });
  });

  // Card actions
  document.querySelectorAll('.card-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const note = notes.find(n => n.id === id);
      if (!note) return;

      switch (action) {
        case 'pin':
          if (!await changeFromUI(note,next=>{next.pinned = !next.pinned;})) return false;
          renderCurrentView();
          break;
        case 'archive':
          if (!await changeFromUI(note,next=>{next.archivedAt = Date.now();})) return false;
          renderCurrentView();
          showToast(t('toast.noteArchived'), t('toast.undo'), async () => {
            if (!await changeFromUI(note,next=>{next.archivedAt = null;})) return false;
            renderCurrentView();
          });
          break;
        case 'unarchive':
          if (!await changeFromUI(note,next=>{next.archivedAt = null;})) return false;
          renderCurrentView();
          showToast(t('toast.noteUnarchived'));
          break;
        case 'trash':
          if (!await changeFromUI(note,next=>{next.deletedAt = Date.now();})) return false;
          renderCurrentView();
          showToast(t('toast.noteToTrash'), t('toast.undo'), async () => {
            if (!await changeFromUI(note,next=>{next.deletedAt = null;})) return false;
            renderCurrentView();
          });
          break;
        case 'restore':
          if (!await changeFromUI(note,next=>{next.deletedAt=null;next.archivedAt=null;})) return false;
          renderCurrentView();
          showToast(t('toast.noteRestored'));
          break;
        case 'delete-forever':
          if (!note.deletedAt) return;
          if (await showConfirm(t('confirm.deletePermanently'),{danger:true})) {
            if(!await deleteFromUI(id))return;
            renderCurrentView();
            showToast(t('toast.noteDeletedForever'));
          }
          break;
        case 'color':
          openColorPicker(btn, note);
          break;
        case 'more':
          openCardMenu(btn, note);
          break;
      }
    });
  });

  initCardDragDrop();
}

// --- New Note Bar ---

function renderNewNoteBar() {
  return `
    <div class="new-note-bar ${newDraft.expanded?'expanded':''}" id="new-note-bar">
      <div class="new-note-collapsed">
        <span class="new-note-placeholder">${t('notes.createNote')}</span>
        <div class="new-note-actions">
          <button class="icon-btn" data-tooltip="${t('notes.newList')}" id="new-todo-btn">${icons.check_list}</button>
        </div>
      </div>
      <div class="new-note-expanded">
        <input class="new-note-title" placeholder="${t('modal.titlePlaceholder')}" id="new-note-title" value="${escapeAttr(newDraft.title)}" autocomplete="off" spellcheck="false" autocapitalize="off">
        <textarea class="new-note-body" placeholder="${t('notes.createNote')}" id="new-note-body" rows="1" autocomplete="off" spellcheck="false" autocapitalize="off"></textarea>
        <div class="new-note-toolbar">
          <div class="toolbar-left">

          </div>
          <div class="toolbar-right">
            <button class="btn-secondary" id="new-note-close">${t('modal.close')}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function flushNewNoteBar() {
  if(barSaving)return barSaving;
  const bar=document.getElementById('new-note-bar');
  if(bar){newDraft.title=bar.querySelector('#new-note-title').value;newDraft.content=bar.querySelector('#new-note-body').value;}
  if(!newDraft.title.trim()&&!newDraft.content.trim()){newDraft={title:'',content:'',expanded:false};setDraftDirty('bar',false);return true;}
  const draft={...newDraft};
  bar?.querySelectorAll('input,textarea,button').forEach(e=>e.disabled=true);
  barSaving=(async()=>{
    const ok=await createNewNote('text',draft.title,draft.content,false);
    if(ok){newDraft={title:'',content:'',expanded:false};setDraftDirty('bar',false);if(cryptoKey)renderCurrentView();}
    else bar?.querySelectorAll('input,textarea,button').forEach(e=>e.disabled=false);
    return ok;
  })().finally(()=>{barSaving=null;});
  return barSaving;
}
function initNewNoteBar() {
  const bar=document.getElementById('new-note-bar');if(!bar)return;
  const title=bar.querySelector('#new-note-title'),body=bar.querySelector('#new-note-body');
  body.value=newDraft.content;
  const capture=()=>{newDraft={title:title.value,content:body.value,expanded:bar.classList.contains('expanded')};setDraftDirty('bar',!!(title.value||body.value));};
  bar.querySelector('.new-note-collapsed').addEventListener('click',e=>{if(e.target.closest('#new-todo-btn'))return;bar.classList.add('expanded');newDraft.expanded=true;title.focus();});
  bar.querySelector('#new-todo-btn').addEventListener('click',async e=>{e.stopPropagation();if(await flushNewNoteBar())await createNewNote('todo');});
  bar.querySelector('#new-note-close').addEventListener('click',async()=>{capture();if(await flushNewNoteBar())bar.classList.remove('expanded');});
  bindDraftLimits(title,body,()=>showToast(t('note.tooLarge')));
  for(const input of [title,body])input.addEventListener('input',capture);
  body.addEventListener('input',()=>{body.style.height='auto';body.style.height=body.scrollHeight+'px';});
  scope.listen('click',e=>{if(!cryptoKey||!bar.isConnected||!bar.classList.contains('expanded')||bar.contains(e.target)||e.target.closest('#search-input,#search-clear,#lang-toggle,#write-now-btn'))return;capture();void flushNewNoteBar();},'new-note-outside');
}

async function createNewNote(type, title = '', content = '', render=true) {
  const { generateUUID } = await import('./utils.js');

  const note = {
    id: generateUUID(),
    type,
    title,
    color: 'default',
    pinned: false,
    labels: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    archivedAt: null,
    order: Math.min(0,...notes.filter(n=>!n.deletedAt&&!n.archivedAt).map(n=>n.order))-1,
  };

  if (type === 'text') {
    note.content = content;
  } else {
    note.tasks = [];
  }

  if(type==='todo'){newTodoIds.add(note.id);await openNoteModal(note);}
  else {if(!await saveFromUI(note))return false;if(render)renderCurrentView();}
  return true;
}

// --- Note Modal ---

async function openNoteModal(note) {
  if ((activeEdit || modalController) && !await closeModal()) return;
  note=structuredClone(note);
  if (note.type === 'vault') {
    showVaultModal(note);
  } else if (isReadOnly()) {
    modalController=new AbortController();
    renderReadOnlyNote(document.getElementById('modal-card'),note,{
      signal:modalController.signal,trigger:document.activeElement,onClose:closeModal,
    });
    document.getElementById('modal-overlay').classList.add('open');
  } else if (note.type === 'text') {
    openTextModal(note);
  } else {
    openTodoModal(note);
  }
  return note;
}

function showVaultModal(item, {editor = false, isNew = false, template = false} = {}) {
  const modal = document.getElementById('modal-card');
  const controller = new AbortController();
  modalController = controller;
  const signal = controller.signal;
  const trigger = () => document.querySelector(`[data-vault-open="${item.id}"]`) || document.getElementById('vault-new-item');
  if (editor) {
    activeEdit = renderVaultEditor(modal, item, {
      signal, isNew, template, onClose: closeModal,
      onSave: draft => saveFromUI(draft, {mergeDraft:false}),
      onDirty: dirty => setDraftDirty('editor',dirty),
      onPin: draft => changeFromUI(draft, next => { next.pinned = !next.pinned; }),
    });
  } else {
    renderVaultDetail(modal, item, {
      onClose: closeModal, controls: secretUI, signal,
      onEdit: isReadOnly()?null:()=>openVaultEditor(item),
    });
  }
  focusPanel(modal, {
    signal, trigger,
    titleId: editor ? 'vault-editor-title' : 'vault-detail-title',
    initial: editor ? '[data-vault-title]' : '#modal-close',
  });
  document.getElementById('modal-overlay').classList.add('open');
  applyVaultIdleTimeout();
}

async function chooseNewVaultItem() {
  if(isReadOnly())return;
  const signal=scope.signal;
  const choices=VAULT_TEMPLATE_IDS.map(value=>({value,label:t('vault.template.'+value)}));
  const selected=await choiceDialog(t('vault.templatePrompt'),choices,{title:t('vault.new'),signal});
  if(!selected||signal.aborted)return;
  const item=newVaultItem(Math.min(0,...notes.map(note=>note.order))-1,createVaultTemplate(selected));
  await openVaultEditor(item,true,selected!=='blank');
}

async function openVaultEditor(item, isNew = false, template = false) {
  if (!await closeModal() || !cryptoKey) return;
  showVaultModal(item, {editor:true, isNew, template});
}

function openTextModal(note) {
  const modal = document.getElementById('modal-card');
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${escapeAttr(note.color)}"` : '';

  modal.innerHTML = `
    <div class="modal-header">
      <input class="modal-title-input" placeholder="${t('modal.titlePlaceholder')}" value="${escapeAttr(note.title || '')}" id="modal-title" autocomplete="off" spellcheck="false" autocapitalize="off">
      <button class="icon-btn modal-pin-btn ${note.pinned ? 'pinned' : ''}" id="modal-pin" data-tooltip="${note.pinned ? t('modal.unpin') : t('modal.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
    </div>
    <div class="modal-body">
      <textarea class="note-editor" placeholder="${t('textModal.placeholder')}" id="modal-editor" autocomplete="off" spellcheck="false" autocapitalize="off"></textarea>
      <div class="note-preview hidden" id="modal-preview"></div>
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left">
        <button class="icon-btn" data-tooltip="${t('modal.color')}" id="modal-color-btn">${icons.palette}</button>
        <button class="icon-btn" data-tooltip="${t('modal.labels')}" id="modal-labels-btn">${icons.label}</button>
        <button class="icon-btn" data-tooltip="${t('modal.duplicate')}" id="modal-duplicate-btn">${icons.copy}</button>
        <button class="icon-btn" data-tooltip="${t('modal.archive')}" id="modal-archive-btn">${icons.archive}</button>
        <button class="icon-btn" data-tooltip="${t('modal.delete')}" id="modal-delete-btn">${icons.delete_icon}</button>
        <button class="icon-btn" data-tooltip="${t('modal.undo')}" id="modal-undo-btn">${icons.undo}</button>
        <button class="icon-btn" data-tooltip="${t('modal.redo')}" id="modal-redo-btn">${icons.redo}</button>
        <button class="md-toggle" id="modal-md-toggle" data-tooltip="${t('textModal.markdownToggle')}">
          ${icons.markdown} <span>${t('textModal.preview')}</span>
        </button>
      </div>
      <div class="modal-toolbar-right">
        <span class="modal-timestamp">${t('modal.edited', { time: formatDateShort(note.updatedAt) })}</span>
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  if (colorAttr) modal.setAttribute('data-color', note.color);
  else modal.removeAttribute('data-color');

  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');

  // --- Undo/Redo ---
  const history = createHistory({ title: note.title || '', content: note.content || '' });
  const undoBtn = document.getElementById('modal-undo-btn');
  const redoBtn = document.getElementById('modal-redo-btn');

  function updateUndoRedoBtns() {
    undoBtn.style.opacity = history.canUndo() ? '1' : '0.3';
    redoBtn.style.opacity = history.canRedo() ? '1' : '0.3';
  }
  updateUndoRedoBtns();

  undoBtn.addEventListener('click', () => {
    const prev = history.undo();
    if (prev) {
      titleInput.value = prev.title;
      editor.value = prev.content;
      note.title = prev.title;
      note.content = prev.content;
      void saveFromUI(note);
      updateUndoRedoBtns();
    }
  });

  redoBtn.addEventListener('click', () => {
    const next = history.redo();
    if (next) {
      titleInput.value = next.title;
      editor.value = next.content;
      note.title = next.title;
      note.content = next.content;
      void saveFromUI(note);
      updateUndoRedoBtns();
    }
  });

  // Ctrl+Z / Ctrl+Y
  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoBtn.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redoBtn.click();
    }
  };
  scope.listen('keydown', keyHandler);
  // Store handler ref to remove on close
  modal._keyHandler = keyHandler;

  // --- Text modal listeners ---
  const editor = document.getElementById('modal-editor');
  editor.value=note.content??'';
  const titleInput = document.getElementById('modal-title');
  const preview = document.getElementById('modal-preview');
  const mdToggle = document.getElementById('modal-md-toggle');
  let previewMode = false;
  const capture=()=>({...note,title:titleInput.value,content:editor.value});
  bindTextLimits(note,titleInput,editor,()=>showToast(t('note.tooLarge')));
  const edit=createEditSession({capture,onDirty:dirty=>setDraftDirty('editor',dirty),save:async snapshot=>{
    const ok=await saveFromUI(snapshot);
    if(ok){Object.assign(note,{updatedAt:snapshot.updatedAt,title:titleInput.value,content:editor.value});updateModalTimestamp(note);history.push({title:titleInput.value,content:editor.value});updateUndoRedoBtns();}
    return ok;
  }});
  activeEdit={...edit,id:note.id,applyFields:fields=>Object.assign(note,fields),cleanup:()=>history.clear()};
  editor.addEventListener('input',edit.schedule);
  titleInput.addEventListener('input',edit.schedule);
  editor.addEventListener('blur',()=>void edit.flush());
  // Markdown toggle
  mdToggle.addEventListener('click', () => {
    previewMode = !previewMode;
    mdToggle.classList.toggle('active', previewMode);

    if (previewMode) {
      renderMarkdown(preview,editor.value||'');
      editor.classList.add('hidden');
      preview.classList.remove('hidden');
    } else {
      editor.classList.remove('hidden');
      preview.classList.add('hidden');
    }
  });

  // Pin
  document.getElementById('modal-pin').addEventListener('click', async (e) => {
    const pinButton=e.currentTarget;
    if (!await changeFromUI(note,next=>{next.pinned = !next.pinned;})) return false;
    pinButton.classList.toggle('pinned', note.pinned);
    pinButton.innerHTML = note.pinned ? icons.pin_filled : icons.pin;
  });

  // Close
  document.getElementById('modal-close').addEventListener('click', () => closeModal());

  // Archive
  document.getElementById('modal-archive-btn').addEventListener('click', async () => {
    if (!await changeFromUI(note,next=>{next.archivedAt = Date.now();})) return false;
    if(!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteArchived'));
  });

  // Delete
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    if (!await changeFromUI(note,next=>{next.deletedAt = Date.now();})) return false;
    if(!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteToTrash'), t('toast.undo'), async () => {
      if (!await changeFromUI(note,next=>{next.deletedAt = null;})) return false;
      renderCurrentView();
    });
  });

  // Duplicate
  document.getElementById('modal-duplicate-btn').addEventListener('click', async () => {
    const duplicateGeneration=sessionGeneration,duplicating=activeEdit;
    if(activeEdit&&!await activeEdit.flush())return;
    const { generateUUID } = await import('./utils.js');
    const { deepClone } = await import('./utils.js');
    if(duplicateGeneration!==sessionGeneration)return;
    const dup = deepClone(note);
    dup.id = generateUUID();
    dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
    dup.createdAt = Date.now();
    dup.updatedAt = Date.now();
    dup.pinned = false;
    if (!await saveFromUI(dup)) return false;
    if(duplicating===activeEdit&&!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteDuplicated'));
  });

  // Color
  document.getElementById('modal-color-btn').addEventListener('click', () => {
    openColorPickerModal(note);
  });

  // Labels
  document.getElementById('modal-labels-btn').addEventListener('click', () => {
    openLabelsPickerModal(note);
  });
}

function isEmptyTodo(note){return note.type==='todo'&&!note.title.trim()&&!(note.tasks||[]).some(task=>task.text.trim());}

function openTodoModal(note) {
  const modal = document.getElementById('modal-card');
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${escapeAttr(note.color)}"` : '';

  if (colorAttr) modal.setAttribute('data-color', note.color);
  else modal.removeAttribute('data-color');

  // Initialize undo/redo history for todo modal
  const { deepClone } = getUtils();
  todoHistory = createHistory({ title: note.title || '', tasks: deepClone(note.tasks || []) });

  renderTodoModalContent(note);
  let pendingTask=null;const pendingDraftId=crypto.randomUUID();
  activeEdit={id:note.id,applyFields:fields=>Object.assign(note,fields),capture:()=>note,captureDraft:()=>captureTodoDraft(note,modal,pendingTask?.id||pendingDraftId),cancel(){},cleanup:()=>{todoHistory?.clear();newTodoIds.delete(note.id);},flush:async()=>{
    const title=document.getElementById('modal-title');if(title)note.title=title.value;
    document.querySelectorAll('#modal-card .todo-text').forEach(input=>{const task=note.tasks.find(t=>t.id===input.dataset.taskId);if(task)task.text=input.value;});
    const pending=document.getElementById('add-task-input')?.value.trim();
    if(pending){if(pendingTask)pendingTask.text=pending;else{pendingTask={id:crypto.randomUUID(),text:pending,done:false,order:note.tasks.length,parentId:null};note.tasks.push(pendingTask);}}
    if(newTodoIds.has(note.id)&&isEmptyTodo(note)&&knownVersions.has(note.id)){
      const{guardedNoteWrite}=await import('./db.js');
      try{await guardedNoteWrite({id:note.id,expectedVaultId:loadedVaultId,knownUpdatedAt:knownVersions.get(note.id),signal:sessionController?.signal});notes=notes.filter(n=>n.id!==note.id);return true;}catch{showToast(t('note.saveFailed'));return false;}
    }
    return saveFromUI(note);
  }};

  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');

  // Ctrl+Z / Ctrl+Y for todo modal
  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      document.getElementById('modal-undo-btn')?.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      document.getElementById('modal-redo-btn')?.click();
    }
  };
  scope.listen('keydown', keyHandler);
  modal._keyHandler = keyHandler;
}

function renderTodoModalContent(note) {
  const modal = document.getElementById('modal-card');
  if(!cryptoKey||!modal)return;
  const tasks = note.tasks || [];
  const pending = tasks.filter(t => !t.done).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = tasks.filter(t => t.done).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const pendingRoots = pending.filter(t => !t.parentId);
  const doneRoots = done.filter(t => !t.parentId);

  function renderTaskItem(task, isDone) {
    const children = tasks.filter(t => t.parentId === task.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const checkedClass = isDone ? 'checked' : '';
    const textClass = isDone ? 'todo-text-done' : '';

    let html = `
      <div class="todo-item ${isDone ? '' : ''}" data-task-id="${escapeAttr(task.id)}" draggable="true">
        <span class="drag-handle" title="${t('todo.drag')}">⠿</span>
        <span class="todo-checkbox ${checkedClass}" data-task-id="${escapeAttr(task.id)}"></span>
        <input class="todo-text ${textClass}" value="${escapeAttr(task.text)}" data-task-id="${escapeAttr(task.id)}" ${isDone ? 'style="text-decoration:line-through; color:var(--text-disabled)"' : ''} autocomplete="off" spellcheck="false" autocapitalize="off">
        <span class="todo-item-delete" data-task-id="${escapeAttr(task.id)}" title="${t('todo.deleteTask')}">✕</span>
      </div>
    `;

    for (const child of children) {
      const childChecked = child.done ? 'checked' : '';
      const childTextClass = child.done ? 'todo-text-done' : '';
      html += `
        <div class="todo-item subitem" data-task-id="${escapeAttr(child.id)}" draggable="true">
          <span class="drag-handle" title="${t('todo.drag')}">⠿</span>
          <span class="todo-checkbox ${childChecked}" data-task-id="${escapeAttr(child.id)}"></span>
          <input class="todo-text ${childTextClass}" value="${escapeAttr(child.text)}" data-task-id="${escapeAttr(child.id)}" ${child.done ? 'style="text-decoration:line-through; color:var(--text-disabled)"' : ''} autocomplete="off" spellcheck="false" autocapitalize="off">
          <span class="todo-item-delete" data-task-id="${escapeAttr(child.id)}" title="${t('todo.deleteTask')}">✕</span>
        </div>
      `;
    }

    return html;
  }

  modal.innerHTML = `
    <div class="modal-header">
      <input class="modal-title-input" placeholder="${t('modal.titlePlaceholder')}" value="${escapeAttr(note.title || '')}" id="modal-title" autocomplete="off" spellcheck="false" autocapitalize="off">
      <button class="icon-btn modal-pin-btn ${note.pinned ? 'pinned' : ''}" id="modal-pin" data-tooltip="${note.pinned ? t('modal.unpin') : t('modal.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
    </div>
    <div class="modal-body">
      <!-- Pending tasks -->
      <div class="todo-section" id="pending-section">
        <div class="todo-section-header">
          <span style="font-size:13px; color: var(--text-secondary);">${tp('todo.pendingCount', pendingRoots.length)}</span>
          <div class="section-actions">
            ${pendingRoots.length > 0 ? `<button class="icon-btn" data-tooltip="${t('todo.checkAll')}" id="check-all-btn">${icons.check_all}</button>` : ''}
          </div>
        </div>
        <div class="todo-items" id="pending-items">
          ${pendingRoots.map(t => renderTaskItem(t, false)).join('')}
        </div>
        <div class="todo-add">
          <span class="add-icon">+</span>
          <input placeholder="${t('todo.addPlaceholder')}" id="add-task-input" autocomplete="off" spellcheck="false" autocapitalize="off">
        </div>
      </div>

      <!-- Done tasks -->
      ${doneRoots.length > 0 ? `
      <div class="todo-section" id="done-section">
        <div class="todo-section-header">
          <span class="section-toggle" id="done-toggle">
            <span class="toggle-arrow" id="done-arrow">▼</span>
            ${tp('todo.doneCount', doneRoots.length)}
          </span>
          <div class="section-actions">
            <button class="icon-btn" data-tooltip="${t('todo.uncheckAll')}" id="uncheck-all-btn">${icons.uncheck_all}</button>
          </div>
        </div>
        <div class="todo-items" id="done-items">
          ${doneRoots.map(t => renderTaskItem(t, true)).join('')}
        </div>
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left">
        <button class="icon-btn" data-tooltip="${t('modal.color')}" id="modal-color-btn">${icons.palette}</button>
        <button class="icon-btn" data-tooltip="${t('modal.labels')}" id="modal-labels-btn">${icons.label}</button>
        <button class="icon-btn" data-tooltip="${t('modal.duplicate')}" id="modal-duplicate-btn">${icons.copy}</button>
        <button class="icon-btn" data-tooltip="${t('modal.archive')}" id="modal-archive-btn">${icons.archive}</button>
        <button class="icon-btn" data-tooltip="${t('modal.delete')}" id="modal-delete-btn">${icons.delete_icon}</button>
        <button class="icon-btn" data-tooltip="${t('modal.undo')}" id="modal-undo-btn">${icons.undo}</button>
        <button class="icon-btn" data-tooltip="${t('modal.redo')}" id="modal-redo-btn">${icons.redo}</button>
      </div>
      <div class="modal-toolbar-right">
        <span class="modal-timestamp">${t('modal.edited', { time: formatDateShort(note.updatedAt) })}</span>
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  modal.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>setDraftDirty('editor',true)));
  bindTodoLimits(note,modal,()=>showToast(t('note.tooLarge')));
  initTodoModalListeners(note);
}

function initTodoModalListeners(note) {
  const { deepClone } = getUtils();

  // --- Undo/Redo ---
  const undoBtn = document.getElementById('modal-undo-btn');
  const redoBtn = document.getElementById('modal-redo-btn');

  function updateUndoRedoBtns() {
    if (undoBtn) undoBtn.style.opacity = todoHistory?.canUndo() ? '1' : '0.3';
    if (redoBtn) redoBtn.style.opacity = todoHistory?.canRedo() ? '1' : '0.3';
  }
  updateUndoRedoBtns();

  function pushTodoHistory() {
    if (todoHistory) {
      todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      updateUndoRedoBtns();
    }
  }

  undoBtn?.addEventListener('click', async () => {
    const prev = todoHistory?.undo();
    if (prev) {
      note.title = prev.title;
      note.tasks = deepClone(prev.tasks);
      if (!await saveFromUI(note)) return false;
      renderTodoModalContent(note);
    }
  });

  redoBtn?.addEventListener('click', async () => {
    const next = todoHistory?.redo();
    if (next) {
      note.title = next.title;
      note.tasks = deepClone(next.tasks);
      if (!await saveFromUI(note)) return false;
      renderTodoModalContent(note);
    }
  });

  // Title
  const titleInput = document.getElementById('modal-title');
  titleInput.addEventListener('blur', async () => {
    note.title = titleInput.value;
    if (!await saveFromUI(note)) return false;
    updateModalTimestamp(note);
    pushTodoHistory();
  });

  // Add task
  const addInput = document.getElementById('add-task-input');
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      e.preventDefault();
      const { generateUUID } = await import('./utils.js');
      const tasks = note.tasks || [];
      tasks.push({
        id: generateUUID(),
        text: addInput.value.trim(),
        done: false,
        order: tasks.filter(t => !t.done && !t.parentId).length,
        parentId: null,
      });
      note.tasks = tasks;
      if (!await saveFromUI(note)) return false;
      addInput.value = '';
      pushTodoHistory();
      renderTodoModalContent(note);
      // Focus the add input again
      document.getElementById('add-task-input')?.focus();
    } else if (e.key === 'Tab' && addInput.value.trim()) {
      // Tab to create subitem under last pending root task
      e.preventDefault();
      const { generateUUID } = await import('./utils.js');
      const tasks = note.tasks || [];
      const pendingRoots = tasks.filter(t => !t.done && !t.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const lastRoot = pendingRoots[pendingRoots.length - 1];
      if (lastRoot) {
        tasks.push({
          id: generateUUID(),
          text: addInput.value.trim(),
          done: false,
          order: tasks.filter(t => t.parentId === lastRoot.id).length,
          parentId: lastRoot.id,
        });
        note.tasks = tasks;
        if (!await saveFromUI(note)) return false;
        addInput.value = '';
        pushTodoHistory();
        renderTodoModalContent(note);
        document.getElementById('add-task-input')?.focus();
      }
    }
  });

  // Checkbox toggles
  document.querySelectorAll('#modal-card .todo-checkbox').forEach(cb => {
    cb.addEventListener('click', async () => {
      const taskId = cb.dataset.taskId;
      const task = note.tasks.find(t => t.id === taskId);
      if (!task) return;

      task.done = !task.done;
      // If parent, toggle children too
      note.tasks.filter(t => t.parentId === taskId).forEach(child => {
        child.done = task.done;
      });

      if (!await saveFromUI(note)) return false;
      pushTodoHistory();
      renderTodoModalContent(note);
    });
  });

  // Edit task text
  document.querySelectorAll('#modal-card .todo-text').forEach(input => {
    input.addEventListener('blur', async () => {
      const taskId = input.dataset.taskId;
      const task = note.tasks.find(t => t.id === taskId);
      if (task) {
        task.text = input.value;
        if (!await saveFromUI(note)) return false;
        pushTodoHistory();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  // Delete task
  document.querySelectorAll('#modal-card .todo-item-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      note.tasks = note.tasks.filter(t => t.id !== taskId && t.parentId !== taskId);
      if (!await saveFromUI(note)) return false;
      pushTodoHistory();
      renderTodoModalContent(note);
    });
  });

  // Check all
  document.getElementById('check-all-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('todo.confirmCheckAll'))) {
      note.tasks.forEach(t => { t.done = true; });
      if (!await saveFromUI(note)) return false;
      pushTodoHistory();
      renderTodoModalContent(note);
    }
  });

  // Uncheck all
  document.getElementById('uncheck-all-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('todo.confirmUncheckAll'))) {
      note.tasks.forEach(t => { t.done = false; });
      if (!await saveFromUI(note)) return false;
      pushTodoHistory();
      renderTodoModalContent(note);
    }
  });

  // Done section toggle
  document.getElementById('done-toggle')?.addEventListener('click', () => {
    const items = document.getElementById('done-items');
    const arrow = document.getElementById('done-arrow');
    if (items) {
      const isHidden = items.style.display === 'none';
      items.style.display = isHidden ? 'flex' : 'none';
      arrow.classList.toggle('collapsed', !isHidden);
    }
  });

  // Pin
  document.getElementById('modal-pin').addEventListener('click', async (e) => {
    const pinButton=e.currentTarget;
    if (!await changeFromUI(note,next=>{next.pinned = !next.pinned;})) return false;
    pinButton.classList.toggle('pinned', note.pinned);
    pinButton.innerHTML = note.pinned ? icons.pin_filled : icons.pin;
  });

  // Close
  document.getElementById('modal-close').addEventListener('click', () => closeModal());

  // Archive
  document.getElementById('modal-archive-btn').addEventListener('click', async () => {
    if (!await changeFromUI(note,next=>{next.archivedAt = Date.now();})) return false;
    if(!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteArchived'));
  });

  // Delete
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    if (!await changeFromUI(note,next=>{next.deletedAt = Date.now();})) return false;
    if(!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteToTrash'));
  });

  // Duplicate
  document.getElementById('modal-duplicate-btn').addEventListener('click', async () => {
    const duplicateGeneration=sessionGeneration,duplicating=activeEdit;
    if(activeEdit&&!await activeEdit.flush())return;
    const { generateUUID, deepClone } = await import('./utils.js');
    if(duplicateGeneration!==sessionGeneration)return;
    const dup = deepClone(note);
    dup.id = generateUUID();
    dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
    dup.createdAt = Date.now();
    dup.updatedAt = Date.now();
    dup.pinned = false;
    dup.tasks = dup.tasks.map(t => ({ ...t, id: generateUUID() }));
    // Fix parentId references
    const idMap = {};
    note.tasks.forEach((t, i) => { idMap[t.id] = dup.tasks[i].id; });
    dup.tasks.forEach(t => { if (t.parentId) t.parentId = idMap[t.parentId] || null; });
    if (!await saveFromUI(dup)) return false;
    if(duplicating===activeEdit&&!await closeModal())return;
    renderCurrentView();
    showToast(t('toast.noteDuplicated'));
  });

  // Color
  document.getElementById('modal-color-btn').addEventListener('click', () => {
    openColorPickerModal(note);
  });

  // Labels
  document.getElementById('modal-labels-btn').addEventListener('click', () => {
    openLabelsPickerModal(note);
  });

  // Task drag and drop
  initTaskDragDrop(note);
}

async function closeModal() {
  const edit=activeEdit;
  edit?.mask?.();
  if(edit && !await edit.flush())return false;
  try{if(edit)await enqueueWrite.drain(edit.id);}catch{return false;}
  if(edit!==activeEdit)return false;
  modalController?.abort();modalController=null;
  activeEdit=null;edit?.cancel();edit?.cleanup?.();todoHistory=null;setDraftDirty('editor',false);
  const modal=document.querySelector('.modal-card');
  if(modal?._keyHandler)document.removeEventListener('keydown',modal._keyHandler);
  document.getElementById('modal-overlay')?.classList.remove('open');
  if(modal)modal.innerHTML='';
  if(cryptoKey)renderCurrentView();
  return true;
}

function updateModalTimestamp(note) {
  const ts = document.querySelector('.modal-timestamp');
  if (ts) ts.textContent = t('modal.edited', { time: formatDateShort(note.updatedAt) });
}

// --- Color Picker ---

function openColorPicker(anchorBtn, note) {
  // Remove any existing
  document.querySelectorAll('.color-picker-popup').forEach(p => p.remove());

  const colors = ['default', 'coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay', 'chalk'];
  const popup = document.createElement('div');
  popup.className = 'color-picker-popup';
  popup.style.cssText = 'position:absolute; z-index:200; background:var(--bg-elevated); border:1px solid var(--border-color); border-radius:8px; padding:8px; box-shadow:0 2px 10px rgba(0,0,0,0.3);';

  popup.innerHTML = `<div style="display:flex;gap:4px;flex-wrap:wrap;max-width:200px;">
    ${colors.map(c => {
      const selected = (note.color || 'default') === c ? 'selected' : '';
      const style = c === 'default' ? 'background:var(--card-bg);border:2px solid var(--border-color);' : `background:var(--note-${c});border:2px solid transparent;`;
      return `<div class="color-opt ${selected}" data-color="${c}" style="${style}width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;">${selected ? '✓' : ''}</div>`;
    }).join('')}
  </div>`;

  // Position
  const rect = anchorBtn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  popup.style.position = 'fixed';

  document.body.appendChild(popup);

  popup.addEventListener('click', async (e) => {
    const opt = e.target.closest('.color-opt');
    if (opt) {
      if (!await changeFromUI(note,next=>{next.color=opt.dataset.color;})) return false;
      const modal = document.getElementById('modal-card');
      if(activeEdit?.id===note.id&&modal){if(note.color!=='default')modal.setAttribute('data-color',note.color);else modal.removeAttribute('data-color');}
      popup.remove();
      renderCurrentView();
    }
  });

  // Close on click outside
  scope.later(() => {
    scope.listen('click', function handler(e) {
      if (!popup.contains(e.target) && e.target !== anchorBtn) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

function openColorPickerModal(note) {
  const btn = document.getElementById('modal-color-btn');
  if (btn) openColorPicker(btn, note);
}

// --- Labels Picker ---

function openLabelsPickerModal(note) {
  document.querySelectorAll('.labels-picker-popup').forEach(p => p.remove());

  const allLabels = getAllLabels();
  const popup = document.createElement('div');
  popup.className = 'labels-picker-popup';
  popup.style.cssText = 'position:fixed; z-index:110; background:var(--bg-elevated); border:1px solid var(--border-color); border-radius:8px; padding:12px; box-shadow:0 2px 10px rgba(0,0,0,0.3); min-width:200px;';

  function renderPopup() {
    const labels = getAllLabels();
    popup.innerHTML = `
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px;">${t('sidebar.labels')}</div>
      ${labels.map(l => {
        const checked = note.labels?.includes(l) ? 'checked' : '';
        return `<div class="label-opt" data-label="${escapeAttr(l)}" style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:4px;font-size:13px;">
          <span style="width:16px;height:16px;border:2px solid var(--icon-color);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;${checked ? 'background:var(--accent-color);border-color:var(--accent-color);' : ''}">${checked ? '✓' : ''}</span>
          ${escapeHTMLString(l)}
        </div>`;
      }).join('')}
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:4px;">
        <input placeholder="${t('labels.newLabel')}" id="new-label-input" style="flex:1;border:none;border-bottom:1px solid var(--border-color);background:transparent;padding:4px;font-size:13px;color:var(--text-primary);" autocomplete="off" spellcheck="false" autocapitalize="off">
      </div>
    `;
  }

  renderPopup();

  const btn = document.getElementById('modal-labels-btn');
  const rect = btn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(popup);

  popup.addEventListener('click', async (e) => {
    const opt = e.target.closest('.label-opt');
    if (opt) {
      const label = opt.dataset.label;
      if (!await changeFromUI(note,next=>{const i=next.labels.indexOf(label);if(i>=0)next.labels.splice(i,1);else next.labels.push(label);} ))return false;
      renderPopup();
    }
  });

  popup.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const input = popup.querySelector('#new-label-input');
      if (input && input.value.trim()) {
        const newLabel=input.value.trim();
        if (!await changeFromUI(note,next=>{if(!next.labels.includes(newLabel))next.labels.push(newLabel);} ))return false;
        renderPopup();
      }
    }
  });

  scope.later(() => {
    scope.listen('click', function handler(e) {
      if (!popup.contains(e.target) && e.target !== btn) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

function getAllLabels() {
  const labelSet = new Set();
  notes.forEach(n => {
    if (n.type === 'vault') return;
    (n.labels || []).forEach(l => labelSet.add(l));
  });
  return Array.from(labelSet).sort();
}

function updateSidebarLabels() {
  const container = document.getElementById('sidebar-labels');
  if (!container) return;
  const labels = getAllLabels();

  container.innerHTML = labels.map(l => `
    <div class="sidebar-item ${currentView === 'label' && currentLabel === l ? 'active' : ''}" data-view="label" data-label="${escapeAttr(l)}">
      <span class="sidebar-icon">${icons.label}</span>
      <span class="sidebar-item-text">${escapeHTMLString(l)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.sidebar-item[data-label]').forEach(item => {
    item.addEventListener('click', () => {
      if (currentView === 'vault') resetVaultSearch();
      currentView = 'label';
      currentLabel = item.dataset.label;
      updateSidebarActive(item);
      renderCurrentView();
      closeMobileSidebar();
    });
  });
}

// --- Labels Manager ---

function openLabelsManager() {
  const modal = document.getElementById('modal-card');
  const labels = getAllLabels();

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title-input" style="font-size:16px;font-weight:500;cursor:default;">${t('labels.editLabels')}</span>
    </div>
    <div class="modal-body">
      <div class="labels-manager" id="labels-manager">
        ${labels.map(l => `
          <div class="label-row" data-label="${escapeAttr(l)}">
            <span class="label-icon">${icons.label}</span>
            <input class="label-name-input" value="${escapeAttr(l)}" data-old="${escapeAttr(l)}" autocomplete="off" spellcheck="false" autocapitalize="off">
            <button class="icon-btn label-delete-btn" data-tooltip="${t('modal.delete')}" data-label="${escapeAttr(l)}">${icons.delete_icon}</button>
          </div>
        `).join('')}
        <div class="label-add-row" id="add-label-row">
          <span style="font-size:18px;">+</span>
          <input placeholder="${t('labels.newLabel')}" id="add-label-input" style="flex:1;border:none;background:transparent;font-size:14px;padding:4px;color:var(--text-primary);" autocomplete="off" spellcheck="false" autocapitalize="off">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left"></div>
      <div class="modal-toolbar-right">
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');

  // Rename label
  document.querySelectorAll('.label-name-input').forEach(input => {
    input.addEventListener('blur', async () => {
      const row=input.closest('.label-row');
      row._renaming=(async()=>{
      const oldName = input.dataset.old;
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        if(!await changeManyFromUI(notes.filter(n=>n.type!=='vault'&&n.labels?.includes(oldName)),next=>{next.labels=[...new Set(next.labels.map(l=>l===oldName?newName:l))];})){input.value=oldName;return false;}
        row.querySelector('.label-delete-btn').dataset.label=newName;
        if(currentLabel===oldName)currentLabel=newName;
        input.dataset.old = newName;
      }
      })();
      await row._renaming;
    });
  });

  // Delete label
  document.querySelectorAll('.label-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(await btn.closest('.label-row')._renaming===false)return;
      const label = btn.dataset.label;
      if(!await changeManyFromUI(notes.filter(n=>n.type!=='vault'&&n.labels?.includes(label)),next=>{next.labels=next.labels.filter(l=>l!==label);} ))return false;
      btn.closest('.label-row').remove();
      updateSidebarLabels();
    });
  });

  // Add label
  const addLabelInput = document.getElementById('add-label-input');
  addLabelInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addLabelInput.value.trim()) {
      // Label created — will show up when first assigned to a note
      addLabelInput.value = '';
      showToast(t('labels.assignToast'));
    }
  });

  document.getElementById('modal-close').addEventListener('click', () => closeModal());
}

// --- Card Menu (More) ---

function openCardMenu(anchorBtn, note) {
  const menuGeneration=sessionGeneration;
  document.querySelectorAll('.card-menu-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'card-menu-popup';
  popup.style.cssText = 'position:fixed;z-index:50;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:4px 0;box-shadow:0 2px 10px rgba(0,0,0,0.3);min-width:160px;';

  popup.innerHTML = `
    <div class="menu-item" data-action="duplicate" style="padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      ${icons.copy} ${t('modal.duplicate')}
    </div>
    <div class="menu-item" data-action="labels" style="padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      ${icons.label} ${t('modal.labels')}
    </div>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(popup);

  popup.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
  });

  popup.addEventListener('click', async (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    popup.remove();

    if (action === 'duplicate') {
      const { generateUUID, deepClone } = await import('./utils.js');
      if(menuGeneration!==sessionGeneration)return;
      const dup = deepClone(note);
      dup.id = generateUUID();
      dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
      dup.createdAt = Date.now();
      dup.updatedAt = Date.now();
      dup.pinned = false;
      if (dup.tasks) {
        const idMap = {};
        dup.tasks = dup.tasks.map(t => {
          const newId = generateUUID();
          idMap[t.id] = newId;
          return { ...t, id: newId };
        });
        dup.tasks.forEach(t => { if (t.parentId) t.parentId = idMap[t.parentId] || null; });
      }
      if (!await saveFromUI(dup)) return false;
      renderCurrentView();
      showToast(t('toast.noteDuplicated'));
    } else if (action === 'labels') {
      const editing=await openNoteModal(note);
      if(!editing||menuGeneration!==sessionGeneration)return;
      scope.later(() => openLabelsPickerModal(editing), 100);
    }
  });

  scope.later(() => {
    scope.listen('click', function handler(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

// --- Card Drag & Drop ---

function initCardDragDrop() {
  const grids = document.querySelectorAll('.notes-grid');

  grids.forEach(grid => {
    const cards = grid.querySelectorAll('.note-card');

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetId = card.dataset.id;
        if (draggedId === targetId) return;

        const draggedNote = notes.find(n => n.id === draggedId);
        const targetNote = notes.find(n => n.id === targetId);
        if (!draggedNote || !targetNote) return;

        const ordered=[...grid.querySelectorAll('.note-card')].map(c=>notes.find(n=>n.id===c.dataset.id)).filter(Boolean);
        const moved=ordered.splice(ordered.findIndex(n=>n.id===draggedId),1)[0];
        ordered.splice(ordered.findIndex(n=>n.id===targetId),0,moved);
        const positions=new Map(ordered.map((n,index)=>[n.id,index]));
        if(!await changeManyFromUI(ordered,next=>{next.order=positions.get(next.id);} ))return;
        renderCurrentView();
      });
    });
  });
}

// --- Task Drag & Drop ---

function initTaskDragDrop(note) {
  let draggedTaskId = null;

  // Make individual items draggable via handle
  const items = document.querySelectorAll('#modal-card .todo-item');
  items.forEach(item => {
    const handle = item.querySelector('.drag-handle');

    handle.addEventListener('mousedown', () => {
      item.setAttribute('draggable', 'true');
    });

    item.addEventListener('dragstart', (e) => {
      draggedTaskId = item.dataset.taskId;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTaskId);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.drag-over, .drag-over-top, .drag-over-bottom').forEach(i => {
        i.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
      });
      draggedTaskId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item.dataset.taskId === draggedTaskId) return;

      // Determine if dropping above or below based on mouse position
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) {
        item.classList.add('drag-over-top');
      } else {
        item.classList.add('drag-over-bottom');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      const droppedId = e.dataTransfer.getData('text/plain');
      const targetId = item.dataset.taskId;
      if (droppedId === targetId) return;

      const draggedTask = note.tasks.find(t => t.id === droppedId);
      const targetTask = note.tasks.find(t => t.id === targetId);
      if (!draggedTask || !targetTask) return;

      // Determine target section from which container this item is in
      const container = item.closest('.todo-items');
      const isDoneSection = container?.id === 'done-items';
      draggedTask.done = isDoneSection;

      // Also toggle children
      note.tasks.filter(t => t.parentId === draggedTask.id).forEach(child => {
        child.done = isDoneSection;
      });

      // If a root item is dropped on a root item, keep as root
      if (!targetTask.parentId && draggedTask.parentId && !item.classList.contains('subitem')) {
        draggedTask.parentId = null;
      }

      // Calculate insert position: before or after target
      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      // Get ordered list of root tasks in the target section
      const sectionTasks = note.tasks
        .filter(t => t.done === isDoneSection && !t.parentId && t.id !== draggedTask.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const targetIndex = sectionTasks.findIndex(t => t.id === targetId);
      const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

      // Insert dragged task at the correct position
      sectionTasks.splice(insertIndex, 0, draggedTask);

      // Reassign orders
      sectionTasks.forEach((t, i) => { t.order = i; });

      if (!await saveFromUI(note)) return false;
      if (todoHistory) {
        const { deepClone } = getUtils();
        todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      }
      renderTodoModalContent(note);
    });
  });

  // Allow dropping on empty section containers (for cross-section drag)
  ['pending-items', 'done-items'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const isDoneSection = containerId === 'done-items';

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('drop', async (e) => {
      // Only handle if not already handled by a child item
      if (e.defaultPrevented) return;
      e.preventDefault();
      const droppedId = e.dataTransfer.getData('text/plain');
      const draggedTask = note.tasks.find(t => t.id === droppedId);
      if (!draggedTask) return;

      // Move to this section
      draggedTask.done = isDoneSection;
      note.tasks.filter(t => t.parentId === draggedTask.id).forEach(child => {
        child.done = isDoneSection;
      });

      // Put at the end of this section
      const sectionTasks = note.tasks
        .filter(t => t.done === isDoneSection && !t.parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      draggedTask.order = sectionTasks.length;

      if (!await saveFromUI(note)) return false;
      if (todoHistory) {
        const { deepClone } = getUtils();
        todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      }
      renderTodoModalContent(note);
    });
  });
}

// --- Toast ---

function showToast(message, actionText, onAction, duration=5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${escapeHTMLString(message)}</span>
    ${actionText ? `<span class="toast-action">${escapeHTMLString(actionText)}</span>` : ''}
  `;

  if (actionText && onAction) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      onAction();
      toast.remove();
    });
  }

  container.appendChild(toast);

  scope.later(() => {
    toast.classList.add('toast-out');
    scope.later(() => toast.remove(), 200);
  }, duration);
}

// --- Confirm Dialog ---

function showConfirm(message,{danger=false}={}) {
  return confirmDialog(message,{signal:scope.signal,danger});
}

// --- Helpers ---

function escapeHTMLString(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + time;
}

function getUtils() {
  // Sync access to utility functions for event handlers
  return {
    debounce: (fn, ms) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = scope.later(() => fn(...args), ms);
      };
    },
    deepClone: (obj) => JSON.parse(JSON.stringify(obj))
  };
}
