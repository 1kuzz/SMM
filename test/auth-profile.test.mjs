import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPureHelpers } from './helpers/load-pure.mjs';

const { tokenValueShape, looksLikeCredentialName, cookieNamesFrom, summarizeAuthCarriers, foldRequests } = await loadPureHelpers();

test('форма значения описывается, значение — нет', () => {
  const jwt = tokenValueShape('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123');
  assert.equal(jwt.kind, 'jwt');
  assert.ok(jwt.note, 'про срок жизни JWT получателю записи надо сказать прямо');
  assert.equal(jwt.length, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123'.length);

  assert.equal(tokenValueShape('{"a":1}').kind, 'json');
  assert.equal(tokenValueShape('a91f2c3d4e5f60718293').kind, 'hex');
  assert.equal(tokenValueShape('AbCdEf0123456789+/=xyz').kind, 'base64ish');
  assert.equal(tokenValueShape('ru').kind, 'short');
  assert.equal(tokenValueShape(null).kind, 'absent');
  assert.equal(tokenValueShape('').kind, 'empty');

  // и главное: нигде в описании не оказалось самого значения
  const described = JSON.stringify(tokenValueShape('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.secretsig'));
  assert.equal(described.includes('secretsig'), false);
});

test('имя, похожее на учётные данные, распознаётся по смыслу', () => {
  for (const name of ['access_token', 'refreshToken', 'JSESSIONID', 'PHPSESSID', 'sid', 'csrf', 'api-key', 'oauth_state', 'authState']) {
    assert.equal(looksLikeCredentialName(name), true, `${name} должно считаться похожим на учётные данные`);
  }
  // Ложное «здесь лежит токен» в профиле авторизации хуже пропуска: получатель записи
  // начнёт искать логин там, где его нет.
  for (const name of ['theme', 'locale', 'lastPage', 'sidebarWidth', 'lastAccessed', 'residential']) {
    assert.equal(looksLikeCredentialName(name), false, `${name} не учётные данные`);
  }
});

test('из cookie берутся имена и форма, но не значения', () => {
  const cookies = cookieNamesFrom('theme=dark; JSESSIONID=9f2c1d3e4a5b6c7d8e9f; token=eyJhbGciOi.eyJzdWIi.sig');
  assert.deepEqual(cookies.map(c => c.name), ['JSESSIONID', 'theme', 'token']);

  const session = cookies.find(c => c.name === 'JSESSIONID');
  assert.equal(session.credentialLike, true);
  assert.equal(session.valueShape, 'hex');
  assert.equal(session.valueLength, 20);

  const theme = cookies.find(c => c.name === 'theme');
  assert.equal(theme.credentialLike, false);

  // cookie с именем без признаков, но со значением-JWT, всё равно помечается
  assert.equal(cookies.find(c => c.name === 'token').valueShape, 'jwt');

  assert.equal(JSON.stringify(cookies).includes('9f2c1d3e4a5b6c7d8e9f'), false, 'значение cookie не сохраняется');
  assert.deepEqual(cookieNamesFrom(''), []);
  assert.deepEqual(cookieNamesFrom(null), []);
});

test('сводка по авторизации считается по всем запросам', () => {
  const folded = foldRequests([
    { seq: 0, phase: 'start', requestId: 'r-1', requestHeaders: { authorization: '[REDACTED]' }, credentials: 'include', method: 'GET', requestUrl: 'https://x/a' },
    { seq: 1, phase: 'start', requestId: 'r-2', requestHeaders: { authorization: '[REDACTED]', 'x-csrf-token': '[REDACTED]' }, credentials: 'omit', method: 'POST', requestUrl: 'https://x/b' },
    { seq: 2, phase: 'start', requestId: 'r-3', requestHeaders: { 'content-type': 'application/json' }, credentials: 'omit', method: 'GET', requestUrl: 'https://x/c' },
  ]);

  assert.deepEqual(summarizeAuthCarriers(folded), [
    { carrier: 'header:authorization', requests: 2 },
    { carrier: 'cookies:include', requests: 1 },
    { carrier: 'header:x-csrf-token', requests: 1 },
  ]);
  assert.deepEqual(summarizeAuthCarriers([]), []);
  assert.deepEqual(summarizeAuthCarriers(null), []);
});
