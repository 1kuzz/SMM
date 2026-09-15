import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPureHelpers } from './helpers/load-pure.mjs';

const {
  UNPARSED, templatizeSegment, endpointKeyOf, foldRequests, buildEndpointInventory,
  jsonShape, mergeShapes, authCarriersOf,
} = await loadPureHelpers();

test('нестабильный сегмент пути превращается в параметр, стабильный — нет', () => {
  assert.equal(templatizeSegment('1428'), '{int}');
  assert.equal(templatizeSegment('9f2c1d3e-1111-4222-8333-abcdefabcdef'), '{uuid}');
  assert.equal(templatizeSegment('2026-09-15'), '{date}');
  assert.equal(templatizeSegment('a91f2c3d4e5f6071'), '{hash}');
  // осмысленные части пути обязаны остаться собой, иначе инвентарь бесполезен
  assert.equal(templatizeSegment('pages'), 'pages');
  assert.equal(templatizeSegment('page-assets'), 'page-assets');
  assert.equal(templatizeSegment('en-US'), 'en-US');
  assert.equal(templatizeSegment('v2'), 'v2');
  // файл с хешем в имени остаётся файлом: расширение — не параметр
  assert.equal(templatizeSegment('app.a91f2c3d4e.js'), 'app.{hash}.js');
  assert.equal(templatizeSegment('style.css'), 'style.css');
  assert.equal(templatizeSegment(''), '');
});

test('два вызова одного эндпоинта с разными id — это один эндпоинт', () => {
  const a = endpointKeyOf('post', 'https://app.example/api/pages/1428/assets?draft=1');
  const b = endpointKeyOf('POST', 'https://app.example/api/pages/1429/assets?draft=0');
  assert.equal(a.key, b.key);
  assert.equal(a.key, 'POST https://app.example/api/pages/{int}/assets');
  assert.deepEqual(a.queryKeys, ['draft']);
  assert.equal(a.method, 'POST');
});

test('относительный URL и мусор вместо URL не роняют ключ', () => {
  const relative = endpointKeyOf('GET', '/api/me', 'https://app.example/page');
  assert.equal(relative.key, 'GET https://app.example/api/me');
  const broken = endpointKeyOf('GET', 'not a url?x=1');
  assert.equal(broken.key, 'GET not a url');
});

test('start/end/error сворачиваются в один запрос', () => {
  const folded = foldRequests([
    { seq: 0, phase: 'start', requestId: 'r-1', transport: 'fetch', actionId: 'a-1', method: 'POST', requestUrl: 'https://x/api/save', iso: 'T0', requestHeaders: { 'content-type': 'application/json' }, body: { title: 'hi' }, credentials: 'include' },
    { seq: 1, phase: 'end', requestId: 'r-1', transport: 'fetch', status: 200, ok: true, durationMs: 42, responseHeaders: { 'content-type': 'application/json' }, responseJson: { id: 5 }, responseBodyCaptured: true, iso: 'T1' },
    { seq: 2, phase: 'start', requestId: 'r-2', transport: 'xhr', method: 'GET', requestUrl: 'https://x/api/list', iso: 'T2' },
    { seq: 3, phase: 'error', requestId: 'r-2', transport: 'xhr', error: 'NetworkError', durationMs: 9, iso: 'T3' },
  ]);

  assert.equal(folded.length, 2);
  assert.equal(folded[0].method, 'POST');
  assert.equal(folded[0].status, 200);
  assert.deepEqual(folded[0].requestBody, { title: 'hi' });
  assert.deepEqual(folded[0].responseJson, { id: 5 });
  assert.equal(folded[0].actionId, 'a-1');
  assert.equal(folded[0].durationMs, 42);
  assert.equal(folded[1].error, 'NetworkError');
  assert.equal(folded[1].phase, 'error');
});

test('end без start не выдумывает метод и не теряется', () => {
  // так бывает после restore: start уехал за maxNetworkEntries, end остался
  const folded = foldRequests([
    { seq: 9, phase: 'end', requestId: 'r-9', method: 'DELETE', requestUrl: 'https://x/api/row/3', status: 204 },
  ]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].method, 'DELETE');
  assert.equal(folded[0].status, 204);
});

test('форма тела — это объединение всех вызовов, а не последний', () => {
  const first = jsonShape({ id: 1, title: 'a', tags: ['x'] });
  const second = jsonShape({ id: 2, title: 'b', tags: ['y'], draft: true });
  const merged = mergeShapes(first, second);

  assert.deepEqual(merged.id, 'number');
  assert.deepEqual(merged.tags, ['string']);
  // ключ, которого не было в одном из вызовов, помечается, а не исчезает из контракта
  assert.deepEqual(merged.draft, { __optional: 'boolean' });

  // разные типы на одном месте — честный union
  assert.deepEqual(mergeShapes('string', 'number'), { __oneOf: ['string', 'number'] });
  assert.deepEqual(mergeShapes({ __oneOf: ['string', 'number'] }, 'null'), { __oneOf: ['string', 'number', 'null'] });
  // null сервера остаётся 'null', а нечитаемое тело — 'unparsed'
  assert.equal(jsonShape(null), 'null');
  assert.equal(jsonShape(UNPARSED), 'unparsed');
  assert.deepEqual(jsonShape([]), []);
});

