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
attempt), `exportRev`, `exportParent`, `exportAncestors` and `exportClock` (export lineage) and
`tombstones` (deletion records). The extension vault folder adds `syncFolder` (directory
handle), `folderConnectionId`, `folderSyncedHash`, `folderSyncedClock`, `folderSyncedVersions`,
`folderSyncedBases` (up to 4 proven merge bases, newest first), `folderPendingWrite` (clock and
local-side versions of an unrecorded write), `writerId`/`writerCount` (this vault's folder
writer and reserved counter, never reused), `folderSyncedRevision`, `folderSeenRev`,
`folderWrittenAt` and `folderSaltClock` (folder clock when the vault passphrase last changed
through the folder; decides which passphrase wins), `folderHistoryDay`/`folderHistoryWeek`/`folderHistoryAt`
(history slots last written) and `photoFolder`/`photoNames`/`photoWrittenAt`/`photoWrittenDay`
(photos folder handle, its seven names and the last photo write; they belong to the folder
connection: kept across folder-driven replacements of the same connection, cleared by import,
reset, changing or disconnecting the folder and "Disconnect photos"); none of it is exported. Local-only vault preferences
(`vaultLayout`, `vaultLockMinutes`) are never exported. An existing salt without an encrypted
`keyCheck` is an unsupported old vault: fail clearly and preserve data until explicit reset.

Keys are nonextractable and memory-only (`session.js`). Reload requires a password;
5-minute deadline is checked on intervals, focus and visibility, with activity
throttled to 1 second. While the vault section or a vault item is open, the local
`vaultLockMinutes` preference (1 or 2) shortens it through `setIdleTimeout`, which never
moves the last activity. Never persist a key or password. A typed reset is explicit.
New passphrases require 14 characters, no composition rules, an embedded denylist and sequence/pattern checks; recommend 5+ randomly chosen words.

Backup v2 is raw `[salt16][iv12][ciphertext+tag]`, no plaintext magic/header.
Immutable profile 2: PBKDF2-HMAC-SHA-256 600000, AES-256-GCM, AAD
`[0x02] || salt || iv`. The encrypted UTF-8 JSON payload carries `v`, `profile`,
`rev`, `parent`, `exportedAt`, preferences, records and ordered count/ID manifest, plus
three optional fields older readers ignore: `tombstones` (deletion records, at most 10000,
kept 1 year), `ancestors` (up to 32 previous hashes) and `clock` (`{writerUUID: n}`, at most
64 entries, safe integers ≥ 1; absent means `{}`). `parent` hashes the previous exact
plaintext JSON bytes using SHA-256 hex. Export lineage is recorded atomically and shared by
manual exports (which carry the clock without incrementing) and vault-folder writes.
README documents the recovery contract. Preserve profile 2 for future readers.
Only binary v2 imports are supported, with complete schema/crypto/model validation
before one `replaceVault` transaction. Unsupported formats preserve the vault. Bounds: 64 MiB file, 10000 notes, 2 MiB UTF-8 note.
A JPEG/PNG photo carrying an appended copy (`[image][exact main bytes][uint32 LE length]`,
`photo-trailer.js`) imports that copy; a raw v2 file is still accepted.

## Modules

- `app.js`: integration/views; avoid broad refactors or further growth here.
- `auth.js`, `password-policy.js`, `account.js`: login, policy, atomic rotation/reset.
- `session.js`, `lifecycle.js`, `edit-session.js`, `editor-limits.js`: memory session, disposal,
  local edit references and serialized per-note writes/flushes.
- `db.js`: transaction primitives, vault replacement, identity/version guards,
  dirty state, export compare-and-swap and download acknowledgement.
- `backup-format.js`, `backup-v2.js`, `backup.js`: bounds/schema, binary crypto,
  file UI and pending state. Download initiation never confirms disk/cloud sync.
- `import-ui.js`: backup import form shared by sign-in and Settings (accepts `.keeplocal` and
  photos with an appended copy). With a connected folder
  (Settings only), the import runs in the lineage lock, preserves the current local vault in
  `keeplocal-preserved/` first (unreadable records kept as-is; a failure imports nothing),
  replaces under the reread snapshot guard and leaves the folder disconnected; choosing the
  folder again leads to the review.
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
- `vault-templates.js`, `password-generator.js`, `vault-generator.js`, `vault-history.js`:
  translated item templates that never write `secret`; primary field per secrecy
  class (`principalField`/`toggleVaultPrimary` in `vault-model.js`) with card quick
  copy (label only in the DOM); generator (default 24, 8–128, rejection sampling,
  Fisher–Yates, options kept per session in memory); 50-step in-memory undo/redo
  applied through the note queue and cleared on close, lock or item switch.
