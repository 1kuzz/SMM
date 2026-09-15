// Единственный тест, который доказывает, что запись действительно СОБИРАЕТСЯ в браузере:
// остальные проверяют чистые функции и сам файл. Здесь логгер работает в настоящем
// Chromium, на настоящем клике, с настоящими fetch/XHR/WebSocket — и мы смотрим, что
// оказалось в экспорте. Приём и требование «браузер ставится отдельно от unit-тестов»
// взяты из Migrator (test/integration/*, pretest:integration).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const LOGGER = await readFile(new URL('../../action-logger-v7.js', import.meta.url), 'utf8');

// Секреты, которых не должно оказаться в экспорте НИ В КАКОМ виде.
const BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.s3cr3t-s1gnatur3';
const CSRF = 'csrf-9f2c1d3e4a5b6c7d';

const PAGE = `<!doctype html>
<html><body>
  <h1>Asset editor</h1>
  <label for="src">Src</label>
  <input id="src" name="src" />
  <button id="save" type="button">Save asset</button>
  <button id="html" type="button">Fetch HTML</button>
  <button id="xhr" type="button">Send XHR</button>
  <button id="ws" type="button">Open socket</button>
  <script>
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('access_token', ${JSON.stringify(BEARER)});

    // Подставной WebSocket: настоящего сервера в тесте нет, а обёртка логгера должна
    // оборачивать то, что предоставляет платформа, чем бы оно ни было.
    window.WebSocket = class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) { this.url = url; this.listeners = {}; }
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
      send(data) { this.lastSent = data; (this.listeners.message || []).forEach(fn => fn({ data: '{"ack":true,"id":10}' })); }
    };

    document.getElementById('save').addEventListener('click', async () => {
      await fetch('/api/pages/1428/assets', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ${JSON.stringify(BEARER)},
          'X-CSRF-Token': ${JSON.stringify(CSRF)},
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ src: document.getElementById('src').value, password: 'hunter2', async: true })
      });
    });

    document.getElementById('html').addEventListener('click', async () => {
      await fetch('/api/broken-page');
    });

    document.getElementById('xhr').addEventListener('click', () => {
      const xhr = new XMLHttpRequest();
      xhr.open('DELETE', '/api/pages/1428/assets/77');
      xhr.setRequestHeader('X-CSRF-Token', ${JSON.stringify(CSRF)});
      xhr.send();
    });

    document.getElementById('ws').addEventListener('click', () => {
      const socket = new WebSocket('wss://app.example/live');
      socket.send('{"op":"subscribe","page":1428}');
    });
  </script>
</body></html>`;

async function record() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'https://app.example' });
  const page = await context.newPage();

  await page.route('**/api/pages/*/assets', route => route.fulfill({
    status: 201,
    headers: { 'content-type': 'application/json', 'location': '/api/assets/10', 'set-cookie': 'server_session=zzz999' },
    body: JSON.stringify({ id: 10, src: 'a.js', secret: 'must-not-appear' }),
  }));
  await page.route('**/api/pages/*/assets/*', route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/broken-page', route => route.fulfill({
    status: 500, headers: { 'content-type': 'text/html' }, body: '<html><body>Internal Error</body></html>',
  }));
  await page.route('**/', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: PAGE }));

  await page.goto('https://app.example/');
  await page.addScriptTag({ content: LOGGER });
  await page.evaluate(() => window.__logger.setMacroName('add-js-asset'));

  await page.fill('#src', 'https://cdn.example/a.js');
  await page.click('#save');
  await page.click('#html');
  await page.click('#xhr');
  await page.click('#ws');
  // хвост ответов и finalizeAction
  await page.waitForTimeout(1500);

  const bundle = await page.evaluate(() => {
    const payload = window.__logger.export();
    // Возвращаем через JSON — ровно то, что попало бы в файл, без живых ссылок на DOM.
    return JSON.parse(JSON.stringify(payload));
  });
  const har = await page.evaluate(() => JSON.parse(JSON.stringify(window.__logger.exportHar())));
  const plan = await page.evaluate(() => JSON.parse(JSON.stringify(window.__logger.exportPlan())));

  await browser.close();
  return { bundle, har, plan };
}

// Chromium ставится отдельно от unit-тестов (npm run test:integration / CI-шаг ниже).
// Если его нет — честный skip с объяснением, а не падение с невнятным стеком: unit-часть
// от этого не зависит, и `npm run check` на чужой машине не должен упираться в браузер.
let bundle;
let har;
let plan;
let unavailable = null;
try {
  ({ bundle, har, plan } = await record());
} catch (error) {
  unavailable = error && error.message ? error.message : String(error);
}

