import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from the repository root and supply an empty, disposable output directory.
// Committed bytes are frozen. A new run uses new salt and IVs as the app does.
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node tests/fixtures/generate-profile2-golden.mjs OUTPUT_DIRECTORY');
const moduleURL = name => pathToFileURL(resolve('js', name)).href;
const { generateSalt, deriveKey, encrypt, arrayToBase64, arrayBufferToBase64 } =
  await import(moduleURL('crypto.js'));
const { encodeV2, makePayload } = await import(moduleURL('backup-v2.js'));
const { validateNote } = await import(moduleURL('note-model.js'));

const password = 'Fictitious Rescue Cafe\u0301 42! 🔑';
const stamp = Date.parse('2026-01-02T03:04:05.000Z');
const id = number => `c0ffee00-0000-4000-8000-${String(number).padStart(12, '0')}`;
function note(number, overrides) {
  const value = {
    id: id(number), title: '', type: 'text', content: '', color: 'default',
    pinned: false, labels: [], createdAt: stamp, updatedAt: stamp,
    deletedAt: null, archivedAt: null, order: number, ...overrides,
  };
  if (value.type !== 'text') delete value.content;
  return validateNote(value);
}

const vault = note(3, {
  type: 'vault', title: 'Cofre de teste', color: 'coral', labels: ['fictício'],
  blocks: [
    { id: id(31), kind: 'field', label: 'Host', value: 'fixture.example.invalid', secret: false },
    { id: id(32), kind: 'field', label: 'Senha', value: 'FICTITIOUS-VAULT-FIELD-15342', secret: true, primary: true },
    { id: id(33), kind: 'field', label: 'Chave de teste', value: 'FICTITIOUS-LINE-ONE\nFICTITIOUS-LINE-TWO', multiline: true },
    { id: id(34), kind: 'text', value: 'Observação fictícia' },
    { id: id(35), kind: 'divider' },
  ],
});
const notes = [
  note(1, {
    title: 'Café com anotações ☕', color: 'mint', labels: ['viagem', 'pessoal'],
    content: '# Plano fictício 🚀\n\n**Revisão** com acentos.\n<img src="https://example.invalid/image" onerror="alert(1)">',
  }),
  note(2, {
    type: 'todo', title: 'Lista de revisão', color: 'sage', labels: ['fictício'],
    tasks: [
      { id: id(21), text: 'Conferir versão', done: true, parentId: null, order: 0 },
      { id: id(22), text: 'Subtarefa com ação 📌', done: false, parentId: id(21), order: 1 },
      { id: id(23), text: 'Rodar a conferência', done: false, parentId: null, order: 2 },
    ],
  }),
  vault,
  note(4, { title: 'Nota na Lixeira', content: 'Conteúdo descartável', deletedAt: stamp + 1000 }),
  note(5, { title: 'Nota arquivada', content: 'Leitura de referência', archivedAt: stamp + 2000, pinned: true }),
];

const salt = generateSalt();
const key = await deriveKey(password, salt);
const records = [];
for (const value of notes) {
  const { iv, ciphertext } = await encrypt(key, JSON.stringify(value));
  records.push({ id: value.id, iv: arrayToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext), updatedAt: value.updatedAt });
}
const payload = makePayload(records, { lang: 'pt-BR', theme: 'dark' }, 1);
payload.exportedAt = new Date(stamp).toISOString();
const bytes = await encodeV2(key, salt, payload);
await writeFile(resolve(directory, 'profile2-golden.keeplocal'), bytes, { flag: 'wx' });
await writeFile(resolve(directory, 'profile2-golden.expected.json'), JSON.stringify(notes, null, 2) + '\n', { flag: 'wx' });
