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
| Password check | Encrypted known block (`keyCheck`); no fast password verifier |
| Session | Nonextractable key only in memory; reload requires password; lock after 5 idle minutes |
| New password | At least 14 characters, no composition rules; embedded common-password list and sequence/pattern checks; prefer 5+ randomly chosen words |
| Disk | Encrypted notes in IndexedDB; local preferences and metadata (salt, outer IDs, timestamps, backup state) are not secret |
| Backup | Authenticated binary v2 envelope; unsupported formats leave the vault unchanged |
| Markdown | Raw HTML becomes text, images are removed, restrictive DOMPurify and CSP; missing libraries fall back to plain text |
| Tabs | Vault identity and record version checked atomically; conflicts offer saving as a new note |
| Recovery | Unreadable records can be copied when decryptable or discarded after typed confirmation and a required export; no password recovery |

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

## Backup and reset

1. Create a vault with a long random passphrase. Keep it safe: encrypted notes
   cannot be recovered without it.
2. **Change master passphrase** requires the current passphrase and rotates all
   readable records atomically. Previous backups still use the previous passphrase.
3. **Backup** starts a `.keeplocal` download. Verify the saved file: the app cannot
   confirm disk writes. `lastBackupAt` records a download attempt; the pending
   warning tracks changes since that attempt.
