// Проверки, которые нельзя сделать, вызвав функцию: они про сам файл. Приём тот же, что
// в Migrator (test/discovery-resilience.test.mjs, вторая половина) — утверждения по
// исходнику там, где поведение живёт в браузере, а сломать его легко невнимательной правкой.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loggerSource, EXPORTED } from './helpers/load-pure.mjs';

const source = await loggerSource();
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

function section(beginMarker, endMarker) {
  const start = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `не найден маркер ${beginMarker}`);
  assert.notEqual(end, -1, `не найден маркер ${endMarker}`);
  return source.slice(start, end);
}

test('версия скрипта и манифеста совпадают', () => {
  const declared = source.match(/const VERSION = '([\d.]+)';/);
  assert.ok(declared, 'VERSION не найдена в исходнике');
  assert.equal(manifest.version, declared[1]);
  assert.ok(
    manifest.name.includes(declared[1].split('.').slice(0, 2).join('.')),
    `имя расширения (${manifest.name}) должно называть ту же минорную версию, что и скрипт`,
  );
});

// Комментарии в проверке чистоты не участвуют: в них имя document/config упоминается
// по делу («document.cookie отдаёт одну строку»), а запрещено именно обращение из кода.
function withoutComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('блок чистых помощников остаётся чистым', () => {
  const block = withoutComments(section('// --- PURE-HELPERS-BEGIN ---', '// --- PURE-HELPERS-END ---'));
  // Если сюда просочится обращение к состоянию логгера, блок перестанет проверяться в
  // node — и молча: тест на загрузку прошёл бы, а упало бы только на вызове.
  for (const forbidden of ['config.', 'document.', 'window.', 'location.', 'networkLog', 'macroLog', 'streamLog', 'session.']) {
    assert.equal(block.includes(forbidden), false, `в чистом блоке не должно быть обращений к ${forbidden}`);
  }
  for (const name of EXPORTED) {
    const declared = new RegExp(`(function|const)\\s+${name}\\b`);
    assert.match(block, declared, `${name} объявлен вне чистого блока — харнесс его не увидит`);
  }
});

test('destroy() возвращает на место КАЖДЫЙ перехваченный нативный метод', () => {
  // Логгер патчит fetch/XHR/WebSocket/EventSource/sendBeacon в каждом окне. Забыть один
  // при добавлении нового — значит оставить страницу с обёрткой после выгрузки логгера.
  const stored = section('nativeByWindow.set(win, {', '});');
  const keys = [...stored.matchAll(/(\w+):\s*native/g)].map(m => m[1]);
  assert.ok(keys.length >= 7, `ожидалось не меньше семи перехватов, найдено ${keys.length}`);

  const restore = section('for (const w of patchedWindowsList) {', 'try { window.open = native.open; }');
  for (const key of keys) {
    assert.ok(restore.includes(`n.${key}`), `destroy() не восстанавливает n.${key}`);
  }
});

test('WebSocket подменяется так, что instanceof и константы у страницы не ломаются', () => {
  assert.match(source, /LoggedWebSocket\.prototype = nativeWebSocket\.prototype/);
  assert.match(source, /for \(const name of \['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'\]\)/);
  assert.match(source, /LoggedEventSource\.prototype = nativeEventSource\.prototype/);
});

test('старый путь «обрезать ответ до разбора» больше не существует', () => {
  // Именованный баг №1 в Migrator network/recorder.py. Раньше здесь было
  // responsePreview: truncBytes(text, ...) — текст резался, и JSON становился нечитаемым.
  assert.equal(/responsePreview:\s*truncBytes/.test(source), false);
  assert.equal(/base\.responsePreview\s*=\s*truncBytes/.test(source), false);
  assert.match(source, /function responseBodyEvidence/);
  // порядок в самой функции: сначала разбор, только потом границы
  const evidence = section('function responseBodyEvidence', '\n  function pushNetwork');
  assert.ok(
    evidence.indexOf('parseJsonBody') < evidence.indexOf('boundText'),
    'в responseBodyEvidence разбор обязан идти до обрезки',
  );
});

test('«тело не читали» сообщается явно на каждом пути, где его не читали', () => {
  // Иначе отсутствие responseJson читается как «ответ был пустой», что неправда.
  // fetch (тело не запрашивали), XHR (не запрашивали / responseType не текстовый),
  // sendBeacon (ответа не существует в принципе).
  const occurrences = source.match(/responseBodyCaptured(: | = )false/g) || [];
  assert.ok(occurrences.length >= 4, `ожидалось не меньше четырёх явных отметок, найдено ${occurrences.length}`);
});

test('журнал стримов живёт по тем же правилам, что остальные журналы', () => {
  assert.match(source, /if \(streamLog\.length > config\.maxStreamEntries\)/, 'streamLog должен подрезаться в trimLogs');
  assert.match(source, /streamLog,\n\s+rawLog,/, 'streamLog должен попадать в полный бэкап');
  assert.match(source, /streamLog\.length = 0;/, 'clear() должен очищать streamLog');
  assert.match(source, /payload\.streamLog/, 'streamLog должен восстанавливаться из IndexedDB');
});

test('инструмент остаётся сайт-независимым', () => {
  // v7.2 специально убрала списки конкретных URL. Инвентарь эндпоинтов — соблазн вернуть
  // их обратно («у нас же всегда /api/...»), и тогда запись на другом сайте снова врёт.
  assert.match(source, /bodyCaptureAllowlist: \[\]/);
  const configBlock = section('const config = {', '\n  // ----');
  assert.equal(/https?:\/\/(?!REPLACE)[a-z0-9.-]+\.[a-z]{2,}/i.test(configBlock), false, 'в config не должно быть зашитых адресов сайтов');
});

test('каждая кнопка панели действительно к чему-то привязана', () => {
  const panelMarkup = section('panel.innerHTML = `', '`;\n\n    document.body.appendChild(panel)');
  const ids = [...panelMarkup.matchAll(/'(__al-[a-z-]+)'/g)].map(m => m[1]);
  assert.ok(ids.includes('__al-export-api') && ids.includes('__al-export-har'), 'новые экспорты должны быть в панели');
  for (const id of ids) {
    assert.ok(
      source.includes(`#${id}'`) || source.includes(`#${id}"`),
      `кнопка ${id} нарисована, но обработчика на неё нет`,
    );
  }
});

test('публичный API называет новые экспорты', () => {
  const api = section('window.__logger = {', '\n  };');
  for (const name of ['exportHar', 'exportApi', 'streamLog']) {
    assert.ok(api.includes(name), `${name} не выставлен в window.__logger`);
  }
});
