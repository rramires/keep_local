import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './harness.mjs';

const GOLDEN_PASSWORD = 'Fictitious Rescue Cafe\u0301 42! 🔑';
const GOLDEN = join(ROOT, 'tests/fixtures/profile2-golden.keeplocal');
const EXPECTED = join(ROOT, 'tests/fixtures/profile2-golden.expected.json');

async function withRecovery(browser, fn, source) {
  const directory = await mkdtemp(join(tmpdir(), 'keeplocal-recovery-test-'));
  let page;
  try {
    const html = join(directory, 'keeplocal-recovery.html');
    await copyFile(join(ROOT, 'recovery/keeplocal-recovery.html'), html);
    const url = pathToFileURL(html).href;
    page = await browser.page(undefined, source);
    page.requests.length = 0;
    page.errors.length = 0;
    await page.waitForNavigation(() => page.send('Page.navigate', { url }));
    await page.until('!!document.querySelector("#open-backup") && document.readyState === "complete"');
    await fn({ page, directory, url });
  } finally {
    try { await page?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

async function selectFile(page, path) {
  const { root } = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#backup-file' });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}

async function submit(page, password) {
  await page.eval(`document.querySelector('#password').value = ${JSON.stringify(password)};
    document.querySelector('#open-backup').click()`);
}

async function openGolden(page, directory) {
  const path = join(directory, 'profile2-golden.keeplocal');
  await copyFile(GOLDEN, path);
  await selectFile(page, path);
  await submit(page, GOLDEN_PASSWORD);
  await page.until('!document.querySelector("#results").hidden');
  return path;
}

export async function run({ browser, check, assert }) {
  await check('H1.1 standalone file opens the golden backup and renders plaintext safely', async () => {
    await withRecovery(browser, async ({ page, directory, url }) => {
      await openGolden(page, directory);
      const expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
      const actual = await page.eval(`[...document.querySelectorAll('#notes .note-title')].map(node => node.textContent)`);
      assert.deepEqual(actual, expected.map(note => note.title));
      assert.equal(await page.eval("document.querySelector('#password').value"), '');
      await page.eval("document.querySelector('#notes details').open = true");
      await page.until("!!document.querySelector('.note-content')");
      assert.equal(await page.eval("document.querySelector('.note-content').textContent"), expected[0].content);
      assert.equal(await page.eval("document.querySelectorAll('img').length"), 0);
      assert.equal(await page.eval('location.href'), url);
      assert.deepEqual(page.errors, []);
    });
  });
}