if (unavailable) {
  test('живая запись в браузере', { skip: `Chromium недоступен: ${unavailable.split('\n')[0]}` }, () => {});
}

const live = (name, fn) => test(name, { skip: unavailable ? 'Chromium недоступен' : false }, fn);

live('в экспорте нет ни одного секретного значения, хотя они были в запросах', () => {
  const serialized = JSON.stringify(bundle) + JSON.stringify(har);
  // Ровно тот случай, ради которого редакция сохраняет ИМЯ, но не значение.
  assert.equal(serialized.includes(BEARER), false, 'токен из Authorization/localStorage не должен попасть в экспорт');
  assert.equal(serialized.includes(CSRF), false, 'значение CSRF-заголовка не должно попасть в экспорт');
  assert.equal(serialized.includes('hunter2'), false, 'поле password из тела запроса не должно попасть в экспорт');
  assert.equal(serialized.includes('server_session=zzz999'), false, 'Set-Cookie ответа не должен попасть в экспорт');
});

live('заголовки запроса записались — и имена секретных тоже', () => {
  const start = bundle.network.find(e => e.phase === 'start' && e.method === 'POST');
  assert.ok(start, 'POST не попал в network[]');
  assert.equal(start.requestHeaders['content-type'], 'application/json');
  assert.equal(start.requestHeaders['x-requested-with'], 'XMLHttpRequest');
  assert.equal(start.requestHeaders.authorization, '[REDACTED]');
  assert.equal(start.requestHeaders['x-csrf-token'], '[REDACTED]');
  assert.equal(start.credentials, 'include');

  const end = bundle.network.find(e => e.phase === 'end' && e.method === 'POST');
  assert.equal(end.responseHeaders['content-type'], 'application/json');
  assert.equal(end.responseHeaders.location, '/api/assets/10');
});

live('тело ответа лежит разобранным, а секретный ключ внутри — отредактирован', () => {
  const end = bundle.network.find(e => e.phase === 'end' && e.method === 'POST');
  assert.equal(end.responseBodyCaptured, true);
  assert.deepEqual(end.responseJson.id, 10);
  assert.equal(end.responseJson.src, 'a.js');
  assert.equal(end.responseJson.secret, '[REDACTED]');
});

live('не-JSON ответ помечается __UNPARSED__, а не выдаёт себя за пустой', () => {
  const failed = bundle.network.find(e => e.phase === 'end' && String(e.requestUrl).includes('broken-page'));
  assert.ok(failed, 'ответ 500 должен попасть в запись: ошибки пишутся всегда');
  assert.equal(failed.status, 500);
  assert.equal(failed.responseJson, '__UNPARSED__');
  assert.match(failed.responsePreview, /Internal Error/);
});

live('эндпоинты собрались в инвентарь и знают шаг-инициатор', () => {
  const write = bundle.endpoints.find(e => e.key === 'POST https://app.example/api/pages/{int}/assets');
  assert.ok(write, `в инвентаре нет POST-эндпоинта: ${bundle.endpoints.map(e => e.key).join(' | ')}`);
  assert.equal(write.write, true);
  assert.equal(write.background, false);
  assert.deepEqual(write.statuses, { 201: 1 });
  assert.ok(write.requestHeaderNames.includes('authorization'));
  assert.ok(write.authCarriers.includes('header:authorization'));
  assert.ok(write.authCarriers.includes('cookies:include'));
  // Типы в теле обязаны сохраниться: по строке "true" вместо true пишется клиент,
  // который сервер отвергнет.
  assert.deepEqual(write.requestShape, { src: 'string', password: 'string', async: 'boolean' });
  const postBody = bundle.network.find(e => e.phase === 'start' && e.method === 'POST').body;
  assert.equal(postBody.async, true);
  assert.equal(postBody.src, 'https://cdn.example/a.js');
  assert.equal(postBody.password, '[REDACTED]');
  assert.deepEqual(write.responseShape, { id: 'number', src: 'string', secret: 'string' });
  assert.equal(write.triggeredBy.length, 1, 'клик по Save должен быть виден как инициатор');

  // XHR-запрос тоже эндпоинт, и это DELETE — то есть «меняет состояние»
  const del = bundle.endpoints.find(e => e.method === 'DELETE');
  assert.ok(del, 'DELETE через XHR должен попасть в инвентарь');
  assert.equal(del.write, true);
  assert.deepEqual(del.statuses, { 204: 1 });
  assert.ok(del.requestHeaderNames.includes('x-csrf-token'), 'заголовки XHR берутся из setRequestHeader');
});

