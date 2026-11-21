# Tests

No npm packages are required. Node 24 (native WebSocket and Web Crypto) and Chromium are used.

```
node --test tests/unit
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
bash build-extension.sh
node tests/build/extension.mjs
```

On the shared development machine, run every command with at most 4 CPUs:
`taskset -c 0-3 nice -n 10 node --test --test-concurrency=4 tests/unit` and
`CHROME_BIN=… taskset -c 0-3 nice -n 10 node tests/browser/run.mjs`. Child Chromium
processes inherit the CPU affinity. A failure that appears only under this limit is a
timing bug.

The browser runner binds only to 127.0.0.1 and creates disposable contexts/profiles
with fictitious data. Missing Chromium is SKIP and does not satisfy acceptance.
Fixtures are fabricated v2 exports using the current immutable profile; no old
source checkout or archived database is required. Imports are limited to 64 MiB,
10000 notes and 2 MiB per serialized UTF-8 note. Every record must authenticate and
match its outer ID/timestamp before atomic replacement. Unsupported old vaults and
non-v2 files fail clearly without changing stored data; reset remains explicit.

Phase 2b adds unreadable-record recovery/discard, cancelled and failed exports,
concurrent record protection, password rotation and own-backup restoration;
17 card/modal action failure cases and second-write rollback for collective labels
and ordering; and a pure password-policy table.
The archive assertion runs after build and keeps vendor support files out of the
ZIP while library SHA-256 verification still runs against tracked source files.
The independent reviewer probes and real unpacked-extension/UI compatibility
scripts are preserved under the owner's ignored `_temp/` folder.

## Extension folder verification

The browser runner also loads the real unpacked MV3 extension in a fresh
Chromium profile using the ID documented in the README. Synchronize the tracked
extension copies with `bash build-extension.sh` before running new browser tests
against a runtime change. The final gate repeats the complete HTTP and extension
runner three consecutive times.

The extension fixtures install the picker substitute and permission, PBKDF2 and
IndexedDB spies via CDP. They use the origin-private file system with fictitious
directories. The tests exercise profile 2 writes and readback, limits, retries, two-profile
reconciliation and confirmed local reset. Two Chromium profiles use separate
OPFS directories; the test helper copies only the .keeplocal files between them.
Read-only checks count both file writes and IndexedDB readwrite transactions.
The Windows Chrome chooser and persistent grant are covered by the owner's
manual procedure.

The conflict checks verify the same typed confirmation with or without the
optional manual export. They check the exact copies in the preservation
subdirectory, import those copies in disposable profiles, and cover preservation
failure, filename collisions, tied revisions, first connection and empty files.
The original review probes enumerate the root. Check the preservation
subdirectory separately when verifying which records survived a choice.

The first-connection checks include both an empty imported vault that pulls
and an equivalent populated vault that adopts the folder head without writing
a file. Separate regressions exercise recovery of an empty main file with an
older side copy and verify that preservation cleanup removes only the failed
attempt. The cleanup tests exercise directory denial, blocked writers, byte
corruption, denied removal and an identity mismatch. The tied review is
measured at 1100 and 390 px in both themes.

Folder recovery tests in the unpacked extension stall the permission query,
directory listing, identity comparison and candidate reads. The scenarios
check passphrase validation, read-only access without writes, export after the
folder lock is released, late completion, and selection of the same folder
from recovery or settings. Instrumentation and shorter read deadlines are
installed with CDP before scripts run in a disposable profile. Production
read deadlines are 15 seconds for metadata and 60 seconds per candidate file.
Writes and the native permission prompt use their ordinary completion path.

On the shared machine, use these commands for the folder gate:

```bash
taskset -c 0-3 nice -n 10 node --test --test-concurrency=4 tests/unit
CHROME_BIN=/path/to/chromium taskset -c 0-3 nice -n 10 node tests/browser/run.mjs
taskset -c 0-3 nice -n 10 bash build-extension.sh
taskset -c 0-3 nice -n 10 node tests/build/extension.mjs
```

Build once before running the browser suite when the app sources have changed.
Repeat the browser suite three times at phase closing.

## Per-note vault-folder merge

The unit tests cover the per-note decision table, lineage selection, snapshot
reuse, deterministic conflict IDs and UTC titles. The fuzz test uses seed
`0x4b4c2026` and verifies at least 5,000 distinct schedules with one to six
notes, randomized timestamps, edits, metadata changes, trash and permanent
deletions. It checks preservation of edits, symmetry, idempotence and note
validation. Seed `0x5eed2026` varies the ancestry of folder revisions.

The two-profile OPFS tests exchange only fictional encrypted files. E1 and E2
discard PC B's revision 5 and verify preservation of edits to the same note
in both timestamp orders. E3 and E4 check an unseen edit against permanent
deletion and verify the appropriate notice on both computers. Other cases
cover direct pulls across intervening writes and manual exports, guarded
application when a local edit arrives mid-write, and zero writes after the
profiles converge or while a session is read only.

Browser tests open profile 2 with optional `tombstones`, `ancestors` and `clock`
in the independent `file://` recovery reader. `node tests/build/profile2-compat.mjs` checks
compatibility in both directions with `a968ee2` extracted by `git archive`.
The golden file continues to use the frozen bytes and SHA-256.

Writer-clock unit tests cover optional payload validation through 64 writers,
clock dominance, base selection, direct pulls, overflow and counter recovery.
The simulation uses seed `0x4b4c2028` for 240 sequences with two or three PCs,
dropped writes, pulls, merges and bursts of up to 101 writes. It checks that
edited content survives and that disjoint edits produce zero conflict copies.
The per-note fuzz above continues to cover permanent deletions and trash.

