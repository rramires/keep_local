# Phase 2d–2e verification

Run from the main repository checkout, on the task branch. No npm packages or previous source checkout are needed.
Use only fictional notes and disposable browser contexts/profiles.

```bash
node --test tests/unit
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
CHROME_BIN=/path/to/chromium node tests/browser/run.mjs
bash build-extension.sh
node tests/build/extension.mjs
diff -r js chrome-extension/js
diff -r css chrome-extension/css
diff -r lib chrome-extension/lib
diff index.html chrome-extension/index.html
git diff --check
```

Stop on the first failure. Do not retry one failed case to qualify a gate.
A browser SKIP is not acceptance. Navigation helpers await the browser load event;
application readiness checks await the data being asserted, including imported notes.
Use `page.waitForNavigation(action)` when a reset action itself reloads the document.

`ui-layout.mjs` asserts real geometry, full-width stacked fields, close/focus, error
color, unreadable-record warning placement, pluralization and password-strength hierarchy.
`dialogs.mjs` exercises named launch controls at 390px, focus trapping/return, exact
words, keyboard cancellation, stacked-dialog IDs, literal text and session teardown.
Both themes and 390/1100px viewports are covered; CSP remains unchanged.

`batch-queue.mjs` holds actual encryption promises: a local pin and label batch both
commit; real second-tab writes refuse the entire batch while waiting for locks or
encrypting it. The existing second-put rollback and missing-target cases remain.
The pure queue fuzz adds 24000 local and 16000 remote schedules with fixed seeds,
releases writes during submission and emulates guarded persistence plus refresh.
Mutation evidence and exact byte restoration are stored outside Git.

Binary v2 profile 2 remains immutable. `backup-fixture.mjs` fabricates valid and
hostile authenticated archives using the current format. `compat-rejection.mjs`
checks unsupported old metadata, explicit reset, non-v2 rejection without writes,
and v2 import/login with an older short passphrase and a salt starting with `{`.
The policy for new passphrases does not retroactively reject valid v2 archives.

The owner’s primary checkout keeps the ignored execution report and gallery at
`_temp/relatorio-execucao-fase-2d-2e.md` and
`_temp/execucao-fase-2d-2e/GALERIA.md`. They include task commits, before/after probes,
failed development attempts, final gates, image hashes and scope checks. They are
execution evidence; independent review and the owner's merge decision remain pending.

Do not push or merge this task branch. Do not alter the File System Access spike.
Phases 3.1–3.9 and 4 remain blocked pending separate authorization.
