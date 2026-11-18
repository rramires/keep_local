import {wordDialog} from './dialogs.js';
// auth.js — Password creation/validation, session management

import { generateSalt, deriveKey, createKeyCheck, verifyKeyCheck, arrayToBase64, base64ToArray } from './crypto.js';
import { saveMeta, getMeta, isFirstUse, createVault, ensureVaultId } from './db.js';
import { t } from './i18n.js';

import { storeSessionKey } from './session.js';
export { storeSessionKey, getSessionKey, refreshSession, clearSession, logout, startSessionTimer, stopSessionTimer } from './session.js';

// --- Password Validation ---

export { validatePassword } from './password-policy.js';
import { validatePassword } from './password-policy.js';

// --- Account Creation ---

export async function createAccount(password) {
  const policy=validatePassword(password);if(!policy.valid)throw new Error(policy.errors.join(' ' ));
  const salt = generateSalt();
  const key = await deriveKey(password, salt, false);
  const keyCheck = await createKeyCheck(key);

  const vaultId=crypto.randomUUID();
  try {
    await createVault({ salt: arrayToBase64(salt), keyCheck,vaultId,dirtySinceBackup:true });
  } catch (error) {
    if (error.code === 'account.exists') throw new Error(t('account.exists'));
    throw error;
  }

  await storeSessionKey(key,vaultId);
  return key;
}

// --- Login ---

export async function login(password) {
  const saltB64 = await getMeta('salt');
  if (!saltB64) throw new Error(t('login.noAccount'));

  const check = await getMeta('keyCheck');
  if(!check)throw new Error(t('login.unsupportedVault'));
  const salt = base64ToArray(saltB64);
  const key = await deriveKey(password, salt, false);
  if(!await verifyKeyCheck(key,check))throw new Error(t('login.wrongPassword'));

  const vaultId=await ensureVaultId(saltB64);
  await storeSessionKey(key,vaultId);
  return key;
}

// --- Auth UI Rendering ---

export function renderAuthView(container, { onAuthenticated }) {
  const firstUse = true; // Will be updated after check

  container.innerHTML = `
    <div class="auth-view">
      <div class="auth-container">
        <div class="auth-logo">
          <h1>Keep<span>Local</span></h1>
          <p>${t('auth.subtitle')}</p>
        </div>
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="create">${t('auth.createTab')}</button>
            <button class="auth-tab" data-tab="login">${t('auth.loginTab')}</button>
            <button class="auth-tab" data-tab="import">${t('auth.importTab')}</button>
          </div>

          <!-- Create Password Tab -->
          <form class="auth-form" id="create-form">
            <div class="form-group">
              <label for="create-password">${t('auth.newPassword')}</label>
              <input type="password" id="create-password" placeholder="${t('auth.passwordPlaceholder')}" autocomplete="new-password">
            </div>
            <div class="form-group">
              <label for="create-confirm">${t('auth.confirmPassword')}</label>
              <input type="password" id="create-confirm" placeholder="${t('auth.confirmPlaceholder')}" autocomplete="new-password">
            </div>
            <div class="password-rules" id="password-rules">
              <ul>
                <li id="rule-length">${t('auth.minLength')}</li>
                <li id="rule-common">${t('validation.common')}</li>
              </ul>
            </div>
            <p class="password-strength" id="password-strength" role="status"></p>
            <p class="help-text">${t('auth.passphraseHint')}</p>
            <div class="form-error" id="create-error" role="alert"></div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" id="create-btn" disabled>${t('auth.createAccount')}</button>
            </div>
            <p style="font-size: 12px; color: var(--text-secondary); text-align: center; margin-top: 8px;">
              ⚠️ ${t('auth.memorizeWarning')}
            </p>
          </form>

          <!-- Login Tab -->
          <form class="auth-form hidden" id="login-form">
            <div class="form-group">
              <label for="login-password">${t('auth.password')}</label>
              <input type="password" id="login-password" placeholder="${t('auth.passwordPlaceholder')}" autocomplete="current-password">
            </div>
            <div class="form-error" id="login-error" role="alert"></div>
            <div class="form-actions">
              <button type="submit" class="btn-primary">${t('auth.login')}</button>
            </div>
            <footer class="auth-reset"><p class="help-text">${t('account.resetHint')}</p><button type="button" class="reset-link" id="reset-vault">${t('account.reset')}</button></footer>
          </form>

          <!-- Import Tab -->
          <div class="auth-import hidden" id="import-form">
            <div class="import-dropzone" id="import-dropzone">
              <div class="import-icon">📁</div>
              <div class="import-text">${t('import.dropzoneText')}</div>
              <div class="import-filename hidden" id="import-filename"></div>
              <input type="file" id="import-file" accept=".keeplocal" style="display:none">
            </div>
            <div class="form-group">
              <label for="import-password">${t('import.backupPassword')}</label>
              <input type="password" id="import-password" placeholder="${t('import.backupPlaceholder')}">
            </div>
            <div class="form-error" id="import-error" role="alert"></div>
            <div class="form-actions">
              <button type="button" class="btn-primary" id="import-btn" disabled>${t('import.importButton')}</button>
            </div>
          </div>
        </div>
        <p class="auth-footer">
          © 2026 <a href="https://github.com/rramires" target="_blank" rel="noopener noreferrer">github.com/rramires</a>
        </p>
      </div>
    </div>
  `;

  initAuthListeners(container, onAuthenticated);
  checkExistingAccount(container);
}

