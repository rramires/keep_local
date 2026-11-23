import {UUID,MAX_NOTE_BYTES,validateNote} from './note-model.js';
import {decryptRecords,validateRecords} from './backup-format.js';
import {encrypt,arrayToBase64,arrayBufferToBase64} from './crypto.js';
import {editorFields} from './note-write-queue.js';
import {t,tp,translateFor} from './i18n.js';
import {descends,nextFolderClock} from './folder-clock.js';

export const MAX_TOMBSTONES = 10000;
const TOMBSTONE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export function pruneTombstones(rows, now = Date.now()) {
  const latest = new Map();
  for (const row of rows) {
    const {id, deletedAt} = row;
    if (typeof id !== 'string' || !UUID.test(id) || !Number.isSafeInteger(deletedAt) ||
        deletedAt < 0 || deletedAt < now - TOMBSTONE_RETENTION_MS) continue;
    if (!latest.has(id) || deletedAt > latest.get(id).deletedAt) latest.set(id, {id, deletedAt});
  }
  return [...latest.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id))
    .slice(0, MAX_TOMBSTONES)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function recordVersions(records) {
  return Object.fromEntries(records.map(({id, updatedAt}) => [id, updatedAt]));
}

export function retainFolderBases(bases) {
  const clockKey=base=>{
    const entries=Object.entries(base.clock??{});
    return entries.length?JSON.stringify(entries.sort(([a],[b])=>a.localeCompare(b))):null;
  };
  const hashedClocks=new Set(bases.filter(base=>base?.versions&&base.hash).map(clockKey));
  const seen=new Set();
  return bases.filter(base=>{
    if(!base?.versions)return false;
    const key=base.hash||clockKey(base);
    if(!key)return false;
    if(!base.hash&&hashedClocks.has(key))return false;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,4);
}

export function reserveFolderVersion(meta,records,heads,options) {
  const clock=nextFolderClock(meta,heads,options);
  const state={writerCount:clock[meta.writerId],folderPendingWrite:{clock,versions:recordVersions(records)}};
  if(meta.folderPendingWrite){
    state.folderSyncedBases=retainFolderBases([meta.folderPendingWrite,
      ...storedFolderBases(meta)]);
  }
  return state;
}

export function folderLineage(head) {
  return [head.parent,...(head.payload?.ancestors??[])].filter(hash=>hash!=null);
}

function storedFolderBases(meta) {
  return meta.folderSyncedBases??[
    {hash:meta.folderSyncedHash,clock:meta.folderSyncedClock??{},versions:meta.folderSyncedVersions},
    meta.folderSyncedBase,
  ];
}

function folderBase(head) {
  return {hash:head.hash,clock:head.payload.clock??{},versions:recordVersions(head.payload.notes)};
}

export function folderVersionState(meta,head,{mergedHeads=[],resetBases=false}={}) {
  const previous={hash:meta.folderSyncedHash,clock:meta.folderSyncedClock??{},versions:meta.folderSyncedVersions};
  const bases=resetBases?[folderBase(head)]:[
    folderBase(head),...mergedHeads.map(folderBase),meta.folderPendingWrite,previous,...storedFolderBases(meta),
  ];
  return {folderSyncedVersions:recordVersions(head.payload.notes),folderSyncedBases:retainFolderBases(bases)};
}

export function baseForFolderHead(meta, head) {
  const pending=meta.folderPendingWrite;
  // When the head proves the pending write, its local conflict losers were
  // kept as copies. Only a tombstone can remove a note from that write.
  if(pending&&descends(head,{clock:pending.clock}))return pending.versions;
  const base=storedFolderBases(meta).find(base=>base?.versions&&descends(head,base));
  if(base)return base.versions;
  if (meta.folderSyncedVersions&&descends(head,{hash:meta.folderSyncedHash,clock:meta.folderSyncedClock})) return meta.folderSyncedVersions;
  return undefined;
}

export function sameTombstones(left = [], right = [], now = Date.now()) {
  return JSON.stringify(pruneTombstones(left,now)) === JSON.stringify(pruneTombstones(right,now));
}

export function folderMergeMessages({fromRemote,deleted,conflicts,restored,keptEdited}) {
  const details = [];
  if (fromRemote) details.push(tp('folder.mergeUpdated',fromRemote));
  if (deleted) details.push(tp('folder.mergeDeleted',deleted));
  if (conflicts) details.push(tp('folder.mergeConflicts',conflicts));
  const messages = [];
  if (details.length) messages.push(t('folder.mergeSummary',{details:details.join(', ')}));
  if (restored) messages.push(tp('folder.mergeRestored',restored));
  if (keptEdited) messages.push(tp('folder.mergeKeptEdited',keptEdited));
  return messages;
}

function emptyStats() {
  return {fromRemote:0,deleted:0,conflicts:0,restored:0,keptEdited:0};
}

function tombstoneTimes(rows, now) {
  return new Map(pruneTombstones(rows,now).map(({id,deletedAt})=>[id,deletedAt]));
}

export function folderPullNotices(snapshot, payload, now = Date.now()) {
  const before=tombstoneTimes(snapshot.meta.tombstones??[],now);
  const after=tombstoneTimes(payload.tombstones??[],now);
  if (!after.size) return undefined;
  const local=new Map(snapshot.notes.map(record=>[record.id,record]));
  const stats=emptyStats();
  for (const record of payload.notes) {
    const existing=local.get(record.id);
    const previous=before.get(record.id);
    const incoming=after.get(record.id);
    // The merge kept a note alongside its deletion marker.
    if (!existing && previous!==undefined && incoming>=previous) stats.keptEdited++;
    if (existing && incoming>(previous??-1) && existing.updatedAt===record.updatedAt &&
        existing.iv===record.iv && existing.ciphertext===record.ciphertext) stats.restored++;
  }
  return stats.keptEdited||stats.restored ? stats : undefined;
}

function canonicalJSON(value) {
  return JSON.stringify(value, (_, part) => {
    if (part && typeof part === 'object' && !Array.isArray(part)) {
      return Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]]));
    }
    return part;
  });
}

