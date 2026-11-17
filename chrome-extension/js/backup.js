// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { getAllNoteRecords, getAllMetaRecords, clearAllNotes, clearAllMeta, saveNoteRecord, saveMeta, getMeta } from './db.js';
import { deriveKey, hashPassword, createKeyCheck, verifyKeyCheck, decrypt, base64ToArray, arrayToBase64 } from './crypto.js';
import { t } from './i18n.js';

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
  const text = await file.text();
  let backup;

  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error(t('backup.invalidFile'));
  }

  if (!backup.app || backup.app !== 'KeepLocal' || !backup.meta || !backup.notes) {
    throw new Error(t('backup.unrecognizedFormat'));
  }

  // Find salt from meta
  const saltRecord = backup.meta.find(m => m.key === 'salt');
  if (!saltRecord) throw new Error(t('backup.corruptedSalt'));

  const salt = base64ToArray(saltRecord.value);
  const key = await deriveKey(password, salt, true);

  const existingCheck = backup.meta.find(m => m.key === 'keyCheck')?.value;
  if (existingCheck && !await verifyKeyCheck(key, existingCheck)) throw new Error(t('backup.wrongPassword'));
  if (!existingCheck && backup.notes.length === 0) {
    const verifier = backup.meta.find(m => m.key === 'passwordVerifier')?.value;
    if (!verifier || await hashPassword(password, salt) !== verifier) throw new Error(t('backup.wrongPassword'));
  }
  for (const record of backup.notes) {
    try { JSON.parse(await decrypt(key, base64ToArray(record.iv), base64ToArray(record.ciphertext))); }
    catch { throw new Error(t('backup.wrongPasswordOrCorrupted')); }
  }
  backup.meta = backup.meta.filter(m => !['passwordVerifier', 'keyCheck'].includes(m.key));
  backup.meta.push({ key: 'keyCheck', value: existingCheck || await createKeyCheck(key) });

  // Clear existing data and import
  await clearAllNotes();
  await clearAllMeta();

  // Import meta
  for (const m of backup.meta) {
    await saveMeta(m.key, m.value);
  }

  // Import notes
  for (const n of backup.notes) {
    await saveNoteRecord(n);
  }

  // Return derived key for session
  return key;
}
