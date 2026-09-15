import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPureHelpers } from './helpers/load-pure.mjs';

const { UNPARSED, harHeaderList, harQueryList, harBodyText, buildHarEntry, buildHar } = await loadPureHelpers();

const REQUEST = {
  requestId: 'r-1',
  transport: 'fetch',
  actionId: 'a-3',
  method: 'post',
  requestUrl: 'https://app.example/api/pages/7/assets?draft=1',
  startedAt: '2026-09-15T10:00:00.000Z',
  endedAt: '2026-09-15T10:00:00.120Z',
  durationMs: 120,
  status: 201,
  ok: true,
  requestHeaders: { 'content-type': 'application/json', authorization: '[REDACTED]' },
  requestBody: { src: 'a.js' },
  responseHeaders: { 'content-type': 'application/json', location: '/api/assets/10' },
  responseJson: { id: 10 },
  responseBodyCaptured: true,
  credentials: 'include',
};

test('HAR-запись содержит то, из чего повторяется запрос', () => {
  const entry = buildHarEntry(REQUEST);

  assert.equal(entry.request.method, 'POST', 'метод в HAR всегда в верхнем регистре');
  assert.equal(entry.request.url, REQUEST.requestUrl);
  assert.deepEqual(entry.request.queryString, [{ name: 'draft', value: '1' }]);
  assert.deepEqual(entry.request.postData, { mimeType: 'application/json', text: '{"src":"a.js"}' });
  assert.equal(entry.response.status, 201);
  assert.equal(entry.response.content.mimeType, 'application/json');
  assert.equal(entry.response.content.text, '{"id":10}');
  assert.equal(entry.response.redirectURL, '/api/assets/10');
  assert.equal(entry.time, 120);
  assert.equal(entry.startedDateTime, '2026-09-15T10:00:00.000Z');

  // Заголовки идут как список пар — так их ждёт любой читатель HAR.
  assert.deepEqual(
    entry.request.headers.find(h => h.name === 'content-type'),
    { name: 'content-type', value: 'application/json' },
  );
  // Ровно то, ради чего HAR отсюда полезнее HAR из DevTools: запрос знает свой шаг.
  assert.equal(entry._actionId, 'a-3');
  assert.equal(entry._transport, 'fetch');
});

test('секретное значение не может попасть в HAR: редакция уже произошла выше', () => {
  const entry = buildHarEntry(REQUEST);
  const authorization = entry.request.headers.find(h => h.name === 'authorization');
  assert.equal(authorization.value, '[REDACTED]');
  assert.ok(authorization, 'имя заголовка остаётся — без него HAR не воспроизводится');
});

test('запрос без ответа выражается честно, а не нулями', () => {
  const entry = buildHarEntry({
    requestId: 'r-2', method: 'GET', requestUrl: 'https://app.example/api/x',
    phase: 'error', error: 'NetworkError: failed to fetch',
  });
  assert.equal(entry.response.status, 0);
  assert.equal(entry.response.statusText, 'ERROR');
  assert.equal(entry._error, 'NetworkError: failed to fetch');
  assert.equal(entry.time, -1, 'неизвестная длительность в HAR это -1, а не 0');
  assert.equal(entry.request.bodySize, -1);
  assert.equal(entry.response.content.text, undefined, 'тела не было — поля тоже нет');
});

test('нечитаемое тело не подделывается под содержимое', () => {
  assert.equal(harBodyText(UNPARSED), null);
  assert.equal(harBodyText(null), null);
  assert.equal(harBodyText('<html/>'), '<html/>');
  assert.equal(harBodyText({ a: 1 }), '{"a":1}');

  const entry = buildHarEntry({
    requestId: 'r-3', method: 'POST', requestUrl: 'https://app.example/api/y',
    requestBody: '[BODY_NOT_CAPTURED]', status: 200, responseJson: UNPARSED, responsePreview: 'plain text',
  });
  assert.equal(entry.request.postData, undefined, 'нечитанное тело не должно выглядеть как пустое');
  assert.equal(entry.response.content.text, 'plain text');
});

test('buildHar даёт валидный каркас HAR 1.2', () => {
  const har = buildHar([REQUEST, null, { requestId: 'r-x' }], {
    creatorName: 'action-logger',
    creatorVersion: '7.3.0',
    pages: [{ id: 'page-1', startedDateTime: '2026-09-15T10:00:00.000Z', title: 'Editor' }],
    pageRef: 'page-1',
  });

  assert.equal(har.log.version, '1.2');
  assert.deepEqual(har.log.creator, { name: 'action-logger', version: '7.3.0' });
  assert.equal(har.log.pages.length, 1);
  assert.deepEqual(har.log.pages[0].pageTimings, { onContentLoad: -1, onLoad: -1 });
  // запись без URL не запись: такие отбрасываются, а не превращаются в entry без request.url
  assert.equal(har.log.entries.length, 1);
  assert.equal(har.log.entries[0].pageref, 'page-1');
  // и всё это должно выживать в JSON — HAR читают файлом, а не объектом в памяти
  assert.equal(JSON.parse(JSON.stringify(har)).log.entries[0].request.method, 'POST');
});

test('вспомогательные преобразования не падают на пустом входе', () => {
  assert.deepEqual(harHeaderList(null), []);
  assert.deepEqual(harQueryList('not a url'), []);
  assert.deepEqual(buildHar(null, {}).log.entries, []);
});
