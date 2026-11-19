import {noticeDialog} from './dialogs.js';
import { readVault, replaceVault, resetFolderLocalVault, assertWritable, isReadOnly, vaultIdentity } from './db.js';
import { generateSalt, deriveKey, verifyKeyCheck, createKeyCheck, encrypt, arrayToBase64, arrayBufferToBase64, base64ToArray } from './crypto.js';
import { decryptRecords } from './backup-format.js';
import { validatePassword } from './password-policy.js';
import { storeSessionKey, clearSession, getSessionKey, getSessionVaultId } from './session.js';
import { publishVaultEvent } from './vault-events.js';
import { t } from './i18n.js';
import { passwordFeedback,focusPanel } from './form-ui.js';

export async function changePassword(currentPassword,newPassword,{signal}={}) {
  assertWritable();
  const policy=validatePassword(newPassword);if(!policy.valid)throw new Error(policy.errors.join(' '));
  const previous=await readVault(),meta=previous.meta;
  const current=await deriveKey(currentPassword,base64ToArray(meta.salt),false);
  if(!await verifyKeyCheck(current,meta.keyCheck))throw new Error(t('login.wrongPassword'));
  let plain;
  try{plain=await decryptRecords(previous.notes,current);}catch{throw Object.assign(new Error(t('account.unreadable')),{code:'account.unreadable'});}
  const salt=generateSalt(),key=await deriveKey(newPassword,salt,false),records=[];
  for(const note of plain){const {iv,ciphertext}=await encrypt(key,JSON.stringify(note));records.push({id:note.id,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext),updatedAt:note.updatedAt});}
  const vaultId=crypto.randomUUID();
  const next={...meta,salt:arrayToBase64(salt),keyCheck:await createKeyCheck(key),vaultId,dirtySinceBackup:true,revision:(meta.revision||0)+1};
  if(signal?.aborted||!await getSessionKey()||getSessionVaultId()!==meta.vaultId)throw new Error(t('vault.changed'));
  await replaceVault({notes:records,meta:next},meta,{signal});
  if(!signal?.aborted&&await getSessionKey()&&getSessionVaultId()===meta.vaultId)storeSessionKey(key,vaultId);publishVaultEvent('vault-replaced',{vaultId});
  return key;
}
export async function resetVault(confirmation) {
  assertWritable();
  if(confirmation!==t('account.resetWord'))throw new Error(t('account.resetCancelled'));
  const previous=await readVault(),vaultId=crypto.randomUUID();
  await replaceVault({notes:[],meta:{vaultId}},previous.meta);
  clearSession();publishVaultEvent('vault-replaced',{vaultId});
}
export async function resetFromLogin(confirmation,expected) {
  if(confirmation!==t('account.resetWord'))throw new Error(t('account.resetCancelled'));
  if(await getSessionKey())throw new Error(t('vault.changed'));
  const vaultId=crypto.randomUUID();
  await resetFolderLocalVault(expected,vaultId);
  clearSession();
  publishVaultEvent('vault-replaced',{vaultId});
}

export async function resetFromFolder(confirmation,expected,{key,signal}) {
  if(confirmation!==t('account.resetWord'))throw new Error(t('account.resetCancelled'));
  if(signal.aborted||!isReadOnly()||!key||key!==await getSessionKey()||
     signal.aborted||getSessionVaultId()!==vaultIdentity(expected))throw new Error(t('vault.changed'));
  const vaultId=crypto.randomUUID();
  await resetFolderLocalVault(expected,vaultId,{signal});
  clearSession();
  publishVaultEvent('vault-replaced',{vaultId});
}

export function renderPasswordChange(container,onChanged,{signal,onRecovery,onClose}={}) {
  const trigger=document.activeElement;
  container.innerHTML=`<form id="change-password-form" class="panel-form">
    <header class="panel-header"><h2 id="change-password-title">${t('account.change')}</h2><button type="button" class="btn-secondary" data-panel-close>${t('modal.close')}</button></header>
    <div class="panel-body form-stack">
      <div class="form-field"><label for="current-password">${t('account.current')}</label><input type="password" id="current-password" autocomplete="current-password" required></div>
      <div class="form-field"><label for="next-password">${t('account.new')}</label><input type="password" id="next-password" autocomplete="new-password" aria-describedby="change-password-rules change-password-strength" required></div>
      <div class="form-field"><label for="next-confirm">${t('auth.confirmPassword')}</label><input type="password" id="next-confirm" autocomplete="new-password" aria-describedby="change-password-match" required></div>
      <div class="password-rules" id="change-password-rules"><ul><li data-rule="length">${t('auth.minLength')}</li><li data-rule="common">${t('validation.common')}</li></ul></div>
      <p class="password-strength" id="change-password-strength" data-password-strength role="status"></p>
      <p class="form-error" id="change-password-match" data-password-match role="status"></p>
      <p class="help-text">${t('auth.passphraseHint')}</p><p class="notice notice-warning">${t('account.rotateWarning')}</p>
      <p class="form-error" id="change-password-error" role="alert"></p>
      <button type="submit" class="btn-primary button-full">${t('account.change')}</button>
    </div></form>`;
  const form=container.querySelector('form');
  form.querySelector('[data-panel-close]').addEventListener('click',onClose);
  const feedback=()=>passwordFeedback(form,form.querySelector('#next-password').value,form.querySelector('#next-confirm').value);
  form.querySelectorAll('#next-password,#next-confirm').forEach(input=>input.addEventListener('input',feedback));feedback();
  focusPanel(container,{signal,trigger,titleId:'change-password-title',initial:'#current-password'});
  signal?.addEventListener('abort',()=>form.querySelectorAll('input').forEach(input=>input.value=''),{once:true});
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      if(container.querySelector('#next-password').value!==container.querySelector('#next-confirm').value)throw new Error(t('auth.passwordsNoMatch'));
      const key=await changePassword(container.querySelector('#current-password').value,container.querySelector('#next-password').value,{signal});
      if(signal?.aborted||!form.isConnected)return;
      await onChanged(key);await noticeDialog(t('account.rotateWarning'),{title:t('account.change'),returnFocus:()=>document.getElementById('change-password-btn')});
    }catch(error){
      if(signal?.aborted||!form.isConnected)return;
      const allowed=['auth.passwordsNoMatch','login.wrongPassword','vault.changed','account.unreadable'].map(t);
      allowed.push(validatePassword(container.querySelector('#next-password').value).errors.join(' '));
      form.querySelector('#change-password-error').textContent=error.code==='vault.readOnly'?t(error.code):allowed.includes(error.message)?error.message:t('account.failed');
      button.disabled=false;
      if(error.code==='account.unreadable'&&onRecovery&&!form.querySelector('#account-recovery')){
        const recover=document.createElement('button');recover.type='button';recover.className='btn-secondary';recover.id='account-recovery';recover.textContent=t('recovery.open');recover.addEventListener('click',onRecovery);form.append(recover);
      }
    }
  });
}
