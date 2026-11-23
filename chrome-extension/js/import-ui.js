import {focusPanel} from './form-ui.js';
import {t} from './i18n.js';

export function importFormMarkup(className) {
  return `<div class="${className}" id="import-form">
    <div class="import-dropzone" id="import-dropzone" role="button" tabindex="0">
      <div class="import-icon" aria-hidden="true">📁</div>
      <div class="import-text">${t('import.dropzoneText')}</div>
      <div class="import-filename hidden" id="import-filename"></div>
      <input type="file" id="import-file" accept=".keeplocal" style="display:none">
    </div>
    <div class="form-group form-field">
      <label for="import-password">${t('import.backupPassword')}</label>
      <input type="password" id="import-password" placeholder="${t('import.backupPlaceholder')}" autocomplete="off">
    </div>
    <div class="form-error" id="import-error" role="alert"></div>
    <div class="form-actions">
      <button type="button" class="btn-primary" id="import-btn" disabled>${t('import.importButton')}</button>
    </div>
  </div>`;
}

export function initImportForm(container,{signal,locked=false,onImported}) {
  const dropzone=container.querySelector('#import-dropzone');
  const fileInput=container.querySelector('#import-file');
  const button=container.querySelector('#import-btn');
  const filename=container.querySelector('#import-filename');
  const password=container.querySelector('#import-password');
  const errorText=container.querySelector('#import-error');
  let selectedFile=null,importing=false;
  const update=()=>{button.disabled=importing||!selectedFile||!password.value;};

  function select(file) {
    if(!file)return;
    selectedFile=file;
    filename.textContent=file.name;
    filename.classList.remove('hidden');
    update();
  }

  dropzone.addEventListener('click',()=>fileInput.click());
  dropzone.addEventListener('keydown',event=>{
    if(!['Enter',' '].includes(event.key))return;
    event.preventDefault();
    fileInput.click();
  });
  dropzone.addEventListener('dragover',event=>{
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop',event=>{
    event.preventDefault();
    dropzone.classList.remove('dragover');
    select(event.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change',()=>select(fileInput.files[0]));
  password.addEventListener('input',update);
  signal?.addEventListener('abort',()=>{password.value='';selectedFile=null;},{once:true});
  button.addEventListener('click',async()=>{
    if(button.disabled||signal?.aborted)return;
    errorText.textContent='';
    importing=true;
    update();
    const file=selectedFile,passphrase=password.value;
    try {
      if(locked)throw new Error(t('folder.importLocked'));
      const {importBackup}=await import('./backup.js');
      const key=await importBackup(file,passphrase,{signal});
      if(!signal?.aborted)await onImported(key);
    }catch(error){
      if(!signal?.aborted)errorText.textContent=t(error.code||error.message||'import.importError');
    }finally{
      password.value='';
      importing=false;
      update();
    }
  });
}

export function renderSettingsImport(container,{signal,trigger,onClose,onImported}) {
  container.innerHTML=`<section class="panel-form">
    <header class="panel-header">
      <h2 id="import-backup-title">${t('import.importButton')}</h2>
      <button type="button" class="btn-secondary" id="modal-close">${t('modal.close')}</button>
    </header>
    ${importFormMarkup('auth-import panel-body')}
  </section>`;
  container.querySelector('#modal-close').addEventListener('click',onClose);
  initImportForm(container,{signal,onImported});
  focusPanel(container,{signal,trigger,titleId:'import-backup-title',initial:'#import-dropzone'});
}
