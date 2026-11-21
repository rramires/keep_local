import { copyFile, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { COLORS } from '../../js/note-model.js';
import { ROOT, PASSWORD, create, add, launchExtension, note } from './harness.mjs';
import { backupFixture, importExpression } from './backup-fixture.mjs';
import { decodeV2 } from '../../js/backup-v2.js';
import { folderFixtureSource } from './folder-fixture.mjs';
import { readFolderFixture } from './folder-transfer.mjs';
import { submitExtensionLogin } from './extension.mjs';

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

function exportFromApp(page) {
  return page.eval(`(async () => {
    let snapshot;
    URL.createObjectURL = blob => { snapshot = blob; return 'blob:fixture'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    await (await import('./js/backup.js')).exportBackup();
    return new Uint8Array(await snapshot.arrayBuffer()).toBase64();
  })()`);
}

function setLanguage(page, locale) {
  return page.eval(`(() => {
    const language = document.querySelector('#language');
    language.value = ${JSON.stringify(locale)};
    language.dispatchEvent(new Event('change'));
  })()`);
}

async function openGolden(page, directory) {
  const path = join(directory, 'profile2-golden.keeplocal');
  await copyFile(GOLDEN, path);
  await selectFile(page, path);
  await submit(page, GOLDEN_PASSWORD);
  await page.until('!document.querySelector("#results").hidden');
  return path;
}

const instrumentFilePage = `(() => {
  if (location.protocol !== 'file:') return;
  Object.defineProperty(navigator, 'language', { value: 'en-US' });
  window.fixtureClipboard = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => fixtureClipboard.push(text) } });
  window.fixtureDeriveCalls = 0;
  const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
  crypto.subtle.deriveKey = (...args) => {
    fixtureDeriveCalls++;
    return derive(...args);
  };

  const set = setTimeout.bind(window), clear = clearTimeout.bind(window);
  const pending = new Map();
  let next = -1;
  window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 15000 && delay !== 20000) return set(callback, delay, ...args);
    const id = next--;
    pending.set(id, { delay, fire: () => callback(...args) });
    return id;
  };
  window.clearTimeout = id => id < 0 ? pending.delete(id) : clear(id);
  window.fixtureTimers = {
    has: delay => [...pending.values()].some(timer => timer.delay === delay),
    fire(delay) {
      const entry = [...pending].find(([, timer]) => timer.delay === delay);
      if (!entry) throw new Error('Expected timer');
      pending.delete(entry[0]);
      entry[1].fire();
    },
  };

  window.browserWrites = [];
  function watch(object, method) {
    const original = object[method];
    object[method] = function (...args) {
      browserWrites.push(method);
      return original.apply(this, args);
    };
  }
  watch(Storage.prototype, 'setItem');
  watch(IDBFactory.prototype, 'open');
  watch(HTMLAnchorElement.prototype, 'click');
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookie?.configurable) Object.defineProperty(Document.prototype, 'cookie', {
    ...cookie,
    set(value) { browserWrites.push('cookie'); cookie.set.call(this, value); },
  });
})()`;

async function expectClosed(page, assert) {
  assert.deepEqual(await page.eval(`[
    document.querySelector('#results').hidden,
    document.querySelector('#unlock').hidden,
    document.querySelector('#notes').childElementCount,
    document.querySelector('#summary').childElementCount,
    document.querySelector('#password').value,
    document.querySelector('#filter').value,
    document.querySelector('#backup-file').files.length,
    document.querySelector('#file-name').textContent,
  ]`), [true, false, 0, 0, '', '', 0, '']);
}

async function assertReadsCopy({ browser, assert, name, base64, title, content }) {
  await withRecovery(browser, async ({ page, directory, url }) => {
    const path = join(directory, name);
    await writeFile(path, Buffer.from(base64, 'base64'));
    await selectFile(page, path);
    await submit(page, PASSWORD);
    await page.until("!document.querySelector('#results').hidden");
    assert.equal(await page.eval("document.querySelector('.note-title').textContent"), title);
    await page.eval("document.querySelector('#notes details').open = true");
    await page.until("!!document.querySelector('.note-content')");
    assert.equal(await page.eval("document.querySelector('.note-content').textContent"), content);
    assert.deepEqual(page.errors, []);
    assert.ok(page.requests.every(request => request === url), page.requests.join('\n'));
  });
}

export async function assertReadsMergedCopy({browser,assert,base64,titles,secrets}) {
  await withRecovery(browser,async({page,directory,url})=>{
    const path=join(directory,'merged-vault.keeplocal');
    await writeFile(path,Buffer.from(base64,'base64'));
    await selectFile(page,path);
    await submit(page,PASSWORD);
    await page.until("!document.querySelector('#results').hidden");
    const shown=await page.eval("[...document.querySelectorAll('#notes .note-title')].map(title=>title.textContent)");
    assert.deepEqual(shown.sort(),titles.toSorted());
    await page.eval("document.querySelectorAll('#notes details').forEach(card=>{card.open=true})");
    await page.until("document.querySelectorAll('#notes .field-value').length===4");
    assert.ok(await page.eval("[...document.querySelectorAll('#notes .field-value')].every(field=>/^•+$/.test(field.textContent))"));
    assert.equal(await page.eval(`${JSON.stringify(secrets)}.some(value=>document.body.innerHTML.includes(value))`),false);
    assert.deepEqual(page.errors,[]);
    assert.ok(page.requests.every(request=>request===url));
  });
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
  await check('H1.2 file lifecycle cancels an in-flight decrypt after pagehide', async () => {
    const hold = `(() => {
      if (location.protocol !== 'file:') return;
      window.cryptoCalls = { derive: 0, decrypt: 0 };
      const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
      const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      crypto.subtle.deriveKey = (...args) => {
        cryptoCalls.derive++;
        return new Promise(resolve => {
          window.resumeDerive = () => derive(...args).then(resolve);
        });
      };
      crypto.subtle.decrypt = (...args) => { cryptoCalls.decrypt++; return decrypt(...args); };
    })()`;
    await withRecovery(browser, async ({ page, directory }) => {
      const path = join(directory, 'paused.keeplocal');
      await copyFile(GOLDEN, path);
      await selectFile(page, path);
      await submit(page, GOLDEN_PASSWORD);
      await page.until("typeof resumeDerive === 'function'");
      assert.deepEqual(await page.eval(`[
        document.querySelector('#open-backup').disabled,
        !document.querySelector('#progress').hidden,
        document.querySelector('#password').value
      ]`), [true, true, '']);
      await page.eval(`(async () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        await resumeDerive();
        // The derive promise resumes the tool before the next browser task.
        await new Promise(resolve => setTimeout(resolve, 0));
      })()`);
      assert.deepEqual(await page.eval('cryptoCalls'), { derive: 1, decrypt: 0 });
      await expectClosed(page, assert);
    }, hold);
  });

  await check('H1.2 golden contents, safe filter, one-field reveal and clipboard cleanup', async () => {
    const expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
    const fields = expected.find(note => note.type === 'vault').blocks.filter(block => block.kind === 'field');
    await withRecovery(browser, async ({ page, directory, url }) => {
      const path = await openGolden(page, directory);
      const beforeHash = createHash('sha256').update(await readFile(path)).digest('hex');
      await page.eval(`for (const details of document.querySelectorAll('#notes details')) details.open = true`);
      await page.until("document.querySelectorAll('.note-body').length === 5");
      const view = await page.eval(`[...document.querySelectorAll('#notes details')].map(note => ({
        title: note.querySelector('.note-title').textContent,
        metadata: [...note.querySelectorAll('.note-meta span')].map(span => span.textContent),
        text: note.querySelector('.note-content')?.textContent ?? null,
        tasks: [...note.querySelectorAll('.task')].map(task => [task.textContent, task.classList.contains('subtask')]),
        fields: [...note.querySelectorAll('.field-label')].map(label => label.textContent),
        vaultText: note.querySelector('.vault-text')?.textContent ?? null,
        dividers: note.querySelectorAll('.vault-divider').length,
      }))`);
      assert.deepEqual(view.map(note => note.title), expected.map(note => note.title));
      assert.equal(view[0].text, expected[0].content);
      assert.deepEqual(view[1].tasks, expected[1].tasks.map(task => [
        (task.done ? '[x] ' : '[ ] ') + task.text, task.parentId !== null,
      ]));
      assert.deepEqual(view[2].fields, fields.map(block => block.label));
      assert.equal(view[2].vaultText, expected[2].blocks.find(block => block.kind === 'text').value);
      assert.equal(view[2].dividers, 1);
      assert.deepEqual(view[0].metadata, ['Text', 'Labels: viagem, pessoal', 'Color: Mint']);
      assert.deepEqual(view[2].metadata, ['Passwords & Keys', 'Labels: fictício', 'Color: Coral']);
      assert.ok(view[3].metadata.includes('Trash'));
      assert.ok(view[4].metadata.includes('Archived'));
      assert.deepEqual(await page.eval(`[...document.querySelectorAll('#summary dd')].map(node => node.textContent)`),
        ['1', '2026-01-02T03:04:05.000Z', '5', '0']);

      const scan = async expectedIndex => {
        const masks = fields.map((block, index) => index === expectedIndex ? block.value : '••••••••');
        assert.deepEqual(await page.eval(`[...document.querySelectorAll('.field-value')].map(field => field.textContent)`), masks);
        const channels = await page.eval(`(() => {
          const values = ${JSON.stringify(fields.map(block => block.value))};
          const attrs = [...document.querySelectorAll('*')].flatMap(node => [...node.attributes].map(attr => attr.value));
          return values.map(value => ({
            dom: document.documentElement.textContent.includes(value),
            html: document.documentElement.outerHTML.includes(value),
            visible: document.body.innerText.includes(value),
            attr: attrs.some(attr => attr.includes(value)),
          }));
        })()`);
        for (const [index, channel] of channels.entries()) {
          const visible = index === expectedIndex;
          assert.deepEqual(channel, { dom: visible, html: visible, visible, attr: false });
        }
      };
      const press = (index, button) => page.eval(`document.querySelectorAll('.vault-field')[${index}].querySelectorAll('button')[${button}].click()`);
      await scan(-1);
      await press(0, 0);
      await scan(0);
      await press(1, 0);
      await scan(1);
      assert.equal(await page.eval('fixtureTimers.has(15000)'), true);
      await page.eval('fixtureTimers.fire(15000)');
      await scan(-1);
      await press(2, 0);
      await scan(2);
      await page.eval("window.dispatchEvent(new Event('blur'))");
      await scan(-1);
      await press(1, 0);
      await page.eval("document.querySelector('#filter').focus()");
      await scan(-1);
      await press(1, 1);
      await page.until('fixtureTimers.has(20000)');
      assert.equal(await page.eval('fixtureClipboard.length'), 1);
      assert.equal(await page.eval(`fixtureClipboard[0] === ${JSON.stringify(fields[1].value)}`), true);
      await page.eval('fixtureTimers.fire(20000)');
      await page.until("fixtureClipboard.length === 2 && fixtureClipboard.at(-1) === ''");
      await scan(-1);

      const applyFilter = query => page.eval(`(() => {
        const input = document.querySelector('#filter');
        input.value = ${JSON.stringify(query)};
        input.dispatchEvent(new Event('input'));
        return [...document.querySelectorAll('.note-title')].map(node => node.textContent);
      })()`);
      for (const block of fields) assert.deepEqual(await applyFilter(block.value), []);
      for (const [query, title] of [
        ['cafe', expected[0].title], ['viagem', expected[0].title], ['PLANO FICTICIO', expected[0].title],
        ['Subtarefa com acao', expected[1].title], ['Chave de teste', expected[2].title],
      ]) assert.deepEqual(await applyFilter(query), [title]);
      await applyFilter('');
      await page.eval(`document.querySelectorAll('#notes details')[2].open = true`);
      await page.until("!!document.querySelector('.field-value')");
      await press(1, 0);
      await scan(1);
      await page.eval("document.querySelector('#close-backup').click()");
      await expectClosed(page, assert);
      assert.deepEqual(await page.eval(`(async () => ({
        local: Object.keys(localStorage), session: Object.keys(sessionStorage),
        databases: await indexedDB.databases(), cookie: document.cookie,
        writes: browserWrites,
      }))()`), { local: [], session: [], databases: [], cookie: '', writes: [] });
      assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), beforeHash);
      assert.deepEqual(page.errors, []);
      assert.ok(page.requests.every(request => request === url), page.requests.join('\n'));
      assert.equal(await page.eval("document.querySelectorAll('a[download]').length"), 0);
    }, instrumentFilePage);
  });

  await check('H1.2 manual HTTP export opens in the detached file reader', async () => {
    const spa = await browser.page();
    const title = 'Cópia do aplicativo 🧪';
    const content = 'Maçã, ação e maré 🚀';
    let base64;
    try {
      await create(spa);
      await add(spa, title, content);
      base64 = await exportFromApp(spa);
    } finally { await spa.close(); }
    await assertReadsCopy({ browser, assert, base64, name: 'manual.keeplocal', title, content });
  });

  await check('H1.5 app export recovers all 12 colors and a Dusk vault item in both languages', async () => {
    const fixtures = COLORS.map(color => note({ title: `Fictitious ${color}`, color }));
    fixtures.push(note({ title: 'Fictitious vault', type: 'vault', color: 'dusk', blocks: [] }));
    delete fixtures.at(-1).content;
    const spa = await browser.page();
    let base64;
    try {
      await create(spa);
      await spa.eval(`(async () => {
        const { saveNote } = await import('./js/app.js');
        for (const item of ${JSON.stringify(fixtures)}) await saveNote(item);
      })()`);
      base64 = await exportFromApp(spa);
      assert.deepEqual(spa.errors, []);
    } finally { await spa.close(); }

    await withRecovery(browser, async ({ page, directory }) => {
      const path = join(directory, 'all-colors.keeplocal');
      await writeFile(path, Buffer.from(base64, 'base64'));
      await selectFile(page, path);
      await submit(page, PASSWORD);
      await page.until("!document.querySelector('#results').hidden");
      assert.equal(await page.eval("document.querySelector('[data-stat=unreadableCount] dd').textContent"), '0');

      for (const [locale, label, vault, names] of [
        ['en', 'Color', 'Passwords & Keys', ['Default', 'Coral', 'Peach', 'Sand', 'Mint', 'Sage', 'Fog', 'Storm', 'Dusk', 'Blossom', 'Clay', 'Chalk']],
        ['pt-BR', 'Cor', 'Senhas e Chaves', ['Padrão', 'Coral', 'Pêssego', 'Areia', 'Menta', 'Sálvia', 'Névoa', 'Tempestade', 'Crepúsculo', 'Flor', 'Argila', 'Giz']],
      ]) {
        await setLanguage(page, locale);
        const rows = await page.eval(`Object.fromEntries([...document.querySelectorAll('#notes details')].map(card => [
          card.querySelector('.note-title').textContent,
          [...card.querySelectorAll('.note-meta span')].map(span => span.textContent),
        ]))`);
        assert.deepEqual(Object.keys(rows).sort(), fixtures.map(item => item.title).sort());
        for (const [index, item] of fixtures.slice(0, -1).entries()) {
          assert.ok(rows[item.title].includes(`${label}: ${names[index]}`), item.color);
        }
        assert.deepEqual(rows['Fictitious vault'], [vault, `${label}: ${names[COLORS.indexOf('dusk')]}`]);
      }
      assert.deepEqual(page.errors, []);
    });
  });

  await check('H2a.1 manual export and import carry deletions without displaying them in the recovery reader', async () => {
    const spa = await browser.page(), target = await browser.page();
    const title = 'Fictitious survivor', content = 'Only the live note is listed';
    const removed = note({title:'Fictitious removed note',deletedAt:1});
    let base64;
    try {
      await create(spa);
      await add(spa,title,content);
      const rows = await spa.eval(`(async()=>{
        const app=await import('./js/app.js');
        await app.saveNote(${JSON.stringify(removed)});
        await app.permanentDeleteNote(${JSON.stringify(removed.id)});
        return (await import('./js/db.js')).getMeta('tombstones');
      })()`);
      base64 = await exportFromApp(spa);
      const {payload} = await decodeV2(Buffer.from(base64,'base64'),PASSWORD);
      assert.deepEqual(payload.tombstones,rows);
      await target.eval(importExpression(base64));
      assert.deepEqual(await target.eval("(await import('./js/db.js')).getMeta('tombstones')"),rows);
      const golden=await readFile(GOLDEN);
      const empty=await browser.page();
      try {
        await empty.eval(importExpression(golden.toString('base64'),GOLDEN_PASSWORD));
        assert.deepEqual(await empty.eval("(await import('./js/db.js')).getMeta('tombstones')"),[]);
      } finally {await empty.close();}
    } finally {await target.close();await spa.close();}
    await assertReadsCopy({browser,assert,base64,name:'manual-with-deletions.keeplocal',title,content});
    await withRecovery(browser,async({page,directory})=>{
      const path=join(directory,'deleted-identifiers.keeplocal');
      await writeFile(path,Buffer.from(base64,'base64'));
      await selectFile(page,path);
      await submit(page,PASSWORD);
      await page.until("!document.querySelector('#results').hidden");
      assert.deepEqual(await page.eval("[...document.querySelectorAll('#notes .note-title')].map(row=>row.textContent)"),[title]);
      assert.equal(await page.eval(`document.body.textContent.includes(${JSON.stringify(removed.id)})`),false);
    });
  });

  await check('H1.2 extension OPFS writes open in the detached file reader', async () => {
    const extension = await launchExtension();
    assert.ok(extension);
    const title = 'Cópia da extensão 🧪';
    const content = 'Conteúdo gravado na pasta fictícia ✅';
    const name = 'keeplocal-vault.keeplocal';
    const removed = note({title:'Fictitious deletion in the folder',deletedAt:1});
    let base64, tombstones;
    try {
      const page = await extension.page(undefined, folderFixtureSource('KL-TEST-RECOVERY-H1'));
      await create(page);
      await add(page, title, content);
      tombstones = await page.eval(`(async()=>{
        const app=await import('./js/app.js');
        await app.saveNote(${JSON.stringify(removed)});
        await app.permanentDeleteNote(${JSON.stringify(removed.id)});
        return (await import('./js/db.js')).getMeta('tombstones');
      })()`);
      await page.eval("(await import('./js/folder-store.js')).chooseSyncFolder({key:(await import('./js/app.js')).getCryptoKey()})");
      await page.reload();
      await page.eval("folderTest.permission = 'granted'");
      await submitExtensionLogin(page);
      await page.until("(await import('./js/db.js')).getMeta('folderSeenRev').then(rev => rev > 0)");
      base64 = await readFolderFixture(page, name);
      assert.deepEqual(page.errors, []);
    } finally { await extension.close(); }
    assert.deepEqual((await decodeV2(Buffer.from(base64,'base64'),PASSWORD)).payload.tombstones,tombstones);
    await assertReadsCopy({ browser, assert, base64, name, title, content });
  });

  await check('H1.2 wrong passphrase, truncation and a changed byte share one error; oversized files never derive', async () => {
    await withRecovery(browser, async ({ page, directory }) => {
      const golden = await readFile(GOLDEN);
      const altered = Buffer.from(golden);
      altered[altered.length - 1] ^= 1;
      const errors = [];
      for (const [name, bytes, passphrase] of [
        ['wrong', golden, 'Fictitious wrong passphrase!'],
        ['short', golden.subarray(0, 30), GOLDEN_PASSWORD],
        ['truncated', golden.subarray(0, -1), GOLDEN_PASSWORD],
        ['tampered', altered, GOLDEN_PASSWORD],
      ]) {
        const path = join(directory, name + '.keeplocal');
        await writeFile(path, bytes);
        await selectFile(page, path);
        await submit(page, passphrase);
        await page.until("!document.querySelector('#error').hidden && !document.querySelector('#open-backup').disabled");
        errors.push(await page.eval("document.querySelector('#error').textContent"));
        assert.deepEqual(await page.eval(`[document.querySelector('#results').hidden,
          document.querySelector('#notes').childElementCount, document.querySelector('#password').value]`), [true, 0, '']);
      }
      assert.equal(new Set(errors).size, 1);
      assert.match(errors[0], /passphrase.*damaged/);
      assert.equal(await page.eval('fixtureDeriveCalls'), 3);

      const oversized = join(directory, 'oversized.keeplocal');
      await writeFile(oversized, '');
      await truncate(oversized, 64 * 1024 * 1024 + 1);
      await selectFile(page, oversized);
      await submit(page, GOLDEN_PASSWORD);
      assert.match(await page.eval("document.querySelector('#error:not([hidden])').textContent"), /64 MiB/);
      assert.equal(await page.eval('fixtureDeriveCalls'), 3);
      assert.equal(await page.eval("document.querySelector('#results').hidden"), true);
      assert.deepEqual(page.errors, []);
    }, instrumentFilePage);
  });

  await check('H1.2 a damaged inner record and invalid manifest do not block the other notes', async () => {
    const fixtures = [
      note({ title: 'Preserved fictitious Á' }),
      note({ title: 'Damaged fictitious B' }),
      note({ title: 'Preserved fictitious C' }),
    ];
    const { payload, seal } = await backupFixture(fixtures);
    const record = payload.notes[1];
    const invalidBytes = Buffer.from(record.ciphertext, 'base64');
    invalidBytes[invalidBytes.length - 1] ^= 1;
    const sealed = await seal({
      ...payload,
      notes: [payload.notes[0], { ...record, ciphertext: invalidBytes.toString('base64') }, payload.notes[2]],
      manifest: { count: 3, ids: payload.manifest.ids.toReversed() },
    });
    await withRecovery(browser, async ({ page, directory }) => {
      const path = join(directory, 'partial.keeplocal');
      await writeFile(path, Buffer.from(sealed, 'base64'));
      await selectFile(page, path);
      await submit(page, PASSWORD);
      await page.until("!document.querySelector('#results').hidden");
      assert.deepEqual(await page.eval(`[...document.querySelectorAll('.note-title')].map(node => node.textContent)`),
        [fixtures[0].title, fixtures[2].title]);
      assert.equal(await page.eval("document.querySelector('.unreadable').textContent"), 'Unreadable record · ' + record.id);
      assert.equal(await page.eval("document.querySelector('[data-stat=unreadableCount] dd').textContent"), '1');
      assert.equal(await page.eval("document.querySelector('#manifest-warning').hidden"), false);
      await page.eval("window.dispatchEvent(new PageTransitionEvent('pagehide'))");
      await expectClosed(page, assert);
      assert.deepEqual(page.errors, []);
    });
  });

  await check('H1.5 future colors and fields recover safely while unknown content stays out of the DOM', async () => {
    const futureColor = '<future-tone>';
    const field = {
      kind: 'field', id: crypto.randomUUID(), label: 'Safe field label', secret: false,
      value: 'FICTITIOUS-H15-MASKED', futureFlag: 'FICTITIOUS-H15-EXTRA-BLOCK',
    };
    const task = {
      id: crypto.randomUUID(), text: 'Safe task text', done: false, parentId: null, order: 0,
      extra: 'FICTITIOUS-H15-EXTRA-TASK',
    };
    const fixtures = [
      note({ title: 'Future color', color: futureColor, extra: 'FICTITIOUS-H15-EXTRA-NOTE' }),
      note({ title: 'Checklist with extra keys', type: 'todo', tasks: [task] }),
      note({
        title: 'Vault with a future block', type: 'vault', content: 'FICTITIOUS-H15-EXTRA-VAULT-CONTENT',
        blocks: [field, {
          kind: 'FICTITIOUS-H15-KIND', id: crypto.randomUUID(),
          label: 'FICTITIOUS-H15-BLOCK-LABEL', value: 'FICTITIOUS-H15-BLOCK-VALUE',
        }],
      }),
      note({
        title: 'Future note type', type: 'FICTITIOUS-H15-TYPE',
        content: 'FICTITIOUS-H15-NOTE-CONTENT', labels: ['FICTITIOUS-H15-NOTE-LABEL'],
        blocks: [{ ...field, label: 'FICTITIOUS-H15-NOTE-BLOCK' }],
      }),
    ];
    const malformed = [
      note({ title: 42 }),
      note({ color: ['default'] }),
      note({ type: { name: 'text' } }),
      note({ type: 'vault', blocks: [{ ...field, kind: null }] }),
      note({ type: 'vault', blocks: [{ ...field, value: false }] }),
    ];
    const { bytes } = await backupFixture([...fixtures, ...malformed]);

    await withRecovery(browser, async ({ page, directory, url }) => {
      const path = join(directory, 'future-notes.keeplocal');
      await writeFile(path, bytes);
      await selectFile(page, path);
      await submit(page, PASSWORD);
      await page.until("!document.querySelector('#results').hidden");

      const readTitles = () => page.eval(`[...document.querySelectorAll('#notes .note-title')].map(node => node.textContent)`);
      const scan = async () => assert.equal(await page.eval(`[document.documentElement.textContent, document.documentElement.outerHTML,
        document.body.innerText].some(value => value.includes('FICTITIOUS-H15-'))`), false);
      for (const [locale, colorLabel, warning, unreadable] of [
        ['en', 'Color', 'Newer format than this tool supports.', 'Unreadable record'],
        ['pt-BR', 'Cor', 'Formato mais novo que esta ferramenta.', 'Registro ilegível'],
      ]) {
        await setLanguage(page, locale);
        assert.deepEqual(await readTitles(), fixtures.map(item => item.title));
        assert.equal(await page.eval("document.querySelector('[data-stat=unreadableCount] dd').textContent"), String(malformed.length));
        assert.deepEqual(await page.eval(`[...document.querySelectorAll('.unreadable')].map(node => node.textContent)`),
          malformed.map(item => unreadable + ' · ' + item.id));
        await scan();

        await page.eval("for (const card of document.querySelectorAll('#notes details')) card.open = true");
        await page.until("document.querySelectorAll('.note-body').length === 3");
        assert.deepEqual(await page.eval(`[...document.querySelectorAll('#notes .notice')].map(node => node.textContent)`),
          [warning, warning]);
        assert.equal(await page.eval(`[...document.querySelectorAll('#notes .note-title')]
          .find(node => node.textContent === ${JSON.stringify(fixtures[3].title)}).closest('.note').textContent`),
          fixtures[3].title + warning);
        assert.equal(await page.eval("document.querySelector('.note-meta span:last-child').textContent"), colorLabel + ': ' + futureColor);
        assert.equal(await page.eval("document.querySelector('.note-content').textContent"), fixtures[0].content);
        assert.equal(await page.eval("document.querySelector('.task').textContent"), '[ ] ' + task.text);
        assert.deepEqual(await page.eval(`[...document.querySelectorAll('.field-label, .field-value')].map(node => node.textContent)`),
          [field.label, '••••••••']);
        assert.equal(await page.eval("document.querySelectorAll('#notes button').length"), 2);
        await scan();

        for (const [term, expected] of [
          [fixtures[3].title, [fixtures[3].title]],
          [field.label, [fixtures[2].title]],
          ['H15-MASKED', []],
          ['H15-BLOCK-LABEL', []],
          ['H15-NOTE-LABEL', []],
          ['', fixtures.map(item => item.title)],
        ]) {
          await page.eval(`(() => {
            const filter = document.querySelector('#filter');
            filter.value = ${JSON.stringify(term)};
            filter.dispatchEvent(new Event('input'));
          })()`);
          assert.deepEqual(await readTitles(), expected);
          await scan();
        }
      }
      assert.deepEqual(page.errors, []);
      assert.ok(page.requests.every(request => request === url));
    });
  });

  await check('H1.2 the standalone interface handles drag and drop, languages and the loopback HTTP reader', async () => {
    const expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
    await withRecovery(browser, async ({ page, directory }) => {
      const path = join(directory, 'drop.keeplocal');
      await copyFile(GOLDEN, path);
      await selectFile(page, path);
      await page.eval(`(() => {
        const file = document.querySelector('#backup-file').files[0];
        const files = new DataTransfer();
        files.items.add(file);
        document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
        const language = document.querySelector('#language');
        language.value = 'pt-BR';
        language.dispatchEvent(new Event('change'));
      })()`);
      assert.equal(await page.eval('document.documentElement.lang'), 'pt-BR');
      assert.equal(await page.eval("document.querySelector('#backup-file').files.length"), 0);
      assert.equal(await page.eval("document.querySelector('#file-name').textContent"), 'drop.keeplocal');
      await submit(page, GOLDEN_PASSWORD);
      await page.until("!document.querySelector('#results').hidden");
      assert.equal(await page.eval("document.querySelector('#results-title').textContent"), 'Backup aberto');
      assert.equal(await page.eval("document.querySelector('.note-title').textContent"), expected[0].title);
      assert.deepEqual(page.errors, []);

      const url = browser.origin + '/recovery/keeplocal-recovery.html';
      page.requests.length = 0;
      await page.waitForNavigation(() => page.send('Page.navigate', { url }));
      await selectFile(page, path);
      await submit(page, GOLDEN_PASSWORD);
      await page.until("!document.querySelector('#results').hidden");
      assert.equal(await page.eval("document.querySelector('.note-title').textContent"), expected[0].title);
      assert.deepEqual(page.errors, []);
      assert.ok(page.requests.every(request => request === url), page.requests.join('\n'));
    });
  });

}
