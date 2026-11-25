import {storeDeviceName} from './db.js';
import {normalizeDeviceName} from './device-name.js';
import {textDialog} from './dialogs.js';
import {t} from './i18n.js';
import {folderMetadata} from './photo-folder.js';

export async function offerDeviceName(signal,notify) {
  try {
    const meta=await folderMetadata();
    if(signal.aborted||!meta.syncFolder)return;
    const existing=normalizeDeviceName(meta.deviceName);
    if(existing)return existing;
    const text=await textDialog(t('deviceName.hint'),{
      title:t('deviceName.label'),label:t('deviceName.label'),name:'deviceName',
      validate:normalizeDeviceName,cancelLabel:t('deviceName.skip'),signal,
    });
    if(text!==null&&!signal.aborted)return await storeDeviceName(meta,text,{signal,fromPicker:true});
  }catch{
    if(!signal.aborted)notify?.(t('deviceName.failed'));
  }
}

export function createDeviceNameSettings(meta,{signal,notify}) {
  const form=document.createElement('form');
  form.className='form-stack';
  const label=document.createElement('label');
  label.className='form-field';
  label.textContent=t('deviceName.label');
  const input=document.createElement('input');
  input.type='text';
  input.dataset.deviceName='';
  input.autocomplete='off';
  input.spellcheck=false;
  input.setAttribute('autocapitalize','off');
  input.setAttribute('autocorrect','off');
  let saved=normalizeDeviceName(meta.deviceName);
  input.value=saved??'';
  const hint=document.createElement('p');
  hint.className='help-text';
  hint.textContent=t('deviceName.hint');
  const save=document.createElement('button');
  save.type='submit';
  save.className='btn-secondary';
  save.textContent=t('deviceName.save');
  const sync=()=>{
    const name=normalizeDeviceName(input.value);
    save.disabled=!name||name===saved||input.disabled;
  };
  input.addEventListener('input',sync);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const name=normalizeDeviceName(input.value);
    if(!name||name===saved||input.disabled||signal.aborted)return;
    input.disabled=true;
    sync();
    try {
      saved=await storeDeviceName(meta,name,{signal});
      if(!signal.aborted)input.value=saved;
    }catch{
      if(!signal.aborted)notify(t('deviceName.failed'));
    }finally{
      input.disabled=false;
      sync();
    }
  });
  label.append(input);
  form.append(label,hint,save);
  sync();
  return form;
}