- Vault folder, **extension only** (`chrome-extension://`; the HTTP SPA keeps manual
  backup and shows no folder UI; fixed ID via manifest `key`):
  - `folder-store.js`: support, picker, handle in meta, permission (first call of
    the sign-in click, before PBKDF2), availability by a real listing, error
    classification (`notFound|denied|unresponsive|error:*`), CAS connection.
  - `folder-timeout.js`: read deadlines (15 s metadata, 60 s per file); a
    `TimeoutError` maps to `unresponsive` (also in action notices). Writes are not wrapped.
  - `folder-vault.js`: root `*.keeplocal` candidates (max 32, 64 MiB each),
    same-salt decode with the session key (`decodeV2WithKey`) and, when given, a second
    key for another salt; each candidate records its salt (other-salt copies also a bytes
    hash). Head = highest encrypted `rev`, divergence and unreadable/other-salt copies.
  - `folder-write.js`: profile 2 snapshot of `keeplocal-vault.keeplocal`, readback
    verification and the `keeplocal-vault-lineage` Web Lock.
  - `folder-reconcile.js`, `folder-review.js`: decision
    (push/pull/adopt/merge/conflict/rollback/otherSalt/unreadableCopy) and the typed
    review (remote/local/merge). First connection: 0 local records pull, identical
    record set adopts, anything else is a conflict. A direct pull needs a clean local
    vault and a head that descends from the last synced state.
  - `folder-merge.js`, `folder-clock.js`: per-note three-way merge. A base is
    proven by hash lineage (`parent`/`ancestors`) or a nonempty dominated `clock`;
    order: pending write → stored bases → synced state → none. Without proof the
    newer version keeps the id and the other becomes a conflict copy (preserved
    first). A note is deleted only by a tombstone not older than its edit. The
    writer counter is reserved in a guarded transaction inside the lineage lock before
    the file is opened; a clock over 64 entries drops other writers (smallest count,
    then id), never its own. Explicit remote/local choices reset the base list.
  - `folder-preserve.js`: before any replacement, the losing side goes to
    `keeplocal-preserved/` (exact bytes or encrypted local snapshot), read back and
    verified; failure replaces nothing. Never cleaned; reads stay root-only. Within one
    reconciliation the same bytes are preserved once (reuse rereads and verifies).
  - `folder-history.js`, `folder-history-write.js`: rotating history in `keeplocal-history/`
    (7 daily `keeplocal-day-<n>-<weekday>` and 4 weekly `keeplocal-week-<n>` slots from the local
    day of the encrypted `exportedAt`). After a normal write's receipt (never on replace), the first
    write of a day or week copies the exact main bytes into its slot inside the lineage lock: a slot
    already from that period is kept, a slot with a higher `rev` is preserved first, the copy is
    read back and hash-verified, and any failure is swallowed without touching the main file. The
    app never reads or cleans the history; `keeplocal-history`/`keeplocal-preserved` are refused as
    vault or copy folders (`isFolderCopyDirectory`).
  - Photos (`photo-trailer.js`, `photo-folder.js`, `photo-settings.js`, `photo-write.js`):
    `[image][exact main bytes][uint32 LE length]` appended to one of seven dedicated JPEG/PNG
    copies. The image is found by signature and end marker (image at most 32 MiB, copy at most
    64 MiB); an unrecognized end is never written. Settings → Photos picks a separate folder
    (own picker id `keeplocal-photos`; never the vault folder or a reserved name) holding exactly
    seven valid images; default string order maps them to Monday..Sunday and the confirmation
    lists each name with its weekday. After a normal main write, inside the lineage lock, today's
    photo is rewritten at most once per hour or on a new local day: exclusive writable, observed
    bytes rechecked, an old copy with a higher `rev` or one the key cannot open preserved first in
    the vault folder's `keeplocal-preserved/`, SHA-256 readback and a guarded receipt. Failures are
    swallowed (status in memory only) and never touch the main file. The app never creates,
    renames or deletes a photo and never loads a vault from a photo by itself.
  - **Write now** (sidebar, below **Backup**; `writeNow` in `folder-sync.js`): the photo
    `requestPermission` comes first in the click, then drafts are flushed, the folder sync runs in
    the lineage lock, the main file is verified and today's photo is forced; a toast reports the
    result. **Backup** still only exports.
  - Other passphrase in the folder (password changed on another PC):
    `folder-salt.js` converts records/copies between keys and picks the target with
    `folderSaltTarget` (no `folderSaltClock` → folder; otherwise the head's descent from
    it decides folder/local); `folder-salt-access.js`, `folder-salt-ui.js` run the
    reconciliation with an `access` object threaded through merge, review, writer and
    apply. `folder-password-change.js`: rotation with a connected folder runs under the
    lineage lock, needs a settled folder, preserves the old main, writes and verifies
    the folder first (restoring the original on a failed readback), then replaces the
    local vault. `folder-login.js`: a failed sign-in tries the folder main (one extra
    PBKDF2) and loads it directly only with proof (receipt, clean local, same versions,
    no local-salt copy, descent from the synced state); otherwise it asks for the old
    local passphrase or offers a read-only view. `folder-other-salt.js`: folder
    passphrase dialog and "use this browser" (typed word, exact-bytes preservation).
    `folder-salt-connect.js`: re-choosing the same connected folder keeps the receipt
    and lets the lineage decide; another folder is a first connection.
  - `folder-copy-view.js`: read-only view of a copy from any folder (own picker id,
    keys per salt in memory only, `startReadOnlySession`, export disabled, cross-tab
    events ignored, 0 writes); returning, locking or expiry discards it.
  - `folder-sync.js`, `folder-status.js`, `folder-ui.js`, `css/folder.css`:
    scheduling, status text (never "synced"/"cloud"), blocking screen, read-only
    banner and settings. Read-only mode is enforced in `db.js` (0 writes).
