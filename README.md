# KeepLocal — Secure Offline Notes

[Português](README.pt-BR.md)

Encrypted notes and task lists stored locally in the browser. No data server,
cloud account, analytics or runtime package installation. Exporting a backup and
opening external links are explicit user actions.

![KeepLocal as a Chrome extension](assets/KeepLocal.jpg)

## Features

Safe Markdown preview, tasks with one subtask level, colors, labels, search,
pinning, archive, 7-day Trash, duplication and undo/redo. New notes appear first;
dragging moves and normalizes their order. Empty lists stay transient until they
contain text. Choose color/labels after creation in the card/editor; the inactive
draft buttons were removed.

## Security

| Aspect | Implementation |
|---|---|
| Key | PBKDF2-HMAC-SHA-256, 600000 iterations, random 16-byte salt |
| Cipher | AES-256-GCM, random 12-byte IV and 16-byte authentication tag |
| Password check | Encrypted known block (`keyCheck`); no fast verifier in new/migrated vaults |
| Session | Nonextractable key only in memory; reload requires password; lock after 5 idle minutes |
| New password | At least 14 characters, no composition rules; short common-password denylist; prefer a long random phrase |
| Disk | Encrypted notes in IndexedDB; local preferences and metadata (salt, outer IDs, timestamps, backup state) are not secret |
| Backup | Authenticated binary v2 envelope; legacy JSON v1 only through validated atomic import |
| Markdown | Raw HTML becomes text, images are removed, restrictive DOMPurify and CSP; missing libraries fall back to plain text |
| Tabs | Vault identity and record version checked atomically; conflicts offer saving as a new note |
| Recovery | No password recovery; reset requires typed confirmation and erases everything |

App code can access plaintext while unlocked. Anyone who can alter its scripts
can capture the password and notes. **Serve code separately from the data/backup
folder and protect it against writes by others.** Avoid writable shared folders
for scripts. Protect the browser profile and operating system as well. Browser
storage persistence is requested once and may be denied; it does not replace an
external backup.

## Run

No npm, bundler or app package installation. From a directory containing code only:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080`. Keep the same origin and port for the same IndexedDB.
The server requires Python 3; Web Crypto requires a secure context (localhost or
HTTPS). This execution validated Chromium; other browsers were not validated.
The extension requires Chrome 120+.

## Backup and migration

1. Before upgrading, export using the old version and keep a copy outside the app
   and synchronized folder. Never overwrite your only recovery copy.
2. Log into the new version: it atomically migrates the legacy verifier. Existing
   account passwords still work; the new policy applies to creation and rotation.
3. Use **Change master password**, entering the current password and a new long
   random passphrase.
4. Click **Backup** to start a `.keeplocal` download. Verify the saved file:
   the app cannot confirm the browser wrote it. `lastBackupAt` means a download
   attempt, and the pending warning tracks changes since that attempt.
5. Store the export in a separate data folder synchronized by your chosen service.
   **KeepLocal does not write automatically to Mega or synchronize files** in this
   phase. Merge and automatic file writing belong to blocked Phase 3.
6. Remove old backups including cloud version history: they still use the old
   password, and v1 may include the fast verifier. Verify the new backup before
   deleting copies needed for recovery.

Import accepts binary v2 or JSON v1, asks for the file password, validates every
record, confirms the replacement counts and commits in one transaction. Cancel,
wrong password, invalid data and write failure preserve the previous vault.
Unreadable local records stay stored, produce a warning and remain in exports;
recover them before expecting a complete reimport of that backup.

## Extension and tests

```bash
bash build-extension.sh
node --test tests/unit
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
```

The build reads the manifest version (currently 1.0.0), synchronizes tracked copies
and creates `dist/keep_local_extension_v1.0.0.zip`. Manual test: open
`chrome://extensions` → Developer mode → Load unpacked → `chrome-extension/`.
The manifest keeps `permissions: []`. [Test instructions](tests/README.md).
The runner uses disposable profiles and fictional data only; a missing-Chromium
`SKIP` does not establish browser acceptance.

## Files

- `index.html`, `css/`: entry point, CSP and styles (tokens in `css/base.css`).
- `js/app.js`: screens and integration; `auth.js`, `session.js`, `lifecycle.js`:
  authentication, in-memory session and callback disposal.
- `js/crypto.js`, `db.js`, `note-model.js`, `edit-session.js`, `editor-limits.js`, `recovery.js`: crypto, transactions,
  validation and serialized writes/drafts.
- `js/backup.js`, `backup-format.js`, `backup-v2.js`: import, download and format.
- `js/account.js`, `vault-events.js`, `trash.js`, `storage.js`: rotation/reset,
  cross-tab events, retention and persistence.