function editorContent(note) {
  return canonicalJSON([note.type, ...editorFields(note).map(field => note[field])]);
}

function indexVault({notes, records}) {
  const encrypted = new Map(records.map(record => [record.id, record]));
  return new Map(notes.map(note => [note.id, {note, record:encrypted.get(note.id)}]));
}

function compareText(left, right) {
  return left < right ? -1 : Number(left > right);
}

function compareVersions(left, right) {
  return left.note.updatedAt - right.note.updatedAt ||
    compareText(canonicalJSON(left.note), canonicalJSON(right.note)) ||
    compareText(left.record?.iv ?? '', right.record?.iv ?? '') ||
    compareText(left.record?.ciphertext ?? '', right.record?.ciphertext ?? '');
}

const encoder = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
}

async function conflictId(note) {
  const contentHash = hex(await sha256(editorContent(note)));
  const bytes = (await sha256(`${note.id}:${note.updatedAt}:${contentHash}`)).slice(0,16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  return [value.slice(0,8),value.slice(8,12),value.slice(12,16),value.slice(16,20),value.slice(20)].join('-');
}

function fitConflictTitle(title, suffix, copy) {
  const available = MAX_NOTE_BYTES - encoder.encode(JSON.stringify(copy)).length;
  const size = text => encoder.encode(JSON.stringify(text)).length - 2;
  if (size(suffix) > available) return null;
  const prefix = Array.from(title.slice(0, 4096 - suffix.length).replace(/[\uD800-\uDBFF]$/u,''));
  let low = 0;
  let high = prefix.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size(prefix.slice(0, middle).join('') + suffix) <= available) low = middle;
    else high = middle - 1;
  }
  return prefix.slice(0, low).join('') + suffix;
}

function conflictCopy(loser, winner, id, language) {
  const date = new Date(Math.min(loser.updatedAt, 8.64e15)).toISOString().split(':').slice(0,2).join(':').replace('T',' ');
  const suffix = translateFor(language, 'folder.conflictSuffix', {date});
  const copy = {...loser, id, order:Math.min(Number.MAX_SAFE_INTEGER, winner.order + 1), title:''};
  const title = fitConflictTitle(loser.title,suffix,copy);
  // A note at the byte limit can use all of its space for editor content.
  return validateNote(title === null ? {...loser,id} : {...copy,title});
}

function pickVersion(left, right, common) {
  if (editorContent(left.note) === editorContent(right.note)) {
    return {winner:compareVersions(left,right) >= 0 ? left : right};
  }
  if (common !== undefined) {
    if (left.note.updatedAt === common) {
      return {winner:right.note.updatedAt > common ? right : left};
    }
    if (right.note.updatedAt === common) return {winner:left};
  }
  return compareVersions(left,right) >= 0 ? {winner:left,loser:right} : {winner:right,loser:left};
}