- `recovery/keeplocal-recovery.html`, `recovery/LEIA-ME.txt`: standalone offline reader of
  the documented profile 2 contract (imports nothing from `js/`; hash-based CSP; works
  from `file://`; no network, storage, download or data-derived HTML; every vault field
  value masked with one-at-a-time reveal/copy; newer note formats shown without raw
  content; also opens the copy appended to a photo) and the bilingual emergency kit guide. Keep its colors and model checks in
  step with `note-model.js`. `tests/fixtures/profile2-golden.keeplocal` is a frozen
  profile 2 export with a pinned SHA-256; never regenerate it.
- `trash.js`, `storage.js`: awaited retention and one persistence request per vault.
- `dialogs.js`, `form-ui.js`: themed promise dialogs (confirm, typed word, choices), keyboard/focus and shared form presentation.
- `i18n.js`, `theme.js`, `history.js`, `icons.js`, `utils.js`: UI support.

All new app user strings go through `t()/tp()` with EN and pt-BR keys. Editor
fields disable spellcheck, capitalization and autocomplete. Preserve CSP. Extension
version stays 1.0.0 and `permissions: []`; extension copies are tracked.

## Git and gate

Use a task branch, never commit master, merge, push or rewrite history without
an explicit new instruction. Stage by explicit paths. `_temp` is owner-ignored.
One coherent task/group per commit, immediately after the complete gate.
The machine is shared: tests, gate, probes and builds use at most 4 CPUs. Prefix them
with `taskset -c 0-3 nice -n 10` (child Chromium processes inherit the affinity) and
pass `--test-concurrency=4` to `node --test`. A failure seen only under this limit is
a timing bug, not a reason to lift it.

```bash
taskset -c 0-3 nice -n 10 node --test --test-concurrency=4 tests/unit
CHROME_BIN=/path/to/chromium taskset -c 0-3 nice -n 10 node tests/browser/run.mjs
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
tracked copies and writes the matching ZIP, then places the recovery reader,
`LEIA-ME.txt` and `SHA256SUMS` next to it in `dist/` (never inside the ZIP). Include copied sources in the same
commit. Verify vendor SHA256SUMS in unit tests. No real vault, browser profile,
Mega account or synchronized data folder in tests. The runner also loads the real
unpacked MV3 extension in a fresh profile; folder tests use OPFS directories and
CDP-installed picker/permission substitutes.

Phase 3 Etapas F–G3 (extension vault folder) are merged. Etapa H follows the owner's
roadmap, one package per owner request (small or same-area items may share a package): H1 (standalone recovery tool and
emergency kit, merged), H2a (per-note merge, tombstones and writer clocks, merged),
H2b (password changed on another PC / other-salt folders, other folder as read-only
recovery, merged), H2c (rotating history copies, package P1, merged), H3 (vault copies in seven
dedicated photos and Write now, package P2, merged). Package P3 (small details) remains before the
final review. Phase 4 Etapas D (core) and
E (templates, primary fields and quick copy, generator, editor undo, section lock)
are merged.
