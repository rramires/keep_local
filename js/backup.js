// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { getAllNoteRecords, getAllMetaRecords, replaceVault, getMeta } from './db.js';
import { deriveKey, hashPassword, createKeyCheck, verifyKeyCheck, decrypt, base64ToArray, arrayToBase64 } from './crypto.js';
import { t } from './i18n.js';
import { MAX_BACKUP_BYTES, validateV1, decryptRecords } from './backup-format.js';

let unsavedChanges = false;

export function setUnsaved() {
  unsavedChanges = true;
}

export function clearUnsaved() {
  unsavedChanges = false;
}

export function isUnsaved() {
  return unsavedChanges;
}

export function initBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    if (unsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export async function exportBackup() {
  const notes = await getAllNoteRecords();
  const meta = await getAllMetaRecords();

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'KeepLocal',
    meta: meta.filter(m => m.key !== 'passwordVerifier'),
    notes: notes.map(n => ({
      id: n.id,
      iv: n.iv,
      ciphertext: n.ciphertext,
      updatedAt: n.updatedAt,
    })),
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `keeplocal-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  unsavedChanges = false;
}

export async function importBackup(file, password) {
  if (!file || file.size > MAX_BACKUP_BYTES) throw new Error(t('backup.tooLarge'));
  let backup,meta;
  try { backup=JSON.parse(await file.text());meta=validateV1(backup); }
  catch { throw new Error(t('backup.unrecognizedFormat')); }
  const salt=base64ToArray(meta.salt);
  const key=await deriveKey(password,salt,true);
  if (meta.keyCheck && !await verifyKeyCheck(key,meta.keyCheck)) throw new Error(t('backup.wrongPassword'));
  if (!meta.keyCheck && !backup.notes.length && await hashPassword(password,salt)!==meta.passwordVerifier) throw new Error(t('backup.wrongPassword'));
  try { await decryptRecords(backup.notes,key); }
  catch { throw new Error(t('backup.wrongPasswordOrCorrupted')); }
  delete meta.passwordVerifier;
  meta.keyCheck ||= await createKeyCheck(key);
  const local=await getAllNoteRecords();
  if ((local.length || await getMeta('salt')) && !window.confirm(t('backup.replaceConfirm',{local:local.length,incoming:backup.notes.length}))) throw new Error(t('backup.cancelled'));
  // V1 cannot authenticate removal of whole records; only v2 authenticates the set.
  await replaceVault({notes:backup.notes,meta});
  return key;
}