- `js/i18n.js`, `theme.js`, `history.js`, `icons.js`, `utils.js`: UI helpers.
- `lib/`: local libraries, hashes and provenance.
- `chrome-extension/`: manifest, worker, privacy, icons, locales and tracked copies
  of `js/`, `css/`, `lib/`, `index.html` synchronized by the build.
- `tests/unit/`, `tests/browser/`, `tests/fixtures/`: gate without npm dependencies.

## Binary backup format and recovery

New exports use `.keeplocal`, MIME `application/octet-stream`, without magic,
plaintext app/version identifiers, JSON headers or KDF parameters:

| Byte offset | Length | Meaning |
|---|---|---|
| 0 | 16 | Raw PBKDF2 salt (the vault salt) |
| 16 | 12 | Random AES-GCM nonce |
| 28 | remainder, at least 16 | Ciphertext followed by the 16-byte GCM tag |

Recovery tools must try the immutable profiles in `js/backup-v2.js` in order.
Currently there is exactly one: **profile 2**, PBKDF2-HMAC-SHA-256, **600000**
iterations, UTF-8 password without normalization, AES-256-GCM, 128-bit tag.
Derive the key from the password and bytes `[0,16)`. The authenticated additional
data is exactly **29 bytes**: `[0x02] || salt[16] || iv[12]`. Decrypt bytes `[28,end)`
with nonce `[16,28)`. Decode the authenticated plaintext as UTF-8 JSON.
The payload contains `v:2`, `profile:2`, `rev`, ISO `exportedAt`, `preferences`
(`lang`, `theme`), `notes`, and `manifest:{count,ids}`. `ids` must equal note IDs
in their exact array order. Notes are the original encrypted IndexedDB records
`{id,iv,ciphertext,updatedAt}` (Base64 inner IV/ciphertext); decrypt each using the
same derived key and validate the note and its matching ID/timestamp. Keeping
inner records also preserves unreadable local records in an export; such a
backup requires recovery of those records before a complete import can succeed.
No plaintext record identifiers, timestamps, counts or per-note lengths are in
the outer envelope. Total ciphertext length and the salt remain observable;
exports from the same vault share a salt. A file is limited to 64 MiB, 10,000
notes and 2 MiB per serialized UTF-8 note for editing/import. Profiles must enforce 600000–5000000
iterations **before** deriving; file bytes never select an arbitrary KDF cost.
Future profiles must preserve profile 2 and append a documented recovery path.

Legacy v1 JSON is still imported after complete validation and atomic replacement.
V1 cannot detect removal of a whole record. V2 authenticates the complete payload
and checks its manifest. Replacing an export with an older *valid* export remains
possible (rollback); revision/merge handling belongs to the blocked Phase 3.

`rev` is a safe integer persisted as `meta.exportRev` and incremented on every
export (first export: 1). `parent` is `null` for the first export, otherwise the
lowercase hexadecimal SHA-256 of the **exact UTF-8 JSON plaintext bytes** of the
previous export, before encryption (not the envelope, not the ciphertext).
`meta.exportParent` stores the current export's plaintext hash for the next one.
The counter and parent are committed together, with a compare-and-swap that
rejects concurrent export tips. A v2 import resumes its counter and records the
imported payload's exact hash as the next parent. These fields reserve lineage
only; they perform no merge, cloud write, rollback protection or synchronization.

Local libraries: Marked **18.2.1** (browser UMD bundle) and DOMPurify **3.4.18**.
Versions, upstream release review and download integrity are recorded in
[`lib/VENDOR.md`](lib/VENDOR.md); `lib/SHA256SUMS` is verified by the unit gate.

## License

[MIT](LICENSE)

## Unreadable and legacy records

The persistent warning opens **Read-only recovery**. It distinguishes failed
decryption from invalid JSON, incompatible models/field limits and over-limit
legacy notes. Decryptable text is displayed safely as read-only data; nothing is
rewritten or deleted. Locking clears the recovery view. Editing/import limits are
4096 title characters, 65536 task-text characters, 200 label characters, 100
labels and 10000 tasks per note, plus the 2 MiB serialized UTF-8 note limit.
Existing encrypted records that violate those limits or have damaged IVs/data
still go unchanged into v2 archives, within the 64 MiB file/10000-record bound.
Envelope decoding preserves such records for recovery tools; **import** still
validates every record strictly and rejects the complete import without mutation.
Repair legacy data before full reimport or password rotation. Automatic locks
clear unsaved plaintext; a failed manual lock offers cancel or explicit discard.
An export in flight is cancelled when its session ends or changes.