async function checkExistingAccount(container) {
  const hasAccount = !(await isFirstUse());
  const loginTab = container.querySelector('[data-tab="login"]');

  if (hasAccount) {
    container.querySelector('[data-tab="create"]').style.display = 'none';
    // Show login tab by default if account exists
    switchTab(container, 'login');
  } else {
    // Hide login tab if no account
    loginTab.style.display = 'none';
  }
}

function switchTab(container, tabName) {
  container.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  container.querySelector('#create-form').classList.toggle('hidden', tabName !== 'create');
  container.querySelector('#login-form').classList.toggle('hidden', tabName !== 'login');
  container.querySelector('#import-form').classList.toggle('hidden', tabName !== 'import');
}

function initAuthListeners(container, onAuthenticated) {
  // Tab switching
  container.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(container, tab.dataset.tab));
  });

  // --- Create form ---
  const createPw = container.querySelector('#create-password');
  const createConfirm = container.querySelector('#create-confirm');
  const createBtn = container.querySelector('#create-btn');
  const createError = container.querySelector('#create-error');

  function updateCreateValidation() {
    const pw = createPw.value;
    const { checks,valid,strength,reason } = validatePassword(pw);

    container.querySelector('#rule-length').classList.toggle('valid', checks.minLength);
    container.querySelector('#rule-common').classList.toggle('valid',checks.notCommon);
    container.querySelector('#rule-common').textContent=t('validation.'+(reason||'common'));
    container.querySelector('#password-strength').textContent=t('password.strength.'+strength);
    container.querySelector('#password-strength').dataset.strength=strength;

    const allValid = valid;
    const matches = pw === createConfirm.value && createConfirm.value.length > 0;
    createBtn.disabled = !(allValid && matches);

    if (createConfirm.value.length > 0 && !matches) {
      createError.textContent = t('auth.passwordsNoMatch');
    } else {
      createError.textContent = '';
    }
  }

  createPw.addEventListener('input', updateCreateValidation);
  createConfirm.addEventListener('input', updateCreateValidation);

  container.querySelector('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    createBtn.disabled = true;
    createError.textContent = '';

    try {
      const key = await createAccount(createPw.value);
      onAuthenticated(key);
    } catch (err) {
      createError.textContent = t(typeof err.code==='string'?err.code:err.message);
      createBtn.disabled = false;
    }
  });

  // --- Login form ---
  container.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginError = container.querySelector('#login-error');
    const loginPw = container.querySelector('#login-password');
    loginError.textContent = '';

    try {
      const key = await login(loginPw.value);
      onAuthenticated(key);
    } catch (err) {
      loginError.textContent = t(typeof err.code==='string'?err.code:err.message);
    }
  });

  container.querySelector('#reset-vault').addEventListener('click',async()=>{
    const {resetVault}=await import('./account.js');
    const confirmation=await wordDialog(t('account.resetPrompt'),{title:t('account.reset'),word:t('account.resetWord'),danger:true});
    try{await resetVault(confirmation);location.reload();}catch(error){container.querySelector('#login-error').textContent=error.message;}
  });

  // --- Import ---
  const dropzone = container.querySelector('#import-dropzone');
  const fileInput = container.querySelector('#import-file');
  const importBtn = container.querySelector('#import-btn');
  const importFilename = container.querySelector('#import-filename');
  let selectedFile = null;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) selectImportFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectImportFile(fileInput.files[0]);
  });

  function selectImportFile(file) {
    selectedFile = file;
    importFilename.textContent = file.name;
    importFilename.classList.remove('hidden');
    updateImportBtn();
  }

  const importPw = container.querySelector('#import-password');
  importPw.addEventListener('input', updateImportBtn);

  function updateImportBtn() {
    importBtn.disabled = !(selectedFile && importPw.value.length > 0);
  }

  importBtn.addEventListener('click', async () => {
    const importError = container.querySelector('#import-error');
    importError.textContent = '';
    importBtn.disabled = true;

    try {
      // Import logic will be implemented in backup.js
      const { importBackup } = await import('./backup.js');
      const key = await importBackup(selectedFile, importPw.value);
      onAuthenticated(key);
    } catch (err) {
      importError.textContent = t(typeof err.code==='string'?err.code:err.message||'import.importError');
      importBtn.disabled = false;
    }
  });
}
