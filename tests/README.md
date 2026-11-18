# Tests

No npm packages are required. Node 24 (native WebSocket and Web Crypto) and Chromium are used.

```
node --test tests/unit
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
bash build-extension.sh
node tests/build/extension.mjs
```

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