test('инвентарь отвечает на «что звать вместо кликов»', () => {
  const actions = [
    { id: 'a-1', order: 4, action: 'click' },
    { id: 'a-2', order: 7, action: 'click' },
  ];
  const folded = foldRequests([
    { seq: 0, phase: 'start', requestId: 'r-1', transport: 'fetch', actionId: 'a-1', method: 'POST', requestUrl: 'https://app.example/api/pages/1/assets', requestHeaders: { 'content-type': 'application/json', authorization: '[REDACTED]' }, body: { src: 'a.js' }, credentials: 'include' },
    { seq: 1, phase: 'end', requestId: 'r-1', status: 201, ok: true, durationMs: 120, responseHeaders: { 'content-type': 'application/json' }, responseJson: { id: 10, src: 'a.js' } },
    { seq: 2, phase: 'start', requestId: 'r-2', transport: 'fetch', actionId: 'a-2', method: 'POST', requestUrl: 'https://app.example/api/pages/2/assets', requestHeaders: { 'content-type': 'application/json', authorization: '[REDACTED]' }, body: { src: 'b.js', async: true } },
    { seq: 3, phase: 'end', requestId: 'r-2', status: 409, ok: false, durationMs: 80, responseHeaders: { 'content-type': 'application/json' }, responseJson: { error: 'exists' } },
    // фоновый запрос без шага-инициатора
    { seq: 4, phase: 'start', requestId: 'r-3', transport: 'fetch', method: 'GET', requestUrl: 'https://app.example/api/ping' },
    { seq: 5, phase: 'end', requestId: 'r-3', status: 200, ok: true, durationMs: 5 },
    // и то, что просили игнорировать
    { seq: 6, phase: 'start', requestId: 'r-4', transport: 'fetch', method: 'POST', requestUrl: 'https://google-analytics.com/collect' },
  ]);

  const endpoints = buildEndpointInventory(folded, actions, {
    ignore: ['google-analytics'],
    baseOrigin: 'https://app.example',
    maxSamples: 3,
  });

  assert.equal(endpoints.length, 2, 'игнор-лист применяется, а вызовы с разными id сливаются');

  const write = endpoints[0];
  assert.equal(write.key, 'POST https://app.example/api/pages/{int}/assets');
  assert.equal(write.write, true, 'POST меняет состояние — это должно быть видно без разбора метода');
  assert.equal(write.calls, 2);
  assert.deepEqual(write.statuses, { 201: 1, 409: 1 });
  assert.equal(write.failures, 1);
  assert.deepEqual(write.errors, ['HTTP 409']);
  assert.equal(write.sameOrigin, true);
  assert.equal(write.background, false);
  assert.deepEqual(write.triggeredBy.map(t => t.order), [4, 7]);
  assert.deepEqual(write.latencyMs, { min: 80, max: 120 });
  assert.deepEqual(write.sampleUrls.length, 2);
  // имена заголовков — часть контракта вызова
  assert.deepEqual(write.requestHeaderNames, ['authorization', 'content-type']);
  assert.deepEqual(write.authCarriers, ['header:authorization', 'cookies:include']);
  // форма запроса объединена по обоим вызовам
  assert.deepEqual(write.requestShape, { src: 'string', async: { __optional: 'boolean' } });
  assert.deepEqual(write.responseShape, { id: { __optional: 'number' }, src: { __optional: 'string' }, error: { __optional: 'string' } });

  const background = endpoints[1];
  assert.equal(background.key, 'GET https://app.example/api/ping');
  assert.equal(background.background, true, 'запрос без шага-инициатора помечается фоновым');
  assert.equal(background.write, false);
});

test('меняющие состояние и привязанные к шагам идут в инвентаре первыми', () => {
  const folded = foldRequests([
    { seq: 0, phase: 'start', requestId: 'r-1', method: 'GET', requestUrl: 'https://x/api/a', actionId: 'a-1' },
    { seq: 1, phase: 'end', requestId: 'r-1', status: 200 },
    { seq: 2, phase: 'start', requestId: 'r-2', method: 'DELETE', requestUrl: 'https://x/api/b', actionId: 'a-1' },
    { seq: 3, phase: 'end', requestId: 'r-2', status: 204 },
    { seq: 4, phase: 'start', requestId: 'r-3', method: 'POST', requestUrl: 'https://x/api/c' },
    { seq: 5, phase: 'end', requestId: 'r-3', status: 200 },
  ]);
  const keys = buildEndpointInventory(folded, [{ id: 'a-1', order: 1, action: 'click' }]).map(e => e.key);
  assert.deepEqual(keys, ['DELETE https://x/api/b', 'GET https://x/api/a', 'POST https://x/api/c']);
});

test('тело, которое не читали, не превращается в пустой контракт', () => {
  const folded = foldRequests([
    { seq: 0, phase: 'start', requestId: 'r-1', method: 'POST', requestUrl: 'https://x/api/a', body: '[BODY_NOT_CAPTURED]', actionId: 'a-1' },
    { seq: 1, phase: 'end', requestId: 'r-1', status: 200, responseJson: UNPARSED, responsePreview: '<html/>', responseBodyCaptured: true },
  ]);
  const [endpoint] = buildEndpointInventory(folded, []);
  assert.equal('requestShape' in endpoint, false, 'нечитанное тело не должно выглядеть как пустой payload');
  assert.equal('responseShape' in endpoint, false, 'не-JSON ответ не должен выглядеть как форма ответа');
});

test('credentials — единственный видимый след cookie-авторизации', () => {
  assert.deepEqual(authCarriersOf({ authorization: '[REDACTED]' }, 'omit'), ['header:authorization']);
  assert.deepEqual(authCarriersOf({}, 'include'), ['cookies:include']);
  assert.deepEqual(authCarriersOf({ 'x-xsrf-token': '[REDACTED]' }, 'same-origin'), ['header:x-xsrf-token', 'cookies:same-origin']);
  assert.deepEqual(authCarriersOf({ 'content-type': 'application/json' }, 'omit'), []);
});
