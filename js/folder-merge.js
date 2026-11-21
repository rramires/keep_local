import {UUID,MAX_NOTE_BYTES,validateNote} from './note-model.js';
import {editorFields} from './note-write-queue.js';
import {translateFor} from './i18n.js';

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
  const deletedLocally = new Map(pruneTombstones(localTombstones,now).map(row => [row.id,row.deletedAt]));
  const deletedRemotely = new Map(pruneTombstones(remoteTombstones,now).map(row => [row.id,row.deletedAt]));
  const tombstones = pruneTombstones([...localTombstones, ...remoteTombstones],now);
  const ids = new Set([...left.keys(), ...right.keys()]);
  const selected = new Map();
  const pendingConflicts = [];
  const stats = {fromRemote:0,deleted:0,conflicts:0,restored:0};

  for (const id of [...ids].sort()) {
    const localVersion = left.get(id);
    const remoteVersion = right.get(id);
    const common = base && Object.hasOwn(base,id) ? base[id] : undefined;
    if (localVersion && remoteVersion) {
      const {winner,loser} = pickVersion(localVersion,remoteVersion,common);
      selected.set(id,winner);
      if (winner === remoteVersion && canonicalJSON(winner.note) !== canonicalJSON(localVersion.note)) stats.fromRemote++;
      if (loser) pendingConflicts.push({loser:loser.note,winner:winner.note});
    } else if (localVersion) {
      const marker = deletedRemotely.get(id);
      if (marker >= localVersion.note.updatedAt && localVersion.note.updatedAt === common) stats.deleted++;
      else {
        selected.set(id,localVersion);
        if (marker < localVersion.note.updatedAt) stats.restored++;
      }
    } else if (!(deletedLocally.get(id) >= remoteVersion.note.updatedAt)) {
      selected.set(id,remoteVersion);
      stats.fromRemote++;
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
