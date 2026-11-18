// db.js — IndexedDB wrapper for KeepLocal

const DB_NAME = 'KeepLocalDB';
const DB_VERSION = 1;

let dbInstance = null;
let writeMode = 'readWrite';
let transientVault = null;

export function isReadOnly() {
  return writeMode === 'readOnly';
}

export function setWriteMode(mode) {
  if (mode !== 'readOnly' && mode !== 'readWrite') throw new TypeError('Invalid vault write mode');
  writeMode = mode;
  if (!isReadOnly()) transientVault = null;
}

export function assertWritable() {
  if (isReadOnly()) throw Object.assign(new Error('vault.readOnly'), {code:'vault.readOnly'});
}

async function writeTransaction(stores,explicitTransition=false) {
  if(!explicitTransition) assertWritable();
  const db = await openDB();
  if(!explicitTransition) assertWritable();
  return db.transaction(stores, 'readwrite');
}

export function vaultIdentity({salt,vaultId}) {
  return vaultId ?? (isReadOnly() && transientVault?.salt === salt ? transientVault?.id : null);
}


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
  if(['lang','theme'].includes(key)){
    const changed=await vaultTransaction(({meta},done,fail)=>{
      const request=meta.getAll();request.onsuccess=()=>{try{
        const values=Object.fromEntries(request.result.map(r=>[r.key,r.value]));
        meta.put({key,value});const dirty=!!values.salt&&values[key]!==value;
        if(dirty)markVaultDirty(meta,values);done(dirty);
      }catch(error){fail(error);}};
    });
    if(changed)(await import('./backup.js')).setUnsaved();
    return;
  }
  const tx = await writeTransaction('meta');
  return new Promise((resolve, reject) => {
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
  const tx = await writeTransaction('meta');
  return new Promise((resolve, reject) => {
    tx.objectStore('meta').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Notes store ---

export async function saveNoteRecord(record) {
  const tx = await writeTransaction('notes');
  return new Promise((resolve, reject) => {
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
  const tx = await writeTransaction('notes');
  return new Promise((resolve, reject) => {
    tx.objectStore('notes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function clearAllNotes() {
  const tx = await writeTransaction('notes');
  return new Promise((resolve, reject) => {
    tx.objectStore('notes').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function clearAllMeta() {
  const tx = await writeTransaction('meta');
  return new Promise((resolve, reject) => {
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

export function vaultTransaction(action) {
  return transactVault(action);
}

async function transactVault(action,explicitTransition=false) {
  const tx = await writeTransaction(['notes', 'meta'],explicitTransition);
  return new Promise((resolve, reject) => {
    let result, failure;
    const fail = (error) => { failure ||= error; try { tx.abort(); } catch {} };
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

export function replaceVault({notes:records,meta:values},expected,{signal}={}) {
  return replaceLocalVault(records,values,expected,signal);
}

export function resetFolderLockedVault(expected,vaultId) {
  return replaceLocalVault([],{vaultId},expected,undefined,true);
}

export function replaceVaultFromFolder({notes,meta},expected,{signal}={}) {
  return replaceLocalVault(notes,meta,expected,signal,true);
}

function replaceLocalVault(records,values,expected,signal,explicitTransition=false) {
  return transactVault(({tx,notes,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const replace=()=>{notes.clear();meta.clear();for(const r of records)notes.put(r);for(const[key,value]of Object.entries(values))meta.put({key,value});done();};
    if(!expected){replace();return;}
    const request=meta.getAll();request.onsuccess=()=>{try{
      const current=Object.fromEntries(request.result.map(r=>[r.key,r.value]));
      assertVaultSnapshot(current,expected);
      replace();
    }catch(error){fail(error);}};
  },explicitTransition);
}

export function storeFolderConnection(handle,expected,vaultId,{signal,transition=false}={}) {
  return transactVault(({tx,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const request=meta.getAll();
    request.onsuccess=()=>{
      try {
        const actual=Object.fromEntries(request.result.map(({key,value})=>[key,value]));
        assertVaultSnapshot(actual,expected);
        if(!actual.vaultId&&vaultId)meta.put({key:'vaultId',value:vaultId});
        if(handle){
          meta.put({key:'syncFolder',value:handle});
          meta.put({key:'folderConnectionId',value:crypto.randomUUID()});
        }else{
          meta.delete('syncFolder');
          meta.delete('folderConnectionId');
        }
        for(const key of ['folderSyncedHash','folderSyncedRevision','folderSeenRev','folderWrittenAt'])meta.delete(key);
        done();
      }catch(error){fail(error);}
    };
  },transition);
}

function assertVaultSnapshot(current,expected,{allowNewEdits=false}={}) {
  const keys=['salt','vaultId','revision','exportRev','exportParent','folderConnectionId',
    'folderSyncedHash','folderSyncedRevision','folderSeenRev','folderWrittenAt'];
  if(keys.some(key=>!(allowNewEdits&&key==='revision')&&current[key]!==expected[key]))throw Object.assign(new Error('vault.changed'),{code:'vault.changed'});
}

export async function verifyFolderWrite(expected,{signal}={}) {
  assertWritable();
  const current=Object.fromEntries((await getAllMetaRecords()).map(row=>[row.key,row.value]));
  assertVaultSnapshot(current,expected,{allowNewEdits:true});
  if(signal?.aborted)throw Object.assign(new Error('session.ended'),{code:'session.ended'});
}

export function recordFolderWrite(expected,{rev,hash,writtenAt},{signal}={}) {
  return vaultTransaction(({tx,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const request=meta.getAll();
    request.onsuccess=()=>{
      try{
        const current=Object.fromEntries(request.result.map(({key,value})=>[key,value]));
        assertVaultSnapshot(current,expected,{allowNewEdits:true});
        const state={
          exportRev:rev,exportParent:hash,folderSyncedHash:hash,
          folderSyncedRevision:expected.revision||0,folderSeenRev:rev,folderWrittenAt:writtenAt,
        };
        for(const [key,value] of Object.entries(state))meta.put({key,value});
        done();
      }catch(error){fail(error);}
    };
  });
}

export async function readVault() {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['notes','meta'],'readonly'),notes=tx.objectStore('notes').getAll(),meta=tx.objectStore('meta').getAll();
    tx.oncomplete=()=>resolve({notes:notes.result,meta:Object.fromEntries(meta.result.map(r=>[r.key,r.value]))});
    tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
  });
}
export function recordExport(expected,rev,hash,{signal}={}) {
  return vaultTransaction(({tx,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const request=meta.getAll();
    request.onsuccess=()=>{try{
      const current=Object.fromEntries(request.result.map(r=>[r.key,r.value]));
      if(current.salt!==expected.salt||current.vaultId!==expected.vaultId||current.exportRev!==expected.exportRev||current.exportParent!==expected.exportParent||current.folderConnectionId!==expected.folderConnectionId)throw new Error('backup.concurrent');
      meta.put({key:'exportRev',value:rev});meta.put({key:'exportParent',value:hash});done();
    }catch(error){fail(error);}};
  });
}

export async function ensureVaultId(expectedSalt,{signal}={}) {
  if (isReadOnly()) {
    const values = Object.fromEntries((await getAllMetaRecords()).map(({key,value})=>[key,value]));
    if (expectedSalt && values.salt !== expectedSalt) throw new Error('vault.changed');
    if (values.vaultId) return values.vaultId;
    if (!transientVault || transientVault.salt !== values.salt) {
      transientVault = {salt:values.salt,id:crypto.randomUUID()};
    }
    return transientVault.id;
  }
  return vaultTransaction(({tx,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const request=meta.getAll();request.onsuccess=()=>{try{
      const values=Object.fromEntries(request.result.map(r=>[r.key,r.value]));
      if(expectedSalt&&values.salt!==expectedSalt)throw new Error('vault.changed');
      const id=values.vaultId||crypto.randomUUID();meta.put({key:'vaultId',value:id});done(id);
    }catch(error){fail(error);}};
  });
}
export function markVaultDirty(meta,values) {
  meta.put({key:'dirtySinceBackup',value:true});
  meta.put({key:'revision',value:(values.revision||0)+1});
}
export function guardedNoteWrite({id,record,expectedVaultId,knownUpdatedAt,signal}) {
  return vaultTransaction(({tx,meta,notes},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const m=meta.getAll(),n=notes.get(id);let ready=0;
    const finish=()=>{if(++ready!==2)return;try{
      const values=Object.fromEntries(m.result.map(r=>[r.key,r.value]));
      if(!expectedVaultId||values.vaultId!==expectedVaultId)throw Object.assign(new Error('vault.changed'),{code:'vault.changed'});
      if(n.result ? (knownUpdatedAt===undefined||n.result.updatedAt>knownUpdatedAt) : knownUpdatedAt!==undefined)throw Object.assign(new Error('note.conflict'),{code:'note.conflict'});
      if(record)notes.put(record);else notes.delete(id);
      markVaultDirty(meta,values);done();
    }catch(error){fail(error);}};
    m.onsuccess=finish;n.onsuccess=finish;
  });
}

export function acknowledgeDownload(expected,at,{signal}={}) {
  return vaultTransaction(({tx,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const request=meta.getAll();request.onsuccess=()=>{try{
      const values=Object.fromEntries(request.result.map(r=>[r.key,r.value]));
      assertVaultSnapshot(values,expected,{allowNewEdits:true});
      meta.put({key:'lastBackupAt',value:at});
      const clean=(values.revision||0)===(expected.revision||0);
      if(clean)meta.put({key:'dirtySinceBackup',value:false});done(clean);
    }catch(error){fail(error);}};
  });
}

function bindTransactionAbort(tx,signal,fail) {
  if(!signal)return true;
  const cancel=()=>fail(Object.assign(new Error('session.ended'),{code:'session.ended'}));
  if(signal.aborted){cancel();return false;}
  signal.addEventListener('abort',cancel,{once:true});
  const cleanup=()=>signal.removeEventListener('abort',cancel);
  tx.addEventListener('complete',cleanup,{once:true});tx.addEventListener('abort',cleanup,{once:true});
  return true;
}

export function discardPreservedRecord(record,expected,{signal,snapshotJSON}={}) {
  return vaultTransaction(({tx,notes,meta},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const m=meta.getAll(),n=notes.getAll();let ready=0;
    const finish=()=>{if(++ready!==2)return;try{
      const values=Object.fromEntries(m.result.map(r=>[r.key,r.value]));
      if(typeof snapshotJSON!=='string'||JSON.stringify({notes:n.result,meta:values})!==snapshotJSON||values.vaultId!==expected.vaultId||!n.result.some(r=>JSON.stringify(r)===JSON.stringify(record)))throw Object.assign(Error('recovery.changed'),{code:'recovery.changed'});
      notes.delete(record.id);markVaultDirty(meta,values);done();
    }catch(error){fail(error);}};
    m.onsuccess=finish;n.onsuccess=finish;
  });
}

export function guardedNoteBatch(changes,{expectedVaultId,signal}) {
  return vaultTransaction(({tx,meta,notes},done,fail)=>{
    if(!bindTransactionAbort(tx,signal,fail))return;
    const m=meta.getAll(),requests=changes.map(c=>notes.get(c.id));let remaining=requests.length+1;
    const finish=()=>{if(--remaining)return;try{
      const values=Object.fromEntries(m.result.map(r=>[r.key,r.value]));
      if(!expectedVaultId||values.vaultId!==expectedVaultId)throw Object.assign(Error('vault.changed'),{code:'vault.changed'});
      changes.forEach((change,i)=>{const stored=requests[i].result;if(stored?(change.knownUpdatedAt===undefined||stored.updatedAt>change.knownUpdatedAt):change.knownUpdatedAt!==undefined)throw Object.assign(Error('note.conflict'),{code:'note.conflict'});});
      changes.forEach(change=>notes.put(change.record));markVaultDirty(meta,values);done();
    }catch(error){fail(error);}};
    m.onsuccess=finish;requests.forEach(request=>request.onsuccess=finish);
  });
}
