import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('H1.2 recovery has only hashed inline code and no network or persistence', async () => {
  const html = await readFile(new URL('../../recovery/keeplocal-recovery.html', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(html) < 40_000, 'The standalone tool fits below 40 KB');
  function hashBlock(tag) {
    const blocks = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'))];
    assert.equal(blocks.length, 1, `Expected one inline ${tag}`);
    return createHash('sha256').update(blocks[0][1].replace(/\r\n?/g, '\n')).digest('base64');
  }
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/i)?.[1];
  assert.equal(policy, [
    "default-src 'none'", `script-src 'sha256-${hashBlock('script')}'`,
    `style-src 'sha256-${hashBlock('style')}'`, "img-src 'none'", "connect-src 'none'",
    "form-action 'none'", "base-uri 'none'",
  ].join('; '));
  assert.equal([...html.matchAll(/<(?:script|style)\b/gi)].length, 2);
  assert.doesNotMatch(html, /\b(?:src|href|srcset|action)\s*=|<\s*(?:link|iframe|img|object)\b|@import\b/i);
  assert.doesNotMatch(html, /\b(?:import|fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\bMath\.random\b/);
  assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage|indexedDB|createObjectURL|showSaveFilePicker)\b|\.(?:cookie|download)\b/);
  assert.doesNotMatch(html, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|writeHTML)\b|\bdocument\.write\b/);
});
