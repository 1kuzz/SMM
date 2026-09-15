import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPureHelpers } from './helpers/load-pure.mjs';

const {
  UNPARSED, parseRawHeaderString, headerMapOf, redactHeaderMap, isSecretHeaderName,
  redactTextBody, parseJsonBody, redactJson, boundText, truncateString
} = await loadPureHelpers();

const SENSITIVE = /pass(word)?|pwd|secret|token|auth|authorization|cookie|session|csrf|api[-_]?key/i;

test('заголовки нормализуются из всех четырёх форм, в которых их отдаёт платформа', () => {
  // сырая строка getAllResponseHeaders()
  assert.deepEqual(
    parseRawHeaderString('Content-Type: application/json\r\nETag: "a1"\r\n'),
    { 'content-type': 'application/json', etag: '"a1"' },
  );
  // повторяющийся заголовок не теряется, а склеивается — как это делает и сам браузер
  assert.deepEqual(
    parseRawHeaderString('Set-Cookie: a=1\nSet-Cookie: b=2'),
    { 'set-cookie': 'a=1, b=2' },
  );
  // Headers-подобный объект
  const headersLike = {
    get: () => null,
    forEach: fn => { fn('application/json', 'Content-Type'); fn('xhr', 'X-Requested-With'); },
  };
  assert.deepEqual(headerMapOf(headersLike), { 'content-type': 'application/json', 'x-requested-with': 'xhr' });
  // массив пар и обычный объект
  assert.deepEqual(headerMapOf([['Accept', 'application/json']]), { accept: 'application/json' });
  assert.deepEqual(headerMapOf({ Accept: 'text/html' }), { accept: 'text/html' });
  // ничего не передали — пустая карта, а не исключение
  assert.deepEqual(headerMapOf(null), {});
  assert.deepEqual(headerMapOf(undefined), {});
});

test('секретный заголовок теряет значение, но НЕ имя', () => {
  const redacted = redactHeaderMap({
    Authorization: 'Bearer eyJhbGciOi.payload.sig',
    'X-CSRF-Token': 'abc123',
    Cookie: 'session=zzz',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  }, SENSITIVE);

  // Ради этого различия всё и сделано: скрипт должен знать, что запрос не пройдёт без
  // Authorization, но само значение в записи оставлять нельзя.
  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted['x-csrf-token'], '[REDACTED]');
  assert.equal(redacted.cookie, '[REDACTED]');
  assert.ok('authorization' in redacted, 'имя секретного заголовка обязано сохраниться');

  // Контрактные заголовки — это не секрет, без них API-клиент не написать.
  assert.equal(redacted['content-type'], 'application/json');
  assert.equal(redacted['x-requested-with'], 'XMLHttpRequest');
});

test('contract-заголовок не редактируется, даже если его имя матчится sensitivePattern', () => {
  // 'content-type' содержит 'content', но встречаются паттерны шире; обратный случай
  // важнее: 'authorization' в списке секретных, и никакой паттерн его не спасёт.
  assert.equal(isSecretHeaderName('content-type', /type/i), false);
  assert.equal(isSecretHeaderName('authorization', null), true);
  assert.equal(isSecretHeaderName('x-tenant-id', SENSITIVE), false);
  assert.equal(isSecretHeaderName('x-session-token', null), true);
});

test('тело разбирается ДО обрезки, а не после (именованный баг №1 в Migrator)', () => {
  const long = JSON.stringify({ id: 7, text: 'x'.repeat(500), nested: { ok: true } });

  // Старое поведение: обрезать текст до лимита и положить строку — получатель не может
  // её распарсить и не знает, что потерялось. Теперь структура цела при любом лимите.
  const parsed = parseJsonBody(long);
  assert.notEqual(parsed, UNPARSED);
  const evidence = redactJson(parsed, SENSITIVE, 50);
  assert.equal(evidence.id, 7);
  assert.equal(evidence.nested.ok, true, 'вложенная структура должна выжить при малом лимите');
  assert.match(evidence.text, /^x{50}\.\.\.\[\+450\]$/, 'режется значение строки, а не JSON вокруг него');
});

test('__UNPARSED__ и null различимы, как и «тела не читали»', () => {
  assert.equal(parseJsonBody(null), UNPARSED, 'тела не было');
  assert.equal(parseJsonBody(''), UNPARSED, 'пустое тело');
  assert.equal(parseJsonBody('<html>oops</html>'), UNPARSED, 'не JSON');
  assert.equal(parseJsonBody('{"broken":'), UNPARSED, 'битый JSON — не догадка о содержимом');

  // А это — настоящий null от сервера, и он обязан отличаться от всего перечисленного.
  assert.equal(parseJsonBody('null'), null);
  assert.notEqual(parseJsonBody('null'), UNPARSED);

  // и пустой массив — это не «ничего»
  assert.deepEqual(parseJsonBody('[]'), []);
});

test('значения секретных ключей в теле не сохраняются ни на какой глубине', () => {
  const body = {
    user: 'ivan',
    password: 'hunter2',
    nested: { access_token: 'aaa.bbb.ccc', keep: 'visible' },
    list: [{ apiKey: 'k' }, { plain: 'p' }],
  };
  const redacted = redactJson(body, SENSITIVE, 1000);
  assert.equal(redacted.user, 'ivan');
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.nested.access_token, '[REDACTED]');
  assert.equal(redacted.nested.keep, 'visible');
  assert.equal(redacted.list[0].apiKey, '[REDACTED]');
  assert.equal(redacted.list[1].plain, 'p');
  assert.equal(JSON.stringify(redacted).includes('hunter2'), false);
});

test('инлайновый Bearer вычищается и из не-JSON тела, и из строк внутри JSON', () => {
  assert.equal(
    redactTextBody('curl -H "Authorization: Bearer eyJ0eXAi.abc-def_123" https://x'),
    'curl -H "Authorization: Bearer [REDACTED]" https://x',
  );
  const redacted = redactJson({ note: 'use Bearer abc123DEF to call' }, SENSITIVE, 1000);
  assert.equal(redacted.note, 'use Bearer [REDACTED] to call');
  assert.equal(redactTextBody(null), null);
});

test('обрезка всегда сообщает о себе', () => {
  assert.deepEqual(boundText('hello', 100), { text: 'hello', truncated: false, originalLength: 5 });
  assert.deepEqual(boundText('hello', 2), { text: 'he', truncated: true, originalLength: 5 });
  assert.deepEqual(boundText(null, 2), { text: null, truncated: false, originalLength: 0 });
  assert.equal(truncateString('abcdef', 3), 'abc...[+3]');
  assert.equal(truncateString('abc', 0), 'abc', 'лимит 0 = без лимита, а не пустая строка');
});

test('глубина и ширина тела ограничены, но потеря отмечена', () => {
  let deep = { end: true };
  for (let i = 0; i < 12; i++) deep = { nested: deep };
  assert.equal(JSON.stringify(redactJson(deep, SENSITIVE, 100)).includes('[MAX_DEPTH]'), true);

  const wide = Array.from({ length: 250 }, (_, i) => i);
  const redacted = redactJson(wide, SENSITIVE, 100);
  assert.equal(redacted.length, 201);
  assert.equal(redacted[200], '...[+50 items]');
});
