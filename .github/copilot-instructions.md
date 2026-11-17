# KeepLocal working context

Vanilla ES modules, HTML/CSS, local Marked 18.2.1 and DOMPurify 3.4.18. No runtime
npm packages, bundler, CDN or data server. Chromium/Node test harness has no npm
dependencies. Browser tests use fictional data in disposable contexts only.

## Data and security

IndexedDB `KeepLocalDB` v1 has `notes` and `meta`. Note records are
`{id,iv,ciphertext,updatedAt}`; IV/ciphertext are Base64 AES-256-GCM values. Decrypted
notes are UUID `text|todo`, validated by `note-model.js`. Local outer IDs/timestamps
and meta are not secret. Metadata includes salt, encrypted `keyCheck`, `vaultId`,
preferences, `revision` (data changes), `dirtySinceBackup`, `lastBackupAt` (download
attempt), `exportRev` and `exportParent` (export lineage). `passwordVerifier` is
legacy-only and is deleted atomically after successful migration.

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
Legacy JSON v1 goes through complete schema/crypto/model validation, then one
`replaceVault` transaction. Bounds: 64 MiB file, 10000 notes, 2 MiB UTF-8 note.

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
- `recovery.js`: safe read-only recovery of preserved, invalid legacy data. V2
  archive encode/decode must preserve unreadable records; strict record/model
  validation belongs to import, within the whole-file bound.
- `trash.js`, `storage.js`: awaited retention and one persistence request per vault.
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
diff -r js chrome-extension/js
diff -r css chrome-extension/css
diff -r lib chrome-extension/lib
diff index.html chrome-extension/index.html
git diff --check
```

A browser SKIP is not acceptance. Build reads manifest version, synchronizes the
tracked copies and writes the matching ZIP. Include copied sources in the same
commit. Verify vendor SHA256SUMS in unit tests. No real vault, browser profile,
Mega account or synchronized data folder in tests.

Phases 3 (automatic synchronized-folder writing/merge) and 4 (password/key notes)
remain blocked until explicit owner authorization. Reserving encrypted export
`rev`/`parent` fields does not authorize either phase.
