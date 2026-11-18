# KeepLocal working context

Vanilla ES modules, HTML/CSS, local Marked 18.2.1 and DOMPurify 3.4.18. No runtime
npm packages, bundler, CDN or data server. Chromium/Node test harness has no npm
dependencies. Browser tests use fictional data in disposable contexts only.

## Data and security

IndexedDB `KeepLocalDB` v1 has `notes` and `meta`. Note records are
`{id,iv,ciphertext,updatedAt}`; IV/ciphertext are Base64 AES-256-GCM values. Decrypted
notes are UUID `text|todo|vault`, validated by `note-model.js`
(`vault` = `blocks` of text/field/divider, checked by `vault-model.js`). Local outer IDs/timestamps
and meta are not secret. Metadata includes salt, encrypted `keyCheck`, `vaultId`,
preferences, `revision` (data changes), `dirtySinceBackup`, `lastBackupAt` (download
attempt), `exportRev` and `exportParent` (export lineage). An existing salt without an encrypted
`keyCheck` is an unsupported old vault: fail clearly and preserve data until explicit reset.

Keys are nonextractable and memory-only (`session.js`). Reload requires a password;
5-minute deadline is checked on intervals, focus and visibility, with activity
throttled to 1 second. Never persist a key or password. A typed reset is explicit.
New passphrases require 14 characters, no composition rules, an embedded denylist and sequence/pattern checks; recommend 5+ randomly chosen words.

Backup v2 is raw `[salt16][iv12][ciphertext+tag]`, no plaintext magic/header.
Immutable profile 2: PBKDF2-HMAC-SHA-256 600000, AES-256-GCM, AAD
`[0x02] || salt || iv`. The encrypted UTF-8 JSON payload carries `v`, `profile`,
`rev`, `parent`, `exportedAt`, preferences, records and ordered count/ID manifest.
`parent` hashes the previous exact plaintext JSON bytes using SHA-256 hex.
Export lineage is recorded atomically; no merge or cloud writing is implemented.
README documents the recovery contract. Preserve profile 2 for future readers.
Only binary v2 imports are supported, with complete schema/crypto/model validation
before one `replaceVault` transaction. Unsupported formats preserve the vault. Bounds: 64 MiB file, 10000 notes, 2 MiB UTF-8 note.

## Modules

- `app.js`: integration/views; avoid broad refactors or further growth here.
- `auth.js`, `password-policy.js`, `account.js`: login, policy, atomic rotation/reset.
- `session.js`, `lifecycle.js`, `edit-session.js`, `editor-limits.js`: memory session, disposal,
  local edit references and serialized per-note writes/flushes.
- `db.js`: transaction primitives, vault replacement, identity/version guards,
  dirty state, export compare-and-swap and download acknowledgement.
- `backup-format.js`, `backup-v2.js`, `backup.js`: bounds/schema, binary crypto,
  file UI and pending state. Download initiation never confirms disk/cloud sync.
- `vault-events.js`: cross-tab notifications; DB guards remain the authority.
- `markdown.js`: escape raw HTML, omit images, restrict DOMPurify; fail closed.
- `recovery.js`: safe viewing and copying of preserved invalid data; typed discard requires a
  separate export, explicit saved-file confirmation and typed word. Session-only
  receipts fingerprint the whole vault; deletion rechecks every encrypted record
  and meta atomically (`recovery-actions.js`). V2
  archive encode/decode must preserve unreadable records; strict record/model
  validation belongs to import, within the whole-file bound.
- `note-write-queue.js`: resolve local intents inside the per-note queue, merge
  only editor-owned title/content/tasks (title/blocks for vault), retain local version ancestry and publish
  after persistence. Remote versions still conflict; DB guards are authoritative.
- `note-actions.js`: copy-first actions, atomic collective label/order changes,
  target-presence checks and publication before releasing the note locks.
- `record-health.js`: classify unreadable records before exports.
- `vault-model.js`: vault block validation and the single secrecy rule:
  `isSecretField = secret ?? (secretLabel || !publicLabel)`. Fields are born
  secret; only whole-word public labels are auto-public; only the lock button
  writes `secret`, and a manual choice wins. Also subtitle and public-only search.
- `vault-view.js`, `vault-editor.js`, `secret-ui.js`, `css/vault.css`: section
  list/grid, read-only detail, block editor through the note queue, reveal with
  auto-hide and copy with clipboard clearing (`dispose()` on teardown). Secrets
  never reach card/list/search/toast/console DOM, storage or meta. Vault items are
  excluded from note views, archive and the label manager; `meta.vaultLayout`
  stays local and is not exported.
- `trash.js`, `storage.js`: awaited retention and one persistence request per vault.
- `dialogs.js`, `form-ui.js`: themed promise dialogs, keyboard/focus and shared form presentation.
- `i18n.js`, `theme.js`, `history.js`, `icons.js`, `utils.js`: UI support.

All new app user strings go through `t()/tp()` with EN and pt-BR keys. Editor
fields disable spellcheck, capitalization and autocomplete. Preserve CSP. Extension
version stays 1.0.0 and `permissions: []`; extension copies are tracked.

## Git and gate

Use a task branch, never commit master, merge, push or rewrite history without
an explicit new instruction. Stage by explicit paths. `_temp` is owner-ignored.
One coherent task/group per commit, immediately after the complete gate:

```bash
node --test tests/unit
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
bash build-extension.sh
node tests/build/extension.mjs
diff -r js chrome-extension/js
diff -r css chrome-extension/css
diff -r lib chrome-extension/lib
diff index.html chrome-extension/index.html
git diff --check
```

For phase closing, run the browser command three consecutive times with no
individual failure retries. Controlled tests plus 5000 original and 40000 additional
fixed-seed schedules cover local and remote writes. Browser navigation awaits a load
event before querying the new execution context; stress evidence is outside Git.

A browser SKIP is not acceptance. Build reads manifest version, synchronizes the
tracked copies and writes the matching ZIP. Include copied sources in the same
commit. Verify vendor SHA256SUMS in unit tests. No real vault, browser profile,
Mega account or synchronized data folder in tests.

Phase 3 (automatic synchronized-folder writing/merge) remains blocked until explicit
owner authorization. Phase 4 core (Etapa D) is merged; Etapa E (templates, quick
copy/star, generator, section undo/timeout) waits for an owner request. Reserving
encrypted export `rev`/`parent` fields does not authorize Phase 3.