live('профиль авторизации отвечает, как входить, не выдавая чем', () => {
  const auth = bundle.authProfile;
  assert.equal(auth.mechanism, 'bearer_header');
  assert.deepEqual(auth.csrfHeaders, ['header:x-csrf-token']);
  assert.equal(auth.httpOnlyCookiesInvisible, true, 'про невидимые HttpOnly-cookie надо сказать прямо');
  assert.ok(auth.recommendation.length > 40);

  const stored = auth.storageCredentials.find(x => x.key === 'access_token');
  assert.ok(stored, 'ключ localStorage, похожий на токен, должен быть назван');
  assert.equal(stored.valueShape, 'jwt');
  assert.equal(stored.source, 'localStorage');
  assert.equal(auth.storageCredentials.some(x => x.key === 'theme'), false, 'обычные настройки — не учётные данные');
});

live('кадры WebSocket записались и привязались к шагу', () => {
  assert.equal(bundle.streams.length, 1, `ожидался один сокет, получено: ${JSON.stringify(bundle.streams.map(s => s.url))}`);
  const socket = bundle.streams[0];
  assert.equal(socket.kind, 'websocket');
  assert.equal(socket.url, 'wss://app.example/live');
  assert.ok(socket.actionId, 'сокет должен знать шаг, на котором его открыли');

  const sent = socket.frames.find(f => f.direction === 'sent');
  const received = socket.frames.find(f => f.direction === 'received');
  assert.deepEqual(sent.json, { op: 'subscribe', page: 1428 });
  assert.deepEqual(received.json, { ack: true, id: 10 });
});

live('HAR валиден, и каждый запрос в нём помнит свой шаг', () => {
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.version, '7.3.0');
  const post = har.log.entries.find(e => e.request.method === 'POST' && e.request.url.includes('/assets'));
  assert.ok(post);
  assert.equal(post.response.status, 201);
  assert.ok(post._actionId, 'привязка запроса к шагу — то, чего нет в HAR из DevTools');
  assert.equal(JSON.parse(post.request.postData.text).src, 'https://cdn.example/a.js');
  assert.ok(post.request.headers.some(h => h.name === 'authorization' && h.value === '[REDACTED]'));
});

live('краткий вывод и открытые вопросы говорят, с чего начинать скрипт', () => {
  assert.equal(bundle.brief.authMechanism, 'bearer_header');
  assert.equal(bundle.brief.apiFirstFeasible, true);
  assert.ok(bundle.brief.stateChangingEndpoints.length >= 2);

  const types = bundle.openQuestions.map(q => q.type);
  // Токен есть, а запроса, который его выдаёт, в записи нет — это надо спросить, а не угадать.
  assert.ok(types.includes('token_source_unknown'), `ожидался вопрос про источник токена, есть: ${types.join(', ')}`);
  assert.ok(types.includes('csrf_source_unknown'));
});

live('шаги сценария по-прежнему записываются как раньше', () => {
  const fill = bundle.timeline.find(a => a.action === 'fill');
  assert.equal(fill.value, 'https://cdn.example/a.js');
  const clicks = bundle.timeline.filter(a => a.action === 'click');
  assert.equal(clicks.length, 4, `ожидалось четыре клика, записано ${clicks.length}`);
  assert.ok(bundle.generated.playwright.includes('test('), 'Playwright-черновик должен генерироваться');
  assert.match(bundle.generated.technicalSpecMarkdown, /## API surface exercised by this recording/);
  assert.match(bundle.generated.technicalSpecMarkdown, /## Authentication/);
});

live('компактный план самодостаточен: его отдают вместо bundle', () => {
  // Если план теряет authProfile/endpoints, то отдавший его получает инструкцию «куда
  // нажимать» без ответа на «как войти» — и это выясняется только при написании кода.
  assert.equal(plan.brief.authMechanism, 'bearer_header');
  assert.equal(plan.authProfile.mechanism, 'bearer_header');
  assert.ok(plan.endpoints.some(e => e.key === 'POST https://app.example/api/pages/{int}/assets'));
  assert.ok(plan.openQuestions.some(q => q.type === 'token_source_unknown'));
  assert.ok(plan.steps.length >= 5);
  // и при этом остаётся компактным: сырых снапшотов и тел ответов в нём нет
  assert.equal('screens' in plan, false);
  assert.equal('network' in plan, false);
  assert.equal('rawLog' in plan, false);
});
