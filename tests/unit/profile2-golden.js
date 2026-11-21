import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeV2 } from '../../js/backup-v2.js';
import { decryptRecords, validateRecords } from '../../js/backup-format.js';

test('H1.0 the frozen profile 2 export passes the real import readers', async () => {
  // Fictional only. The combining accent deliberately stays decomposed.
  const password = 'Fictitious Rescue Cafe\u0301 42! 🔑';
  const bytes = await readFile(new URL('../fixtures/profile2-golden.keeplocal', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '2c7c7274e5d6f63abc672b23e860d438cde3b5e55458498653afa53affcff0b3');
  const expected = JSON.parse(await readFile(new URL('../fixtures/profile2-golden.expected.json', import.meta.url), 'utf8'));
  const { key, profile, payload } = await decodeV2(bytes, password);
  assert.deepEqual(profile, { id: 2, iterations: 600_000 });
  assert.equal(key.extractable, false);
  assert.equal(payload.rev, 1);
  assert.equal(payload.parent, null);
  assert.deepEqual(payload.ancestors, []);
  assert.deepEqual(payload.clock, {});
  assert.equal(payload.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(payload.preferences, { lang: 'pt-BR', theme: 'dark' });
  validateRecords(payload.notes);
  assert.deepEqual(await decryptRecords(payload.notes, key), expected);
});
