// Расширение целиком в настоящем Chromium: одна запись проходит через два разных сайта
// (другой origin = другое хранилище страницы — ровно там прежняя версия начинала новую сессию),
// перезагрузку и комментарий, а «Стоп» отдаёт один архив, в котором есть всё.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

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

function serve(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
}

let archive;
let ctx;
let servers = [];
let originB;

test.before(async () => {
  const b = await serve((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>B</title><h1>Портал B</h1><a href="/reports">Отчёты</a>
      <button id="go" onclick="this.textContent='готово'">Сформировать</button>`);
  });
  originB = `http://localhost:${b.address().port}`;
  const a = await serve((req, res) => {
    if (req.url === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.statusCode = 201; res.end(JSON.stringify({ id: 7, got: JSON.parse(body) })); });
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>A</title><h1>Портал A</h1>
      <form action="/search"><input name="q" aria-label="Поиск"></form>
      <label for="name">Название</label><input id="name">
      <button id="save" onclick="fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.getElementById('name').value})}).then(r=>r.json()).then(j=>{document.getElementById('out').textContent='Сохранено '+j.id})">Сохранить</button>
      <p id="out"></p><a id="tob" href="${originB}/">На портал B</a>`);
  });
  servers = [a, b];
  const originA = `http://127.0.0.1:${a.address().port}`;

  ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'smm-')), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const page = ctx.pages()[0] || await ctx.newPage();
  await sw.evaluate(() => start());

  await page.goto(`${originA}/`);
  await page.waitForTimeout(800);
  await page.fill('#name', 'Квартальный отчёт');
  await page.click('#save');
  await page.waitForSelector('text=Сохранено 7');
  await page.waitForTimeout(1500);
  await Promise.all([page.waitForURL(`${originB}/`), page.click('#tob')]);
  await page.waitForTimeout(1000);
  await page.click('#go');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForTimeout(2200);
  await sw.evaluate(() => comment('после перезагрузки запись должна продолжаться'));
  await page.waitForTimeout(800);

  const exportPage = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('ext/export.html') });
  await sw.evaluate(() => stop());
  const ep = await exportPage;
  await ep.waitForFunction(() => window.__smmZip, null, { timeout: 20000 });
  const b64 = await ep.evaluate(async () => {
    const u8 = new Uint8Array(await (await window.__smmZip).arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (process.env.SMM_KEEP) await writeFile(process.env.SMM_KEEP, Buffer.from(b64, 'base64')); // посмотреть архив руками
  archive = unzip(Buffer.from(b64, 'base64'));
});

test.after(async () => { await ctx?.close(); for (const s of servers) s.close(); });

const json = (name) => JSON.parse(archive.get(name).toString('utf8'));

test('одна сессия через два сайта и перезагрузку', () => {
  const s = json('session.json');
  const origins = new Set(s.pages.map((p) => new URL(p.url).origin));
  assert.equal(origins.size, 2, JSON.stringify(s.pages));
  assert.ok(s.pages.length >= 3, `A, B и B после перезагрузки: ${s.pages.length}`);
  assert.ok(s.timeline.some((e) => e.kind === 'nav' && e.url?.startsWith(originB)));
  assert.equal(s.comments.length, 1);
  assert.ok(s.counts.actions >= 3, `шаги: ${s.counts.actions}`);
});

test('каждая страница — подробная запись логгера, с телами запросов', () => {
  const s = json('session.json');
  const first = s.pages[0];
  const bundle = json(`${first.folder}/bundle.json`);
  const text = JSON.stringify(bundle);
  assert.ok(text.includes('Квартальный отчёт'), 'введённое значение');
  assert.ok(text.includes('/api/save'), 'запрос шага');
  const har = json('network/session.har');
  assert.ok(har.log.entries.some((e) => e.request.url.endsWith('/api/save') && e.response.status === 201));
});

test('скриншоты, DOM, карта и все запросы браузера', () => {
  const names = [...archive.keys()];
  assert.ok(names.some((n) => n.startsWith('screenshots/') && n.endsWith('.jpg')), 'есть скриншоты');
  const shot = archive.get(names.find((n) => n.startsWith('screenshots/')));
  assert.equal(shot[0], 0xff); assert.equal(shot[1], 0xd8);
  for (const page of json('session.json').pages) assert.ok(names.some((n) => n.startsWith(`${page.folder}/dom-`)), `снимок DOM у ${page.folder}`);
  const map = json('sitemap.json');
  assert.ok(map.origins[originB].notVisited.some((l) => l.href === `${originB}/reports`), 'невидимые ссылки для обхода');
  const reqs = json('network/requests.json');
  assert.ok(reqs.some((r) => r.type === 'main_frame' && r.url.startsWith(originB)));
  assert.ok(archive.get('README.md').toString('utf8').includes('sitemap.json'));
});
