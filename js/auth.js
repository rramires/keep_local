// auth.js — Password creation/validation, session management

import { generateSalt, deriveKey, hashPassword, exportKey, importKey, arrayToBase64, base64ToArray } from './crypto.js';
import { saveMeta, getMeta, isFirstUse } from './db.js';
import { t } from './i18n.js';

const SESSION_KEY = 'keeplocal_session_key';
const SESSION_TS_KEY = 'keeplocal_session_ts';
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

let sessionTimer = null;
let onSessionExpired = null;

// --- Password Validation ---

export function validatePassword(pw) {
  const errors = [];
  const checks = {
    minLength: pw.length >= 8,
    hasUppercase: /[A-Z]/.test(pw),
    hasSpecial: /[^a-zA-Z0-9]/.test(pw),
  };

  if (!checks.minLength) errors.push(t('validation.minLength'));
  if (!checks.hasUppercase) errors.push(t('validation.hasUppercase'));
  if (!checks.hasSpecial) errors.push(t('validation.hasSpecial'));

  return { valid: errors.length === 0, errors, checks };
}

// --- Account Creation ---

export async function createAccount(password) {
  const salt = generateSalt();
  const key = await deriveKey(password, salt, true);
  const pwHash = await hashPassword(password, salt);

  await saveMeta('salt', arrayToBase64(salt));
  await saveMeta('passwordVerifier', pwHash);

  await storeSessionKey(key);
  return key;
}

// --- Login ---

export async function login(password) {
  const saltB64 = await getMeta('salt');
  if (!saltB64) throw new Error(t('login.noAccount'));

  const salt = base64ToArray(saltB64);
  const key = await deriveKey(password, salt, true);
  const pwHash = await hashPassword(password, salt);
  const storedHash = await getMeta('passwordVerifier');

  if (pwHash !== storedHash) {
    throw new Error(t('login.wrongPassword'));
  }

  await storeSessionKey(key);
  return key;
}

// --- Session Management ---

async function storeSessionKey(key) {
  const exported = await exportKey(key);
  sessionStorage.setItem(SESSION_KEY, exported);
  sessionStorage.setItem(SESSION_TS_KEY, Date.now().toString());
}

export async function getSessionKey() {
  const exported = sessionStorage.getItem(SESSION_KEY);
  const ts = sessionStorage.getItem(SESSION_TS_KEY);

  if (!exported || !ts) return null;

  const elapsed = Date.now() - parseInt(ts, 10);
  if (elapsed > SESSION_TIMEOUT) {
    clearSession();
    return null;
  }

  try {
    return await importKey(exported);
  } catch {
    clearSession();
    return null;
  }
}

export function refreshSession() {
  if (sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_TS_KEY, Date.now().toString());
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_TS_KEY);
}

export function logout() {
  clearSession();
  if (onSessionExpired) onSessionExpired();
}

export function startSessionTimer(onExpire) {
  onSessionExpired = onExpire;
  resetSessionTimer();

  const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
  events.forEach(evt => {
    document.addEventListener(evt, handleActivity, { passive: true });
  });
}

export function stopSessionTimer() {
  clearTimeout(sessionTimer);
  const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
  events.forEach(evt => {
    document.removeEventListener(evt, handleActivity);
  });
}

function handleActivity() {
  refreshSession();
  resetSessionTimer();
}

function resetSessionTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    clearSession();
    stopSessionTimer();
    if (onSessionExpired) onSessionExpired();
  }, SESSION_TIMEOUT);
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
                <li id="rule-upper">${t('auth.hasUppercase')}</li>
                <li id="rule-special">${t('auth.hasSpecial')}</li>
              </ul>
            </div>
            <div class="form-error" id="create-error"></div>
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
            <div class="form-error" id="login-error"></div>
            <div class="form-actions">
              <button type="submit" class="btn-primary">${t('auth.login')}</button>
            </div>
          </form>

          <!-- Import Tab -->
          <div class="auth-import hidden" id="import-form">
            <div class="import-dropzone" id="import-dropzone">
              <div class="import-icon">📁</div>
              <div class="import-text">${t('import.dropzoneText')}</div>
              <div class="import-filename hidden" id="import-filename"></div>
              <input type="file" id="import-file" accept=".json,.keeplocal.json" style="display:none">
            </div>
            <div class="form-group">
              <label for="import-password">${t('import.backupPassword')}</label>
              <input type="password" id="import-password" placeholder="${t('import.backupPlaceholder')}">
            </div>
            <div class="form-error" id="import-error"></div>
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
    const { checks } = validatePassword(pw);

    container.querySelector('#rule-length').classList.toggle('valid', checks.minLength);
    container.querySelector('#rule-upper').classList.toggle('valid', checks.hasUppercase);
    container.querySelector('#rule-special').classList.toggle('valid', checks.hasSpecial);

    const allValid = checks.minLength && checks.hasUppercase && checks.hasSpecial;
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
      createError.textContent = err.message;
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
      loginError.textContent = err.message;
    }
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
      importError.textContent = err.message || t('import.importError');
      importBtn.disabled = false;
    }
  });
}