The two-profile E6 regressions perform 34 and 100 separate folder writes while
the other PC is closed. Sign-in must load the new file directly with zero
folder writes, preservation files or conflict copies. Other checks pause a
merge after the file closes, then reload with or without an intervening write
from another tab. The sign-in race expects two contents. Normal writes also
pause before their local receipt, exercising both retained and lost files,
counter continuation and a new writer identity after reset.

The recovery regressions C1, C3a and C3b use the production reservation, base
selection, receipt and merge functions. C1 covers an unsaved local edit in an
interrupted merge. C3a/C3b use three PCs to verify unique reserved counters,
retention of the reopened edit and the real concurrent conflict in C3a.
The lost-file case requires the next reserved count, even when the earlier file
has disappeared. Injected reservation failures leave the database and file
unchanged with zero file-write attempts.

C5 uses seeds `0x0c10c4a8` and `0x0c10c4a9`, 600 sequences per variant,
two or three PCs, 40 randomized steps and final convergence. Each PC edits
only its own note. A delivery is dropped only when two PCs write over the same
head and one file wins. One variant also closes after writing and before the
local receipt or application. Both require zero lost final edits, generated
conflicts and conflict copies. A separate regression checks that a proven
archived B:2 pending base precedes the older B:1 receipt when B:3 is unproven.

E8/E9 repeat unsaved-edit interruptions with two real extension profiles and
OPFS, using an intervening guarded write from another tab. E8c is the control.
E10 drops a merge while the other PC writes again, then checks both contents
on both PCs without conflict copies or preservation files. Explicit source
choices keep only their chosen base, and disconnect clears the history.
A real 65th writer also writes a file successfully. Unit tests check stable
clock trimming and conservative conflict preservation when proof is trimmed.

The full gate uses a disposable profile for every test. At phase closing, run
the complete browser runner three consecutive times and stop on the first
failure. Setting `KEEPLOCAL_H2A_CAPTURES` to an existing output directory
captures the merge notice, conflict copy and review choice in both themes at
1100 and 390 px. Set `KEEPLOCAL_H2A7_CAPTURES` to an existing directory for
the four captures of the kept-edit notice in E4.

## Phase 2c verification

`tests/unit/note-write-queue.js` forces both action/editor orders for pin, color,
archive, trash and labels against title/content/tasks, then runs 5000 schedules
with seed `0x4b4c202c`. Persistence failures and remote/session guards are separate
checks. The browser cases control promises and observe queued writes; the old
2-second autosave race case no longer uses a 2100 ms sleep as synchronization.

Repeat the complete browser command above **three times consecutively**, stopping
on the first failure; do not retry individual cases to obtain a green gate.
The independent review stress scripts live in the owner's ignored folder. From
the main repository checkout (work happens on a task branch there, never in a
separate worktree), run them with CHROME_BIN set:

```bash
node _temp/revisao-claude-fase-2b/race.mjs /absolute/path/to/keep_local timer 200
node _temp/revisao-claude-fase-2b/race.mjs /absolute/path/to/keep_local close 100
node _temp/revisao-claude-fase-2b/run-one.mjs /absolute/path/to/keep_local 'review: queued toolbar writes' 5
```

Both stress JSON results must have `fail: 0` and `pass: N`. These review scripts
report results rather than reliably returning a failing exit status: inspect the
JSON. Store fresh review evidence separately from the completed execution logs.

Recovery tests now export without deleting, require a saved-file checkbox and
typed word, and invalidate the receipt on record, preference or unrelated-record
changes. The last check injects a change after hashing the old snapshot and proves
that the deletion transaction checks all records again. Todo metadata failures
are covered separately from the task draft/retry model documented in the README.

## Passwords & Keys tools

The HTTP browser checks exercise template selection by keyboard, primary fields,
quick copy, the generator, undo and a shorter section lock. The extension
runner checks the preservation toast duration and keeps the local idle
preference out of manual and folder backups. The read-only test counts
IndexedDB transactions and folder writes.

The final scan observes DOM text and attributes, search, toasts, console and
unencrypted metadata and browser storage. An editor value is allowed only
while its own input is focused. The session test advances a disposable
browser's clock through CDP, with no change to the production clock. Run the
complete browser suite three consecutive times at closing with CPU affinity 0–3.

## Standalone recovery and emergency kit

`tests/fixtures/profile2-golden.keeplocal` freezes a real profile 2 export with
a fictional passphrase and known plaintext. The unit test checks its SHA-256
and reads it through the app's normal import readers. The generator documents
how it was made. To inspect the generator, run it from the repository root
with an empty `mkdtemp` directory as its argument. Keep the committed fixture
frozen.

`tests/unit/recovery-tool.js` verifies the inline CSP hashes and the absence
of dependencies, persistence and download paths. The browser runner copies
the standalone HTML and encrypted inputs to a temporary directory and selects
them through CDP, including outputs captured from the HTTP app and the
extension's OPFS folder. In disposable profiles, the suite checks failed
authentication, the pre-KDF size limit, partial recovery, masked output,
filtering, clipboard timers, pagehide and absence of network or stored data.
The clipboard stub observes writes without accessing the system clipboard.

The build places the HTML, bilingual guide and SHA-256 manifest beside the ZIP.
The build test checks their exact bytes and excludes them from the ZIP. Run
the full gate with CPU affinity 0–3 and four unit-test workers. At closing,
run the browser suite three consecutive times.
