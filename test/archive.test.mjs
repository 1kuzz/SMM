// Сборка архива из сырых журналов (ext/archive.js) и сам ZIP (ext/zip.js) — без браузера.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const SMMArchive = require('../ext/archive.js');
const ctx = vm.createContext({ Blob, Response, CompressionStream, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer });
vm.runInContext(`${await readFile(new URL('../ext/zip.js', import.meta.url), 'utf8')}\nthis.SMMZip = SMMZip;`, ctx);
const { SMMZip } = ctx;

/** Minimal ZIP reader: the central directory, then each entry (stored or deflated). */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(body) : body);
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const T = Date.parse('2026-10-26T10:00:00Z');
const rec = { sid: 's1', startedAt: T, stoppedAt: T + 125000 };
const bundle = (url) => JSON.stringify({ schema: 'action-logger-ai-v7', endpoints: [{ method: 'POST', path: '/api/x' }], url });
const harOf = (id) => JSON.stringify({ log: { pages: [{ id: 'page-1', title: id }], entries: [{ pageref: 'page-1', startedDateTime: new Date(T + 1000).toISOString(), request: { url: `https://a.test/${id}` } }] } });
const data = {
  rec,
  events: [
    { sid: 's1', t: T + 100, kind: 'nav', type: 'committed', tabId: 1, url: 'https://a.test/' },
    { sid: 's1', t: T + 200, kind: 'doc', docId: 'd1', tabId: 1, url: 'https://a.test/', title: 'A', docStartedAt: T + 150 },
    { sid: 's1', t: T + 3000, kind: 'action', docId: 'd1', tabId: 1, url: 'https://a.test/', action: { action: 'click' } },
    { sid: 's1', t: T + 3100, kind: 'request', tabId: 1, type: 'xmlhttprequest', method: 'GET', url: 'https://a.test/api/list', status: 200 },
    { sid: 's1', t: T + 3200, kind: 'request', tabId: 1, type: 'xmlhttprequest', method: 'POST', url: 'https://a.test/api/x', status: 201 },
    { sid: 's1', t: T + 5000, kind: 'nav', type: 'committed', tabId: 1, url: 'https://sso.b.test/login' },
    { sid: 's1', t: T + 5100, kind: 'doc', docId: 'd2', tabId: 1, url: 'https://sso.b.test/login', title: 'B', docStartedAt: T + 5050 },
    { sid: 's1', t: T + 9000, kind: 'comment', tabId: 1, url: 'https://sso.b.test/login', text: 'тут вход через SSO' },
  ],
  shots: [{ sid: 's1', t: T + 3050, tabId: 1, url: 'https://a.test/', reason: 'action-click', blob: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
  doms: [{ sid: 's1', t: T + 1700, docId: 'd1', url: 'https://a.test/', title: 'A', reason: 'load', html: '<html>a</html>',
    surface: { links: [{ href: 'https://a.test/reports', text: 'Отчёты' }, { href: 'https://sso.b.test/login', text: 'Войти' }], forms: [{ method: 'GET', action: 'https://a.test/search', fields: [{ name: 'q' }] }] } }],
  docs: [
    { key: 's1|d1', sid: 's1', docId: 'd1', tabId: 1, startedAt: T + 150, url: 'https://a.test/', final: true, bundle: bundle('a'), har: harOf('a'), actions: 1, requests: 2 },
    { key: 's1|d2', sid: 's1', docId: 'd2', tabId: 1, startedAt: T + 5050, url: 'https://sso.b.test/login', final: false, bundle: bundle('b'), har: harOf('b'), actions: 0, requests: 0 },
  ],
};

test('одна сессия на два сайта: страницы по порядку, таймлайн, карта, API', () => {
  const files = SMMArchive.build(data);
  const byName = new Map(files.map((f) => [f.name, f.data]));
  for (const name of ['README.md', 'session.json', 'sitemap.json', 'endpoints.json', 'network/requests.json', 'network/session.har',
    'pages/001-a.test/bundle.json', 'pages/001-a.test/dom-001-load.html', 'pages/001-a.test/dom-001-load.surface.json',
    'pages/002-sso.b.test-login/bundle.json', 'screenshots/0001-100003-action-click.jpg']) assert.ok(byName.has(name), name);

  const s = JSON.parse(byName.get('session.json'));
  assert.equal(s.id, 's1');
  assert.equal(s.durationSec, 125);
  assert.deepEqual(s.pages.map((p) => [p.folder, p.snapshot]), [['pages/001-a.test', 'final'], ['pages/002-sso.b.test-login', 'periodic']]);
  assert.equal(s.counts.requests, 2);
  assert.equal(s.comments[0].text, 'тут вход через SSO');
  const kinds = s.timeline.map((e) => e.kind);
  assert.ok(kinds.includes('screenshot') && kinds.includes('dom') && kinds.includes('comment'));
  assert.ok(!s.timeline.some((e) => e.url === 'https://a.test/api/list'), 'a plain GET stays out of the timeline');
  assert.ok(s.timeline.some((e) => e.kind === 'request' && e.method === 'POST'), 'a write is in the timeline');
  assert.ok(s.timeline.every((e, i, a) => i === 0 || a[i - 1].at <= e.at), 'timeline is in time order');
  assert.equal(s.timeline.find((e) => e.kind === 'action').page, 'pages/001-a.test');

  const map = JSON.parse(byName.get('sitemap.json'));
  assert.deepEqual(map.origins['https://a.test'].notVisited.map((l) => l.href), ['https://a.test/reports']);
  assert.equal(map.forms[0].action, 'https://a.test/search');

  const har = JSON.parse(byName.get('network/session.har'));
  assert.deepEqual(har.log.pages.map((p) => p.id), ['pages/001-a.test:page-1', 'pages/002-sso.b.test-login:page-1']);
  assert.equal(har.log.entries.length, 2);
  assert.equal(JSON.parse(byName.get('endpoints.json')).length, 2);
});

test('ZIP открывается обычным распаковщиком: имена в UTF-8, deflate и store', async () => {
  const files = [
    { name: 'README.md', data: 'Привет' },
    { name: 'pages/001-ä/bundle.json', data: JSON.stringify({ a: 'x'.repeat(5000) }) },
    { name: 'shot.jpg', data: new Uint8Array([1, 2, 3]), store: true },
  ];
  const blob = await SMMZip.build(files);
  const entries = unzip(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual([...entries.keys()], files.map((f) => f.name));
  assert.equal(entries.get('README.md').toString('utf8'), 'Привет');
  assert.equal(JSON.parse(entries.get('pages/001-ä/bundle.json')).a.length, 5000);
  assert.deepEqual([...entries.get('shot.jpg')], [1, 2, 3]);
  assert.equal(SMMZip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
