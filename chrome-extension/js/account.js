import { readVault, replaceVault } from './db.js';
import { generateSalt, deriveKey, verifyKeyCheck, createKeyCheck, encrypt, arrayToBase64, arrayBufferToBase64, base64ToArray } from './crypto.js';
import { decryptRecords } from './backup-format.js';
import { validatePassword } from './password-policy.js';
import { storeSessionKey, clearSession, getSessionKey, getSessionVaultId } from './session.js';
import { publishVaultEvent } from './vault-events.js';
import { t } from './i18n.js';

export async function changePassword(currentPassword,newPassword,{signal}={}) {
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
  delete next.passwordVerifier;
  if(signal?.aborted||!await getSessionKey()||getSessionVaultId()!==meta.vaultId)throw new Error(t('vault.changed'));
  await replaceVault({notes:records,meta:next},meta,{signal});
  if(!signal?.aborted&&await getSessionKey()&&getSessionVaultId()===meta.vaultId)storeSessionKey(key,vaultId);publishVaultEvent('vault-replaced',{vaultId});
  return key;
}
export async function resetVault(confirmation) {
  if(confirmation!==t('account.resetWord'))throw new Error(t('account.resetCancelled'));
  const previous=await readVault(),vaultId=crypto.randomUUID();
  await replaceVault({notes:[],meta:{vaultId}},previous.meta);
  clearSession();publishVaultEvent('vault-replaced',{vaultId});
}
export function renderPasswordChange(container,onChanged,{signal,onRecovery}={}) {
  container.innerHTML=`<form id="change-password-form"><h2>${t('account.change')}</h2>
    <label>${t('account.current')}<input type="password" id="current-password" autocomplete="current-password" required></label>
    <label>${t('account.new')}<input type="password" id="next-password" autocomplete="new-password" required></label>
    <label>${t('auth.confirmPassword')}<input type="password" id="next-confirm" autocomplete="new-password" required></label>
    <p>${t('auth.passphraseHint')}</p><p>${t('account.rotateWarning')}</p><p class="form-error" id="change-password-error"></p>
    <button type="submit" class="btn-primary">${t('account.change')}</button></form>`;
  const form=container.querySelector('form');
  signal?.addEventListener('abort',()=>form.querySelectorAll('input').forEach(input=>input.value=''),{once:true});
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=container.querySelector('button');button.disabled=true;
    try{
      if(container.querySelector('#next-password').value!==container.querySelector('#next-confirm').value)throw new Error(t('auth.passwordsNoMatch'));
      const key=await changePassword(container.querySelector('#current-password').value,container.querySelector('#next-password').value,{signal});
      if(signal?.aborted||!form.isConnected)return;
      await onChanged(key);window.alert(t('account.rotateWarning'));
    }catch(error){
      if(signal?.aborted||!form.isConnected)return;
      const allowed=['auth.passwordsNoMatch','login.wrongPassword','vault.changed','account.unreadable'].map(t);
      allowed.push(validatePassword(container.querySelector('#next-password').value).errors.join(' '));
      form.querySelector('#change-password-error').textContent=allowed.includes(error.message)?error.message:t('account.failed');
      button.disabled=false;
      if(error.code==='account.unreadable'&&onRecovery&&!form.querySelector('#account-recovery')){
        const recover=document.createElement('button');recover.type='button';recover.id='account-recovery';recover.textContent=t('recovery.open');recover.addEventListener('click',onRecovery);form.append(recover);
      }
    }
  });
}
