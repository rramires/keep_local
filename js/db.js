// db.js — IndexedDB wrapper for KeepLocal

const DB_NAME = 'KeepLocalDB';
const DB_VERSION = 1;

let dbInstance = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) { resolve(dbInstance); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Meta store ---

export async function saveMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Notes store ---

export async function saveNoteRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getNoteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const req = tx.objectStore('notes').get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllNoteRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const req = tx.objectStore('notes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteNoteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function clearAllNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function clearAllMeta() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllMetaRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function isFirstUse() {
  const salt = await getMeta('salt');
  return salt === null;
}

export async function vaultTransaction(action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notes', 'meta'], 'readwrite');
    let result, failure;
    const fail = (error) => { failure = error; try { tx.abort(); } catch {} };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('transaction.aborted'));
    tx.onerror = () => {};
    try { action({ tx, notes: tx.objectStore('notes'), meta: tx.objectStore('meta') }, value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

export function createVault(values) {
  return vaultTransaction(({ meta }, done, fail) => {
    const request = meta.getAll();
    request.onsuccess = () => {
      try {
        if (request.result.some(r => ['salt', 'keyCheck'].includes(r.key))) {
          fail(Object.assign(new Error('account.exists'), { code: 'account.exists' }));
          return;
        }
        for (const [key, value] of Object.entries(values)) meta.put({ key, value });
        done();
      } catch (error) { fail(error); }
    };
  });
}

export function migrateKeyCheck(salt, keyCheck) {
  return vaultTransaction(({ meta }, done, fail) => {
    const request = meta.getAll();
    request.onsuccess = () => {
      try {
        const values = Object.fromEntries(request.result.map(r => [r.key, r.value]));
        if (values.salt !== salt) throw new Error('vault.changed');
        if (!values.keyCheck) meta.put({ key: 'keyCheck', value: keyCheck });
        meta.delete('passwordVerifier');
        done();
      } catch (error) { fail(error); }
    };
  });
}

export function replaceVault({ notes: records, meta: values }) {
  return vaultTransaction(({ notes, meta }, done) => {
    notes.clear();meta.clear();
    for (const r of records) notes.put(r);
    for (const [key,value] of Object.entries(values)) meta.put({key,value});
    done();
  });
}
