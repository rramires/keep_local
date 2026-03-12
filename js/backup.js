// backup.js — Export/import encrypted backup, unsavedChanges flag, beforeunload

import { getAllNoteRecords, getAllMetaRecords, clearAllNotes, clearAllMeta, saveNoteRecord, saveMeta, getMeta } from './db.js';
import { deriveKey, hashPassword, decrypt, base64ToArray, arrayToBase64 } from './crypto.js';

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
    meta: meta,
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
    throw new Error('Arquivo de backup inválido.');
  }

  if (!backup.app || backup.app !== 'KeepLocal' || !backup.meta || !backup.notes) {
    throw new Error('Formato de backup não reconhecido.');
  }

  // Find salt from meta
  const saltRecord = backup.meta.find(m => m.key === 'salt');
  if (!saltRecord) throw new Error('Backup corrompido: salt não encontrado.');

  const salt = base64ToArray(saltRecord.value);
  const key = await deriveKey(password, salt, true);

  // Verify password by checking hash
  const pwHash = await hashPassword(password, salt);
  const storedHashRecord = backup.meta.find(m => m.key === 'passwordVerifier');
  if (!storedHashRecord || pwHash !== storedHashRecord.value) {
    throw new Error('Senha incorreta.');
  }

  // Verify by trying to decrypt the first note
  if (backup.notes.length > 0) {
    const firstNote = backup.notes[0];
    try {
      const iv = base64ToArray(firstNote.iv);
      const ct = base64ToArray(firstNote.ciphertext);
      await decrypt(key, iv, ct.buffer ? ct : ct);
    } catch {
      throw new Error('Senha incorreta ou backup corrompido.');
    }
  }

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
