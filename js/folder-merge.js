import {UUID} from './note-model.js';

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