export async function mergeVaults({
  local, remote, base, localTombstones = [], remoteTombstones = [], now = Date.now(), language = 'en',
}) {
  const left = indexVault(local);
  const right = indexVault(remote);
  const deletedLocally = tombstoneTimes(localTombstones,now);
  const deletedRemotely = tombstoneTimes(remoteTombstones,now);
  const tombstones = pruneTombstones([...localTombstones, ...remoteTombstones],now);
  const ids = new Set([...left.keys(), ...right.keys()]);
  const selected = new Map();
  const pendingConflicts = [];
  const stats = emptyStats();

  for (const id of [...ids].sort()) {
    const localVersion = left.get(id);
    const remoteVersion = right.get(id);
    const common = base && Object.hasOwn(base,id) ? base[id] : undefined;
    if (localVersion && remoteVersion) {
      const {winner,loser} = pickVersion(localVersion,remoteVersion,common);
      selected.set(id,winner);
      if (winner === remoteVersion && canonicalJSON(winner.note) !== canonicalJSON(localVersion.note)) stats.fromRemote++;
      if (loser) pendingConflicts.push({loser:loser.note,winner:winner.note});
    } else {
      const remaining=localVersion??remoteVersion;
      const marker=(localVersion?deletedRemotely:deletedLocally).get(id);
      if (marker!==undefined && common!==undefined && remaining.note.updatedAt<=common) {
        if (localVersion) stats.deleted++;
        continue;
      }
      selected.set(id,remaining);
      if (remoteVersion) stats.fromRemote++;
      if (marker!==undefined) {
        if (localVersion) stats.restored++;
        else stats.keptEdited++;
      }
    }
  }

  for (const {loser,winner} of pendingConflicts) {
    const id = await conflictId(loser);
    const deletedAt = Math.max(deletedLocally.get(id) ?? -1, deletedRemotely.get(id) ?? -1);
    if (ids.has(id) || selected.has(id) || deletedAt >= loser.updatedAt) continue;
    selected.set(id,{note:conflictCopy(loser,winner,id,language)});
    stats.conflicts++;
  }

  const versions = [...selected.keys()].sort().map(id => selected.get(id));
  // Conflict copies lack an existing record. The caller encrypts just those notes.
  return {
    notes:versions.map(({note}) => note),
    records:versions.flatMap(({record}) => record ? [record] : []),
    tombstones,
    stats,
  };
}

export function sameNotes(left, right) {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map(note => [note.id, note]));
  return left.every(note => canonicalJSON(note) === canonicalJSON(byId.get(note.id)));
}

export async function reconcileFolderNotes(snapshot, head, otherHeads, key) {
  const {meta}=snapshot;
  const local={records:snapshot.notes,notes:await decryptRecords(snapshot.notes,key)};
  const now=Date.now();
  const language=[meta.lang,...otherHeads.map(copy=>copy.payload.preferences.lang)].includes('pt-BR')?'pt-BR':'en';
  const stats=emptyStats();
  let merged={...local,tombstones:meta.tombstones??[]};
  let headNotes;
  for(const copy of otherHeads){
    const records=copy.payload.notes;
    const notes=await decryptRecords(records,key);
    if(copy.hash===head.hash)headNotes=notes;
    merged=await mergeVaults({
      local:merged,remote:{notes,records},base:baseForFolderHead(meta,copy),
      localTombstones:merged.tombstones,remoteTombstones:copy.payload.tombstones,now,language,
    });
    for(const name of Object.keys(stats))stats[name]+=merged.stats[name];
  }

  const byId=new Map(merged.records.map(record=>[record.id,record]));
  const records=[];
  for(const note of merged.notes){
    const existing=byId.get(note.id);
    if(existing){records.push(existing);continue;}
    const {iv,ciphertext}=await encrypt(key,JSON.stringify(note));
    records.push({id:note.id,updatedAt:note.updatedAt,iv:arrayToBase64(iv),ciphertext:arrayBufferToBase64(ciphertext)});
  }
  validateRecords(records);
  headNotes??=await decryptRecords(head.payload.notes,key);
  return {
    records,tombstones:merged.tombstones,stats,now,
    sameLocalNotes:sameNotes(merged.notes,local.notes),
    sameHeadNotes:sameNotes(merged.notes,headNotes),
  };
}