4. Store exports separately from app code. The extension can also write an
   encrypted copy to a chosen folder ([Vault folder](#vault-folder-extension-only));
   the HTTP app has manual backup only. KeepLocal cannot see Mega or any cloud
   service and never reports a cloud sync.

Import accepts **binary v2 only**, asks for its passphrase, validates every record,
confirms replacement counts and commits in one transaction. Cancellation, wrong
passphrase, unsupported format, invalid data and write failure preserve the vault.
Old vaults without an encrypted key check are unsupported and remain unchanged;
**Erase everything and start again** requires the exact typed word and erases only
by explicit choice. No automatic migration or erasure occurs.

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
The manifest keeps `permissions: []`.

Extension ID `dplgmdpgehkbgphaimafofojbjhlkphm`.
Loading the unpacked extension from any folder keeps the same ID, origin and
IndexedDB data. An older installation without the manifest key has a separate
origin with its own IndexedDB. For the current test installation, remove the old
instance and load `chrome-extension/` again. [Test instructions](tests/README.md).
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
- `js/vault-model.js`, `js/vault-view.js`, `js/vault-editor.js`, `js/secret-ui.js`,
  `css/vault.css`: Passwords and Keys models, lists, editor, secret controls and styles.
- `js/vault-templates.js`: templates and translated block creation.
- `js/password-generator.js`, `js/vault-generator.js`: password generation and editor controls.
- `js/vault-history.js`: in-memory undo and redo for vault drafts.
- `js/folder-*.js`, `css/folder.css`: extension vault folder (handle and
  permission, read deadlines, candidates, write/verify, reconciliation,
  preservation, status and screens).
- `lib/`: local libraries, hashes and provenance.
- `chrome-extension/`: manifest, worker, privacy, icons, locales and tracked copies
  of `js/`, `css/`, `lib/`, `index.html` synchronized by the build.
- `tests/unit/`, `tests/browser/`: gate without npm dependencies.

## Binary backup format and recovery

The standalone recovery reader implements this contract independently. Open
the HTML file directly in Chrome or Edge to read a backup offline.
[Open the recovery reader](recovery/keeplocal-recovery.html).

The reader displays unrecognized color names as plain text and ignores extra
properties on notes, tasks and vault blocks. For an unrecognized note type it
shows the title and a newer-format warning. For an unrecognized vault block it
shows only the warning in place of the block. Known vault fields stay masked
until explicitly revealed. Records with invalid field types are reported as
unreadable. The app applies strict validation when importing a backup.

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
in their exact array order. The optional encrypted `tombstones` array contains
up to 10,000 permanent deletion markers `{id,deletedAt}`, with a UUID and a
nonnegative safe integer timestamp in milliseconds. An absent array means no
markers. Recovery tools can ignore this field when listing live records. Notes are the original encrypted IndexedDB records
`{id,iv,ciphertext,updatedAt}` (Base64 inner IV/ciphertext); decrypt each using the
same derived key and no additional authenticated data. Validate each note
and its matching ID/timestamp. Keeping
inner records also preserves unreadable local records in an export; such a
backup requires recovery of those records before a complete import can succeed.
Export asks for confirmation when unreadable records exist and reports a partial
recovery archive, rather than a fully restorable backup. Recovery can create a valid
text note containing decrypted raw content; oversized content stays read-only for
manual copying. Discard has two steps: Export now preserves the record without deleting it;
then verify the saved file, check the explicit saved-file confirmation and type
DISCARD. The app cannot confirm disk writes. The receipt is session-only, and any
change to the vault snapshot requires another export. The complete snapshot is
checked again atomically before deletion, including unrelated records.
After every unreadable record has been resolved, full import and password rotation
work again. Password strength labels are heuristics, not measured entropy.
No plaintext record identifiers, timestamps, counts or per-note lengths are in
the outer envelope. Total ciphertext length and the salt remain observable;
exports from the same vault share a salt. A file is limited to 64 MiB, 10,000
notes and 2 MiB per serialized UTF-8 note for editing/import. Profiles must enforce 600000–5000000
iterations **before** deriving; file bytes never select an arbitrary KDF cost.
Future profiles must preserve profile 2 and append a documented recovery path.

Only binary v2 is supported. V2 authenticates the complete payload and checks its
manifest. Recognizable JSON documents are rejected without interpreting an older
schema. Without plaintext magic, an unauthenticated binary file cannot be reliably
distinguished from a wrong passphrase or damaged v2 file; the error names these
possibilities and preserves the vault. Manually importing an older *valid* export remains
possible (rollback); only the extension's vault folder compares revisions.

`rev` is a safe integer persisted as `meta.exportRev` and incremented on every
export (first export: 1). `parent` is `null` for the first export, otherwise the
lowercase hexadecimal SHA-256 of the **exact UTF-8 JSON plaintext bytes** of the
previous export, before encryption (not the envelope, not the ciphertext).
`meta.exportParent` stores the current export's plaintext hash for the next one.
The optional encrypted `ancestors` array stores up to 32 lowercase, 64-character
hexadecimal hashes of previous payloads, newest first. A new payload prepends its
non-null `parent` to that parent's list and keeps the first 32 hashes. An absent
list is empty. Recovery tools can ignore it when listing live records.
The counter, parent and `meta.exportAncestors` are committed together, with a
compare-and-swap that rejects concurrent export tips. A v2 import resumes its counter
and records the imported payload's exact hash and ancestor list. Manual exports and vault-folder
writes share this lineage, so gaps in `rev` are normal. Manual import performs no
merge or rollback protection.

## Emergency kit

Keep an **encrypted USB drive** (BitLocker To Go or VeraCrypt) with these files:

- Your latest `.keeplocal` copies, including the vault folder file and manual backups.
- The extension ZIP for the version in use.
- `keeplocal-recovery.html`, `LEIA-ME.txt` and `SHA256SUMS` from `dist/`.

Keep the master passphrase separately from the drive. Update the kit after
important changes and test a backup with the reader periodically, for example
every three months. Compare each distribution file with `SHA256SUMS` using
`certutil -hashfile <file> SHA256` on Windows or run
`sha256sum -c SHA256SUMS` from the kit directory on Linux.

Open the HTML directly in Chrome or Edge to view notes and reveal or copy one
field at a time. The reader leaves your backup file intact. The guide covers
reinstalling KeepLocal and importing a backup. [Bilingual guide](recovery/LEIA-ME.txt).

## Passwords & Keys

- **New item** offers a blank item and templates for servers, databases, API keys,
  SSH, web logins and Cloudflare R2 / S3. Template labels use the current language.
  Add content or edit the labels before saving an item.
- Use the editor's stars to pick one primary field for each class, public or
  secret. Cards use the primary public value as their subtitle and offer quick
  copy for each class. KeepLocal attempts to clear the clipboard after 20 seconds.
  Clipboard history and cross-device sync may retain copied values.
- **Generate** in a secret field offers 24 characters by default, adjustable
  from 8 to 128. Select character classes and optionally exclude similar
  characters. Replacing a populated field requires confirmation.
- The editor supports 50 in-memory undo steps. Use the buttons or Ctrl/Cmd+Z
  and Ctrl/Cmd+Shift+Z where the cursor is outside a text field. Text fields use
  browser undo. Closing the editor or locking clears the history.
- **Section lock** can use the five-minute default, two minutes or one minute
  of inactivity while this section or a vault item is open. The preference
  stays on this browser and the five-minute default applies elsewhere.

## Vault folder (extension only)

Only the extension (`chrome-extension://`) offers a vault folder; the HTTP app
shows no folder option. **Settings → Vault folder → Choose folder…** stores a
directory handle in local metadata; only the folder name is shown. In Chrome,
choose **Allow on every visit** to keep access between sessions. The passphrase
is still required at every opening.

- **File:** `keeplocal-vault.keeplocal` in the folder root, byte-for-byte the
  binary v2 profile 2 format above. After a change (about 1.5 s later, and on
  focus, visibility change and page hide) the app writes a new revision, reads
  it back and verifies it. "Written to folder at HH:MM" means a local file write
  only. A folder write does not count as a manual backup.
- **Sign in:** the folder permission request is the first action of the click.
  Availability is decided by listing the folder. Every root `*.keeplocal`
  (at most 32, 64 MiB each; Mega conflict copies included) is authenticated with
  the session key when it shares the vault salt. The head is the highest
  encrypted `rev`, never a file date. Other files are ignored.
- **Decision:** a browser with no local changes loads a newer file directly
  when its encrypted parent matches the last known shared file. After the
  first shared snapshot, divergent changes and tied heads are compared one
  note at a time on sign-in and focus. Reviews are still required for older
  revisions, a first connection with different data and an incompatible or
  unreadable main copy. An empty local vault without deletion markers loads the
  folder on first connection. An identical set is adopted without writing.
- **Merging:** edits to different notes can be combined. When the same note
  has competing content edits, the newer version keeps its ID and the other
  becomes a conflict copy with its edit time in UTC. A notice reports the
  counts. The folder and local originals are verified in `keeplocal-preserved/`
  before replacement. Only the highest encrypted revision and other copies
  at that revision take part.
- **Permanent deletions:** encrypted backups carry deletion markers for up to
  365 days and at most 10,000 entries. An unchanged note can be removed on
  the other computer. A later edit can keep it, with a notice on the editing
  computer.
- **Review:** Merge both preserves the two sources before combining them.
  Choosing either source is still available. Every replacement choice
  requires typing REPLACE. Preserved files open with normal Import. The app
  leaves those files in place and scans only the folder root. Folder writes
  require zero unreadable local records.
- **Unavailable folder:** a blocking screen offers Try again, Choose another
  folder, Open read only, Start over… and Sign out. Read only is enforced in the
  data layer (no writes or merging). Folder reads have deadlines (15 s for metadata, 60 s
  per file): a folder that does not answer leads to "The folder did not
  respond" instead of a stuck sign-in. If it persists, select the same folder
  again, or use Settings → Disconnect folder → Choose folder. Writes have no
  deadline.
- **Disconnect and reset:** disconnecting keeps the folder contents. Reset on the
  sign-in screen or Start over… erases the local vault and its folder link, never
  the folder copy. Import on the sign-in screen is refused while a folder is
  connected.

Planned next are support for folders written with another passphrase and
opening another folder for recovery, followed by rotating copies.

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

## Editor persistence scope

Metadata actions on text and todo notes use copies and publish only after a
successful write. Task edits use an editor draft: a failed save keeps pending
changes for retry when closing; they do not have the same no-divergence guarantee
as metadata actions. Review the failure message and retry before discarding a draft.
Password pattern checks are heuristics: combinations such as Dallas2024Cowboys!
and Summer2024!Summer2024! may still meet the minimum. Use 5–6 randomly selected
words; the indicator cannot establish that a phrase was randomly generated.
