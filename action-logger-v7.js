/**
 * ACTION LOGGER v7 — AI-first recorder действий для последующего ТЗ, макросов и Playwright.
 *
 * Цель: один раз запустить в DevTools Console, пройти сценарий строго по порядку,
 * нажать «Стоп + экспорт» и получить ОДИН максимально подробный JSON.
 *
 * v7 добавляет поверх возможностей v6:
 *  [1] строгие actionId/order + rawSeqStart/rawSeqEnd для точного связывания событий;
 *  [2] before/after screen snapshots и screen diff для каждого действия;
 *  [3] автоматические inferredExpected по фактическим последствиям действия;
 *  [4] корреляцию fetch/XHR с действием, которое запустило запрос;
 *  [5] единый AI bundle при stop(): timeline + raw + screens + network + variables + warnings + Playwright + draft ТЗ;
 *  [6] locator confidence score/level/reasons — неуникальные локаторы явно помечаются;
 *  [7] hover сохраняется, если после него действительно изменился UI, в том числе parent→submenu;
 *  [8] pageId/popup context; same-origin popup по возможности подключается к записи;
 *  [9] download-кандидаты: <a download>, программные anchor.click(), Blob URL;
 * [10] автоматические variable candidates для вводимых/выбираемых значений;
 * [11] подробный AI-oriented schema и warnings вместо необходимости ставить заметки во время записи;
 * [12] отдельный lightweight MutationObserver для UI-effects работает даже в macro-режиме;
 * [13] сохранены Shadow DOM, iframe, dialogs, navigation, backup, CSP fallback и Playwright export v6.
 *
 * v7.1 добавляет поверх v7 (нужно, чтобы по логу можно было реально доделать миграцию контента,
 * а не только восстановить хореографию кликов):
 *  [1] полный (не innerText!) текст CodeMirror 6 через node.cmView.view.state.doc.toString(),
 *      плюс построчный diff между началом и концом серии debounce-вводов в одном поле;
 *  [2] request/response тела всегда сохраняются для запросов, коррелированных с действием
 *      пользователя (см. v7.2 [1] — правило с тех пор стало общим, без списка URL);
 *  [3] содержимое загружаемых текстовых файлов (File.text()) с hash — не только name/size/type;
 *  [4] семантика Ant Design: Select-опция из портала, Switch, Radio, Collapse-заголовок,
 *      кнопки Popconfirm/Modal распознаются вместо безымянного "клик по div";
 *  [5] contextChain на каждом действии — активная вкладка, заголовок раскрытой панели,
 *      URL ассета из input в ближайшей строке;
 *  [6] screenDiff сравнивает значения input/select и порядок повторяющихся строк, а не
 *      только headings/dialogs/alerts/buttons;
 *  [7] hover-проверки и UI-effects MutationObserver используют light-дескрипторы и исключают
 *      поддеревья CodeMirror/тултипов — меньше принудительных reflow на каждый чих/нажатие;
 *  [8] полный бэкап уходит в IndexedDB (structured clone) вместо JSON.stringify всего в
 *      localStorage каждые 2.5с; localStorage хранит только компактную версию для быстрого
 *      синхронного restore сразу после reload;
 *  [9] fetch/XHR патчатся не только в top-window, но и в каждом same-origin iframe/popup;
 * [10] unstableTokenPattern больше не бракует длинные стабильные классы (ant-collapse-header
 *      и т.п.) — см. v7.2 [2] про автоопределение testIdAttribute на любом сайте;
 * [11] __logger.registerProbe(name, fn) — предметный snapshot приложения до/после действия;
 * [12] __logger.expect(...) / __logger.note(...) — человеческие ассерты/заметки в момент записи;
 * [13] console.log/console.info тоже пишутся в raw log (кроме сообщений самого логгера);
 * [14] реордер строк через pointer events (не только HTML5 DnD) распознаётся как dragTo;
 * [15] __logger.beginTask(meta) / endTask(result) — группировка таймлайна по страницам/задачам;
 * [16] экспорт дедуплицирует снапшоты по fingerprint (screens[] + ссылки вместо копий) и
 *      добавляет __logger.exportPlan() — компактный JSON-рецепт без сырых снапшотов/тел сети;
 * [17] клики по ссылке с target=_blank помечаются requiresManualVerification.
 *
 * v7.2 — инструмент больше не заточен под один конкретный сайт: то, что раньше требовало
 * ручной настройки под SiteEditor, теперь определяется в рантайме на любой странице:
 *  [1] bodyCaptureAllowlist (список URL) убран — общее правило "тело сохраняется для
 *      любого запроса, коррелированного с действием пользователя, или для ошибки сети",
 *      работает без знания конкретных эндпоинтов; __logger.captureBodiesFor(pattern) —
 *      ручной override сверху для несвязанных с действиями запросов;
 *  [2] discoverCustomIdAttributes() сканирует интерактивные элементы, находит частые
 *      стабильные кастомные атрибуты (data-at-selector, data-qa-id, data-hook, ...) и сам
 *      выбирает testIdAttribute — без знания разметки сайта заранее;
 *  [3] generic ARIA-слой (role=option/listbox/switch/tab/[aria-expanded]) поверх
 *      AntD-детектора — семантика Select/Switch/Collapse распознаётся и на не-AntD сайтах;
 *      contextChain (активная вкладка/заголовок панели) починен — раньше el.closest() не
 *      мог найти активный таб/заголовок, т.к. это соседи по DOM, а не предки;
 *  [4] action.destructive — эвристика по тексту/классам (delete/remove/discard/danger...);
 *  [5] action.possibleRetry — повтор клика по тому же локатору без видимого эффекта между
 *      попытками — сигнал, что в скрипте нужен явный wait;
 *  [6] __logger.setMacroName(name) — recording'и различаются по имени, а не только по id
 *      сессии, если инструмент используется для многих разных сценариев/сайтов подряд;
 *  [7] payload.openQuestions[] — автосборка "что уточнить у оператора" (слабые локаторы без
 *      подтверждения, неинструментированные попапы, возможные retry, разрушительные шаги без
 *      видимого эффекта, неподтверждённые сетевые ошибки) — готовый чек-лист, а не то, что
 *      получателю нужно вычислять самому по всему таймлайну.
 *
 * v7.3 — запись перестаёт быть только «хореографией кликов»: из неё теперь можно написать
 * автоматизацию на API, а не только повтор нажатий. Всё взято из Migrator
 * (python/src/migrator/network/recorder.py) — там эта дисциплина уже выстрадана:
 *  [1] заголовки запроса и ответа записываются всегда (раньше — вообще никогда). Значения
 *      секретных имён (authorization, cookie, x-csrf-token, x-api-key, ...) заменяются на
 *      [REDACTED], но САМО ИМЯ сохраняется: скрипту нужно знать, что без этого заголовка
 *      запрос не пройдёт, даже если значение из записи взять нельзя;
 *  [2] тело ответа больше не обрезается ДО разбора (именованный баг №1 в Migrator): порядок
 *      всегда parse -> redact -> bound, поэтому в записи лежит целая структура ответа, а не
 *      оборванная строка, которую получатель не может распарсить;
 *  [3] responseJson === '__UNPARSED__' означает «тело было, но это не JSON», и это НЕ то же
 *      самое, что null (баг №2 в Migrator: «null vs [] must never be conflated»);
 *      responseBodyCaptured:false — «тело не читали вовсе»;
 *  [4] WebSocket, EventSource(SSE) и navigator.sendBeacon — раньше невидимы полностью.
 *      Приложение на сокетах давало запись, по которой автоматизацию написать нельзя;
 *      кадры кладутся в streams[] с привязкой к шагу, который их вызвал;
 *  [5] payload.endpoints[] — инвентарь вызовов: METHOD + шаблон пути (/pages/1428 и
 *      /pages/1429 — это один эндпоинт {int}), статусы, шаги-инициаторы, объединённая форма
 *      request/response (__optional для ключа, который был не во всех вызовах), имена
 *      нужных заголовков. Это и есть ответ на «что звать вместо кликов»;
 *  [6] payload.authProfile — как сайт авторизуется, БЕЗ единого сохранённого секрета:
 *      механизм (bearer/cookie), имена cookie и форма значений, ключи storage, похожие на
 *      токен (jwt/hex/base64), запросы-кандидаты на логин, и прямое предупреждение, что
 *      HttpOnly-cookie из JS не видны — пустой список не значит «cookie не используются»;
 *  [7] __logger.exportHar() — сетевая часть в HAR 1.2: открывается в DevTools, Postman,
 *      Insomnia и кодогенераторах, каждый запрос помнит шаг сценария (_actionId);
 *  [8] __logger.exportApi() — только инвентарь + авторизация + краткий вывод, без таймлайна;
 *  [9] openQuestions[] пополнились вопросами, на которых спотыкается именно автоматизация:
 *      откуда брать токен, откуда CSRF, эндпоинт, который ни разу не ответил успешно;
 * [10] бэкап версии 7.x теперь восстанавливается внутри мажора, а не выбрасывается при
 *      любом несовпадении: терять из-за обновления скрипта живую запись хуже.
 *
 * Команды:
 *   __logger.start() / pause() / stop() / destroy()
 *   __logger.stats() / clear()
 *   __logger.export()               // единый v7 AI bundle
 *   __logger.exportPlaywright()     // опционально, если нужен отдельный .spec.js
 *   __logger.generatePlaywright()
 *   __logger.copyLast()
 *   __logger.registerProbe(name, fn) / unregisterProbe(name)
 *   __logger.expect({ type, value }) / __logger.note(text)
 *   __logger.beginTask({ locale, path }) / endTask({ status })
 *   __logger.exportPlan()           // компактный JSON без сырых снапшотов/тел сети
 *   __logger.exportApi()            // [v7.3] инвентарь эндпоинтов + профиль авторизации
 *   __logger.exportHar()            // [v7.3] сетевая часть в HAR 1.2
 *   __logger.setMacroName(name)     // имя для файлов экспорта при множестве записей
 *   __logger.captureBodiesFor(pattern) / rediscoverIdAttributes() / setTestIdAttribute(name)
 */
(function () {
  'use strict';

  const VERSION = '7.3.0';
  // Ключ бэкапа привязан к мажорной версии, а не к минорной: внутри v7 схема только
  // дополняется, и запись, начатую до обновления скрипта, нельзя терять из-за смены имени
  // ключа (гейт совместимости — в restored ниже).
  const STORAGE_KEY = '__actionLoggerBackup_v7_2';
  const IDB_NAME = '__actionLoggerBackupV7';
  const IDB_STORE = 'backup';

  if (window.__logger && window.__logger.version === VERSION) {
    window.__logger.showPanel();
    window.__logger.start();
    console.log('%c[logger v7] уже установлен — продолжаю существующую сессию.', 'color:cyan;font-weight:bold');
    return;
  }

  const native = {
    fetch: window.fetch,
    open: window.open,
    alert: window.alert,
    confirm: window.confirm,
    prompt: window.prompt,
    consoleError: console.error,
    consoleWarn: console.warn,
    consoleLog: console.log,
    consoleInfo: console.info,
    pushState: history.pushState,
    replaceState: history.replaceState,
    xhrOpen: XMLHttpRequest.prototype.open,
    xhrSend: XMLHttpRequest.prototype.send,
    anchorClick: HTMLAnchorElement.prototype.click,
    createObjectURL: URL.createObjectURL ? URL.createObjectURL.bind(URL) : null
  };

  const config = {
    mode: 'macro', // macro | debug

    maxText: 1000,
    // [v7.1] большой лимит для CodeMirror/textarea/contentEditable/URL — иначе главный
    // артефакт миграции (текст EmbeddedHTML) обрезается до 1000 символов
    maxLargeText: 100000,
    maxRawEvents: 12000,
    maxMacroActions: 3000,
    maxScreenSnapshots: 3500,
    maxNetworkEntries: 6000,

    // [v7.2] сайт-специфичного списка URL больше нет — вместо него общее правило:
    // тело всегда сохраняется для запроса, коррелированного с действием пользователя
    // (actionId != null), или для любого запроса с ошибкой. Работает на любом сайте без
    // настройки. Этот список — только ручной override сверху общего правила (пуст по умолчанию,
    // пополняется через __logger.captureBodiesFor(pattern) для несвязанных с действиями запросов).
    bodyCaptureAllowlist: [],
    bodyCaptureAllowlistMaxBytes: 200000,

    // [7] бэкап по времени, а не по количеству событий
    autoSaveMs: 2500,
    autoRestore: true,
    autoExportOnStop: true,

    inputDebounceMs: 550,
    scrollThrottleMs: 300,
    hoverDwellMs: 450,
    effectSettleMs: 1200,
    effectMaxMs: 8000,
    networkCorrelationMs: 10000,
    uiEffectsPerAction: 40,
    screenMaxItems: 40,

    // [v7.1][16] отдельно от trackLowLevelMouse (debug-only диагностика) — реордер строк
    // через pointer events (не HTML5 DnD) иначе не попадает в лог вообще
    trackPointerDrag: true,
    pointerDragThresholdPx: 8,
    trackLowLevelMouse: false,
    trackAllKeyboard: false,
    trackFocus: false,
    trackScroll: true,
    trackMouseMove: false,
    trackWheel: false,
    trackDomMutations: false,
    trackNetwork: true,
    // [v7.3] Транспорты, которых логгер раньше не видел вообще. Приложение на
    // WebSocket/SSE давало запись, по которой автоматизацию написать нельзя: в сетевой
    // части просто не было того, чем оно на самом деле разговаривает с сервером.
    trackWebSockets: true,
    trackEventSource: true,
    trackBeacons: true,
    trackHover: true,
    trackActionEffects: true,
    captureScreenSnapshots: true,
    inferExpectedResults: true,
    generateDraftSpec: true,

    captureClipboardText: false,
    capturePromptText: false,
    captureNetworkBodies: false,
    captureResponseBodies: false,
    snapshotHTML: false,

    // [v7.3] Заголовки пишутся всегда: без Content-Type/Accept/X-Requested-With/CSRF по
    // записи нельзя повторить запрос ничем, кроме того же самого клика. Значения секретных
    // имён при этом не сохраняются никогда — см. redactHeaderMap.
    captureRequestHeaders: true,
    captureResponseHeaders: true,
    // Кадры WebSocket/SSE — поток, а не событие: без потолка одна запись за пять минут
    // выедает и IndexedDB-бэкап, и экспорт.
    maxWsFramesPerSocket: 300,
    maxWsFrameChars: 4000,
    maxStreamEntries: 200,
    // Профиль авторизации и инвентарь эндпоинтов — то, из чего пишется API-скрипт.
    buildEndpointInventory: true,
    buildAuthProfile: true,
    endpointSampleUrls: 3,

    // [9][10] генерация теста
    playwrightTextMethod: 'fill', // fill | pressSequentially
    playwrightLocators: 'semantic', // semantic | css
    // [v7.2] нейтральный дефолт по конвенции Playwright; на конкретном сайте переопределяется
    // автоматически через discoverCustomIdAttributes() — см. ниже — без ручной настройки
    testIdAttribute: 'data-testid',
    testIdAttributeManuallySet: false,
    autoDiscoverTestIdAttribute: true,
    discoveredIdAttributes: [], // заполняется discoverCustomIdAttributes() в рантайме
    emitAssertions: true,
    emitSteps: true,

    ignoreAnimatedStyle: true,
    mutationRoot: null,

    ignoreSelectors: [
      'time[data-cds="RelativeTime"]',
      'link[rel*="icon"]',
      '[data-cds-portal]',
      '[data-cds="Tooltip"]',
      '[data-testid="pending-queue-row"]',
      '#__action-logger-panel',
      '[data-action-logger-internal]'
    ],

    // [v7.1] поддеревья, которые исключаются из UI-effects MutationObserver (не из общего
    // isIgnoredEl!) — CodeMirror перерисовывает десятки узлов на каждое нажатие клавиши,
    // и раньше это заставляло watchActionEffects делать компактный дескриптор на каждый чих
    mutationExcludeSelectors: [
      '.cm-editor',
      '.cm-scroller',
      '.cm-content',
      '.cm-gutters',
      '.ant-spin',
      '.ant-tooltip',
      '[data-cds="Tooltip"]'
    ],

    networkIgnore: [
      'doubleclick.net',
      'google-analytics',
      'googletagmanager.com',
      'segment.io',
      'datadoghq',
      '/rum',
      'analytics'
    ],

    sensitiveNamePattern: /pass(word)?|pwd|secret|token|auth|authorization|cookie|session|csrf|api[-_]?key|access[-_]?key|private[-_]?key|credit|card|cvv|cvc|otp|pin/i,
    // [v7.2] клики, похожие на необратимое действие — помечаются action.destructive=true,
    // чтобы в сгенерированном скрипте такие шаги шли под подтверждение, а не выполнялись
    // молча наравне с открытием вкладки. Общий по тексту/классам эвристический паттерн,
    // не завязан на конкретный сайт.
    destructiveWordPattern: /\b(delete|remove|discard|purge|destroy|reject|revoke|unpublish|drop)\b|удал|отклон|отказ|очистить всё|сбросить всё/i,
    destructiveClassPattern: /danger|destructive|delete|remove|warn/i,
    // [v7.1] классы/атрибуты с этими префиксами считаются стабильными независимо от длины —
    // старое правило "18+ символов = нестабильно" браковало ant-collapse-header (19),
    // ant-select-selection-item (25) и другие обычные классы дизайн-системы
    stableTokenPrefixes: ['ant-', 'anticon-', 'data-at-'],
    // убрана общая длина ([A-Za-z0-9_-]{18,}) — остались только реальные признаки
    // сгенерированных/хешированных токенов (css-in-js, CSS modules, длинные hex-хеши)
    unstableTokenPattern: /(^\d{4,}$)|([a-f0-9]{10,})|(^css-)|(^sc-)|(^jss)|(^Mui[A-Z].*-\d+$)|(^_[A-Za-z0-9]{7,}_)/i
  };

  // ------------------------------------------------------------------ utils

  function trunc(value, n = config.maxText) {
    if (value == null) return value;
    const s = String(value);
    return s.length > n ? s.slice(0, n) + `...[+${s.length - n}]` : s;
  }

  function collapse(s, n = 120) {
    return trunc(String(s == null ? '' : s).trim().replace(/\s+/g, ' '), n);
  }

  function safeCssEscape(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(value));
    return String(value).replace(/["\\#.;:[\]()=+~*^$|<>]/g, '\\$&');
  }

  function quoteAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function isElement(el) {
    return !!el && el.nodeType === 1 && typeof el.tagName === 'string';
  }

  function safeMatches(el, selector) {
    try { return isElement(el) && el.matches(selector); } catch (_) { return false; }
  }

  function isIgnoredEl(el) {
    if (!isElement(el)) return false;
    for (const sel of config.ignoreSelectors) {
      try {
        if (el.closest(sel)) return true;
      } catch (_) {}
    }
    return false;
  }

  function actualTarget(e) {
    try {
      const p = typeof e.composedPath === 'function' ? e.composedPath() : null;
      if (p) {
        const found = p.find(isElement);
        if (found) return found;
      }
    } catch (_) {}
    return isElement(e.target) ? e.target : null;
  }

  function isIgnoredUrl(url) {
    return !!url && config.networkIgnore.some(p => String(url).includes(p));
  }

  function isSensitiveElement(el) {
    if (!isElement(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return true;
    const hay = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('autocomplete'),
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder')
    ].filter(Boolean).join(' ');
    return config.sensitiveNamePattern.test(hay);
  }

  // [v7.1] большие поля (CodeMirror/textarea/contentEditable/url) не режутся до 1000 символов
  function fieldTextLimit(el) {
    if (isCodeMirrorContent(el)) return config.maxLargeText;
    if (isElement(el) && el.tagName === 'TEXTAREA') return config.maxLargeText;
    if (isElement(el) && el.isContentEditable) return config.maxLargeText;
    if (isElement(el)) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'url') return config.maxLargeText;
    }
    return config.maxText;
  }

  function sanitizeValue(el, value, limit) {
    if (isSensitiveElement(el)) return '[REDACTED]';
    return trunc(value, limit || fieldTextLimit(el));
  }

  function sanitizeUrl(url) {
    if (!url) return url;
    try {
      const u = new URL(String(url), location.href);
      for (const [k] of u.searchParams) {
        if (config.sensitiveNamePattern.test(k)) u.searchParams.set(k, '[REDACTED]');
      }
      return u.href;
    } catch (_) {
      return trunc(url);
    }
  }

  function sanitizeObject(value, depth = 0, limit = config.maxText) {
    if (depth > 5) return '[MAX_DEPTH]';
    if (value == null) return value;
    if (typeof value === 'string') return trunc(value, limit);
    // [v7.3] Раньше числа и булевы тоже проходили через trunc, а он возвращает String(value):
    // записанное тело {"id":10,"async":true} превращалось в {"id":"10","async":"true"}, и по
    // такой записи писался API-клиент, отправляющий строки вместо чисел. Тип сохраняем.
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitizeObject(v, depth + 1, limit));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value).slice(0, 100)) {
        out[k] = config.sensitiveNamePattern.test(k) ? '[REDACTED]' : sanitizeObject(v, depth + 1, limit);
      }
      return out;
    }
    return trunc(String(value), limit);
  }

  // [v7.1] truncBytes использует ту же посимвольную оценку, что и trunc — для JSON-текста
  // этого достаточно, без реального подсчёта UTF-8 байт
  function truncBytes(value, limit) {
    return trunc(value, limit);
  }

  // [v7.2] сайт-специфичного списка URL больше нет. Общее, работающее на любом сайте правило:
  // тело сохраняется всегда для запроса, который вызвало действие пользователя (actionId
  // известен — почти всегда это то, что реально доказывает результат шага), для любой ошибки
  // сети (диагностика), и для URL из ручного override-списка (__logger.captureBodiesFor()).
  function isAllowlistedForBody(url) {
    return !!url && config.bodyCaptureAllowlist.some(p => String(url).includes(p));
  }

  function shouldCaptureBody(url, meta) {
    meta = meta || {};
    if (isAllowlistedForBody(url)) return true;
    if (meta.actionId) return true;
    if (meta.status != null && meta.status >= 400) return true;
    if (meta.ok === false) return true;
    return false;
  }

  // forceCapture=true игнорирует captureNetworkBodies и использует bodyCaptureAllowlistMaxBytes
  function sanitizeBody(body, forceCapture = false) {
    if (body == null) return null;
    if (!config.captureNetworkBodies && !forceCapture) return '[BODY_NOT_CAPTURED]';
    const limit = forceCapture ? config.bodyCaptureAllowlistMaxBytes : config.maxText;
    try {
      if (body instanceof URLSearchParams) {
        const out = {};
        for (const [k, v] of body.entries()) out[k] = config.sensitiveNamePattern.test(k) ? '[REDACTED]' : trunc(v, limit);
        return out;
      }
      if (body instanceof FormData) {
        const out = {};
        for (const [k, v] of body.entries()) {
          if (config.sensitiveNamePattern.test(k)) out[k] = '[REDACTED]';
          else if (v instanceof File) out[k] = { file: v.name, size: v.size, type: v.type };
          else out[k] = trunc(v, limit);
        }
        return out;
      }
      if (typeof body === 'string') {
        try {
          return sanitizeObject(JSON.parse(body), 0, limit);
        } catch (_) {
          return trunc(body, limit);
        }
      }
      return sanitizeObject(body, 0, limit);
    } catch (_) {
      return '[UNREADABLE_BODY]';
    }
  }

  function stableToken(token) {
    if (!token) return false;
    const s = String(token);
    if (config.stableTokenPrefixes.some(p => s.startsWith(p))) return true;
    return !config.unstableTokenPattern.test(s);
  }

  // [v7.2] "пусть сам узнает всё о сайте": вместо жёстко зашитого имени test-id атрибута
  // сканируем интерактивные элементы и ищем часто повторяющиеся кастомные атрибуты со
  // стабильными (не хэш-подобными) значениями — именно так выглядит QA/test-id атрибут,
  // каким бы именем его ни назвали на конкретном сайте (data-at-selector, data-qa-id,
  // data-cy-id, data-auto, data-hook, ...).
  const COMMON_HTML_ATTRS = new Set([
    'id', 'class', 'style', 'type', 'name', 'href', 'src', 'role', 'tabindex', 'disabled',
    'checked', 'readonly', 'placeholder', 'value', 'title', 'alt', 'target', 'rel', 'for',
    'action', 'method', 'width', 'height', 'colspan', 'rowspan', 'draggable', 'contenteditable',
    'spellcheck', 'autocomplete', 'maxlength', 'minlength', 'min', 'max', 'step', 'pattern',
    'required', 'multiple', 'selected', 'size', 'accept', 'autofocus', 'autoplay', 'controls',
    'loop', 'muted', 'download', 'lang', 'dir', 'translate', 'hidden', 'inert', 'nonce',
    'crossorigin', 'referrerpolicy', 'sandbox', 'allow', 'loading', 'decoding', 'sizes', 'srcset'
  ]);

  function discoverCustomIdAttributes(doc = document) {
    try {
      const freq = new Map();
      const candidates = doc.querySelectorAll('button,a,input,select,textarea,[role],[onclick],[tabindex]');
      let scanned = 0;
      for (const el of candidates) {
        if (++scanned > 4000) break;
        const names = el.getAttributeNames ? el.getAttributeNames() : [];
        for (const name of names) {
          if (COMMON_HTML_ATTRS.has(name) || name.startsWith('aria-') || name.startsWith('on') || name.startsWith('data-v-') || name.startsWith('data-react')) continue;
          const value = el.getAttribute(name);
          if (!value || value.length > 100 || !stableToken(value)) continue;
          freq.set(name, (freq.get(name) || 0) + 1);
        }
      }
      return [...freq.entries()]
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);
    } catch (_) {
      return [];
    }
  }

  function runIdAttributeDiscovery() {
    if (!config.autoDiscoverTestIdAttribute) return;
    const found = discoverCustomIdAttributes(document);
    if (!found.length) return;
    config.discoveredIdAttributes = found;
    // getByTestId в сгенерированном Playwright может проверять только ОДНО имя атрибута —
    // берём самый частый кандидат, если пользователь явно не переопределил testIdAttribute
    if (!config.testIdAttributeManuallySet) {
      config.testIdAttribute = found[0];
    }
    console.log(`%c[logger] обнаружены вероятные test-id атрибуты сайта: ${found.join(', ')} (используется: ${config.testIdAttribute})`, 'color:lime');
  }

  // ==================================================== [v7.3] network evidence helpers
  // Всё между PURE-HELPERS-BEGIN и PURE-HELPERS-END не замыкается ни на config, ни на
  // логи, ни на document — только аргументы и локальные константы. Поэтому этот блок
  // вырезается из исходника и проверяется в node без браузера
  // (test/network-evidence.test.mjs — приём взят из Migrator, test/discovery-resilience.test.mjs).
  // Не добавляйте здесь обращений к внешним переменным: тест на этом падает.
  // --- PURE-HELPERS-BEGIN ---

  // [v7.3] Migrator, network/recorder.py: «`null` vs `[]` must never be conflated».
  // Тело, которого не было, или которое не разобралось как JSON, помечается этим маркером,
  // а не null: null означает ровно одно — в JSON пришёл литеральный null. Получатель записи
  // не должен вычислять разницу между «сервер ответил null» и «мы не смогли прочитать».
  const UNPARSED = '__UNPARSED__';

  // [v7.3] Migrator, network/recorder.py DEFAULT_REDACTED_HEADER_NAMES. Значение секретного
  // заголовка не сохраняется никогда — а имя сохраняется всегда. Будущему скрипту нужно
  // знать, что запрос не пройдёт без Authorization/X-CSRF-Token, даже если сам токен из
  // записи взять нельзя. Поэтому '[REDACTED]' на месте значения, а не удаление ключа.
  const REDACTED_HEADER_NAMES = [
    'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
    'x-csrf-token', 'x-xsrf-token', 'x-csrftoken', 'x-auth-token', 'x-access-token',
    'x-api-key', 'api-key', 'apikey', 'x-amz-security-token', 'x-session-token'
  ];

  // Заголовки, по которым пишется API-клиент: их значения — это контракт, не секрет.
  const CONTRACT_HEADER_NAMES = [
    'content-type', 'accept', 'accept-language', 'content-encoding', 'content-length',
    'x-requested-with', 'location', 'retry-after', 'etag', 'if-match', 'if-none-match',
    'prefer', 'x-http-method-override', 'idempotency-key'
  ];

  const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

  function truncateString(value, maxChars) {
    const s = String(value);
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars) + `...[+${s.length - maxChars}]`;
  }

  // Заголовки приходят четырьмя разными формами (Headers, {}, [[k,v]], сырая строка
  // getAllResponseHeaders()) — нормализуем в один lower-case объект, чтобы дальше
  // редакция и инвентарь эндпоинтов работали с одной формой.
  function parseRawHeaderString(raw) {
    const out = {};
    if (!raw) return out;
    for (const line of String(raw).split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      const name = line.slice(0, i).trim().toLowerCase();
      const value = line.slice(i + 1).trim();
      if (!name) continue;
      out[name] = out[name] ? `${out[name]}, ${value}` : value;
    }
    return out;
  }

  function headerMapOf(source) {
    const out = {};
    if (!source) return out;
    try {
      if (typeof source === 'string') return parseRawHeaderString(source);
      if (typeof source.forEach === 'function' && typeof source.get === 'function') {
        source.forEach((value, name) => { out[String(name).toLowerCase()] = String(value); });
        return out;
      }
      if (Array.isArray(source)) {
        for (const pair of source) {
          if (!pair || pair.length < 2) continue;
          out[String(pair[0]).toLowerCase()] = String(pair[1]);
        }
        return out;
      }
      for (const [name, value] of Object.entries(source)) {
        if (value == null) continue;
        out[String(name).toLowerCase()] = String(value);
      }
    } catch (_) {}
    return out;
  }

  function isSecretHeaderName(name, sensitivePattern) {
    const lower = String(name || '').toLowerCase();
    if (REDACTED_HEADER_NAMES.includes(lower)) return true;
    if (CONTRACT_HEADER_NAMES.includes(lower)) return false;
    return !!(sensitivePattern && sensitivePattern.test(lower));
  }

  function redactHeaderMap(headers, sensitivePattern, maxChars) {
    const out = {};
    for (const [name, value] of Object.entries(headers || {})) {
      const lower = String(name).toLowerCase();
      out[lower] = isSecretHeaderName(lower, sensitivePattern) ? '[REDACTED]' : truncateString(value, maxChars || 2000);
    }
    return out;
  }

  // [v7.3] Migrator, network/recorder.py redact_text_body: для не-JSON тела ключей нет,
  // поэтому единственное, что можно вычистить надёжно — инлайновый `Bearer <token>`.
  function redactTextBody(text) {
    if (text == null) return text;
    return String(text).replace(BEARER_TOKEN_RE, 'Bearer [REDACTED]');
  }

  // [v7.3] Migrator, network/recorder.py: «Never truncate before parsing». Раньше ответ
  // обрезался до лимита и в лог уходила строка с оборванным JSON — получатель не мог её
  // разобрать и не знал, что именно потерялось. Теперь порядок всегда parse -> redact ->
  // bound: структура ответа сохраняется целиком, режутся только длинные строки внутри.
  function parseJsonBody(text) {
    if (text == null || text === '') return UNPARSED;
    try {
      return JSON.parse(text);
    } catch (_) {
      return UNPARSED;
    }
  }

  function redactJson(value, sensitivePattern, maxChars, depth) {
    const level = depth || 0;
    if (level > 8) return '[MAX_DEPTH]';
    if (value == null) return value;
    if (typeof value === 'string') return truncateString(redactTextBody(value), maxChars);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      const out = value.slice(0, 200).map(item => redactJson(item, sensitivePattern, maxChars, level + 1));
      if (value.length > 200) out.push(`...[+${value.length - 200} items]`);
      return out;
    }
    if (typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value).slice(0, 200)) {
        out[key] = sensitivePattern && sensitivePattern.test(key)
          ? '[REDACTED]'
          : redactJson(item, sensitivePattern, maxChars, level + 1);
      }
      return out;
    }
    return truncateString(String(value), maxChars);
  }

  function boundText(text, maxChars) {
    if (text == null) return { text: null, truncated: false, originalLength: 0 };
    const s = String(text);
    if (!maxChars || s.length <= maxChars) return { text: s, truncated: false, originalLength: s.length };
    return { text: s.slice(0, maxChars), truncated: true, originalLength: s.length };
  }

  // ---------------------------------------------------- [v7.3] форма тела вместо значений
  // Скрипт пишется по форме payload'а, а не по одному записанному значению: какие ключи,
  // какие типы, что необязательно. Значения при этом остаются в самой записи — здесь
  // только скелет, который можно показать в ТЗ, не раскрывая содержимое.
  function jsonShape(value, depth, maxDepth) {
    const level = depth || 0;
    const limit = maxDepth || 6;
    if (value === UNPARSED) return 'unparsed';
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (level >= limit) return 'unknown(max-depth)';
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return type;
    if (Array.isArray(value)) {
      if (!value.length) return [];
      let merged;
      for (const item of value.slice(0, 20)) merged = mergeShapes(merged, jsonShape(item, level + 1, limit));
      return [merged];
    }
    if (type === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value).slice(0, 80)) out[key] = jsonShape(item, level + 1, limit);
      return out;
    }
    return type;
  }

  // Один эндпоинт обычно вызывается в записи несколько раз с разными payload'ами. Берём
  // объединение форм, а не последнюю: ключ, который был только в одном вызове, помечается
  // __optional, а не исчезает из контракта.
  function mergeShapes(a, b) {
    if (a === undefined) return b;
    if (b === undefined) return a;
    if (JSON.stringify(a) === JSON.stringify(b)) return a;

    const isPlain = x => !!x && typeof x === 'object' && !Array.isArray(x);
    const unwrap = x => (isPlain(x) && '__optional' in x ? x.__optional : x);
    const optionalA = isPlain(a) && '__optional' in a;
    const optionalB = isPlain(b) && '__optional' in b;
    if (optionalA || optionalB) {
      const inner = mergeShapes(unwrap(a), unwrap(b));
      return { __optional: inner };
    }

    if (isPlain(a) && isPlain(b) && !('__oneOf' in a) && !('__oneOf' in b)) {
      const out = {};
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
        if (!(key in a)) out[key] = isPlain(b[key]) && '__optional' in b[key] ? b[key] : { __optional: b[key] };
        else if (!(key in b)) out[key] = isPlain(a[key]) && '__optional' in a[key] ? a[key] : { __optional: a[key] };
        else out[key] = mergeShapes(a[key], b[key]);
      }
      return out;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (!a.length) return b;
      if (!b.length) return a;
      return [mergeShapes(a[0], b[0])];
    }

    const variants = [];
    for (const value of [a, b]) {
      const list = isPlain(value) && Array.isArray(value.__oneOf) ? value.__oneOf : [value];
      for (const item of list) {
        if (!variants.some(x => JSON.stringify(x) === JSON.stringify(item))) variants.push(item);
      }
    }
    return variants.length === 1 ? variants[0] : { __oneOf: variants };
  }

  // -------------------------------------------- [v7.3] URL -> шаблон эндпоинта
  // /api/pages/1428/assets/9f2c1d... и /api/pages/1429/assets/aa01... — это один эндпоинт.
  // Без шаблонизации инвентарь распадается на сотню «уникальных» URL, и по нему нельзя
  // понять, какие вызовы вообще есть у приложения.
  function templatizeSegment(segment) {
    const s = String(segment == null ? '' : segment);
    if (!s) return s;
    if (/^\d+$/.test(s)) return '{int}';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return '{uuid}';
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return '{date}';
    // Расширение сохраняем, а хеш внутри имени — нет: /static/app.a91f2c3d4e.js это
    // app.{hash}.js. Иначе каждая сборка выглядит как новый эндпоинт. Части имени
    // шаблонизируются по отдельности — в них точек уже нет, рекурсия конечна.
    const dot = s.lastIndexOf('.');
    if (dot > 0 && dot < s.length - 1 && /^[a-z0-9]{1,5}$/i.test(s.slice(dot + 1))) {
      const stem = s.slice(0, dot).split('.').map(part => templatizeSegment(part)).join('.');
      return `${stem}${s.slice(dot)}`;
    }
    if (/^[0-9a-f]{8,}$/i.test(s)) return '{hash}';
    if (s.length >= 20 && /[A-Za-z]/.test(s) && /\d/.test(s) && !/[\s]/.test(s)) return '{token}';
    return s;
  }

  function endpointKeyOf(method, url, baseHref) {
    const verb = String(method || 'GET').toUpperCase();
    let origin = '';
    let path = String(url || '');
    let queryKeys = [];
    try {
      const parsed = baseHref ? new URL(path, baseHref) : new URL(path);
      origin = parsed.origin;
      path = parsed.pathname;
      queryKeys = [...new Set([...parsed.searchParams.keys()])].sort();
    } catch (_) {
      const cut = path.indexOf('?');
      if (cut >= 0) path = path.slice(0, cut);
    }
    const pathTemplate = path.split('/').map((segment, index) => (index === 0 ? segment : templatizeSegment(segment))).join('/');
    return { method: verb, origin, pathTemplate, queryKeys, key: `${verb} ${origin}${pathTemplate}` };
  }

  // ---------------------------------------- [v7.3] start/end/error -> одна запись запроса
  // В networkLog один запрос лежит двумя-тремя строками (phase start/end/error). И HAR,
  // и инвентарь эндпоинтов, и профиль авторизации хотят один запрос одной записью.
  function foldRequests(networkEntries) {
    const byId = new Map();
    const order = [];
    for (const entry of networkEntries || []) {
      if (!entry) continue;
      const id = entry.requestId || `seq-${entry.seq}`;
      if (!byId.has(id)) {
        byId.set(id, { requestId: id, transport: entry.transport || null, actionId: entry.actionId || null, seq: entry.seq });
        order.push(id);
      }
      const record = byId.get(id);
      if (entry.actionId && !record.actionId) record.actionId = entry.actionId;
      if (entry.transport && !record.transport) record.transport = entry.transport;

      if (entry.phase === 'start') {
        record.method = entry.method || record.method || 'GET';
        record.requestUrl = entry.requestUrl || record.requestUrl;
        record.startedAt = entry.iso || record.startedAt;
        record.startedAtMs = entry.t != null ? entry.t : record.startedAtMs;
        if (entry.requestHeaders) record.requestHeaders = entry.requestHeaders;
        if (entry.credentials !== undefined) record.credentials = entry.credentials;
        if (entry.body !== undefined) record.requestBody = entry.body;
      } else {
        record.method = record.method || entry.method || 'GET';
        record.requestUrl = record.requestUrl || entry.requestUrl;
        record.phase = entry.phase;
        if (entry.status !== undefined) record.status = entry.status;
        if (entry.ok !== undefined) record.ok = entry.ok;
        if (entry.finalUrl) record.finalUrl = entry.finalUrl;
        if (entry.durationMs != null) record.durationMs = entry.durationMs;
        if (entry.error) record.error = entry.error;
        if (entry.responseHeaders) record.responseHeaders = entry.responseHeaders;
        if (entry.responseJson !== undefined) record.responseJson = entry.responseJson;
        if (entry.responsePreview !== undefined) record.responsePreview = entry.responsePreview;
        if (entry.responseBodyCaptured !== undefined) record.responseBodyCaptured = entry.responseBodyCaptured;
        if (entry.responseBodyBytes != null) record.responseBodyBytes = entry.responseBodyBytes;
        record.endedAt = entry.iso || record.endedAt;
      }
    }
    return order.map(id => byId.get(id));
  }

  function authCarriersOf(requestHeaders, credentials) {
    const carriers = [];
    const headers = requestHeaders || {};
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower === 'authorization') carriers.push('header:authorization');
      else if (lower.includes('csrf') || lower.includes('xsrf')) carriers.push(`header:${lower}`);
      else if (lower === 'x-api-key' || lower === 'api-key' || lower === 'apikey') carriers.push(`header:${lower}`);
      else if (lower === 'x-access-token' || lower === 'x-auth-token' || lower === 'x-session-token') carriers.push(`header:${lower}`);
    }
    // credentials:'include'/'same-origin' — единственный след cookie-авторизации, который
    // виден из страницы: сам заголовок Cookie браузер добавляет после нашего хука и в JS
    // не читается (см. authProfile.cookieHeaderNote).
    if (credentials === 'include' || credentials === 'same-origin') carriers.push(`cookies:${credentials}`);
    return [...new Set(carriers)];
  }

  // ------------------------------------------------- [v7.3] инвентарь эндпоинтов
  // Итог: «какие вызовы есть у приложения, какой шаг их запускает, что в них лежит и что
  // нужно, чтобы их позвать» — то, из чего пишется автоматизация на API вместо повтора
  // кликов. Чистая функция: на входе свёрнутые запросы и действия, на выходе массив.
  function buildEndpointInventory(foldedRequests, actions, options) {
    const opts = options || {};
    const maxSamples = opts.maxSamples || 3;
    const ignoreSubstrings = opts.ignore || [];
    const byAction = new Map();
    for (const action of actions || []) if (action && action.id) byAction.set(action.id, action);

    const endpoints = new Map();
    for (const request of foldedRequests || []) {
      if (!request || !request.requestUrl) continue;
      if (ignoreSubstrings.some(pattern => String(request.requestUrl).includes(pattern))) continue;

      const identity = endpointKeyOf(request.method, request.requestUrl, opts.baseHref);
      let endpoint = endpoints.get(identity.key);
      if (!endpoint) {
        endpoint = {
          key: identity.key,
          method: identity.method,
          origin: identity.origin,
          pathTemplate: identity.pathTemplate,
          sameOrigin: opts.baseOrigin ? identity.origin === opts.baseOrigin : null,
          // GET/HEAD/OPTIONS можно звать при отладке безопасно; остальное меняет состояние
          write: !['GET', 'HEAD', 'OPTIONS'].includes(identity.method),
          transports: [],
          calls: 0,
          statuses: {},
          failures: 0,
          queryKeys: [],
          sampleUrls: [],
          requestHeaderNames: [],
          authCarriers: [],
          requestContentTypes: [],
          responseContentTypes: [],
          requestShape: undefined,
          responseShape: undefined,
          triggeredBy: [],
          latencyMs: null,
          errors: []
        };
        endpoints.set(identity.key, endpoint);
      }

      endpoint.calls += 1;
      if (request.transport && !endpoint.transports.includes(request.transport)) endpoint.transports.push(request.transport);
      for (const key of identity.queryKeys) if (!endpoint.queryKeys.includes(key)) endpoint.queryKeys.push(key);
      if (endpoint.sampleUrls.length < maxSamples && !endpoint.sampleUrls.includes(request.requestUrl)) {
        endpoint.sampleUrls.push(request.requestUrl);
      }

      const statusKey = request.status != null ? String(request.status) : (request.error ? 'error' : 'unknown');
      endpoint.statuses[statusKey] = (endpoint.statuses[statusKey] || 0) + 1;
      if (request.error || (request.status != null && request.status >= 400)) {
        endpoint.failures += 1;
        const message = request.error || `HTTP ${request.status}`;
        if (endpoint.errors.length < maxSamples && !endpoint.errors.includes(message)) endpoint.errors.push(message);
      }

      for (const name of Object.keys(request.requestHeaders || {})) {
        if (!endpoint.requestHeaderNames.includes(name)) endpoint.requestHeaderNames.push(name);
      }
      for (const carrier of authCarriersOf(request.requestHeaders, request.credentials)) {
        if (!endpoint.authCarriers.includes(carrier)) endpoint.authCarriers.push(carrier);
      }
      const requestType = (request.requestHeaders || {})['content-type'];
      if (requestType && !endpoint.requestContentTypes.includes(requestType)) endpoint.requestContentTypes.push(requestType);
      const responseType = (request.responseHeaders || {})['content-type'];
      if (responseType && !endpoint.responseContentTypes.includes(responseType)) endpoint.responseContentTypes.push(responseType);

      if (request.requestBody !== undefined && request.requestBody !== null && request.requestBody !== '[BODY_NOT_CAPTURED]') {
        endpoint.requestShape = mergeShapes(endpoint.requestShape, jsonShape(request.requestBody));
      }
      if (request.responseJson !== undefined && request.responseJson !== UNPARSED) {
        endpoint.responseShape = mergeShapes(endpoint.responseShape, jsonShape(request.responseJson));
      }

      if (request.durationMs != null) {
        const current = endpoint.latencyMs || { min: request.durationMs, max: request.durationMs };
        endpoint.latencyMs = { min: Math.min(current.min, request.durationMs), max: Math.max(current.max, request.durationMs) };
      }

      const action = request.actionId ? byAction.get(request.actionId) : null;
      if (action && !endpoint.triggeredBy.some(x => x.actionId === action.id)) {
        endpoint.triggeredBy.push({ actionId: action.id, order: action.order != null ? action.order : null, action: action.action || null });
      }
    }

    const list = [...endpoints.values()];
    for (const endpoint of list) {
      endpoint.queryKeys.sort();
      endpoint.requestHeaderNames.sort();
      // Запрос без единого шага-инициатора — фоновый: его нельзя воспроизвести «нажав
      // то же самое», и в скрипте он обычно либо не нужен, либо нужен как отдельный вызов.
      endpoint.background = endpoint.triggeredBy.length === 0;
      if (endpoint.requestShape === undefined) delete endpoint.requestShape;
      if (endpoint.responseShape === undefined) delete endpoint.responseShape;
    }
    // Сначала то, что меняет состояние и привязано к шагам — по нему пишут скрипт.
    return list.sort((a, b) => {
      if (a.background !== b.background) return a.background ? 1 : -1;
      if (a.write !== b.write) return a.write ? -1 : 1;
      return b.calls - a.calls || a.key.localeCompare(b.key);
    });
  }

  // ------------------------------------------------------------- [v7.3] HAR 1.2
  // Теперь, когда заголовки и тела есть, запись выражается в стандартном формате: HAR
  // открывается в DevTools, Postman, Insomnia и почти любом кодогенераторе. Своя схема
  // остаётся для смысла (шаги, локаторы, ожидания), HAR — чтобы сетевую часть можно было
  // отдать инструменту, который про наш JSON никогда не слышал.
  function harHeaderList(headers) {
    return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
  }

  function harQueryList(url) {
    try {
      return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
    } catch (_) {
      return [];
    }
  }

  function harBodyText(value) {
    if (value == null || value === UNPARSED) return null;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return null; }
  }

  function buildHarEntry(request) {
    const requestHeaders = request.requestHeaders || {};
    const responseHeaders = request.responseHeaders || {};
    const requestText = harBodyText(request.requestBody === '[BODY_NOT_CAPTURED]' ? null : request.requestBody);
    const responseText = harBodyText(request.responseJson !== undefined && request.responseJson !== UNPARSED
      ? request.responseJson
      : request.responsePreview);

    const entry = {
      startedDateTime: request.startedAt || request.endedAt || new Date(0).toISOString(),
      time: request.durationMs != null ? request.durationMs : -1,
      _requestId: request.requestId,
      _transport: request.transport || null,
      // Единственная причина, по которой HAR отсюда полезнее HAR из DevTools: каждый
      // запрос знает шаг сценария, который его вызвал.
      _actionId: request.actionId || null,
      _phase: request.phase || null,
      _error: request.error || null,
      request: {
        method: String(request.method || 'GET').toUpperCase(),
        url: request.requestUrl || '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: harHeaderList(requestHeaders),
        queryString: harQueryList(request.requestUrl),
        headersSize: -1,
        bodySize: requestText != null ? requestText.length : -1
      },
      response: {
        status: request.status != null ? request.status : 0,
        statusText: request.error ? 'ERROR' : '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: harHeaderList(responseHeaders),
        content: {
          size: request.responseBodyBytes != null ? request.responseBodyBytes : (responseText != null ? responseText.length : 0),
          mimeType: responseHeaders['content-type'] || 'application/octet-stream'
        },
        redirectURL: responseHeaders.location || '',
        headersSize: -1,
        bodySize: responseText != null ? responseText.length : -1
      },
      cache: {},
      timings: { send: 0, wait: request.durationMs != null ? request.durationMs : -1, receive: 0 }
    };
    if (requestText != null) {
      entry.request.postData = { mimeType: requestHeaders['content-type'] || 'application/json', text: requestText };
    }
    if (responseText != null) entry.response.content.text = responseText;
    return entry;
  }

  function buildHar(foldedRequests, meta) {
    const info = meta || {};
    return {
      log: {
        version: '1.2',
        creator: { name: info.creatorName || 'action-logger', version: info.creatorVersion || '0' },
        browser: info.browser ? { name: 'browser', version: String(info.browser) } : undefined,
        pages: (info.pages || []).map(page => ({
          startedDateTime: page.startedDateTime,
          id: page.id,
          title: page.title || '',
          pageTimings: { onContentLoad: -1, onLoad: -1 }
        })),
        // HAR-редакция уже произошла выше: сюда попадают только заголовки/тела,
        // прошедшие redactHeaderMap/redactJson. Секретов в экспорте нет by construction.
        entries: (foldedRequests || []).filter(r => r && r.requestUrl).map(request => {
          const entry = buildHarEntry(request);
          if (info.pageRef) entry.pageref = info.pageRef;
          return entry;
        })
      }
    };
  }

  // ----------------------------------------- [v7.3] авторизация: форма вместо значения
  // Главный вопрос любой будущей автоматизации — не «куда кликать», а «как войти».
  // Ответ на него можно дать, не сохранив ни одного секрета: важно, что в storage лежит
  // именно JWT (значит у него есть срок и его надо получать заново), а не то, какой.
  // 'sid' и 'access' нельзя искать подстрокой: 'sidebarWidth' и 'lastAccessed' — не
  // учётные данные, а ложный «здесь лежит токен» в профиле авторизации хуже пропуска.
  const CREDENTIAL_NAME_RE = /token|jwt|auth|credential|bearer|oauth|refresh|sess(ion|id)|csrf|xsrf|api[-_]?key|access[-_]?key|(^|[^a-z])sid([^a-z]|$)/i;

  function looksLikeCredentialName(name) {
    return CREDENTIAL_NAME_RE.test(String(name || ''));
  }

  function tokenValueShape(value) {
    if (value == null) return { kind: 'absent', length: 0 };
    const s = String(value);
    const shape = { kind: 'opaque', length: s.length };
    if (!s.length) return { kind: 'empty', length: 0 };
    // JWT распознаём по форме, не декодируя: три base64url-части через точку.
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(s)) {
      shape.kind = 'jwt';
      shape.note = 'у JWT есть срок жизни — скрипт должен получать его заново, а не хранить';
      return shape;
    }
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      shape.kind = 'json';
      return shape;
    }
    if (/^[0-9a-f]{16,}$/i.test(s)) { shape.kind = 'hex'; return shape; }
    if (/^[A-Za-z0-9+/=_-]{20,}$/.test(s)) { shape.kind = 'base64ish'; return shape; }
    if (s.length < 8) { shape.kind = 'short'; return shape; }
    return shape;
  }

  // document.cookie отдаёт одну строку — нам нужны только имена и форма значений.
  function cookieNamesFrom(cookieString) {
    const out = [];
    for (const part of String(cookieString || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      if (!name) continue;
      const shape = tokenValueShape(part.slice(eq + 1).trim());
      out.push({ name, valueShape: shape.kind, valueLength: shape.length, credentialLike: looksLikeCredentialName(name) || shape.kind === 'jwt' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Итог по всем запросам: чем именно приложение доказывает серверу, кто оно.
  function summarizeAuthCarriers(foldedRequests) {
    const counts = {};
    for (const request of foldedRequests || []) {
      if (!request) continue;
      for (const carrier of authCarriersOf(request.requestHeaders, request.credentials)) {
        counts[carrier] = (counts[carrier] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([carrier, requests]) => ({ carrier, requests }));
  }

  // --- PURE-HELPERS-END ---

  // ------------------------------------------------ [1] shadow-aware локаторы

  function rootOf(el) {
    try {
      const r = el.getRootNode ? el.getRootNode() : null;
      if (r && (r.nodeType === 9 || r.nodeType === 11)) return r;
    } catch (_) {}
    return el.ownerDocument || document;
  }

  function isShadowRoot(node) {
    return !!node && node.nodeType === 11 && !!node.host;
  }

  function isUnique(root, selector) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch (_) {
      return false;
    }
  }

  // Путь внутри одного root'а. Границу shadow DOM пробиваем пробелом:
  // Playwright css-движок проходит сквозь open shadow root по descendant-комбинатору.
  function structuralCssInRoot(el) {
    if (!isElement(el)) return null;
    const root = rootOf(el);
    const parts = [];
    let node = el;

    while (isElement(node) && parts.length < 7) {
      let part = node.tagName.toLowerCase();

      const stableClasses = Array.from(node.classList || [])
        .filter(stableToken)
        .filter(c => c.length <= 80)
        .slice(0, 2);

      if (stableClasses.length) part += stableClasses.map(c => '.' + safeCssEscape(c)).join('');

      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }

      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (isUnique(root, candidate)) return candidate;

      if (node.id && stableToken(node.id) && isUnique(root, `#${safeCssEscape(node.id)}`)) {
        parts[0] = `#${safeCssEscape(node.id)}${parts[0].replace(/^[a-z0-9-]+/i, '')}`;
        const withId = parts.join(' > ');
        if (isUnique(root, withId)) return withId;
      }

      node = node.parentElement;
    }

    return parts.join(' > ');
  }

  function structuralCss(el) {
    const own = structuralCssInRoot(el);
    if (!own) return null;
    const root = rootOf(el);
    if (!isShadowRoot(root)) return own;
    const hostPath = structuralCss(root.host);
    return hostPath ? `${hostPath} ${own}` : own;
  }

  // --------------------------------------------------- роль и доступное имя

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.multiple || Number(el.size) > 1 ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ({
        checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
        reset: 'button', image: 'button', range: 'slider', number: 'spinbutton',
        search: 'searchbox', email: 'textbox', tel: 'textbox', url: 'textbox', text: 'textbox'
      })[t] || null;
    }
    return null;
  }

  function roleOf(el) {
    if (!isElement(el)) return null;
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    return explicit || implicitRole(el);
  }

  function accessibleName(el) {
    if (!isElement(el)) return null;
    try {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return collapse(aria, 100);

      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const root = rootOf(el);
        const text = labelledBy.split(/\s+/)
          .map(id => {
            const n = root.getElementById ? root.getElementById(id) : document.getElementById(id);
            return n ? n.textContent : '';
          })
          .join(' ').trim();
        if (text) return collapse(text, 100);
      }

      if (el.labels && el.labels.length && el.labels[0].textContent.trim()) {
        return collapse(el.labels[0].textContent, 100);
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (['submit', 'button', 'reset'].includes(t) && el.value) return collapse(el.value, 100);
      }
      if (tag === 'img') {
        const alt = el.getAttribute('alt');
        if (alt && alt.trim()) return collapse(alt, 100);
      }

      const role = roleOf(el);
      if (['button', 'link', 'heading', 'menuitem', 'tab', 'option', 'cell', 'columnheader'].includes(role)) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) return collapse(text, 100);
      }

      const title = el.getAttribute('title');
      if (title && title.trim()) return collapse(title, 100);
    } catch (_) {}
    return null;
  }

  const NAMEABLE = 'a,button,input,select,textarea,summary,img,h1,h2,h3,h4,h5,h6,[role]';

  function roleNameUnique(root, el, role, name) {
    if (!role || !name) return false;
    try {
      const all = root.querySelectorAll(NAMEABLE);
      let count = 0;
      let scanned = 0;
      for (const candidate of all) {
        if (++scanned > 2000) return false; // слишком большая страница — не рискуем
        if (roleOf(candidate) !== role) continue;
        if (accessibleName(candidate) !== name) continue;
        if (++count > 1) return false;
      }
      return count === 1;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------- [9] дескриптор для Playwright

  function pwDescriptor(el, candidates, role, name) {
    const root = rootOf(el);

    if (config.playwrightLocators === 'semantic') {
      const testId = el.getAttribute(config.testIdAttribute);
      if (testId && stableToken(testId)) {
        return { method: 'getByTestId', args: [testId], unique: isUnique(root, `[${config.testIdAttribute}="${quoteAttr(testId)}"]`) };
      }

      if (role && name && roleNameUnique(root, el, role, name)) {
        return { method: 'getByRole', args: [role, { name, exact: true }], unique: true };
      }

      const label = el.labels && el.labels.length ? collapse(el.labels[0].textContent, 100) : null;
      if (label) return { method: 'getByLabel', args: [label, { exact: true }], unique: false };

      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) {
        return { method: 'getByPlaceholder', args: [collapse(placeholder, 100), { exact: true }], unique: false };
      }
    }

    const best = candidates.find(c => c.unique) || candidates[0];
    return best ? { method: 'locator', args: [best.css], unique: !!best.unique } : null;
  }

  function locatorInfo(el) {
    if (!isElement(el)) return null;
    const root = rootOf(el);
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    // [v7.2] config.discoveredIdAttributes заполняется discoverCustomIdAttributes() —
    // это позволяет находить стабильные test-id-подобные атрибуты на ЛЮБОМ сайте, а не
    // только по фиксированному списку общеизвестных имён
    const testIdAttrs = new Set([config.testIdAttribute, ...config.discoveredIdAttributes, 'data-at-selector', 'data-testid', 'data-test', 'data-qa', 'data-cy']);
    for (const attr of testIdAttrs) {
      const value = el.getAttribute(attr);
      if (value && stableToken(value)) {
        const css = `[${attr}="${quoteAttr(value)}"]`;
        candidates.push({ kind: attr, value, css, unique: isUnique(root, css) });
      }
    }

    if (el.id && stableToken(el.id)) {
      const css = `#${safeCssEscape(el.id)}`;
      candidates.push({ kind: 'id', value: el.id, css, unique: isUnique(root, css) });
    }

    const name = el.getAttribute('name');
    if (name && stableToken(name)) {
      const css = `${tag}[name="${quoteAttr(name)}"]`;
      candidates.push({ kind: 'name', value: name, css, unique: isUnique(root, css) });
    }

    const aria = el.getAttribute('aria-label');
    if (aria && aria.length <= 140) {
      const css = `${tag}[aria-label="${quoteAttr(aria)}"]`;
      candidates.push({ kind: 'aria-label', value: aria, css, unique: isUnique(root, css) });
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.length <= 140) {
      const css = `${tag}[placeholder="${quoteAttr(placeholder)}"]`;
      candidates.push({ kind: 'placeholder', value: placeholder, css, unique: isUnique(root, css) });
    }

    const type = el.getAttribute('type');
    if (type && name && stableToken(name)) {
      const css = `${tag}[type="${quoteAttr(type)}"][name="${quoteAttr(name)}"]`;
      candidates.push({ kind: 'type+name', value: `${type}:${name}`, css, unique: isUnique(root, css) });
    }

    const fallback = structuralCss(el);
    if (fallback) candidates.push({ kind: 'css', value: fallback, css: fallback, unique: isUnique(root, fallback) });

    const primary = candidates.find(c => c.unique) || candidates[0] || { kind: 'tag', value: tag, css: tag, unique: false };
    const role = roleOf(el);
    const accName = accessibleName(el);

    return {
      primary,
      alternatives: candidates.slice(0, 6),
      pw: pwDescriptor(el, candidates, role, accName),
      inShadow: isShadowRoot(root),
      role,
      accessibleName: accName,
      ariaLabel: aria || null,
      text: collapse(el.innerText || el.textContent || '', 160) || null
    };
  }

  function xpath(el) {
    if (!isElement(el)) return null;
    if (isShadowRoot(rootOf(el))) return null; // xpath не пробивает shadow DOM
    if (el.id && stableToken(el.id)) return `//*[@id="${String(el.id).replace(/"/g, '\\"')}"]`;
    const parts = [];
    let node = el;
    while (isElement(node) && node !== document.documentElement && parts.length < 10) {
      let idx = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
      node = node.parentElement;
    }
    return '/html/' + parts.join('/');
  }

  function isVisible(el) {
    if (!isElement(el) || !el.getBoundingClientRect) return null;
    try {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    } catch (_) {
      return null;
    }
  }

  // [6] light-режим: без rect / computedStyle / локаторов — не форсирует reflow
  function elInfo(el, opts) {
    if (!isElement(el)) return null;
    const light = !!(opts && opts.light);

    const info = {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name'),
      type: el.getAttribute('type'),
      value: 'value' in el ? sanitizeValue(el, el.value) : null
    };

    if (light) {
      info.light = true;
      info.text = collapse(el.textContent || '', 60) || null;
      return info;
    }

    const loc = locatorInfo(el);
    info.locator = loc;
    info.selector = loc ? loc.primary.css : null;
    info.xpath = xpath(el);
    info.href = el.getAttribute('href');
    info.text = collapse(el.innerText || '', 120) || null;

    try {
      const r = el.getBoundingClientRect();
      info.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (_) {
      info.rect = null;
    }

    info.state = {
      disabled: !!el.disabled,
      checked: 'checked' in el ? !!el.checked : null,
      readOnly: !!el.readOnly,
      visible: isVisible(el)
    };

    info.attrs = {};
    try {
      for (const n of el.getAttributeNames()) {
        if (['class', 'id', 'style', 'value'].includes(n)) continue;
        info.attrs[n] = config.sensitiveNamePattern.test(n) ? '[REDACTED]' : trunc(el.getAttribute(n), 120);
      }
    } catch (_) {}

    if (config.snapshotHTML && el.outerHTML) info.outerHTML = trunc(el.outerHTML, 500);
    return info;
  }


  // ---------------------------------------------------------- v7 AI helpers

  function uniqueStrings(values, limit = config.screenMaxItems) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
      const v = collapse(value, 220);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= limit) break;
    }
    return out;
  }

  function visibleElements(doc, selector, limit = config.screenMaxItems) {
    const out = [];
    try {
      for (const el of doc.querySelectorAll(selector)) {
        if (out.length >= limit) break;
        if (isIgnoredEl(el) || isVisible(el) !== true) continue;
        out.push(el);
      }
    } catch (_) {}
    return out;
  }

  // [v7.1][9] locatorInfo делает 5-7 querySelectorAll на элемент — компактный дескриптор
  // кэшируется по элементу на время ОДНОГО screenSnapshot()-вызова (generation-инвалидация,
  // не переживает следующий снапшот, т.к. уникальность локатора могла измениться).
  let locatorCacheGen = 0;
  const locatorCache = new WeakMap();

  function locatorInfoCached(el) {
    if (!isElement(el)) return null;
    const hit = locatorCache.get(el);
    if (hit && hit.gen === locatorCacheGen) return hit.value;
    const value = locatorInfo(el);
    locatorCache.set(el, { gen: locatorCacheGen, value });
    return value;
  }

  function compactElement(el) {
    if (!isElement(el)) return null;
    const loc = locatorInfoCached(el);
    return {
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: accessibleName(el),
      text: collapse(el.innerText || el.textContent || '', 220) || null,
      type: el.getAttribute('type'),
      placeholder: collapse(el.getAttribute('placeholder') || '', 160) || null,
      href: sanitizeUrl(el.href || el.getAttribute('href')) || null,
      locator: loc ? { primary: loc.primary, pw: loc.pw } : null
    };
  }

  // [9] лёгкий дескриптор без locatorInfo/rect/computedStyle — не форсирует reflow.
  // Используется только для дешёвого "изменился ли экран" при hover-проверках; если
  // изменение подтвердилось, финальные before/after всё равно строятся полными.
  function compactElementLight(el) {
    if (!isElement(el)) return null;
    return {
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: accessibleName(el),
      text: collapse(el.innerText || el.textContent || '', 220) || null,
      type: el.getAttribute('type'),
      placeholder: null,
      href: null,
      locator: null
    };
  }

  function screenSnapshot(doc = document, ctx = null, opts = null) {
    if (!config.captureScreenSnapshots || !doc) return null;
    const light = !!(opts && opts.light);
    if (!light) locatorCacheGen++;
    const compact = light ? compactElementLight : compactElement;
    const win = doc.defaultView || window;
    const c = ctx || ctxFor(doc);
    const headings = visibleElements(doc, 'h1,h2,h3,[role="heading"]')
      .map(el => collapse(el.innerText || el.textContent || '', 220)).filter(Boolean);
    const dialogs = visibleElements(doc, 'dialog,[role="dialog"],[aria-modal="true"]', 15).map(compact).filter(Boolean);
    const alerts = visibleElements(doc, '[role="alert"],[role="status"],[aria-live]', 20).map(compact).filter(Boolean);
    const buttons = visibleElements(doc, 'button,[role="button"],input[type="button"],input[type="submit"]')
      .map(compact).filter(Boolean);
    const inputs = light ? [] : visibleElements(doc, 'input,textarea,select,[contenteditable="true"]')
      .map(el => {
        const x = compact(el);
        if (!x) return null;
        // [v7.1] rawEditableValue достаёт полный текст CodeMirror 6 (не innerText — тот
        // отдаёт только видимую из-за виртуализации строк часть), поэтому before/after
        // снапшоты редактора реально отражают контент, а не обрезанный фрагмент экрана
        const sensitive = isSensitiveElement(el);
        const raw = rawEditableValue(el);
        x.value = sensitive ? '[REDACTED]' : trunc(raw, fieldTextLimit(el));
        x.valueHash = sensitive ? null : simpleHash(raw);
        if (el.tagName === 'SELECT') x.selectedText = uniqueStrings(Array.from(el.selectedOptions || []).map(o => o.text), 10);
        return x;
      }).filter(Boolean);
    const tables = light ? [] : visibleElements(doc, 'table,[role="grid"],[role="table"]', 12).map(el => {
      let headers = [];
      let rowCount = null;
      try {
        headers = uniqueStrings(Array.from(el.querySelectorAll('th,[role="columnheader"]')).map(x => x.innerText || x.textContent), 20);
        rowCount = el.querySelectorAll('tbody tr,[role="row"]').length;
      } catch (_) {}
      return { locator: locatorInfoCached(el), headers, rowCount, textPreview: collapse(el.innerText || el.textContent || '', 500) };
    });
    let activeElement = null;
    if (!light) { try { activeElement = compact(doc.activeElement); } catch (_) {} }
    const snapshot = {
      pageId: c.pageId || 'page-1',
      frame: c.label || 'top',
      url: sanitizeUrl(win.location && win.location.href ? win.location.href : location.href),
      title: doc.title || null,
      readyState: doc.readyState,
      headings: uniqueStrings(headings),
      dialogs,
      alerts,
      buttons,
      inputs,
      tables,
      activeElement,
      scroll: { x: Math.round(win.scrollX || 0), y: Math.round(win.scrollY || 0) },
      viewport: { width: win.innerWidth || null, height: win.innerHeight || null },
      capturedAt: new Date().toISOString(),
      light
    };
    snapshot.fingerprint = simpleHash(JSON.stringify({
      url: snapshot.url, title: snapshot.title, headings: snapshot.headings,
      dialogs: dialogs.map(x => [x.role, x.name, x.text]),
      alerts: alerts.map(x => [x.role, x.name, x.text]),
      buttons: buttons.slice(0, 20).map(x => [x.name, x.text])
    }));
    return snapshot;
  }

  function simpleHash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function locatorConfidence(locator) {
    if (!locator) return { score: 0, level: 'none', reasons: ['no locator'] };
    const reasons = [];
    let score = 0.2;
    const p = locator.primary || {};
    const pw = locator.pw || {};
    if (p.unique) { score += 0.35; reasons.push('primary locator is unique'); }
    else reasons.push('primary locator is not proven unique');
    if (pw.unique) { score += 0.25; reasons.push('Playwright locator is unique'); }
    if (pw.method === 'getByTestId') { score += 0.18; reasons.push('stable test id'); }
    else if (pw.method === 'getByRole') { score += 0.16; reasons.push('semantic role+name'); }
    else if (pw.method === 'getByLabel') { score += 0.12; reasons.push('label-based locator'); }
    else if (pw.method === 'getByPlaceholder') { score += 0.08; reasons.push('placeholder-based locator'); }
    if (p.kind === 'css' && /nth-of-type/.test(p.css || '')) { score -= 0.18; reasons.push('structural nth-of-type fallback'); }
    if (locator.inShadow) { score -= 0.03; reasons.push('inside open shadow DOM'); }
    score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
    return { score, level: score >= 0.82 ? 'high' : score >= 0.58 ? 'medium' : 'low', reasons };
  }

  function keyedList(list, mapper) {
    const map = new Map();
    for (const item of list || []) {
      const key = mapper(item);
      if (key && !map.has(key)) map.set(key, item);
    }
    return map;
  }

  function screenDiff(before, after) {
    if (!before || !after) return null;
    const diffStrings = (a, b) => {
      const A = new Set(a || []), B = new Set(b || []);
      return { added: [...B].filter(x => !A.has(x)), removed: [...A].filter(x => !B.has(x)) };
    };
    const descriptorKey = x => x && collapse([x.role, x.name, x.text].filter(Boolean).join('|'), 400);
    const diffObjects = (a, b) => {
      const A = keyedList(a, descriptorKey), B = keyedList(b, descriptorKey);
      return {
        added: [...B.entries()].filter(([k]) => !A.has(k)).map(([,v]) => v),
        removed: [...A.entries()].filter(([k]) => !B.has(k)).map(([,v]) => v)
      };
    };

    // [v7.1][8] раньше diff смотрел только на headings/dialogs/alerts/buttons — для Assets
    // единственное, что реально меняется, это значения input/select и порядок строк.
    const inputKey = x => (x && x.locator && x.locator.primary && x.locator.primary.css) || descriptorKey(x);
    const diffInputs = (a, b) => {
      const A = keyedList(a, inputKey), B = keyedList(b, inputKey);
      const changed = [];
      for (const [k, bv] of B.entries()) {
        const av = A.get(k);
        if (!av) continue;
        // valueHash сравнивает ПОЛНЫЙ контент (важно для CM6: truncated value может
        // случайно совпасть по первым maxLargeText символам, hash — нет)
        const valueChanged = (av.valueHash != null && bv.valueHash != null)
          ? av.valueHash !== bv.valueHash
          : av.value !== bv.value;
        const selectedChanged = JSON.stringify(av.selectedText || null) !== JSON.stringify(bv.selectedText || null);
        if (valueChanged || selectedChanged) {
          changed.push({
            locator: bv.locator, name: bv.name, text: bv.text,
            from: av.value, to: bv.value,
            fromHash: av.valueHash || null, toHash: bv.valueHash || null,
            fromSelected: av.selectedText || null, toSelected: bv.selectedText || null
          });
        }
      }
      return {
        added: [...B.entries()].filter(([k]) => !A.has(k)).map(([,v]) => v),
        removed: [...A.entries()].filter(([k]) => !B.has(k)).map(([,v]) => v),
        changed
      };
    };
    const rowOrder = list => (list || []).map(inputKey).filter(Boolean);
    const beforeOrder = rowOrder(before.inputs);
    const afterOrder = rowOrder(after.inputs);
    const commonBefore = beforeOrder.filter(k => afterOrder.includes(k));
    const commonAfter = afterOrder.filter(k => beforeOrder.includes(k));
    const inputsOrderChanged = commonBefore.length > 1 && JSON.stringify(commonBefore) !== JSON.stringify(commonAfter);

    return {
      urlChanged: before.url !== after.url ? { from: before.url, to: after.url } : null,
      titleChanged: before.title !== after.title ? { from: before.title, to: after.title } : null,
      fingerprintChanged: before.fingerprint !== after.fingerprint,
      headings: diffStrings(before.headings, after.headings),
      dialogs: diffObjects(before.dialogs, after.dialogs),
      alerts: diffObjects(before.alerts, after.alerts),
      buttons: diffObjects(before.buttons, after.buttons),
      inputs: diffInputs(before.inputs, after.inputs),
      inputsOrderChanged
    };
  }

  // [v7.1][9] CodeMirror перерисовывает десятки узлов на каждое нажатие клавиши — без
  // этого исключения watchActionEffects дергает compactElement/querySelector на каждый чих,
  // что при печати в редакторе превращается в шквал принудительных reflow.
  function isMutationExcluded(el) {
    if (!isElement(el)) return false;
    for (const sel of config.mutationExcludeSelectors) {
      try { if (el.closest(sel)) return true; } catch (_) {}
    }
    return false;
  }

  function meaningfulMutationNode(node) {
    if (!isElement(node) || isIgnoredEl(node) || isMutationExcluded(node)) return null;
    const interesting = safeMatches(node, 'dialog,[role="dialog"],[role="alert"],[role="status"],[aria-live],h1,h2,h3,button,[role="button"],table,[role="grid"],form,[class*="toast" i],[class*="modal" i],[class*="alert" i],[class*="success" i],[class*="error" i]')
      ? node
      : (node.querySelector ? node.querySelector('dialog,[role="dialog"],[role="alert"],[role="status"],[aria-live],h1,h2,h3,[class*="toast" i],[class*="modal" i],[class*="alert" i]') : null);
    if (!interesting || isIgnoredEl(interesting)) return null;
    return compactElement(interesting);
  }

  function mergeUniqueEffects(list, item) {
    if (!item) return;
    const key = simpleHash(JSON.stringify(item));
    if (!list.some(x => x._key === key)) list.push({ ...item, _key: key });
  }

  // ---------------------------------------------------------------- session

  const restored = (() => {
    if (!config.autoRestore) return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed) return null;
      // [v7.3] Раньше любое несовпадение версии выбрасывало бэкап целиком. Но внутри
      // одной мажорной версии схема только дополняется (новые поля просто отсутствуют —
      // см. ensureEffects), а теряется при этом самое дорогое: запись, которая шла в
      // момент обновления скрипта. Несовместимой считаем только смену мажора.
      const savedMajor = String(parsed.version || '').split('.')[0];
      if (savedMajor !== VERSION.split('.')[0]) {
        native.consoleWarn.call(console, `[logger] бэкап версии ${parsed.version} несовместим с ${VERSION}, начинаю новую сессию.`);
        return null;
      }
      if (parsed.version !== VERSION) {
        native.consoleWarn.call(console, `[logger] бэкап версии ${parsed.version} восстановлен в ${VERSION}: поля, добавленные после ${parsed.version}, у старых шагов будут пустыми.`);
      }
      return parsed;
    } catch (_) {
      return null;
    }
  })();

  // [11] контекст запуска — без него реплей на другой машине плывёт
  function environment() {
    let timezone = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      deviceScaleFactor: window.devicePixelRatio || 1,
      userAgent: navigator.userAgent,
      locale: navigator.language,
      languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : null,
      timezone,
      platform: navigator.platform || null
    };
  }

  const session = restored && restored.session ? restored.session : {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    startUrl: location.href,
    startTitle: document.title,
    macroName: null, // [v7.2] __logger.setMacroName(...) — иначе выводится из pathname при экспорте
    env: environment()
  };
  if (!session.env) session.env = environment();
  if (session.macroName === undefined) session.macroName = null;

  const rawLog = restored && Array.isArray(restored.rawLog) ? restored.rawLog : [];
  const macroLog = restored && Array.isArray(restored.macroLog) ? restored.macroLog : [];
  const screenLog = restored && Array.isArray(restored.screenLog) ? restored.screenLog : [];
  const networkLog = restored && Array.isArray(restored.networkLog) ? restored.networkLog : [];
  // [v7.1][19] группировка по страницам/задачам — плоский таймлайн на 20 страниц читать
  // бесполезно, а per-page рецепт с фактическими значениями это то, из чего пишется код.
  const tasksLog = restored && Array.isArray(restored.tasksLog) ? restored.tasksLog : [];
  // [v7.3] WebSocket/SSE — это поток кадров, а не пара запрос/ответ, поэтому живёт
  // отдельным журналом; в networkLog при этом попадает сам handshake, чтобы адрес сокета
  // был виден в инвентаре эндпоинтов наравне с HTTP.
  const streamLog = restored && Array.isArray(restored.streamLog) ? restored.streamLog : [];

  window.__actionLog = rawLog;
  window.__macroLog = macroLog;
  window.__screenLog = screenLog;
  window.__networkLog = networkLog;
  window.__tasksLog = tasksLog;
  window.__streamLog = streamLog;

  let recording = true;
  let rawSeq = rawLog.length ? Math.max(...rawLog.map(x => Number(x.seq) || 0)) + 1 : 0;
  let macroSeq = macroLog.length ? Math.max(...macroLog.map(x => Number(x.seq) || 0)) + 1 : 0;
  let lastKnownUrl = restored && restored.lastUrl ? restored.lastUrl : location.href;
  let lastTitle = document.title;
  let internalDepth = 0;
  let pageSeq = restored && restored.pageSeq ? restored.pageSeq : 1;
  let requestSeq = restored && restored.requestSeq ? restored.requestSeq : 0;
  let currentAction = null;
  let currentTask = restored && restored.currentTask ? restored.currentTask : null; // [v7.1][19]
  let idAttributeDiscoveryRanAfterNav = false; // [v7.2]
  const actionsById = new Map();
  for (const a of macroLog) if (a && a.id) actionsById.set(a.id, a);
  let actionFinalizeTimer = null;
  const pageWindows = new WeakMap();
  pageWindows.set(window, 'page-1');

  const ac = new AbortController(); // [3]

  function withInternal(fn) {
    internalDepth++;
    try { return fn(); }
    finally { internalDepth--; }
  }

  // ----------------------------------------------- [7][v7.1][10] бэкап c деградацией
  //
  // localStorage-only бэкап раньше JSON.stringify'ил macroLog + 300 снапшотов + 500 network
  // записей каждые 2.5с — на часовой сессии это мегабайты стрингификации на каждом тике и
  // почти гарантированный выход за квоту localStorage (5-10MB), после чего терялись как раз
  // rawLog/screenLog/networkLog. Теперь: ПОЛНЫЙ бэкап (structured clone, без stringify) идёт
  // в IndexedDB — там квота на порядки больше; localStorage хранит только компактную версию
  // (session + macroLog, большие текстовые поля обрезаны для самого бэкапа) для быстрого
  // синхронного восстановления сразу после reload, ещё до того как откроется IndexedDB.

  let saveTimer = null;
  let backupMode = 'full'; // full | macro-only | off
  let idbHandle = null;
  let idbFailed = false;

  function openIdb() {
    if (idbHandle) return Promise.resolve(idbHandle);
    if (idbFailed || typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => { idbHandle = req.result; resolve(idbHandle); };
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
  }

  function idbPut(payload) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readwrite'); } catch (e) { reject(e); return; }
      tx.objectStore(IDB_STORE).put(payload, 'session');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexedDB put failed'));
    }));
  }

  function idbGet() {
    return openIdb().then(db => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readonly'); } catch (e) { reject(e); return; }
      const req = tx.objectStore(IDB_STORE).get('session');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('indexedDB get failed'));
    }));
  }

  function fullBackupPayload() {
    return {
      version: VERSION,
      session,
      lastUrl: location.href,
      savedAt: new Date().toISOString(),
      macroLog,
      screenLog,
      networkLog,
      streamLog,
      rawLog,
      tasksLog,
      currentTask,
      pageSeq,
      requestSeq
    };
  }

  // large text (CM6/textarea) обрезается только в компактной localStorage-версии —
  // полное значение всё равно живёт в памяти и уходит в IndexedDB/экспорт без урезания
  function macroLogForLocalStorage() {
    return macroLog.map(a => {
      if (a && a.action === 'fill' && a.isLargeText && typeof a.value === 'string' && a.value.length > 2000) {
        return { ...a, value: trunc(a.value, 2000), valueTruncatedForLocalStorageBackup: true };
      }
      return a;
    });
  }

  function compactBackupPayload() {
    return {
      version: VERSION,
      session,
      lastUrl: location.href,
      savedAt: new Date().toISOString(),
      macroLog: macroLogForLocalStorage(),
      tasksLog,
      currentTask,
      pageSeq,
      requestSeq
    };
  }

  function writeBackup() {
    if (backupMode === 'off') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactBackupPayload()));
    } catch (e) {
      backupMode = 'off';
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      native.consoleWarn.call(console, '[logger] бэкап отключён — даже компактная версия не влезает в localStorage. Экспортируйте лог вручную.');
      return;
    }
    if (idbFailed || typeof indexedDB === 'undefined') return;
    idbPut(fullBackupPayload()).catch(e => {
      idbFailed = true;
      native.consoleWarn.call(console, '[logger] IndexedDB бэкап недоступен — после перезагрузки восстановится только macroLog (без rawLog/screenLog/networkLog): ', e && e.message ? e.message : e);
    });
  }

  function saveBackup(force = false) {
    if (force) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      writeBackup();
      return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeBackup();
    }, config.autoSaveMs);
  }

  function trimLogs() {
    if (rawLog.length > config.maxRawEvents) rawLog.splice(0, rawLog.length - config.maxRawEvents);
    if (macroLog.length > config.maxMacroActions) macroLog.splice(0, macroLog.length - config.maxMacroActions);
    if (screenLog.length > config.maxScreenSnapshots) screenLog.splice(0, screenLog.length - config.maxScreenSnapshots);
    if (networkLog.length > config.maxNetworkEntries) networkLog.splice(0, networkLog.length - config.maxNetworkEntries);
    if (streamLog.length > config.maxStreamEntries) streamLog.splice(0, streamLog.length - config.maxStreamEntries);
  }

  function pushRaw(entry) {
    if (!recording || internalDepth) return null;
    entry.seq = rawSeq++;
    entry.t = Date.now();
    entry.iso = new Date().toISOString();
    entry.url = location.href;
    entry.frame = entry.frame || 'top';
    rawLog.push(entry);
    trimLogs();
    schedulePanelUpdate();
    saveBackup(false);
    return entry;
  }

  function sameLocator(a, b) {
    return !!(a && b && a.primary && b.primary && a.primary.css === b.primary.css);
  }

  function currentActionForCorrelation(maxAge = config.effectMaxMs) {
    if (!currentAction) return null;
    if (Date.now() - currentAction.t > maxAge) return null;
    return currentAction;
  }

  function actionById(id) {
    return id ? actionsById.get(id) || null : null;
  }

  function recordScreen(kind, action, ctx, snapshot) {
    if (!snapshot) return null;
    const entry = {
      seq: screenLog.length,
      kind,
      actionId: action ? action.id : null,
      t: Date.now(),
      iso: new Date().toISOString(),
      snapshot
    };
    screenLog.push(entry);
    trimLogs();
    return entry;
  }

  function deriveExpected(action) {
    if (!action || !config.inferExpectedResults) return [];
    const out = [];
    const add = (type, value, confidence = 'inferred') => out.push({ type, value, confidence });
    const effects = action.effects || {};
    if (effects.navigation && effects.navigation.toUrl) add('url', effects.navigation.toUrl, 'high');
    if (effects.popup) add('popup', effects.popup.url || effects.popup.pageId || 'popup opened', 'high');
    if (effects.popup && effects.popup.attachable === false) {
      add('manual_verification_required', { url: effects.popup.url, reason: 'target=_blank popup not instrumented by a one-shot page script' }, 'high');
    }
    for (const d of effects.dialogs || []) add('dialog', { type: d.type, message: d.message, accepted: d.accepted }, 'high');
    for (const d of effects.downloads || []) add('download', { filename: d.filename || null, href: d.href || null }, 'medium');
    for (const u of (effects.ui || []).slice(0, 12)) {
      if (u.change === 'added' && u.node) add('ui_visible', { role: u.node.role, name: u.node.name, text: u.node.text, locator: u.node.locator }, 'medium');
    }
    if (action.diff) {
      for (const d of (action.diff.dialogs && action.diff.dialogs.added || []).slice(0, 6)) add('dialog_visible', d, 'high');
      for (const a of (action.diff.alerts && action.diff.alerts.added || []).slice(0, 8)) add('status_visible', a, 'high');
      for (const h of (action.diff.headings && action.diff.headings.added || []).slice(0, 6)) add('heading_visible', h, 'medium');
      if (action.diff.titleChanged) add('title', action.diff.titleChanged.to, 'medium');
      for (const c of (action.diff.inputs && action.diff.inputs.changed || []).slice(0, 8)) add('input_value_changed', c, 'high');
      for (const c of (action.diff.inputs && action.diff.inputs.added || []).slice(0, 6)) add('input_added', { name: c.name, text: c.text, locator: c.locator }, 'medium');
      for (const c of (action.diff.inputs && action.diff.inputs.removed || []).slice(0, 6)) add('input_removed', { name: c.name, text: c.text, locator: c.locator }, 'medium');
      if (action.diff.inputsOrderChanged) add('rows_reordered', true, 'medium');
    }
    for (const n of (effects.network || []).filter(x => x.phase === 'end' && x.status >= 400).slice(0, 5)) add('network_error_observed', { method: n.method, url: n.requestUrl, status: n.status }, 'high');
    const seen = new Set();
    return out.filter(x => {
      const k = simpleHash(JSON.stringify(x));
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  // [v7.1][20] Probe API — предметное состояние приложения (активная вкладка, ключ
  // документа, список строк Assets...), которое не выразить общими DOM-эвристиками.
  // __logger.registerProbe(name, fn) вызывает fn('before'|'after') до/после каждого действия.
  const probes = {};

  function runProbes(phase) {
    const out = {};
    let any = false;
    for (const [name, fn] of Object.entries(probes)) {
      any = true;
      try { out[name] = fn(phase); } catch (e) { out[name] = { __probeError: String(e && e.message || e) }; }
    }
    return any ? out : null;
  }

  function finalizeAction(action, reason = 'settled') {
    if (!action || action.finalizedAt) return action;
    const ctx = action.__ctx || ctxFor(document);
    const doc = action.__doc || document;
    let after = null;
    try { after = screenSnapshot(doc, ctx); } catch (_) {}
    action.after = after;
    action.diff = screenDiff(action.before, after);
    action.rawSeqEnd = Math.max(action.rawSeqStart, rawSeq - 1);
    action.finalizedAt = new Date().toISOString();
    action.finalizeReason = reason;
    action.probe = action.probe || {};
    try { action.probe.after = runProbes('after'); } catch (_) {}
    action.inferredExpected = deriveExpected(action);
    if (after) recordScreen('after', action, ctx, after);
    delete action.__ctx;
    delete action.__doc;
    if (currentAction === action) currentAction = null;
    saveBackup(false);
    return action;
  }

  function scheduleFinalize(action) {
    if (actionFinalizeTimer) clearTimeout(actionFinalizeTimer);
    actionFinalizeTimer = setTimeout(() => {
      actionFinalizeTimer = null;
      finalizeAction(action, 'settled');
    }, config.effectSettleMs);
  }

  function ensureEffects(action) {
    if (!action.effects) action.effects = { network: [], ui: [], dialogs: [], downloads: [], errors: [], streams: [], navigation: null, popup: null };
    // [v7.3] у действия, восстановленного из бэкапа v7.2, поля streams нет — дорисовываем,
    // иначе первый же кадр WebSocket падает на push у undefined
    if (!Array.isArray(action.effects.streams)) action.effects.streams = [];
    return action.effects;
  }

  // [v7.2] тот же локатор + тот же тип действия повторно в пределах 15с, а предыдущий раз
  // ничего видимо не изменил — почти всегда значит "не дождались", намёк на нужный wait
  // в сгенерированном скрипте, а не два независимых шага.
  const POSSIBLE_RETRY_WINDOW_MS = 15000;
  function detectPossibleRetry(action) {
    if (!action.locator || !action.locator.primary || !action.locator.primary.css) return null;
    const css = action.locator.primary.css;
    for (let i = macroLog.length - 1; i >= 0 && i >= macroLog.length - 20; i--) {
      const prev = macroLog[i];
      if (!prev || prev.action !== action.action) continue;
      if (!prev.locator || !prev.locator.primary || prev.locator.primary.css !== css) continue;
      const gap = (action.t || Date.now()) - prev.t;
      if (gap > POSSIBLE_RETRY_WINDOW_MS) return null;
      if (prev.finalizedAt && prev.diff && !prev.diff.fingerprintChanged &&
          !(prev.diff.inputs && prev.diff.inputs.changed && prev.diff.inputs.changed.length)) {
        return { previousActionId: prev.id, gapMs: gap };
      }
      return null;
    }
    return null;
  }

  function pushMacro(action) {
    if (!recording || internalDepth || !action) return null;

    const now = Date.now();
    const previous = macroLog[macroLog.length - 1];

    if (previous && action.action === previous.action &&
        sameLocator(action.locator, previous.locator) &&
        now - previous.t < 250 &&
        ['click', 'dblclick', 'contextmenu'].includes(action.action)) {
      return previous;
    }

    if (currentAction && !currentAction.finalizedAt) finalizeAction(currentAction, 'next_action');

    action.seq = macroSeq++;
    action.id = action.id || `a-${action.seq}`;
    action.order = action.seq + 1;
    action.t = now;
    action.iso = new Date(now).toISOString();
    action.url = location.href;
    action.gapMs = previous ? Math.max(0, now - previous.t) : 0;
    action.frameChain = action.frameChain || [];
    action.pageId = action.pageId || (action.__ctx && action.__ctx.pageId) || 'page-1';
    action.rawSeqStart = Number.isInteger(action.rawSeqStart) ? action.rawSeqStart : Math.max(0, rawSeq - 1);
    action.sinceStartMs = Math.max(0, now - new Date(session.startedAt).getTime());
    action.locatorConfidence = locatorConfidence(action.locator);
    action.taskId = currentTask ? currentTask.id : null;
    action.possibleRetry = detectPossibleRetry(action);
    action.effects = action.effects || { network: [], ui: [], dialogs: [], downloads: [], errors: [], navigation: null, popup: null };
    const ctx = action.__ctx || ctxFor(action.__doc || document);
    const doc = action.__doc || document;
    // [v7.1][16] dragTo подставляет свой pre-drag снапшот (нативный DOM к моменту pushMacro
    // уже отражает НОВЫЙ порядок строк — снапшот "до" нужно взять до, а не в момент drop)
    action.before = action.before || screenSnapshot(doc, ctx);
    if (action.before) recordScreen('before', action, ctx, action.before);
    action.probe = { before: null, after: null };
    try { action.probe.before = runProbes('before'); } catch (_) {}
    action.__ctx = ctx;
    action.__doc = doc;

    macroLog.push(action);
    actionsById.set(action.id, action);
    currentAction = action;
    trimLogs();
    schedulePanelUpdate();
    saveBackup(false);
    scheduleFinalize(action);
    return action;
  }

  function lastInteractive() {
    const candidates = [...macroLog].reverse();
    const last = candidates.find(a => a && ['click', 'dblclick', 'contextmenu', 'hover', 'fill', 'select', 'check', 'uncheck', 'press', 'submit', 'dragTo', 'setFiles'].includes(a.action));
    return last || null;
  }

  // [v7.1][4] setFiles раньше писал только name/size/type — для миграции файл и есть
  // результат (inline JS/CSS блок, выгруженный в отдельный ассет). Текстовые файлы читаем
  // через File.text() и кладём в action.artifacts вместе с хэшем.
  const TEXT_ARTIFACT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|css|scss|less|json|html|htm|svg|txt|md)$/i;
  const TEXT_ARTIFACT_MIME = /^(text\/|application\/json|application\/javascript|application\/xml|image\/svg\+xml)/i;
  const MAX_ARTIFACT_FILE_BYTES = 2 * 1024 * 1024;

  function shouldCaptureFileContent(file) {
    if (!file) return false;
    if (file.size > MAX_ARTIFACT_FILE_BYTES) return false;
    return TEXT_ARTIFACT_MIME.test(file.type || '') || TEXT_ARTIFACT_EXT.test(file.name || '');
  }

  async function captureFileArtifacts(fileList, action) {
    if (!action) return;
    const files = Array.from(fileList || []);
    action.artifacts = action.artifacts || [];
    for (const f of files) {
      const meta = { name: f.name, size: f.size, type: f.type };
      if (!shouldCaptureFileContent(f)) {
        meta.contentCaptured = false;
        action.artifacts.push(meta);
        continue;
      }
      try {
        const text = await f.text();
        meta.contentCaptured = true;
        meta.contentLength = text.length;
        meta.contentHash = simpleHash(text);
        meta.content = trunc(text, config.maxLargeText);
        meta.truncated = text.length > config.maxLargeText;
      } catch (e) {
        meta.contentCaptured = false;
        meta.captureError = String(e && e.message || e);
      }
      action.artifacts.push(meta);
      saveBackup(false);
    }
  }

  // -------------------------------------------------------------- listeners

  const docContexts = new WeakMap();
  const attachedDocs = new WeakSet();
  const pendingInputs = new Map();
  let dragSource = null;
  let mutationObservers = [];
  let effectObservers = [];
  let iframeObservers = [];
  let hoverCandidate = null;
  let pointerDragCandidate = null; // [v7.1][16]

  function ctxFor(doc) {
    return docContexts.get(doc) || { label: 'top', frameChain: [], pageId: 'page-1' };
  }

  // [v7.1/v7.2][7] "к какой строке относится этот select/delete" — активная вкладка, заголовок
  // раскрытой панели и URL из ближайшей строки. Без этого локатор вида nth-of-type ничего не
  // говорит о том, какую именно строку затронуло действие.
  function nearestRowUrl(el) {
    try {
      const row = el && el.closest ? el.closest('tr,[role="row"],[role="listitem"],.ant-list-item,.ant-table-row,li') : null;
      if (!row) return null;
      const urlInput = row.querySelector('input[type="text"],input[type="url"],input:not([type])');
      if (urlInput && urlInput.value) return trunc(urlInput.value, 500);
      return null;
    } catch (_) {
      return null;
    }
  }

  // [v7.2] Активная вкладка/заголовок панели почти никогда не являются ПРЕДКОМ элемента
  // внутри их содержимого (это соседи по DOM: .ant-collapse-header — сосед .ant-collapse-content,
  // а не его родитель) — el.closest() тут в принципе не может найти совпадение. Нужно сначала
  // подняться до общего контейнера, а затем поискать заголовок/таб уже внутри него.
  function nearestActiveTabLabel(el, maxLen) {
    try {
      const container = el.closest('.ant-tabs, [role="tablist"], [class*="tabs" i]');
      if (!container) return null;
      const activeTab = container.querySelector('.ant-tabs-tab-active .ant-tabs-tab-btn, .ant-tabs-tab-active, [role="tab"][aria-selected="true"]');
      if (!activeTab) return null;
      return collapse(activeTab.innerText || activeTab.textContent || '', maxLen || 160) || null;
    } catch (_) {
      return null;
    }
  }

  function nearestPanelHeaderLabel(el, maxLen) {
    try {
      const item = el.closest('.ant-collapse-item');
      if (item) {
        const header = item.querySelector('.ant-collapse-header');
        if (header) return collapse(header.innerText || header.textContent || '', maxLen || 160) || null;
      }
      // generic ARIA: подняться по предкам и поискать элемент с id, на который где-то
      // в документе ссылается aria-controls (стандартный паттерн disclosure/accordion)
      let node = el, hops = 0;
      while (node && node !== document.body && hops < 8) {
        if (node.id) {
          const trigger = document.querySelector(`[aria-controls="${quoteAttr(node.id)}"]`);
          if (trigger) return collapse(trigger.innerText || trigger.textContent || '', maxLen || 160) || null;
        }
        node = node.parentElement;
        hops++;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function buildContextChain(el) {
    const chain = [];
    try {
      const tab = nearestActiveTabLabel(el, 160);
      if (tab) chain.push({ kind: 'tab', label: tab });
      const panel = nearestPanelHeaderLabel(el, 160);
      if (panel) chain.push({ kind: 'panel', label: panel });
      const rowUrl = nearestRowUrl(el);
      if (rowUrl) chain.push({ kind: 'rowUrl', value: sanitizeUrl(rowUrl) || rowUrl });
    } catch (_) {}
    return chain;
  }

  function macroTarget(el, ctx) {
    const loc = locatorInfo(el);
    return {
      locator: loc,
      locatorConfidence: locatorConfidence(loc),
      target: {
        tag: el.tagName ? el.tagName.toLowerCase() : null,
        type: el.getAttribute ? el.getAttribute('type') : null,
        text: collapse(el.innerText || el.textContent || '', 120) || null
      },
      frameChain: ctx.frameChain || [],
      pageId: ctx.pageId || 'page-1',
      contextChain: buildContextChain(el),
      __ctx: ctx,
      __doc: el.ownerDocument || document
    };
  }

  function isTextLike(el) {
    if (!isElement(el)) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    const type = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'date', 'datetime-local', 'month', 'week', 'time'].includes(type);
  }

  // [v7.1][1] CodeMirror 6 виртуализирует строки — innerText отдаёт только видимый кусок.
  // node.cmView.view — внутренний, но стабильный способ достать полный EditorState.doc.
  function isCodeMirrorContent(el) {
    return safeMatches(el, '.cm-content');
  }

  function codeMirrorFullText(el) {
    try {
      const view = el && el.cmView && el.cmView.view;
      if (view && view.state && view.state.doc && typeof view.state.doc.toString === 'function') {
        return view.state.doc.toString();
      }
    } catch (_) {}
    return null;
  }

  // Полное непорезанное значение поля (используется и для отображаемого value, и для
  // hash/length/diff, которые обязаны отражать реальный контент, а не то, что влезло в лимит).
  function rawEditableValue(el) {
    if (isCodeMirrorContent(el)) {
      const full = codeMirrorFullText(el);
      if (full != null) return full;
    }
    if (el.isContentEditable) return el.innerText || el.textContent || '';
    return 'value' in el ? el.value : '';
  }

  function currentEditableValue(el) {
    return sanitizeValue(el, rawEditableValue(el));
  }

  // [v7.1] простой построчный diff (не LCS) — достаточно, чтобы увидеть, какие строки
  // появились/исчезли между началом и концом серии debounce-вводов в одном поле.
  function lineDiff(oldText, newText, limit = 40) {
    const oldLines = String(oldText == null ? '' : oldText).split('\n');
    const newLines = String(newText == null ? '' : newText).split('\n');
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const addedLines = newLines.filter(l => !oldSet.has(l)).slice(0, limit).map(l => collapse(l, 300));
    const removedLines = oldLines.filter(l => !newSet.has(l)).slice(0, limit).map(l => collapse(l, 300));
    return {
      addedLines,
      removedLines,
      addedCount: newLines.filter(l => !oldSet.has(l)).length,
      removedCount: oldLines.filter(l => !newSet.has(l)).length,
      oldLineCount: oldLines.length,
      newLineCount: newLines.length
    };
  }

  function flushInput(el, reason = 'debounce') {
    const pending = pendingInputs.get(el);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingInputs.delete(el);

    const sensitive = isSensitiveElement(el);
    const raw = rawEditableValue(el);
    const limit = fieldTextLimit(el);
    const value = sensitive ? '[REDACTED]' : trunc(raw, limit);
    const isLargeText = isCodeMirrorContent(el) || (isElement(el) && el.tagName === 'TEXTAREA') || !!(isElement(el) && el.isContentEditable);
    const valueLength = sensitive ? null : raw.length;
    const valueHash = sensitive ? null : simpleHash(raw);
    const textDiff = (!sensitive && isLargeText && pending.initialValue != null && pending.initialValue !== raw)
      ? lineDiff(pending.initialValue, raw)
      : null;

    const prev = macroLog[macroLog.length - 1];

    if (prev && prev.action === 'fill' && sameLocator(prev.locator, pending.locator) && Date.now() - prev.t < 2500) {
      prev.value = value;
      prev.valueLength = valueLength;
      prev.valueHash = valueHash;
      prev.isLargeText = isLargeText;
      if (textDiff) prev.textDiff = textDiff;
      prev.reason = reason;
      prev.lastValueUpdateAt = new Date().toISOString();
      prev.inferredExpected = deriveExpected(prev);
      schedulePanelUpdate();
      saveBackup(true);
      return;
    }

    pushMacro({
      action: 'fill',
      locator: pending.locator,
      target: pending.target,
      frameChain: pending.frameChain,
      contextChain: pending.contextChain,
      value,
      valueLength,
      valueHash,
      isLargeText,
      textDiff,
      sensitive,
      reason,
      rawSeqStart: pending.rawSeqStart
    });
  }

  function scheduleInput(el, ctx) {
    const old = pendingInputs.get(el);
    if (old) clearTimeout(old.timer);
    const base = macroTarget(el, ctx);
    const timer = setTimeout(() => flushInput(el, 'debounce'), config.inputDebounceMs);
    const initialValue = old && old.initialValue != null ? old.initialValue : rawEditableValue(el);
    pendingInputs.set(el, {
      ...base,
      initialValue,
      rawSeqStart: old && Number.isInteger(old.rawSeqStart) ? old.rawSeqStart : Math.max(0, rawSeq - 1),
      timer
    });
  }

  function flushAllInputs() {
    for (const el of Array.from(pendingInputs.keys())) flushInput(el, 'flush');
  }

  // [12] hover: меню, раскрывающиеся по наведению
  const HOVER_SENSITIVE = '[aria-haspopup],[aria-expanded],[role="menuitem"],[role="menu"],[role="tab"],a,button,summary,li,[class*="menu" i],[class*="dropdown" i],[class*="nav" i],[class*="submenu" i]';

  function isHoverSensitive(el) {
    return safeMatches(el, HOVER_SENSITIVE);
  }

  function maybeInsertHover(clickEl) {
    const candidate = hoverCandidate;
    hoverCandidate = null;
    if (!candidate || !config.trackHover) return;
    if (Date.now() - candidate.at > 8000) return;
    const el = candidate.el;
    if (!isElement(el) || !el.isConnected || el === clickEl) return;

    // v7: parent→submenu больше не отбрасывается. Hover сохраняем, если UI после dwell
    // изменился или клик произошёл внутри/рядом с раскрытым меню.
    // [v7.1][9] это только дешёвая light-проверка "стоит ли вообще записывать hover";
    // если да — полноценные before/after строит обычный finalizeAction() у pushMacro.
    const after = screenSnapshot(el.ownerDocument || document, candidate.ctx, { light: true });
    const diff = screenDiff(candidate.before, after);
    let related = false;
    try { related = !!(el.contains(clickEl) || clickEl.contains(el)); } catch (_) {}
    const changed = !!(diff && diff.fingerprintChanged);
    if (!changed && !related) return;
    pushMacro({ action: 'hover', ...macroTarget(el, candidate.ctx), inferred: true, hoverEvidence: { relatedToClick: related, uiChanged: changed } });
  }

  // [v7.1][6] Ant Design не даёт native change/select-семантику: клик по опции в портале,
  // Switch без checkbox, Collapse-заголовок и кнопки Popconfirm/Modal — всё это раньше писалось
  // как безымянный "клик по div". Ищем ближайший известный паттерн AntD DOM и переобозначаем
  // уже созданное действие вместо второго клика.
  function findAntdSelectForDropdown(dropdownEl) {
    try {
      const listboxId = dropdownEl && dropdownEl.id;
      if (!listboxId) return null;
      const owner = document.querySelector(`[aria-owns="${listboxId}"],[aria-controls="${listboxId}"]`);
      if (!owner) return null;
      return owner.closest('.ant-select');
    } catch (_) {
      return null;
    }
  }

  function annotateAntdInteractions(t, action) {
    if (!isElement(t) || !action) return;
    try {
      const option = t.closest('.ant-select-item-option');
      if (option) {
        const dropdown = option.closest('.ant-select-dropdown');
        const selectEl = dropdown ? findAntdSelectForDropdown(dropdown) : null;
        const valueText = collapse(option.getAttribute('title') || option.textContent || '', 160);
        const previousText = selectEl
          ? collapse((selectEl.querySelector('.ant-select-selection-item') || {}).textContent || '', 160) || null
          : null;
        action.action = 'select';
        action.value = valueText;
        action.antd = { control: 'select', valueText, previousText };
        if (selectEl) {
          const loc = locatorInfo(selectEl);
          if (loc) { action.locator = loc; action.locatorConfidence = locatorConfidence(loc); action.controlLocator = loc; }
        }
        action.inferredExpected = deriveExpected(action);
        return;
      }

      const sw = t.closest('.ant-switch');
      if (sw) {
        const checked = sw.getAttribute('aria-checked') === 'true';
        action.action = 'toggle';
        action.checked = checked;
        action.antd = { control: 'switch', checked };
        action.inferredExpected = deriveExpected(action);
        return;
      }

      const radio = t.closest('.ant-radio-wrapper,.ant-radio-button-wrapper');
      if (radio) {
        action.antd = { control: 'radio', label: collapse(radio.textContent || '', 160) };
        return;
      }

      const collapseHeader = t.closest('.ant-collapse-header');
      if (collapseHeader) {
        const item = collapseHeader.closest('.ant-collapse-item');
        const wasActive = item ? item.classList.contains('ant-collapse-item-active') : null;
        action.action = 'expand';
        action.antd = { control: 'collapse', panelTitle: collapse(collapseHeader.textContent || '', 160), wasActive };
        action.inferredExpected = deriveExpected(action);
        return;
      }

      const popconfirmBtn = t.closest('.ant-popover-buttons button,.ant-popconfirm-buttons button');
      if (popconfirmBtn) {
        const isConfirm = popconfirmBtn.classList.contains('ant-btn-primary') || popconfirmBtn.classList.contains('ant-btn-dangerous');
        action.antd = { control: 'popconfirm', choice: isConfirm ? 'confirm' : 'cancel', label: collapse(popconfirmBtn.textContent || '', 80) };
        return;
      }

      const modalFooterBtn = t.closest('.ant-modal-footer button');
      if (modalFooterBtn) {
        const modal = modalFooterBtn.closest('.ant-modal');
        const title = modal ? collapse((modal.querySelector('.ant-modal-title') || {}).textContent || '', 160) : null;
        action.antd = { control: 'modal', label: collapse(modalFooterBtn.textContent || '', 80), modalTitle: title };
        return;
      }
    } catch (_) {}
  }

  // [v7.2] generic-слой поверх WAI-ARIA — работает на ЛЮБОМ сайте (MUI, Radix, react-select,
  // самописные компоненты), не только AntD. Запускается только если AntD-детектор выше не
  // распознал паттерн (action.antd ещё не выставлен), чтобы не переобозначать дважды.
  function annotateGenericAriaInteractions(t, action) {
    if (!isElement(t) || !action || action.antd) return;
    try {
      const option = t.closest('[role="option"]');
      if (option) {
        const listbox = option.closest('[role="listbox"]');
        const listboxId = listbox && listbox.id;
        const owner = listboxId ? document.querySelector(`[aria-owns="${listboxId}"],[aria-controls="${listboxId}"],[aria-activedescendant]`) : null;
        const valueText = collapse(option.textContent || '', 160);
        action.action = 'select';
        action.value = valueText;
        action.aria = { control: 'listbox-option', valueText };
        if (owner) {
          const loc = locatorInfo(owner);
          if (loc) { action.locator = loc; action.locatorConfidence = locatorConfidence(loc); action.controlLocator = loc; }
        }
        action.inferredExpected = deriveExpected(action);
        return;
      }

      const sw = t.closest('[role="switch"]');
      if (sw) {
        const checked = sw.getAttribute('aria-checked') === 'true';
        action.action = 'toggle';
        action.checked = checked;
        action.aria = { control: 'switch', checked };
        action.inferredExpected = deriveExpected(action);
        return;
      }

      const tab = t.closest('[role="tab"]');
      if (tab) {
        action.aria = { control: 'tab', label: collapse(tab.textContent || '', 160), selected: tab.getAttribute('aria-selected') === 'true' };
        return;
      }

      // дисклоужер/аккордеон/дерево — любой триггер с aria-expanded, если это сам кликнутый
      // элемент управления, а не случайный контейнер с этим атрибутом где-то выше по дереву
      const disclosure = safeMatches(t, '[aria-expanded]') ? t : t.closest('button[aria-expanded],[role="button"][aria-expanded],summary[aria-expanded],[role="tab"][aria-expanded]');
      if (disclosure) {
        const wasExpanded = disclosure.getAttribute('aria-expanded') === 'true';
        action.action = 'expand';
        action.aria = { control: 'disclosure', label: collapse(disclosure.textContent || '', 160), wasExpanded };
        action.inferredExpected = deriveExpected(action);
        return;
      }
    } catch (_) {}
  }

  // [v7.2] эвристика "разрушительности": текст элемента/ближайшей кнопки-ссылки или её
  // классы похожи на необратимое действие. Не завязано на конкретный сайт/дизайн-систему.
  function computeDestructive(t, action) {
    if (!isElement(t) || !action) return;
    try {
      const name = (action.locator && (action.locator.accessibleName || action.locator.text)) || (action.target && action.target.text) || '';
      if (config.destructiveWordPattern.test(name)) { action.destructive = true; return; }
      const control = t.closest('button,[role="button"],a,[role="menuitem"]') || t;
      const cls = typeof control.className === 'string' ? control.className : '';
      if (config.destructiveClassPattern.test(cls)) { action.destructive = true; return; }
      const controlText = collapse(control.innerText || control.textContent || '', 160) || '';
      if (config.destructiveWordPattern.test(controlText)) action.destructive = true;
    } catch (_) {}
  }

  // [5] popup: клик, открывающий новую вкладку
  function annotatePopup(url, popupWindow = null, via = 'window_open') {
    const last = lastInteractive();
    const pageId = `page-${++pageSeq}`;
    const info = { url: sanitizeUrl(url) || null, pageId, via };
    if (popupWindow) {
      try { pageWindows.set(popupWindow, pageId); } catch (_) {}
    }
    if (last && Date.now() - last.t < config.effectMaxMs) {
      last.resultPopup = info;
      ensureEffects(last).popup = info;
      last.inferredExpected = deriveExpected(last);
    } else {
      pushMacro({ action: 'popup', popup: info, frameChain: [], pageId: 'page-1', __ctx: ctxFor(document), __doc: document });
    }
    saveBackup(false);

    // Если popup same-origin и window.open вернул WindowProxy — подключаем его к той же сессии.
    if (popupWindow) {
      const tryAttach = () => {
        try {
          const d = popupWindow.document;
          if (!d) return;
          const ctx = { label: `popup:${pageId}`, frameChain: [], pageId };
          attachListeners(d, ctx);
          attachIframes(d, ctx);
          patchNetwork(popupWindow);
        } catch (_) {}
      };
      setTimeout(tryAttach, 50);
      try { popupWindow.addEventListener('load', () => setTimeout(tryAttach, 50), { signal: ac.signal }); } catch (_) {}
    }
    return info;
  }

  window.open = function (url) {
    const result = native.open.apply(this, arguments);
    try {
      pushRaw({ kind: 'navigation', type: 'window_open', requestUrl: sanitizeUrl(url) });
      annotatePopup(url, result, 'window_open');
    } catch (_) {}
    return result;
  };

  function attachListeners(doc, ctx) {
    if (!doc || attachedDocs.has(doc)) return;
    attachedDocs.add(doc);
    docContexts.set(doc, ctx);

    const win = doc.defaultView || window;

    const on = (target, type, handler, opts = {}) => {
      try {
        const options = typeof opts === 'boolean' ? { capture: opts } : { ...opts };
        options.signal = ac.signal;
        if (options.capture === undefined) options.capture = true;
        target.addEventListener(type, handler, options);
      } catch (_) {}
    };

    on(doc, 'click', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;

      maybeInsertHover(t);

      pushRaw({
        kind: 'mouse', type: 'click', frame: ctx.label, target: elInfo(t),
        coords: { clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY },
        button: e.button
      });
      const action = pushMacro({ action: 'click', ...macroTarget(t, ctx), button: e.button });
      annotateAntdInteractions(t, action);
      annotateGenericAriaInteractions(t, action);
      computeDestructive(t, action);

      try {
        const anchor = t.closest('a');
        if (anchor && action && anchor.hasAttribute('download')) {
          const dl = {
            via: 'anchor_download',
            href: sanitizeUrl(anchor.href),
            filename: anchor.getAttribute('download') || null
          };
          action.resultDownload = dl;
          ensureEffects(action).downloads.push(dl);
          action.inferredExpected = deriveExpected(action);
        }

        // target=_blank открывает вкладку мимо JS window.open — сам popup-документ из console
        // получить нельзя, но pageId и причинная связь сохраняются.
        if (anchor && anchor.target === '_blank' && action && !action.resultPopup) {
          const info = { url: sanitizeUrl(anchor.href), via: 'target_blank', pageId: `page-${++pageSeq}`, attachable: false };
          action.resultPopup = info;
          // [v7.1][21] результат такого клика логгер проверить не может — явно помечаем,
          // что нужна ручная верификация, вместо тихой потери факта проверки.
          action.requiresManualVerification = true;
          ensureEffects(action).popup = info;
          action.inferredExpected = deriveExpected(action);
          console.log('%c[logger] открылась вкладка (target=_blank) — результат не инструментируется. Проверьте вручную и вызовите __logger.expect({...}) или __logger.note("...").', 'color:orange');
        }
      } catch (_) {}
    });

    on(doc, 'dblclick', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'mouse', type: 'dblclick', frame: ctx.label, target: elInfo(t), coords: { clientX: e.clientX, clientY: e.clientY } });
      pushMacro({ action: 'dblclick', ...macroTarget(t, ctx) });
    });

    on(doc, 'contextmenu', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'mouse', type: 'contextmenu', frame: ctx.label, target: elInfo(t), coords: { clientX: e.clientX, clientY: e.clientY } });
      pushMacro({ action: 'contextmenu', ...macroTarget(t, ctx) });
    });

    let hoverTimer = null;
    on(doc, 'mouseover', e => {
      if (!config.trackHover || !recording) return;
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (isHoverSensitive(t) && t.isConnected) hoverCandidate = {
          el: t, ctx, at: Date.now(), before: screenSnapshot(t.ownerDocument || doc, ctx, { light: true })
        };
      }, config.hoverDwellMs);
    });

    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      on(doc, type, e => {
        if (!config.trackLowLevelMouse) return;
        const t = actualTarget(e);
        if (!t || isIgnoredEl(t)) return;
        pushRaw({
          kind: type.startsWith('pointer') ? 'pointer' : 'mouse',
          type,
          frame: ctx.label,
          target: elInfo(t, { light: true }),
          pointerType: e.pointerType || undefined,
          button: e.button,
          coords: { clientX: e.clientX, clientY: e.clientY }
        });
      });
    }

    on(doc, 'input', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;

      pushRaw({
        kind: 'input',
        type: 'input',
        frame: ctx.label,
        target: elInfo(t, { light: true }),
        newValue: isTextLike(t) ? currentEditableValue(t) : undefined
      });

      if (isTextLike(t)) scheduleInput(t, ctx);
    });

    on(doc, 'change', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;

      const raw = { kind: 'change', type: 'change', frame: ctx.label, target: elInfo(t) };

      if (t.tagName === 'SELECT') {
        const selected = Array.from(t.selectedOptions || []).map(o => ({ value: o.value, text: trunc(o.text, 200) }));
        raw.selected = selected;
        pushMacro({
          action: 'select',
          ...macroTarget(t, ctx),
          multiple: !!t.multiple,
          value: t.multiple ? selected.map(o => o.value) : sanitizeValue(t, t.value),
          text: selected.map(o => o.text).join(', ') || null
        });
      } else if (t.tagName === 'INPUT' && t.type === 'file') {
        raw.files = Array.from(t.files || []).map(f => ({ name: f.name, size: f.size, type: f.type }));
        const fileAction = pushMacro({ action: 'setFiles', ...macroTarget(t, ctx), files: raw.files });
        captureFileArtifacts(t.files, fileAction);
      } else if (t.type === 'checkbox' || t.type === 'radio') {
        raw.checked = !!t.checked;
        pushMacro({ action: t.checked ? 'check' : 'uncheck', ...macroTarget(t, ctx), checked: !!t.checked });
      } else if (isTextLike(t)) {
        flushInput(t, 'change');
      } else if ('value' in t && t.tagName === 'INPUT') {
        // range / date / time / color — раньше терялись полностью
        pushMacro({
          action: 'fill',
          ...macroTarget(t, ctx),
          inputType: (t.getAttribute('type') || 'text').toLowerCase(),
          value: sanitizeValue(t, t.value),
          reason: 'change'
        });
      }

      pushRaw(raw);
    });

    on(doc, 'focusout', e => {
      const t = actualTarget(e);
      if (t && isTextLike(t)) flushInput(t, 'focusout');
      if (config.trackFocus && t && !isIgnoredEl(t)) pushRaw({ kind: 'focus', type: 'focusout', frame: ctx.label, target: elInfo(t, { light: true }) });
    });

    on(doc, 'focusin', e => {
      if (!config.trackFocus) return;
      const t = actualTarget(e);
      if (t && !isIgnoredEl(t)) pushRaw({ kind: 'focus', type: 'focusin', frame: ctx.label, target: elInfo(t, { light: true }) });
    });

    on(doc, 'submit', e => {
      const t = actualTarget(e) || e.target;
      flushAllInputs();
      if (t && isIgnoredEl(t)) return;
      pushRaw({ kind: 'form', type: 'submit', frame: ctx.label, target: elInfo(t) });
      if (isElement(t)) pushMacro({ action: 'submit', ...macroTarget(t, ctx) });
    });

    on(doc, 'keydown', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;

      // [14] горячие клавиши самого логгера — не попадают в сценарий
      if (e.ctrlKey && e.shiftKey && ['KeyM', 'KeyS'].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'KeyM') {
          const label = native.prompt.call(window, 'Текст метки:');
          if (label) mark(label);
        } else {
          stop();
        }
        return;
      }

      const special = ['Enter', 'Escape', 'Tab'].includes(e.key);
      if (config.trackAllKeyboard || special) {
        pushRaw({
          kind: 'keyboard', type: 'keydown', frame: ctx.label, target: elInfo(t, { light: true }),
          key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey
        });
      }

      if (special || ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 's', 'f'].includes(String(e.key).toLowerCase()))) {
        if (isTextLike(t)) flushInput(t, 'before_key');
        pushMacro({
          action: 'press',
          ...macroTarget(t, ctx),
          key: e.key,
          code: e.code,
          modifiers: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey }
        });
      }
    });

    on(doc, 'keyup', e => {
      if (!config.trackAllKeyboard) return;
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({
        kind: 'keyboard', type: 'keyup', frame: ctx.label, target: elInfo(t, { light: true }),
        key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey
      });
    });

    let scrollTimer = null;
    on(doc, 'scroll', e => {
      if (!config.trackScroll || scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        const target = e.target === doc ? doc.scrollingElement || doc.documentElement : e.target;
        pushRaw({
          kind: 'scroll', type: 'scroll', frame: ctx.label,
          target: isElement(target) ? elInfo(target, { light: true }) : null,
          scrollY: win.scrollY, scrollX: win.scrollX
        });
      }, config.scrollThrottleMs);
    });

    let mouseMoveTimer = null;
    on(doc, 'mousemove', e => {
      if (!config.trackMouseMove || mouseMoveTimer) return;
      mouseMoveTimer = setTimeout(() => { mouseMoveTimer = null; }, 150);
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'mousemove', type: 'mousemove', frame: ctx.label, target: elInfo(t, { light: true }), coords: { clientX: e.clientX, clientY: e.clientY } });
    });

    on(doc, 'wheel', e => {
      if (!config.trackWheel) return;
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'wheel', type: 'wheel', frame: ctx.label, target: elInfo(t, { light: true }), deltaX: e.deltaX, deltaY: e.deltaY });
    }, { capture: true, passive: true });

    for (const type of ['copy', 'cut', 'paste']) {
      on(doc, type, e => {
        const t = actualTarget(e);
        if (!t || isIgnoredEl(t)) return;
        let data = null;
        if (config.captureClipboardText) {
          try { data = sanitizeValue(t, e.clipboardData ? e.clipboardData.getData('text') : null); } catch (_) {}
        }
        pushRaw({
          kind: 'clipboard', type, frame: ctx.label, target: elInfo(t, { light: true }),
          data: config.captureClipboardText ? data : '[CLIPBOARD_NOT_CAPTURED]'
        });
      });
    }

    on(doc, 'dragstart', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      dragSource = { ...macroTarget(t, ctx), at: Date.now() };
      pushRaw({ kind: 'dragdrop', type: 'dragstart', frame: ctx.label, target: elInfo(t) });
    });

    on(doc, 'dragover', e => {
      if (config.mode !== 'debug') return;
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'dragdrop', type: 'dragover', frame: ctx.label, target: elInfo(t, { light: true }) });
    });

    on(doc, 'drop', e => {
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      pushRaw({ kind: 'dragdrop', type: 'drop', frame: ctx.label, target: elInfo(t) });
      if (dragSource) {
        pushMacro({ action: 'dragTo', source: dragSource, destination: macroTarget(t, ctx) });
      }
      dragSource = null;
    });

    // [v7.1][16] реордер через pointer events (без нативного HTML5 DnD) — AntD/rc-компоненты
    // часто двигают строки так, а не через dragstart/drop, и раньше это не писалось вообще.
    const DRAG_HANDLE_SELECTOR = '[draggable="true"],tr,[role="row"],.ant-table-row,.ant-list-item,li,'
      + '[class*="drag-handle" i],[class*="draghandle" i],[class*="sortable" i],[class*="dnd" i],[class*="drag" i]';
    const DRAG_EXCLUDE_SELECTOR = 'input,textarea,select,[contenteditable="true"],.cm-editor,button,a,[role="button"]';

    on(doc, 'pointerdown', e => {
      if (!config.trackPointerDrag) return;
      const t = actualTarget(e);
      if (!t || isIgnoredEl(t)) return;
      if (safeMatches(t, DRAG_EXCLUDE_SELECTOR) || (t.closest && t.closest(DRAG_EXCLUDE_SELECTOR))) return;
      if (!safeMatches(t, DRAG_HANDLE_SELECTOR) && !(t.closest && t.closest(DRAG_HANDLE_SELECTOR))) return;
      pointerDragCandidate = {
        pointerId: e.pointerId, startEl: t, ctx, doc,
        startX: e.clientX, startY: e.clientY, moved: false, before: null
      };
    });

    on(doc, 'pointermove', e => {
      const c = pointerDragCandidate;
      if (!c || c.pointerId !== e.pointerId || c.moved) return;
      const dx = e.clientX - c.startX, dy = e.clientY - c.startY;
      if (Math.hypot(dx, dy) < config.pointerDragThresholdPx) return;
      c.moved = true;
      // полный (не light) снапшот — только он несёт inputs/rows, нужные для diff порядка;
      // это разовая цена одного реального drag-жеста, не за каждый pointermove
      try { c.before = screenSnapshot(c.doc, c.ctx); } catch (_) {}
    });

    const endPointerDrag = e => {
      const c = pointerDragCandidate;
      pointerDragCandidate = null;
      if (!c || !c.moved || (e.pointerId != null && c.pointerId !== e.pointerId)) return;
      const endT = actualTarget(e) || c.startEl;
      pushMacro({
        action: 'dragTo',
        source: macroTarget(c.startEl, c.ctx),
        destination: macroTarget(endT, c.ctx),
        via: 'pointer',
        before: c.before,
        frameChain: c.ctx.frameChain || [],
        pageId: c.ctx.pageId || 'page-1',
        __ctx: c.ctx,
        __doc: c.doc
      });
    };
    on(doc, 'pointerup', endPointerDrag);
    on(doc, 'pointercancel', endPointerDrag);

    setTimeout(() => attachIframes(doc, ctx), 0);
    watchIframes(doc, ctx);
    watchActionEffects(doc, ctx);
  }

  function attachIframes(doc, parentCtx) {
    if (!doc || !doc.querySelectorAll) return;
    doc.querySelectorAll('iframe').forEach((frame, i) => {
      try {
        const childDoc = frame.contentDocument;
        if (!childDoc) return;
        const loc = locatorInfo(frame);
        const childCtx = {
          label: `${parentCtx.label}/iframe#${frame.id || i}`,
          frameChain: [...(parentCtx.frameChain || []), loc ? loc.primary.css : `iframe:nth-of-type(${i + 1})`],
          pageId: parentCtx.pageId || 'page-1'
        };
        attachListeners(childDoc, childCtx);
        attachIframes(childDoc, childCtx);
        try { patchNetwork(frame.contentWindow); } catch (_) {}

        // iframe может перезагрузиться и заменить document
        if (!frame.__alLoadHooked) {
          frame.__alLoadHooked = true;
          frame.addEventListener('load', () => {
            setTimeout(() => attachIframes(doc, parentCtx), 50);
          }, { signal: ac.signal });
        }
      } catch (_) {
        // cross-origin iframe: доступ закрыт браузером
      }
    });
  }

  // [4] лёгкий наблюдатель только за появлением iframe — работает всегда
  function watchIframes(doc, ctx) {
    if (!doc || !doc.documentElement || typeof MutationObserver !== 'function') return;
    let scheduled = false;
    const mo = new MutationObserver(mutations => {
      if (scheduled) return;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME' || (n.querySelector && n.querySelector('iframe'))) {
            scheduled = true;
            setTimeout(() => { scheduled = false; attachIframes(doc, ctx); }, 150);
            return;
          }
        }
      }
    });
    try {
      mo.observe(doc.documentElement, { childList: true, subtree: true });
      iframeObservers.push(mo);
    } catch (_) {}
  }

  attachListeners(document, { label: 'top', frameChain: [], pageId: 'page-1' });
  attachIframes(document, { label: 'top', frameChain: [], pageId: 'page-1' });


  // ---------------------------------------------- v7 UI effect correlation

  function watchActionEffects(doc, ctx) {
    if (!config.trackActionEffects || !doc || !doc.documentElement || typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(mutations => {
      if (!recording || internalDepth) return;
      const action = currentActionForCorrelation();
      if (!action) return;
      const effects = ensureEffects(action);
      for (const m of mutations) {
        if (effects.ui.length >= config.uiEffectsPerAction) break;
        if (isElement(m.target) && isMutationExcluded(m.target)) continue;
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (effects.ui.length >= config.uiEffectsPerAction) break;
            const node = meaningfulMutationNode(n);
            if (node) mergeUniqueEffects(effects.ui, { change: 'added', node, frame: ctx.label, at: new Date().toISOString() });
          }
          for (const n of m.removedNodes) {
            if (effects.ui.length >= config.uiEffectsPerAction) break;
            if (n.nodeType !== 1) continue;
            const text = collapse(n.textContent || '', 240);
            if (text) mergeUniqueEffects(effects.ui, { change: 'removed', node: { tag: n.tagName ? n.tagName.toLowerCase() : null, text }, frame: ctx.label, at: new Date().toISOString() });
          }
        } else if (m.type === 'attributes') {
          const target = isElement(m.target) ? m.target : null;
          if (!target || isIgnoredEl(target) || isAnimatedNoise(target, m.attributeName)) continue;
          if (['aria-expanded','aria-hidden','disabled','hidden','open','class','style'].includes(m.attributeName)) {
            const node = compactElement(target);
            if (node) mergeUniqueEffects(effects.ui, { change: 'attribute', attribute: m.attributeName, oldValue: trunc(m.oldValue, 200), newValue: trunc(target.getAttribute(m.attributeName), 200), node, frame: ctx.label, at: new Date().toISOString() });
          }
        } else if (m.type === 'characterData') {
          const target = isElement(m.target.parentElement) ? m.target.parentElement : null;
          if (!target || isIgnoredEl(target) || isMutationExcluded(target)) continue;
          if (safeMatches(target, '[role="alert"],[role="status"],[aria-live],h1,h2,h3,button')) {
            const node = compactElement(target);
            if (node) mergeUniqueEffects(effects.ui, { change: 'text', oldValue: trunc(m.oldValue, 200), newValue: collapse(m.target.textContent || '', 240), node, frame: ctx.label, at: new Date().toISOString() });
          }
        }
      }
      if (effects.ui.length) {
        scheduleFinalize(action);
        saveBackup(false);
      }
    });
    try {
      mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
      effectObservers.push(mo);
    } catch (_) {}
  }

  // -------------------------------------------------------- DOM mutations

  function isAnimatedNoise(el, attribute) {
    if (!config.ignoreAnimatedStyle || !isElement(el)) return false;
    if (!['style', 'class', 'fill-opacity', 'height', 'width', 'x', 'y'].includes(attribute)) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /transition|animate|spin|shimmer|_animating_/i.test(cls) || el.tagName === 'RECT';
  }

  function disconnectMutationObservers() {
    mutationObservers.forEach(o => { try { o.disconnect(); } catch (_) {} });
    mutationObservers = [];
  }

  function attachMutationObservers() {
    disconnectMutationObservers();
    if (!config.trackDomMutations) return;

    const doc = document;
    const ctx = ctxFor(doc);
    const root = (config.mutationRoot && doc.querySelector(config.mutationRoot)) || doc.documentElement;
    if (!root) return;

    const mo = new MutationObserver(mutations => {
      if (!recording || internalDepth) return;
      const changes = [];
      const MAX = 40;

      for (const m of mutations) {
        if (changes.length >= MAX) break;
        const target = isElement(m.target) ? m.target : m.target.parentElement;
        if (target && (isIgnoredEl(target) || isMutationExcluded(target))) continue;

        if (m.type === 'attributes') {
          if (isAnimatedNoise(target, m.attributeName)) continue;
          changes.push({ change: 'attribute', node: elInfo(target, { light: true }), attribute: m.attributeName, oldValue: trunc(m.oldValue, 200) });
        } else if (m.type === 'characterData') {
          changes.push({ change: 'text', node: elInfo(target, { light: true }), oldValue: trunc(m.oldValue, 200), newValue: trunc(m.target.textContent, 200) });
        } else if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (changes.length >= MAX) break;
            if (n.nodeType === 1 && !isIgnoredEl(n)) changes.push({ change: 'added', node: elInfo(n, { light: true }) });
          }
          for (const n of m.removedNodes) {
            if (changes.length >= MAX) break;
            if (n.nodeType === 1 && !isIgnoredEl(n)) changes.push({ change: 'removed', node: elInfo(n, { light: true }) });
          }
        }
      }

      if (changes.length) {
        pushRaw({ kind: 'dom', type: 'mutation', frame: ctx.label, changes, truncated: mutations.length > changes.length });
      }
    });

    mo.observe(root, {
      childList: true, subtree: true,
      attributes: true, attributeOldValue: true,
      characterData: true, characterDataOldValue: true
    });
    mutationObservers.push(mo);
  }

  attachMutationObservers();

  // ------------------------------------------------------------ navigation

  function annotateNavigation(type, fromUrl, toUrl) {
    const last = lastInteractive();
    const info = { type, fromUrl: sanitizeUrl(fromUrl), toUrl: sanitizeUrl(toUrl) };
    if (last && Date.now() - last.t < config.effectMaxMs) {
      last.resultNavigation = info;
      ensureEffects(last).navigation = info;
      last.inferredExpected = deriveExpected(last);
      scheduleFinalize(last);
      return;
    }
    pushMacro({ action: 'navigate', type, fromUrl: info.fromUrl, toUrl: info.toUrl, frameChain: [], pageId: 'page-1', __ctx: ctxFor(document), __doc: document });
  }

  function logNav(type) {
    const newUrl = location.href;
    const newTitle = document.title;
    if (newUrl === lastKnownUrl) {
      lastTitle = newTitle;
      return;
    }

    pushRaw({ kind: 'navigation', type, fromUrl: lastKnownUrl, toUrl: newUrl, fromTitle: lastTitle, toTitle: newTitle });
    annotateNavigation(type, lastKnownUrl, newUrl);
    lastKnownUrl = newUrl;
    lastTitle = newTitle;
    saveBackup(true);
    // [v7.2] первая SPA-навигация часто открывает совсем другой раздел приложения —
    // стоит один раз пересканировать test-id атрибуты на свежем DOM
    if (!idAttributeDiscoveryRanAfterNav) {
      idAttributeDiscoveryRanAfterNav = true;
      setTimeout(runIdAttributeDiscovery, 800);
    }
  }

  history.pushState = function () {
    const result = native.pushState.apply(this, arguments);
    logNav('pushState');
    return result;
  };

  history.replaceState = function () {
    const result = native.replaceState.apply(this, arguments);
    logNav('replaceState');
    return result;
  };

  const onWin = (type, handler, opts) => window.addEventListener(type, handler, { ...(opts || {}), signal: ac.signal });

  onWin('popstate', () => logNav('popstate'));
  onWin('hashchange', () => logNav('hashchange'));

  onWin('pagehide', () => {
    flushAllInputs();
    pushRaw({ kind: 'navigation', type: 'pagehide', fromUrl: location.href, toUrl: null });
    saveBackup(true);
  });

  onWin('beforeunload', () => {
    flushAllInputs();
    saveBackup(true);
  });

  onWin('focus', () => { if (config.trackFocus) pushRaw({ kind: 'window', type: 'focus' }); });
  onWin('blur', () => { if (config.trackFocus) pushRaw({ kind: 'window', type: 'blur' }); });
  onWin('resize', () => { if (config.mode === 'debug') pushRaw({ kind: 'window', type: 'resize', width: innerWidth, height: innerHeight }); });

  document.addEventListener('visibilitychange', () => {
    pushRaw({ kind: 'window', type: 'visibilitychange', state: document.visibilityState });
  }, { signal: ac.signal });

  if (restored && restored.lastUrl && restored.lastUrl !== location.href) {
    const last = lastInteractive();
    if (last && !last.resultNavigation) {
      last.resultNavigation = { type: 'full_navigation_resume', fromUrl: restored.lastUrl, toUrl: location.href };
      ensureEffects(last).navigation = last.resultNavigation;
      last.inferredExpected = deriveExpected(last);
    } else {
      pushMacro({ action: 'navigate', type: 'full_navigation_resume', fromUrl: restored.lastUrl, toUrl: location.href, frameChain: [] });
    }
    lastKnownUrl = location.href;
  }

  // --------------------------------------------------------------- dialogs

  function annotateDialog(dialog) {
    const last = lastInteractive();
    if (last && Date.now() - last.t < config.effectMaxMs) {
      last.resultDialog = dialog;
      ensureEffects(last).dialogs.push(dialog);
      last.inferredExpected = deriveExpected(last);
      saveBackup(false);
      return;
    }
    pushMacro({ action: 'dialog', dialog, frameChain: [], pageId: 'page-1', __ctx: ctxFor(document), __doc: document });
  }

  window.alert = function (msg) {
    const message = trunc(msg);
    pushRaw({ kind: 'dialog', type: 'alert', message });
    const result = native.alert.apply(this, arguments);
    annotateDialog({ type: 'alert', message, accepted: true });
    return result;
  };

  window.confirm = function (msg) {
    const message = trunc(msg);
    const accepted = native.confirm.apply(this, arguments);
    pushRaw({ kind: 'dialog', type: 'confirm', message, accepted });
    annotateDialog({ type: 'confirm', message, accepted });
    return accepted;
  };

  window.prompt = function (msg, def) {
    const message = trunc(msg);
    const result = native.prompt.apply(this, arguments);
    const accepted = result !== null;
    const response = accepted
      ? (config.capturePromptText ? trunc(result) : '[PROMPT_VALUE_NOT_CAPTURED]')
      : null;
    pushRaw({ kind: 'dialog', type: 'prompt', message, defaultValue: trunc(def), accepted, response });
    annotateDialog({ type: 'prompt', message, accepted, response });
    return result;
  };

  onWin('error', e => {
    const err = { kind: 'error', type: 'window_error', message: trunc(e.message), source: e.filename, line: e.lineno, col: e.colno };
    pushRaw(err);
    const a = currentActionForCorrelation();
    if (a) ensureEffects(a).errors.push(sanitizeObject(err));
  });

  onWin('unhandledrejection', e => {
    const err = { kind: 'error', type: 'unhandled_rejection', reason: trunc(String(e.reason)) };
    pushRaw(err);
    const a = currentActionForCorrelation();
    if (a) ensureEffects(a).errors.push(sanitizeObject(err));
  });

  console.error = function (...args) {
    pushRaw({ kind: 'console', type: 'error', args: args.map(a => trunc(String(a), 300)) });
    return native.consoleError.apply(console, args);
  };

  console.warn = function (...args) {
    pushRaw({ kind: 'console', type: 'warn', args: args.map(a => trunc(String(a), 300)) });
    return native.consoleWarn.apply(console, args);
  };

  // [v7.1][17] console.log/info раньше не писались вообще. Сообщения самого логгера
  // ("[logger] ...") отфильтровываются, чтобы не засорять raw log собственной болтовнёй.
  function isLoggerOwnMessage(args) {
    const first = args && args[0];
    return typeof first === 'string' && first.indexOf('[logger') !== -1;
  }

  console.log = function (...args) {
    if (!isLoggerOwnMessage(args)) pushRaw({ kind: 'console', type: 'log', args: args.map(a => trunc(String(a), 300)) });
    return native.consoleLog.apply(console, args);
  };

  console.info = function (...args) {
    if (!isLoggerOwnMessage(args)) pushRaw({ kind: 'console', type: 'info', args: args.map(a => trunc(String(a), 300)) });
    return native.consoleInfo.apply(console, args);
  };

  // --------------------------------------------------------------- network

  // [2] input может быть string | URL | Request
  function requestUrlOf(input) {
    if (typeof input === 'string') return input;
    if (!input) return null;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    if (typeof input.url === 'string') return input.url; // Request
    if (typeof input.href === 'string') return input.href;
    try { return String(input); } catch (_) { return null; }
  }

  function requestBodyOf(input, init, url, actionId) {
    const force = shouldCaptureBody(url, { actionId });
    if (init && init.body != null) return sanitizeBody(init.body, force);
    if (!config.captureNetworkBodies && !force) return input && typeof input.clone === 'function' ? '[BODY_NOT_CAPTURED]' : null;
    if (input && typeof input.clone === 'function' && input.method && input.method !== 'GET') {
      return '[REQUEST_BODY_ASYNC]'; // тело Request читается только асинхронно, не блокируем запрос
    }
    return null;
  }

  // [v7.3] Заголовки — то, без чего API-скрипт не написать: Content-Type, Accept,
  // X-Requested-With, CSRF, кастомные заголовки приложения. Раньше не записывались вообще,
  // и по логу нельзя было понять, чем запрос отличается от того же URL из curl.
  function requestHeadersOf(input, init) {
    if (!config.captureRequestHeaders) return undefined;
    const fromInput = input && typeof input === 'object' && input.headers ? headerMapOf(input.headers) : {};
    const fromInit = init && init.headers ? headerMapOf(init.headers) : {};
    return redactHeaderMap({ ...fromInput, ...fromInit }, config.sensitiveNamePattern);
  }

  function responseHeadersOf(source) {
    if (!config.captureResponseHeaders) return undefined;
    return redactHeaderMap(headerMapOf(source), config.sensitiveNamePattern);
  }

  // Заголовок Cookie браузер добавляет после нашего хука и из JS не читается — режим
  // credentials это единственный наблюдаемый признак того, что запрос шёл с cookie.
  function credentialsOf(input, init) {
    if (init && init.credentials) return init.credentials;
    if (input && typeof input === 'object' && input.credentials) return input.credentials;
    return 'same-origin';
  }

  // [v7.3] parse -> redact -> bound, в этом порядке (Migrator, network/recorder.py:
  // «Never truncate before parsing»). Раньше ответ обрезался до лимита ДО разбора, и в
  // запись уходил оборванный JSON — получатель не мог его прочитать и не знал, что
  // потерялось. Теперь структура ответа сохраняется целиком, режутся строки внутри.
  function responseBodyEvidence(text, limit) {
    const out = { responseBodyCaptured: true, responseBodyBytes: text == null ? 0 : String(text).length };
    const parsed = parseJsonBody(text);
    if (parsed !== UNPARSED) {
      out.responseJson = redactJson(parsed, config.sensitiveNamePattern, limit);
      return out;
    }
    // Не JSON (html/csv/текст ошибки) — тогда текстовое превью, но с честным маркером:
    // responseJson === UNPARSED означает «тело было, JSON'ом не является», а не «null».
    out.responseJson = UNPARSED;
    const bounded = boundText(text, limit);
    out.responsePreview = redactTextBody(bounded.text);
    out.responseTruncated = bounded.truncated;
    return out;
  }

  function pushNetwork(entry, actionId = null) {
    const item = {
      seq: networkLog.length,
      requestId: entry.requestId || `r-${++requestSeq}`,
      actionId: actionId || null,
      t: Date.now(),
      iso: new Date().toISOString(),
      ...entry
    };
    networkLog.push(item);
    trimLogs();
    const a = actionById(item.actionId);
    if (a) {
      ensureEffects(a).network.push(sanitizeObject(item));
      a.inferredExpected = deriveExpected(a);
      saveBackup(false);
    }
    return item;
  }

  // [v7.1][13] fetch/XHR патчились только в top-window: у same-origin iframe свои
  // прототипы/globalThis, поэтому запросы из worker-iframe раньше не попадали в лог вообще.
  // patchNetwork(win) — переиспользуемая фабрика, вызывается и для window, и для каждого
  // same-origin iframe.contentWindow из attachIframes().
  const patchedWindows = new WeakSet();
  const patchedWindowsList = [];
  const nativeByWindow = new WeakMap();

  function patchNetwork(win) {
    if (!win || patchedWindows.has(win)) return;
    let nativeFetch, nativeXhrOpen, nativeXhrSend, nativeXhrSetHeader, nativeWebSocket, nativeEventSource, nativeSendBeacon;
    try { nativeFetch = win.fetch; } catch (_) {}
    try { nativeXhrOpen = win.XMLHttpRequest && win.XMLHttpRequest.prototype.open; } catch (_) {}
    try { nativeXhrSend = win.XMLHttpRequest && win.XMLHttpRequest.prototype.send; } catch (_) {}
    try { nativeXhrSetHeader = win.XMLHttpRequest && win.XMLHttpRequest.prototype.setRequestHeader; } catch (_) {}
    try { nativeWebSocket = win.WebSocket; } catch (_) {}
    try { nativeEventSource = win.EventSource; } catch (_) {}
    try { nativeSendBeacon = win.navigator && win.navigator.sendBeacon; } catch (_) {}
    if (typeof nativeFetch !== 'function' && !(nativeXhrOpen && nativeXhrSend)) return;

    patchedWindows.add(win);
    patchedWindowsList.push(win);
    nativeByWindow.set(win, {
      fetch: nativeFetch, xhrOpen: nativeXhrOpen, xhrSend: nativeXhrSend, xhrSetHeader: nativeXhrSetHeader,
      webSocket: nativeWebSocket, eventSource: nativeEventSource, sendBeacon: nativeSendBeacon
    });

    if (typeof nativeFetch === 'function') {
      win.fetch = function (input, init) {
        const rawUrl = requestUrlOf(input);
        if (!config.trackNetwork || isIgnoredUrl(rawUrl)) return nativeFetch.apply(this, arguments);

        const url = sanitizeUrl(rawUrl);
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const start = Date.now();
        const requestId = `r-${++requestSeq}`;
        const correlated = currentActionForCorrelation(config.networkCorrelationMs);
        const actionId = correlated ? correlated.id : null;
        const body = requestBodyOf(input, init, url, actionId);
        const requestHeaders = requestHeadersOf(input, init);
        const credentials = credentialsOf(input, init);

        pushRaw({ kind: 'network', type: 'fetch_start', requestId, actionId, requestUrl: url, method, body, requestHeaders, credentials });
        pushNetwork({ phase: 'start', transport: 'fetch', requestId, requestUrl: url, method, body, requestHeaders, credentials }, actionId);

        return nativeFetch.apply(this, arguments).then(res => {
          const base = {
            phase: 'end', transport: 'fetch', requestId,
            requestUrl: url, finalUrl: sanitizeUrl(res.url), method,
            status: res.status, ok: res.ok, durationMs: Date.now() - start,
            responseHeaders: responseHeadersOf(res.headers)
          };
          const allow = shouldCaptureBody(url, { actionId, status: res.status, ok: res.ok })
            || shouldCaptureBody(res.url, { actionId, status: res.status, ok: res.ok });

          if (!config.captureResponseBodies && !allow) {
            const skipped = { ...base, responseBodyCaptured: false };
            pushRaw({ kind: 'network', type: 'fetch_end', actionId, ...skipped });
            pushNetwork(skipped, actionId);
            return res;
          }

          try {
            res.clone().text()
              .then(text => {
                const withBody = { ...base, ...responseBodyEvidence(text, allow ? config.bodyCaptureAllowlistMaxBytes : config.maxText) };
                pushRaw({ kind: 'network', type: 'fetch_end', actionId, ...withBody });
                pushNetwork(withBody, actionId);
              })
              .catch(() => { pushRaw({ kind: 'network', type: 'fetch_end', actionId, ...base }); pushNetwork(base, actionId); });
          } catch (_) {
            pushRaw({ kind: 'network', type: 'fetch_end', actionId, ...base });
            pushNetwork(base, actionId);
          }
          return res;
        }).catch(err => {
          const base = { phase: 'error', transport: 'fetch', requestId, requestUrl: url, method, error: trunc(String(err), 300), durationMs: Date.now() - start };
          pushRaw({ kind: 'network', type: 'fetch_error', actionId, ...base });
          pushNetwork(base, actionId);
          throw err;
        });
      };
    }

    if (nativeXhrOpen && nativeXhrSend && win.XMLHttpRequest) {
      win.XMLHttpRequest.prototype.open = function (method, url) {
        this.__alMeta = { method: String(method || 'GET').toUpperCase(), rawUrl: url, url: sanitizeUrl(url), headers: {} };
        return nativeXhrOpen.apply(this, arguments);
      };

      // [v7.3] У XHR заголовки видны только здесь: getAllRequestHeaders в платформе нет,
      // поэтому единственный способ узнать, с каким Content-Type/CSRF ушёл запрос —
      // запомнить то, что приложение выставило само.
      if (nativeXhrSetHeader) {
        win.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          try {
            if (this.__alMeta) {
              if (!this.__alMeta.headers) this.__alMeta.headers = {};
              this.__alMeta.headers[String(name).toLowerCase()] = String(value);
            }
          } catch (_) {}
          return nativeXhrSetHeader.apply(this, arguments);
        };
      }

      win.XMLHttpRequest.prototype.send = function (body) {
        const meta = this.__alMeta;
        if (!meta || !config.trackNetwork || isIgnoredUrl(meta.rawUrl)) return nativeXhrSend.apply(this, arguments);

        meta.start = Date.now();
        meta.requestId = `r-${++requestSeq}`;
        const correlated = currentActionForCorrelation(config.networkCorrelationMs);
        meta.actionId = correlated ? correlated.id : null;
        const allowRequest = shouldCaptureBody(meta.url, { actionId: meta.actionId });
        const requestBody = sanitizeBody(body, allowRequest);
        const requestHeaders = config.captureRequestHeaders ? redactHeaderMap(meta.headers || {}, config.sensitiveNamePattern) : undefined;
        const credentials = this.withCredentials ? 'include' : 'same-origin';
        pushRaw({ kind: 'network', type: 'xhr_start', requestId: meta.requestId, actionId: meta.actionId, requestUrl: meta.url, method: meta.method, body: requestBody, requestHeaders, credentials });
        pushNetwork({ phase: 'start', transport: 'xhr', requestId: meta.requestId, requestUrl: meta.url, method: meta.method, body: requestBody, requestHeaders, credentials }, meta.actionId);

        this.addEventListener('loadend', () => {
          const ok = this.status >= 200 && this.status < 400;
          const allow = allowRequest || shouldCaptureBody(meta.url, { actionId: meta.actionId, status: this.status, ok });
          let responseHeaders;
          try { responseHeaders = responseHeadersOf(this.getAllResponseHeaders()); } catch (_) {}
          const base = {
            phase: 'end', transport: 'xhr', requestId: meta.requestId,
            requestUrl: meta.url, finalUrl: sanitizeUrl(this.responseURL), method: meta.method,
            status: this.status, ok, durationMs: Date.now() - meta.start,
            responseHeaders
          };
          if (config.captureResponseBodies || allow) {
            let read = false;
            try {
              if (!this.responseType || this.responseType === 'text') {
                Object.assign(base, responseBodyEvidence(this.responseText, allow ? config.bodyCaptureAllowlistMaxBytes : config.maxText));
                read = true;
              }
            } catch (_) {}
            // responseType=blob/arraybuffer: тело есть, но текстом его отсюда не взять —
            // это надо сказать прямо, а не оставить получателя думать, что тела не было.
            if (!read) base.responseBodyCaptured = false;
          } else {
            base.responseBodyCaptured = false;
          }
          pushRaw({ kind: 'network', type: 'xhr_end', actionId: meta.actionId, ...base });
          pushNetwork(base, meta.actionId);
        }, { once: true });

        return nativeXhrSend.apply(this, arguments);
      };
    }

    // [v7.3] WebSocket. Возвращаем настоящий сокет с обёрнутым send и своими слушателями —
    // при подмене на собственный класс у приложения ломаются instanceof и WebSocket.OPEN.
    if (config.trackWebSockets && typeof nativeWebSocket === 'function') {
      const LoggedWebSocket = function (url, protocols) {
        const socket = protocols === undefined ? new nativeWebSocket(url) : new nativeWebSocket(url, protocols);
        if (!config.trackNetwork || isIgnoredUrl(url) || internalDepth) return socket;

        const correlated = currentActionForCorrelation(config.networkCorrelationMs);
        const record = {
          kind: 'websocket',
          requestId: `ws-${++requestSeq}`,
          url: sanitizeUrl(url),
          protocols: protocols == null ? null : (Array.isArray(protocols) ? protocols.slice(0, 5).map(String) : [String(protocols)]),
          actionId: correlated ? correlated.id : null,
          openedAt: new Date().toISOString(),
          frames: [],
          framesDropped: 0,
          closedAt: null,
          closeCode: null,
          closeReason: null,
          errored: false
        };
        streamLog.push(record);
        trimLogs();
        pushRaw({ kind: 'network', type: 'websocket_open', requestId: record.requestId, actionId: record.actionId, requestUrl: record.url });
        // Handshake попадает и в networkLog — чтобы адрес сокета был виден в инвентаре
        // эндпоинтов наравне с HTTP, а не только внутри streams[].
        pushNetwork({ phase: 'start', transport: 'websocket', requestId: record.requestId, requestUrl: record.url, method: 'GET' }, record.actionId);

        const pushFrame = (direction, data) => {
          if (!recording || internalDepth) return;
          if (record.frames.length >= config.maxWsFramesPerSocket) { record.framesDropped += 1; return; }
          const inFlight = currentActionForCorrelation(config.networkCorrelationMs);
          const frame = { direction, at: new Date().toISOString(), actionId: inFlight ? inFlight.id : null, size: null };
          try {
            if (typeof data === 'string') {
              frame.size = data.length;
              const parsed = parseJsonBody(data);
              if (parsed !== UNPARSED) frame.json = redactJson(parsed, config.sensitiveNamePattern, config.maxWsFrameChars);
              else {
                frame.json = UNPARSED;
                const bounded = boundText(data, config.maxWsFrameChars);
                frame.text = redactTextBody(bounded.text);
                frame.truncated = bounded.truncated;
              }
            } else if (data && typeof data === 'object') {
              // Бинарный кадр текстом не прочитать — говорим это прямо, а не пишем null.
              frame.binary = true;
              frame.size = data.size != null ? data.size : (data.byteLength != null ? data.byteLength : null);
            }
          } catch (_) {}
          record.frames.push(frame);
          const action = actionById(frame.actionId);
          if (action) ensureEffects(action).streams.push({ socket: record.requestId, url: record.url, direction, at: frame.at });
        };

        try {
          const nativeSend = socket.send;
          socket.send = function (data) {
            pushFrame('sent', data);
            return nativeSend.apply(this, arguments);
          };
        } catch (_) {}

        try {
          socket.addEventListener('message', event => pushFrame('received', event && event.data));
          socket.addEventListener('close', event => {
            record.closedAt = new Date().toISOString();
            record.closeCode = event && event.code != null ? event.code : null;
            record.closeReason = event && event.reason ? trunc(event.reason, 200) : null;
            pushNetwork({ phase: 'end', transport: 'websocket', requestId: record.requestId, requestUrl: record.url, method: 'GET', status: null, wsCloseCode: record.closeCode, frames: record.frames.length }, record.actionId);
          });
          socket.addEventListener('error', () => { record.errored = true; });
        } catch (_) {}

        return socket;
      };
      try {
        LoggedWebSocket.prototype = nativeWebSocket.prototype;
        for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
          if (nativeWebSocket[name] !== undefined) LoggedWebSocket[name] = nativeWebSocket[name];
        }
        win.WebSocket = LoggedWebSocket;
      } catch (_) {}
    }

    // [v7.3] EventSource (SSE). Односторонний поток, но для скрипта он часто и есть
    // «результат» шага: нажали — и в стриме пришло событие с новым состоянием.
    if (config.trackEventSource && typeof nativeEventSource === 'function') {
      const LoggedEventSource = function (url, esConfig) {
        const stream = esConfig === undefined ? new nativeEventSource(url) : new nativeEventSource(url, esConfig);
        if (!config.trackNetwork || isIgnoredUrl(url) || internalDepth) return stream;

        const correlated = currentActionForCorrelation(config.networkCorrelationMs);
        const record = {
          kind: 'eventsource',
          requestId: `es-${++requestSeq}`,
          url: sanitizeUrl(url),
          withCredentials: !!(esConfig && esConfig.withCredentials),
          actionId: correlated ? correlated.id : null,
          openedAt: new Date().toISOString(),
          frames: [],
          framesDropped: 0,
          errored: false
        };
        streamLog.push(record);
        trimLogs();
        pushRaw({ kind: 'network', type: 'eventsource_open', requestId: record.requestId, actionId: record.actionId, requestUrl: record.url });
        pushNetwork({ phase: 'start', transport: 'eventsource', requestId: record.requestId, requestUrl: record.url, method: 'GET', credentials: record.withCredentials ? 'include' : 'same-origin' }, record.actionId);

        try {
          stream.addEventListener('message', event => {
            if (!recording || internalDepth) return;
            if (record.frames.length >= config.maxWsFramesPerSocket) { record.framesDropped += 1; return; }
            const inFlight = currentActionForCorrelation(config.networkCorrelationMs);
            const frame = { direction: 'received', at: new Date().toISOString(), actionId: inFlight ? inFlight.id : null, eventType: (event && event.type) || 'message', lastEventId: (event && event.lastEventId) || null };
            const data = event && typeof event.data === 'string' ? event.data : null;
            if (data != null) {
              frame.size = data.length;
              const parsed = parseJsonBody(data);
              if (parsed !== UNPARSED) frame.json = redactJson(parsed, config.sensitiveNamePattern, config.maxWsFrameChars);
              else {
                frame.json = UNPARSED;
                const bounded = boundText(data, config.maxWsFrameChars);
                frame.text = redactTextBody(bounded.text);
                frame.truncated = bounded.truncated;
              }
            }
            record.frames.push(frame);
            const action = actionById(frame.actionId);
            if (action) ensureEffects(action).streams.push({ socket: record.requestId, url: record.url, direction: 'received', at: frame.at });
          });
          stream.addEventListener('error', () => { record.errored = true; });
        } catch (_) {}

        return stream;
      };
      try {
        LoggedEventSource.prototype = nativeEventSource.prototype;
        for (const name of ['CONNECTING', 'OPEN', 'CLOSED']) {
          if (nativeEventSource[name] !== undefined) LoggedEventSource[name] = nativeEventSource[name];
        }
        win.EventSource = LoggedEventSource;
      } catch (_) {}
    }

    // [v7.3] navigator.sendBeacon — «выстрелил и забыл». Ответа у него нет по определению,
    // но сам факт и тело важны: часто именно так уходит подтверждение шага.
    if (config.trackBeacons && typeof nativeSendBeacon === 'function') {
      try {
        win.navigator.sendBeacon = function (url, data) {
          if (!config.trackNetwork || isIgnoredUrl(url) || internalDepth) return nativeSendBeacon.apply(win.navigator, arguments);
          const correlated = currentActionForCorrelation(config.networkCorrelationMs);
          const actionId = correlated ? correlated.id : null;
          const requestId = `bc-${++requestSeq}`;
          const safeUrl = sanitizeUrl(url);
          const body = sanitizeBody(data, shouldCaptureBody(safeUrl, { actionId }));
          const result = nativeSendBeacon.apply(win.navigator, arguments);
          pushRaw({ kind: 'network', type: 'beacon', requestId, actionId, requestUrl: safeUrl, method: 'POST', body, queued: result !== false });
          pushNetwork({ phase: 'start', transport: 'beacon', requestId, requestUrl: safeUrl, method: 'POST', body }, actionId);
          // Ответа не будет никогда — закрываем запись сразу, чтобы свёртка запросов не
          // считала её незавершённой, и помечаем, что тело ответа не «потерялось».
          pushNetwork({ phase: 'end', transport: 'beacon', requestId, requestUrl: safeUrl, method: 'POST', status: null, queued: result !== false, responseBodyCaptured: false }, actionId);
          return result;
        };
      } catch (_) {}
    }
  }

  patchNetwork(window);

  // v7 download detection for programmatic Blob/ObjectURL + anchor.click().
  const blobUrls = new Map();
  if (native.createObjectURL) {
    URL.createObjectURL = function (obj) {
      const url = native.createObjectURL(obj);
      if (!internalDepth) {
        try { blobUrls.set(url, { size: obj && obj.size || null, type: obj && obj.type || null, createdAt: Date.now() }); } catch (_) {}
      }
      return url;
    };
  }

  HTMLAnchorElement.prototype.click = function () {
    if (internalDepth) return native.anchorClick.apply(this, arguments);
    try {
      if (this.hasAttribute('download') || blobUrls.has(this.href)) {
        const a = currentActionForCorrelation() || lastInteractive();
        const blob = blobUrls.get(this.href) || null;
        const dl = { via: 'programmatic_anchor_click', href: sanitizeUrl(this.href), filename: this.getAttribute('download') || null, blob };
        pushRaw({ kind: 'download', type: 'download_candidate', actionId: a ? a.id : null, download: dl });
        if (a) { ensureEffects(a).downloads.push(dl); a.resultDownload = dl; a.inferredExpected = deriveExpected(a); }
      }
    } catch (_) {}
    return native.anchorClick.apply(this, arguments);
  };

  // ---------------------------------------------- [13] выгрузка с fallback

  let lastExport = null;

  function deliver(filename, content, mime = 'application/json') {
    lastExport = { filename, content, mime, at: new Date().toISOString() };
    let ok = false;
    withInternal(() => {
      try {
        const blob = new Blob([content], { type: mime });
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('data-action-logger-internal', '1');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        ok = true;
      } catch (e) {
        native.consoleWarn.call(console, '[logger] скачивание заблокировано:', e && e.message ? e.message : e);
      }
    });

    if (!ok) copyLast();
    else console.log(`[logger] ${filename} — если файл не появился (CSP), выполните __logger.copyLast()`);
    return ok;
  }

  function copyLast() {
    if (!lastExport) {
      console.log('[logger] нечего копировать — сначала выполните экспорт.');
      return false;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastExport.content)
          .then(() => console.log(`%c[logger] ${lastExport.filename} скопирован в буфер обмена.`, 'color:lime'))
          .catch(() => {
            console.log('[logger] буфер обмена недоступен, содержимое ниже:');
            console.log(lastExport.content);
          });
        return true;
      }
    } catch (_) {}
    console.log('[logger] содержимое экспорта:');
    console.log(lastExport.content);
    return false;
  }

  function serializableConfig() {
    return {
      mode: config.mode,
      inputDebounceMs: config.inputDebounceMs,
      trackNetwork: config.trackNetwork,
      trackHover: config.trackHover,
      trackActionEffects: config.trackActionEffects,
      captureScreenSnapshots: config.captureScreenSnapshots,
      inferExpectedResults: config.inferExpectedResults,
      effectSettleMs: config.effectSettleMs,
      captureClipboardText: config.captureClipboardText,
      capturePromptText: config.capturePromptText,
      captureNetworkBodies: config.captureNetworkBodies,
      captureResponseBodies: config.captureResponseBodies,
      trackDomMutations: config.trackDomMutations,
      playwrightTextMethod: config.playwrightTextMethod,
      playwrightLocators: config.playwrightLocators,
      emitAssertions: config.emitAssertions
    };
  }

  // [v7.1][11] один и тот же снапшот раньше попадал в экспорт дважды: целиком внутри
  // action.before/after И отдельной записью в screenLog. Дедуп только на экспорте (по
  // fingerprint) — runtime screenDiff/deriveExpected продолжают работать с живыми
  // объектами как раньше, это чисто изменение формы итогового JSON.
  function dedupScreens(actions) {
    const byFingerprint = new Map();
    const screens = [];
    function addSnapshot(snapshot) {
      if (!snapshot) return null;
      const fp = snapshot.fingerprint || null;
      if (fp && byFingerprint.has(fp)) return byFingerprint.get(fp);
      const id = `scr-${screens.length}`;
      screens.push({ id, ...snapshot });
      if (fp) byFingerprint.set(fp, id);
      return id;
    }
    function refFor(snapshot) {
      if (!snapshot) return null;
      const id = addSnapshot(snapshot);
      return { ref: id, fingerprint: snapshot.fingerprint || null, url: snapshot.url || null, title: snapshot.title || null };
    }
    for (const a of actions) {
      if (a.before) a.before = refFor(a.before);
      if (a.after) a.after = refFor(a.after);
    }
    // прочие записи screenLog (session_start и т.п.), не покрытые before/after ни одного действия
    for (const entry of screenLog) {
      if (entry && entry.snapshot) addSnapshot(entry.snapshot);
    }
    return screens;
  }

  function cleanActionForExport(action) {
    const out = {};
    for (const [k, v] of Object.entries(action || {})) {
      if (k === '__ctx' || k === '__doc') continue;
      out[k] = v;
    }
    if (out.effects && Array.isArray(out.effects.ui)) {
      out.effects.ui = out.effects.ui.map(x => { const y = { ...x }; delete y._key; return y; });
    }
    return out;
  }

  function buildVariables(actions) {
    const vars = [];
    const seen = new Map();
    const slug = (s, fallback) => {
      const x = String(s || fallback || 'VALUE').toUpperCase().replace(/[^A-Z0-9А-ЯЁ]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
      return x || fallback || 'VALUE';
    };
    for (const a of actions) {
      if (!['fill','select','check','uncheck','setFiles','toggle'].includes(a.action)) continue;
      let value = a.value;
      if (a.action === 'check' || a.action === 'uncheck') value = !!a.checked;
      if (a.action === 'toggle') value = !!a.checked;
      if (a.action === 'setFiles') value = (a.files || []).map(f => f.name);
      const rawName = a.locator && (a.locator.accessibleName || a.locator.ariaLabel || (a.locator.primary && a.locator.primary.value)) || a.target && a.target.text || a.action;
      const base = slug(rawName, a.action.toUpperCase());
      const key = `${base}:${JSON.stringify(value)}`;
      if (!seen.has(key)) {
        const item = {
          name: base,
          recordedValue: a.sensitive || value === '[REDACTED]' ? '[REDACTED]' : value,
          sensitive: !!a.sensitive || value === '[REDACTED]',
          actionIds: [a.id],
          locator: a.locator ? { primary: a.locator.primary, pw: a.locator.pw } : null
        };
        seen.set(key, item); vars.push(item);
      } else seen.get(key).actionIds.push(a.id);
    }
    const names = new Map();
    for (const v of vars) {
      const n = names.get(v.name) || 0;
      names.set(v.name, n + 1);
      if (n) v.name = `${v.name}_${n + 1}`;
    }
    return vars;
  }

  function buildWarnings(actions) {
    const warnings = [];
    for (const a of actions) {
      if (a.locatorConfidence && a.locatorConfidence.level === 'low') warnings.push({ type: 'weak_locator', actionId: a.id, action: a.action, confidence: a.locatorConfidence, locator: a.locator });
      if (a.effects && a.effects.network) {
        for (const n of a.effects.network.filter(x => x.phase === 'end' && x.status >= 400)) warnings.push({ type: 'network_error', actionId: a.id, method: n.method, url: n.requestUrl, status: n.status });
      }
      if (a.effects && a.effects.errors && a.effects.errors.length) warnings.push({ type: 'runtime_error', actionId: a.id, errors: a.effects.errors });
      if (a.action === 'setFiles') warnings.push({ type: 'file_paths_not_recorded', actionId: a.id, files: a.files });
      if (a.resultPopup && a.resultPopup.attachable === false) warnings.push({ type: 'popup_not_instrumented', actionId: a.id, popup: a.resultPopup, note: 'target=_blank popup cannot be automatically instrumented from a one-shot DevTools page script — requires __logger.expect()/note() during the manual run' });
    }
    return warnings;
  }

  // [v7.2] Собирает "что нужно уточнить у оператора" автоматически, по фактам записи —
  // цель в том, чтобы получателю (ассистенту, пишущему скрипт автоматизации) не пришлось
  // руками искать слабые места по всему таймлайну на каждую присланную запись.
  function buildOpenQuestions(actions, context) {
    const out = [];
    for (const a of actions) {
      const hasHuman = !!((a.humanExpected && a.humanExpected.length) || (a.humanNotes && a.humanNotes.length));

      if (a.locatorConfidence && a.locatorConfidence.level === 'low' && !hasHuman) {
        out.push({
          type: 'weak_locator_unconfirmed', actionId: a.id, order: a.order,
          question: `Шаг ${a.order} (${a.action}): локатор не подтверждён уникальным (${a.locator && a.locator.primary && a.locator.primary.css}). Это точно тот элемент?`
        });
      }
      if (a.requiresManualVerification && !hasHuman) {
        out.push({
          type: 'manual_verification_missing', actionId: a.id, order: a.order,
          question: `Шаг ${a.order} открыл вкладку/попап, результат не проверен автоматически — что там должно было появиться?`
        });
      }
      if (a.possibleRetry) {
        out.push({
          type: 'possible_retry', actionId: a.id, order: a.order,
          question: `Шаг ${a.order} повторяет клик по тому же элементу, что и шаг #${a.possibleRetry.previousActionId} без видимого эффекта между ними — нужен явный wait перед этим шагом?`
        });
      }
      if (a.destructive && a.diff && !a.diff.fingerprintChanged && !(a.diff.inputs && a.diff.inputs.changed && a.diff.inputs.changed.length)) {
        out.push({
          type: 'destructive_no_visible_effect', actionId: a.id, order: a.order,
          question: `Шаг ${a.order} похож на разрушительное действие, но видимых изменений на экране не зафиксировано — он реально сработал (может, было доп. подтверждение вне записи)?`
        });
      }
      if (a.effects && a.effects.network) {
        for (const n of a.effects.network) {
          if (n.phase === 'end' && n.status >= 400 && !hasHuman) {
            out.push({
              type: 'network_error_unconfirmed', actionId: a.id, order: a.order,
              question: `Шаг ${a.order} вызвал ${n.method} ${n.requestUrl} -> ${n.status}. Это ожидаемая ошибка сценария или сбой?`
            });
          }
        }
      }
    }

    // [v7.3] Вопросы не только про шаги, но и про то, из чего будет собран скрипт: без
    // ответа на «откуда брать токен» и «эти фоновые вызовы вообще нужны» автоматизация
    // упирается в них на первом же запуске, а не на десятом.
    const endpoints = (context && context.endpoints) || [];
    const authProfile = context && context.authProfile;
    if (authProfile && authProfile.mechanism === 'unknown' && endpoints.length) {
      out.push({
        type: 'auth_mechanism_unknown',
        question: 'По записи не видно, как приложение авторизуется (ни Authorization, ни следов cookie-режима, а HttpOnly-cookie из JS не видны). Как оператор вошёл в систему и что должен делать скрипт — переиспользовать сохранённую сессию или логиниться сам?'
      });
    }
    if (authProfile && authProfile.mechanism === 'bearer_header' && !authProfile.loginCandidates.length) {
      out.push({
        type: 'token_source_unknown',
        question: 'Запросы несут Authorization, но запроса, который этот токен выдаёт, в записи нет (запись началась в уже залогиненной сессии). Откуда скрипт должен брать токен?'
      });
    }
    if (authProfile && authProfile.csrfHeaders.length) {
      out.push({
        type: 'csrf_source_unknown',
        question: `Запросы несут CSRF-заголовок (${authProfile.csrfHeaders.join(', ')}), значение в записи не сохранено. Откуда его берёт страница — из cookie, из meta-тега, из отдельного запроса?`
      });
    }
    for (const endpoint of endpoints) {
      if (endpoint.write && endpoint.failures && endpoint.failures === endpoint.calls) {
        out.push({
          type: 'endpoint_only_ever_failed',
          question: `${endpoint.key} в записи вызывался ${endpoint.calls} раз(а) и ни разу не ответил успешно (${Object.keys(endpoint.statuses).join(', ')}). Это часть сценария или запись сломанного состояния?`
        });
      }
    }
    return out;
  }

  function actionHuman(a) {
    const name = a.locator && (a.locator.accessibleName || a.locator.ariaLabel || a.locator.text) || a.target && a.target.text || a.target && a.target.tag || '';
    switch (a.action) {
      case 'click': return `Click ${JSON.stringify(name || 'element')}`;
      case 'dblclick': return `Double-click ${JSON.stringify(name || 'element')}`;
      case 'contextmenu': return `Right-click ${JSON.stringify(name || 'element')}`;
      case 'hover': return `Hover ${JSON.stringify(name || 'element')}`;
      case 'fill': return `Fill ${JSON.stringify(name || 'field')} with ${a.sensitive ? '<SECRET>' : JSON.stringify(a.value)}`;
      case 'select': return `Select ${JSON.stringify(a.value)} in ${JSON.stringify(name || 'select')}`;
      case 'toggle': return `Toggle ${JSON.stringify(name || 'switch')} to ${a.checked ? 'ON' : 'OFF'}`;
      case 'expand': return `Expand/collapse panel ${JSON.stringify(a.antd && a.antd.panelTitle || name || 'section')}`;
      case 'check': return `Check ${JSON.stringify(name || 'checkbox')}`;
      case 'uncheck': return `Uncheck ${JSON.stringify(name || 'checkbox')}`;
      case 'press': return `Press ${pressKey(a)} on ${JSON.stringify(name || 'active element')}`;
      case 'dragTo': return 'Drag source to destination';
      case 'setFiles': return `Set files ${(a.files || []).map(f => f.name).join(', ')}`;
      case 'navigate': return `Navigate to ${a.toUrl}`;
      default: return `${a.action} ${name}`.trim();
    }
  }

  function generateDraftSpec(actions, context) {
    const lines = [];
    lines.push('# Recorded scenario — technical draft');
    lines.push('');
    lines.push('> Draft inferred from browser facts only. User business intent/wording should be added afterwards.');
    lines.push('');
    lines.push(`Start URL: ${session.startUrl}`);
    lines.push(`Recorded at: ${session.startedAt}`);
    lines.push('');
    lines.push('## Ordered steps');
    lines.push('');
    const taskById = new Map((tasksLog || []).map(t => [t.id, t]));
    let openTaskId = undefined;
    for (const a of actions) {
      if (a.action === 'mark') continue;
      if (a.taskId !== openTaskId) {
        openTaskId = a.taskId;
        if (openTaskId) {
          const task = taskById.get(openTaskId);
          const label = task && task.meta ? JSON.stringify(task.meta) : openTaskId;
          lines.push(`## Task: ${label}`);
          lines.push('');
        }
      }
      lines.push(`### ${a.order}. ${actionHuman(a)}`);
      lines.push(`- actionId: ${a.id}`);
      lines.push(`- page/frame: ${a.pageId || 'page-1'} / ${(a.frameChain || []).join(' -> ') || 'top'}`);
      if (a.locator) lines.push(`- locator confidence: ${a.locatorConfidence ? `${a.locatorConfidence.level} (${a.locatorConfidence.score})` : 'unknown'}`);
      if (a.before) lines.push(`- before: ${a.before.title || ''} | ${a.before.url || ''}`);
      if (a.effects && a.effects.network && a.effects.network.length) {
        const starts = a.effects.network.filter(x => x.phase === 'start');
        for (const n of starts) lines.push(`- request: ${n.method} ${n.requestUrl}`);
        const ends = a.effects.network.filter(x => x.phase === 'end' || x.phase === 'error');
        for (const n of ends) lines.push(`- response: ${n.method} ${n.requestUrl} -> ${n.status != null ? n.status : n.error}`);
      }
      for (const e of a.inferredExpected || []) lines.push(`- inferred expected [${e.confidence}]: ${e.type} = ${JSON.stringify(e.value)}`);
      if (a.after) lines.push(`- after: ${a.after.title || ''} | ${a.after.url || ''}`);
      lines.push('');
    }

    // [v7.3] ТЗ без сетевой части — это инструкция «куда нажимать». Сетевая часть
    // отвечает на вопрос, можно ли вообще обойтись без нажатий.
    const endpoints = (context && context.endpoints) || [];
    const authProfile = context && context.authProfile;
    if (authProfile) {
      lines.push('## Authentication');
      lines.push('');
      lines.push(`- mechanism: ${authProfile.mechanism}`);
      if (authProfile.observedCarriers.length) {
        lines.push(`- observed carriers: ${authProfile.observedCarriers.map(c => `${c.carrier} (x${c.requests})`).join(', ')}`);
      }
      if (authProfile.loginCandidates.length) {
        lines.push(`- login-looking endpoints: ${authProfile.loginCandidates.map(c => c.key).join(', ')}`);
      }
      lines.push(`- ${authProfile.recommendation}`);
      lines.push('- No credential value is recorded anywhere in this bundle, by construction.');
      lines.push('');
    }
    if (endpoints.length) {
      lines.push('## API surface exercised by this recording');
      lines.push('');
      lines.push('| endpoint | calls | statuses | write | triggered by steps |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const endpoint of endpoints.slice(0, 80)) {
        const statuses = Object.entries(endpoint.statuses).map(([code, count]) => `${code}x${count}`).join(' ');
        const steps = endpoint.triggeredBy.map(t => t.order).filter(x => x != null).join(', ') || (endpoint.background ? 'background' : '-');
        lines.push(`| \`${endpoint.key}\` | ${endpoint.calls} | ${statuses} | ${endpoint.write ? 'yes' : 'no'} | ${steps} |`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  function finalizeAllActions() {
    flushAllInputs();
    if (actionFinalizeTimer) { clearTimeout(actionFinalizeTimer); actionFinalizeTimer = null; }
    for (const a of macroLog) if (a && !a.finalizedAt) finalizeAction(a, 'export');
    for (const a of macroLog) if (a) a.inferredExpected = deriveExpected(a);
  }

  function exportBundle(filename = `action-log-v7-${resolvedMacroName()}-${Date.now()}.json`) {
    finalizeAllActions();
    saveBackup(true);
    const actions = macroLog.map(cleanActionForExport);
    const variables = buildVariables(actions);
    const warnings = buildWarnings(actions);
    // [v7.3] Свёртка start/end/error в один запрос — общая основа для инвентаря
    // эндпоинтов, профиля авторизации и HAR. Считается один раз на экспорт.
    const folded = foldRequests(networkLog);
    const endpoints = config.buildEndpointInventory ? buildEndpointInventory(folded, actions, {
      maxSamples: config.endpointSampleUrls,
      ignore: config.networkIgnore,
      baseHref: location.href,
      baseOrigin: location.origin
    }) : [];
    const authProfile = config.buildAuthProfile ? buildAuthProfile(folded, endpoints) : null;
    const openQuestions = buildOpenQuestions(actions, { endpoints, authProfile });
    const screens = dedupScreens(actions);
    const payload = {
      schema: 'action-logger-ai-v7',
      schemaPurpose: 'AI-first deterministic browser trace for reconstructing user steps, drafting requirements, and generating macros/tests',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      session,
      env: environment(),
      config: serializableConfig(),
      stats: {
        rawEvents: rawLog.length,
        macroActions: actions.length,
        screenSnapshotsCaptured: screenLog.length,
        screenSnapshotsDeduped: screens.length,
        networkEntries: networkLog.length,
        httpRequests: folded.length,
        endpoints: endpoints.length,
        stateChangingEndpoints: endpoints.filter(e => e.write).length,
        streams: streamLog.length,
        streamFrames: streamLog.reduce((sum, s) => sum + (s.frames ? s.frames.length : 0), 0),
        weakLocators: actions.filter(a => a.locatorConfidence && a.locatorConfidence.level === 'low').length,
        openQuestions: openQuestions.length,
        backupMode
      },
      aiInstructions: {
        sourceOfTruth: 'timeline order/actionId plus correlated effects; rawLog is supporting forensic detail',
        userWillDescribeIntentLater: true,
        doNotReorderStepsWithoutEvidence: true,
        useBeforeAfterAndEffectsToInferWaitsAndAssertions: true,
        secrets: 'Values marked REDACTED must be parameterized, never guessed',
        locatorRule: 'Prefer high-confidence semantic/test-id locators; low-confidence locators require repair instead of blindly using .first()',
        popupRule: 'pageId separates browser pages when observable; target=_blank may be recorded but not instrumented by a one-shot page script',
        openQuestionsRule: 'Resolve openQuestions[] with the user in one batch before writing automation for the affected steps — do not guess destructive/ambiguous steps silently',
        endpointsRule: 'endpoints[] is the API surface this recording actually exercised: prefer calling a state-changing endpoint directly over replaying the clicks that triggered it, and write payloads against requestShape/responseShape (the union across every recorded call) rather than against one recorded value',
        shapeMarkers: '__optional means the key was absent in at least one recorded call; __oneOf lists the alternative shapes seen at that position',
        unparsedMarker: `${UNPARSED} means a body existed but is not JSON (see responsePreview) — it never means the value was null, and responseBodyCaptured:false means no body was read at all`,
        authRule: 'authProfile says how the site authenticates, never with what: no token, cookie or header value is ever recorded. An empty cookies[] does not mean cookies are unused — HttpOnly cookies are invisible to page scripts',
        streamsRule: 'streams[] carries WebSocket/SSE frames; if a step changed state with no HTTP request, look there before concluding the recording missed it'
      },
      timeline: actions,
      tasks: tasksLog,
      variables,
      warnings,
      openQuestions,
      screens,
      // [v7.3] API-часть записи: инвентарь вызовов, способ авторизации и короткий вывод
      // «с чего начинать скрипт». Это и есть ответ на «что нужно, чтобы автоматизировать
      // это потом», который раньше получателю приходилось собирать самому по network[].
      brief: buildAutomationBrief(endpoints, authProfile),
      endpoints,
      authProfile,
      streams: streamLog,
      network: networkLog,
      rawLog,
      generated: {
        playwright: generatePlaywright(),
        technicalSpecMarkdown: config.generateDraftSpec ? generateDraftSpec(actions, { endpoints, authProfile }) : null
      }
    };
    deliver(filename, JSON.stringify(payload, null, 2));
    console.log(`[logger] AI bundle: ${rawLog.length} raw / ${actions.length} actions / ${networkLog.length} network / ${endpoints.length} endpoints / ${streamLog.length} streams / ${screenLog.length} screens`);
    if (openQuestions.length) {
      console.log(`%c[logger] ${openQuestions.length} открытых вопросов — см. payload.openQuestions`, 'color:orange');
    }
    return payload;
  }

  function exportMacro(filename = `macro-log-v7-${resolvedMacroName()}-${Date.now()}.json`) {
    flushAllInputs();
    saveBackup(true);
    const payload = {
      schema: 'action-logger-macro-v7',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      session,
      env: environment(),
      actions: macroLog
    };
    deliver(filename, JSON.stringify(payload, null, 2));
    console.log(`[logger] macro: ${macroLog.length} actions`);
  }

  // [v7.1][11] компактный "рецепт" для ассистента — без полных снапшотов/тел сети/rawLog,
  // только то, из чего пишется код: локатор, значение(+hash), contextChain, diff-сводка.
  function buildPlan(actions) {
    return actions.map(a => ({
      order: a.order,
      id: a.id,
      taskId: a.taskId || null,
      t: a.iso,
      action: a.action,
      human: actionHuman(a),
      locator: a.locator ? { primary: a.locator.primary, pw: a.locator.pw, confidence: a.locatorConfidence } : null,
      contextChain: a.contextChain || [],
      // большой CM6/textarea-текст сюда не тащим целиком (это отдельно есть в AI JSON) —
      // только превью + hash/length + line-diff, этого достаточно, чтобы понять что менялось
      value: a.isLargeText && typeof a.value === 'string' ? trunc(a.value, 500) : a.value,
      valueLength: a.valueLength || null,
      valueHash: a.valueHash || null,
      isLargeText: !!a.isLargeText,
      textDiff: a.textDiff || null,
      checked: a.checked,
      antd: a.antd || null,
      aria: a.aria || null,
      destructive: !!a.destructive,
      possibleRetry: a.possibleRetry || null,
      requiresManualVerification: a.requiresManualVerification || false,
      artifacts: (a.artifacts || []).map(x => ({ name: x.name, size: x.size, contentHash: x.contentHash || null, contentCaptured: !!x.contentCaptured })),
      network: (a.effects && a.effects.network || []).filter(n => n.phase !== 'start').map(n => ({
        method: n.method, url: n.requestUrl, status: n.status,
        // [v7.3] тело ответа теперь чаще лежит разобранным в responseJson, чем текстом
        hasBody: (n.responseJson !== undefined && n.responseJson !== UNPARSED) || n.responsePreview != null
      })),
      streams: (a.effects && a.effects.streams || []).map(s => ({ url: s.url, direction: s.direction })),
      inferredExpected: a.inferredExpected || [],
      humanExpected: a.humanExpected || [],
      humanNotes: a.humanNotes || [],
      diffSummary: a.diff ? {
        urlChanged: a.diff.urlChanged || null,
        titleChanged: a.diff.titleChanged || null,
        inputsChanged: (a.diff.inputs && a.diff.inputs.changed || []).length,
        inputsOrderChanged: !!a.diff.inputsOrderChanged,
        dialogsAdded: (a.diff.dialogs && a.diff.dialogs.added || []).length,
        alertsAdded: (a.diff.alerts && a.diff.alerts.added || []).length
      } : null
    }));
  }

  function exportPlan(filename = `action-plan-v7-${resolvedMacroName()}-${Date.now()}.json`) {
    finalizeAllActions();
    const actions = macroLog.map(cleanActionForExport);
    // [v7.3] План — это то, что отдают вместо bundle, когда bundle не влезает в чат.
    // Значит он не имеет права молча терять ответ на «как авторизоваться» и вопросы,
    // без которых скрипт не написать: сам инвентарь компактный, тел сети в нём нет.
    const folded = foldRequests(networkLog);
    const endpoints = config.buildEndpointInventory ? buildEndpointInventory(folded, actions, {
      maxSamples: 1,
      ignore: config.networkIgnore,
      baseHref: location.href,
      baseOrigin: location.origin
    }) : [];
    const authProfile = config.buildAuthProfile ? buildAuthProfile(folded, endpoints) : null;
    const payload = {
      schema: 'action-logger-plan-v7',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      session: { id: session.id, macroName: resolvedMacroName(), startUrl: session.startUrl, startedAt: session.startedAt },
      tasks: tasksLog,
      brief: buildAutomationBrief(endpoints, authProfile),
      authProfile,
      endpoints: endpoints.map(e => ({
        key: e.key, write: e.write, background: e.background, calls: e.calls, statuses: e.statuses,
        authCarriers: e.authCarriers, requestShape: e.requestShape, responseShape: e.responseShape,
        triggeredBy: e.triggeredBy
      })),
      openQuestions: buildOpenQuestions(actions, { endpoints, authProfile }),
      steps: buildPlan(actions)
    };
    deliver(filename, JSON.stringify(payload, null, 2));
    console.log(`[logger] plan: ${payload.steps.length} шагов, ${endpoints.length} эндпоинтов, ${payload.openQuestions.length} открытых вопросов`);
    return payload;
  }

  // ------------------------------------- [v7.3] то, что нужно будущему скрипту, а не глазу
  // Таймлайн отвечает на «куда нажимали». Этот раздел отвечает на три вопроса, без которых
  // автоматизацию всё равно не написать: какие вызовы есть у приложения, как в него войти
  // и в каком виде это отдать инструменту, который про нашу схему не знает (HAR).

  function storageCredentialKeys(storage, sourceName) {
    const out = [];
    if (!storage) return out;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key == null || key === STORAGE_KEY) continue; // свой бэкап — не учётные данные сайта
        let value = null;
        try { value = storage.getItem(key); } catch (_) {}
        const shape = tokenValueShape(value);
        if (!looksLikeCredentialName(key) && shape.kind !== 'jwt') continue;
        out.push({ source: sourceName, key, valueShape: shape.kind, valueLength: shape.length, note: shape.note || null });
      }
    } catch (_) {}
    return out;
  }

  const LOGIN_PATH_RE = /login|logon|signin|sign-in|auth|oauth|token|session|sso|refresh/i;

  function buildAuthProfile(folded, endpoints) {
    let cookies = [];
    try { cookies = cookieNamesFrom(document.cookie); } catch (_) {}
    const storageCredentials = [
      ...storageCredentialKeys(typeof window !== 'undefined' ? window.localStorage : null, 'localStorage'),
      ...storageCredentialKeys(typeof window !== 'undefined' ? window.sessionStorage : null, 'sessionStorage')
    ];
    const observedCarriers = summarizeAuthCarriers(folded);
    const carrierNames = observedCarriers.map(x => x.carrier);
    const loginCandidates = (endpoints || [])
      .filter(e => e.write && LOGIN_PATH_RE.test(e.pathTemplate))
      .map(e => ({ key: e.key, calls: e.calls, statuses: e.statuses }));

    let mechanism = 'unknown';
    let recommendation = 'Способ авторизации по записи не определился: запись могла начаться уже в залогиненной сессии, где ни одного авторизующего запроса не было. Спросите оператора, как он вошёл.';
    if (carrierNames.includes('header:authorization')) {
      mechanism = 'bearer_header';
      recommendation = 'Запросы несут Authorization. Значение в записи не сохранено (и не должно быть): скрипт получает токен сам — либо запросом логина из loginCandidates, либо из окружения/секрета.';
    } else if (carrierNames.some(x => x.startsWith('cookies:')) || cookies.length) {
      mechanism = 'browser_cookies';
      recommendation = 'Авторизация держится на cookie браузера. Для Playwright: войдите руками один раз и сохраните context.storageState() — воспроизводить сам логин обычно не нужно. Для curl/requests: cookie придётся прокидывать явно, значений в записи нет.';
    }
    const csrfHeaders = carrierNames.filter(x => x.includes('csrf') || x.includes('xsrf'));
    if (csrfHeaders.length) {
      recommendation += ` Плюс CSRF-заголовок (${csrfHeaders.join(', ')}): его значение берётся из живой страницы/cookie, константой из записи его зашить нельзя.`;
    }

    return {
      origin: location.origin,
      mechanism,
      observedCarriers,
      csrfHeaders,
      cookies,
      // Пустой список cookies НЕ означает «cookie не используются»: HttpOnly-cookie (а это
      // почти все сессионные) из JS не видны вообще. Это надо сказать прямо, иначе получатель
      // записи сделает ровно обратный вывод.
      httpOnlyCookiesInvisible: true,
      cookieHeaderNote: 'Заголовок Cookie браузер добавляет после хука логгера и в JS не читается — признаком cookie-авторизации служит режим credentials запроса, а не наличие заголовка.',
      storageCredentials,
      loginCandidates,
      recommendation
    };
  }

  // Одна страница на сессию — и только она. Разложить запросы по навигациям HAR-полем
  // pageref можно было бы, но соответствие «запрос -> страница» пришлось бы угадывать по
  // времени; навигации и без того лежат в таймлайне с точной привязкой к шагам.
  function harPages() {
    return [{ id: 'page-1', startedDateTime: session.startedAt, title: session.startTitle || session.startUrl || '' }];
  }

  function buildAutomationBrief(endpoints, authProfile) {
    const writes = endpoints.filter(e => e.write && !e.background);
    const weakest = endpoints.filter(e => e.failures > 0);
    return {
      // Короткий ответ на «с чего начинать скрипт», чтобы получателю не пришлось
      // вычислять это самому по всему инвентарю.
      authMechanism: authProfile ? authProfile.mechanism : null,
      stateChangingEndpoints: writes.map(e => e.key),
      backgroundEndpoints: endpoints.filter(e => e.background).length,
      endpointsWithFailures: weakest.map(e => ({ key: e.key, statuses: e.statuses, errors: e.errors })),
      apiFirstFeasible: writes.length > 0,
      apiFirstNote: writes.length
        ? 'Шаги, меняющие состояние, прошли через HTTP — их можно звать напрямую, не повторяя клики. Сверяйте requestShape/responseShape, а не одно записанное значение.'
        : 'Ни один шаг, меняющий состояние, не дал HTTP-запроса в записи: либо всё идёт через WebSocket/SSE (см. streams), либо запись не покрыла сохранение. Автоматизация, скорее всего, остаётся UI-уровня.'
    };
  }

  function buildHarPayload(folded) {
    return buildHar(folded, {
      creatorName: 'action-logger',
      creatorVersion: VERSION,
      pages: harPages(),
      pageRef: 'page-1'
    });
  }

  function exportHar(filename = `network-${resolvedMacroName()}-${Date.now()}.har`) {
    const folded = foldRequests(networkLog);
    const har = buildHarPayload(folded);
    deliver(filename, JSON.stringify(har, null, 2));
    console.log(`[logger] HAR: ${har.log.entries.length} запросов — открывается в DevTools/Postman/Insomnia`);
    return har;
  }

  function exportApi(filename = `api-recipe-${resolvedMacroName()}-${Date.now()}.json`) {
    finalizeAllActions();
    const actions = macroLog.map(cleanActionForExport);
    const folded = foldRequests(networkLog);
    const endpoints = buildEndpointInventory(folded, actions, {
      maxSamples: config.endpointSampleUrls,
      ignore: config.networkIgnore,
      baseHref: location.href,
      baseOrigin: location.origin
    });
    const authProfile = buildAuthProfile(folded, endpoints);
    const payload = {
      schema: 'action-logger-api-v7',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      session: { id: session.id, macroName: resolvedMacroName(), startUrl: session.startUrl, startedAt: session.startedAt },
      brief: buildAutomationBrief(endpoints, authProfile),
      authProfile,
      endpoints,
      streams: streamLog.map(s => ({
        kind: s.kind, url: s.url, actionId: s.actionId, frames: s.frames.length, framesDropped: s.framesDropped,
        sample: s.frames.slice(0, 3)
      }))
    };
    deliver(filename, JSON.stringify(payload, null, 2));
    console.log(`[logger] API recipe: ${endpoints.length} эндпоинтов, авторизация — ${authProfile.mechanism}`);
    return payload;
  }

  // ------------------------------------------------- [9][10][15] Playwright

  function jsString(value) {
    return JSON.stringify(value == null ? '' : String(value));
  }

  function jsValue(value) {
    return JSON.stringify(value);
  }

  // { name: "Save", exact: true } вместо JSON-обёртки — читается как рукописный тест
  function jsOptions(obj) {
    const parts = Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? jsString(v) : jsValue(v)}`);
    return `{ ${parts.join(', ')} }`;
  }

  function pageVar(pageId) {
    if (!pageId || pageId === 'page-1') return 'page';
    return `page_${String(pageId).replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  function frameScopeCode(frameChain, pageId) {
    let scope = pageVar(pageId);
    for (const frameSelector of frameChain || []) scope += `.frameLocator(${jsString(frameSelector)})`;
    return scope;
  }

  function locatorCode(a) {
    const scope = frameScopeCode(a.frameChain, a.pageId);
    const L = a.locator;
    if (!L) return null;

    const pw = L.pw;
    if (pw && pw.method) {
      const args = pw.args.map(arg => (typeof arg === 'object' && arg !== null ? jsOptions(arg) : jsString(arg))).join(', ');
      return { code: `${scope}.${pw.method}(${args})`, unique: !!pw.unique };
    }

    const css = L.primary && L.primary.css;
    if (!css) return null;
    return { code: `${scope}.locator(${jsString(css)})`, unique: !!L.primary.unique };
  }

  function pressKey(action) {
    const mods = [];
    if (action.modifiers && action.modifiers.ctrl) mods.push('Control');
    if (action.modifiers && action.modifiers.meta) mods.push('Meta');
    if (action.modifiers && action.modifiers.alt) mods.push('Alt');
    if (action.modifiers && action.modifiers.shift) mods.push('Shift');
    mods.push(action.key);
    return mods.join('+');
  }

  function actionLines(a, indent, state) {
    const out = [];
    const pad = ' '.repeat(indent);
    const loc = locatorCode(a);
    const sel = loc ? loc.code : null;

    const push = line => out.push(pad + line);

    if (a.gapMs > 3000 && a.gapMs < 30000) push(`// пауза оператора: ${a.gapMs} мс`);
    if (a.locator && a.locator.inShadow) push(`// элемент внутри shadow DOM`);
    if (loc && !loc.unique) push(`// TODO: локатор не уникален — намеренно НЕ используем .first(); уточните локатор`);

    // [10] проверка, что новый экран отрисовался
    if (config.emitAssertions && state.needVisibilityAssert && sel &&
        ['click', 'dblclick', 'fill', 'select', 'check', 'uncheck', 'hover', 'press'].includes(a.action)) {
      push(`await expect(${sel}).toBeVisible();`);
      state.needVisibilityAssert = false;
    }

    if (a.resultDialog) {
      const d = a.resultDialog;
      if (!d.accepted) push(`page.once('dialog', dialog => dialog.dismiss());`);
      else if (d.type === 'prompt') {
        if (d.response && d.response !== '[PROMPT_VALUE_NOT_CAPTURED]') push(`page.once('dialog', dialog => dialog.accept(${jsString(d.response)}));`);
        else push(`page.once('dialog', dialog => dialog.accept(process.env.MACRO_PROMPT || ''));`);
      } else push(`page.once('dialog', dialog => dialog.accept());`);
    }

    // [5] клик, открывающий новую вкладку
    const popupWrap = a.resultPopup && ['click', 'dblclick', 'press'].includes(a.action);
    let actionExpr = null;

    switch (a.action) {
      case 'click': actionExpr = sel ? `${sel}.click()` : null; break;
      case 'dblclick': actionExpr = sel ? `${sel}.dblclick()` : null; break;
      case 'contextmenu': actionExpr = sel ? `${sel}.click({ button: 'right' })` : null; break;
      case 'hover': actionExpr = sel ? `${sel}.hover()` : null; break;
      case 'check': actionExpr = sel ? `${sel}.check()` : null; break;
      case 'uncheck': actionExpr = sel ? `${sel}.uncheck()` : null; break;
      case 'press':
        actionExpr = sel ? `${sel}.press(${jsString(pressKey(a))})` : `page.keyboard.press(${jsString(pressKey(a))})`;
        break;
      case 'fill':
        if (sel) {
          if (a.sensitive || a.value === '[REDACTED]') {
            push(`// секрет не сохранён намеренно`);
            actionExpr = `${sel}.fill(process.env.MACRO_SECRET || '')`;
          } else if (['range', 'color'].includes(a.inputType)) {
            // Playwright не умеет fill() для range/color — ставим значение напрямую
            push(`// ${a.inputType}: значение выставляется через evaluate`);
            actionExpr = `${sel}.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, ${jsString(a.value)})`;
          } else if (config.playwrightTextMethod === 'pressSequentially') {
            actionExpr = `${sel}.pressSequentially(${jsString(a.value)})`;
          } else {
            actionExpr = `${sel}.fill(${jsString(a.value)})`;
          }
        }
        break;
      case 'select':
        if ((a.antd && a.antd.control === 'select') || (a.aria && a.aria.control === 'listbox-option')) {
          // [v7.1/v7.2] кастомный select (AntD или generic ARIA listbox) — не нативный
          // <select>, .selectOption() тут не работает: открываем дропдаун кликом по
          // контролу и кликаем нужную опцию по тексту.
          if (sel) push(`await ${sel}.click();`);
          push(`await page.getByRole('option', ${jsOptions({ name: a.value, exact: true })}).click();`);
        } else if (sel) {
          actionExpr = `${sel}.selectOption(${Array.isArray(a.value) ? jsValue(a.value) : jsString(a.value)})`;
        }
        break;
      case 'toggle':
        actionExpr = sel ? `${sel}.click()` : null;
        if (actionExpr) push(`// AntD Switch -> ${a.checked ? 'checked' : 'unchecked'}`);
        break;
      case 'expand':
        actionExpr = sel ? `${sel}.click()` : null;
        break;
      case 'setFiles':
        if (sel) {
          push(`// TODO: укажите реальные пути к файлам: ${(a.files || []).map(f => f.name).join(', ')}`);
          push(`// await ${sel}.setInputFiles('/path/to/file');`);
        }
        break;
      case 'submit':
        push(`// submit формы; обычно воспроизводится предыдущим кликом или Enter`);
        break;
      case 'dragTo': {
        const src = locatorCode(a.source || {});
        const dst = locatorCode(a.destination || {});
        if (src && dst) actionExpr = `${src.code}.dragTo(${dst.code})`;
        else push(`// TODO: drag&drop между разными фреймами требует ручной доработки`);
        break;
      }
      case 'navigate':
        if (a.toUrl) {
          push(`await page.goto(${jsString(a.toUrl)}); // ${a.type || 'navigation'}`);
          state.needVisibilityAssert = true;
        }
        break;
      case 'popup':
        push(`// открытие новой вкладки: ${a.popup && a.popup.url ? a.popup.url : 'unknown'}`);
        break;
      case 'mark':
        push(`// MARK: ${String(a.label || '').replace(/\r?\n/g, ' ')}`);
        break;
      case 'dialog':
        push(`// одиночный диалог (${a.dialog && a.dialog.type}); обработчик привяжите к вызывающему действию вручную`);
        break;
      default:
        push(`// не поддерживается: ${JSON.stringify(a.action)}`);
    }

    if (actionExpr) {
      if (popupWrap) {
        const popupVar = pageVar(a.resultPopup && a.resultPopup.pageId || `page-${a.seq}`);
        const parentVar = pageVar(a.pageId);
        push(`const [${popupVar}] = await Promise.all([`);
        push(`  ${parentVar}.waitForEvent('popup'),`);
        push(`  ${actionExpr},`);
        push(`]);`);
        push(`await ${popupVar}.waitForLoadState();`);
      } else {
        push(`await ${actionExpr};`);
      }
    }

    if (a.resultNavigation && a.resultNavigation.toUrl) {
      const targetPage = pageVar(a.pageId);
      if (config.emitAssertions) push(`await expect(${targetPage}).toHaveURL(${jsString(a.resultNavigation.toUrl)});`);
      else push(`// -> переход на ${a.resultNavigation.toUrl}`);
      state.needVisibilityAssert = true;
    }

    // v7: фактически наблюдавшиеся UI outcomes как подсказки/ассерты.
    if (config.emitAssertions && a.diff) {
      for (const alert of (a.diff.alerts && a.diff.alerts.added || []).slice(0, 3)) {
        const txt = alert.name || alert.text;
        if (txt) push(`await expect(${pageVar(a.pageId)}.getByText(${jsString(txt)}, { exact: false })).toBeVisible();`);
      }
    }

    return out;
  }

  function generatePlaywright() {
    flushAllInputs();

    const env = session.env || environment();
    const lines = [];
    lines.push(`const { test, expect } = require('@playwright/test');`);
    lines.push('');
    lines.push(`// Записано Action Logger v${VERSION} ${session.startedAt}`);
    lines.push(`// UA: ${env.userAgent}`);
    lines.push('');
    lines.push(`test.use({`);
    lines.push(`  viewport: ${jsValue(env.viewport)},`);
    lines.push(`  deviceScaleFactor: ${env.deviceScaleFactor},`);
    lines.push(`  locale: ${jsString(env.locale)},`);
    lines.push(`  timezoneId: ${jsString(env.timezone || 'UTC')},`);
    lines.push(`  testIdAttribute: ${jsString(config.testIdAttribute)},`);
    lines.push(`});`);
    lines.push('');
    lines.push(`test('recorded scenario', async ({ page }) => {`);
    lines.push(`  await page.goto(${jsString(session.startUrl)});`);

    const state = { needVisibilityAssert: config.emitAssertions };

    // [15] группировка по меткам
    const groups = [];
    let current = { label: null, actions: [] };
    for (const a of macroLog) {
      if (a.action === 'mark' && config.emitSteps) {
        if (current.actions.length || current.label) groups.push(current);
        current = { label: a.label || 'step', actions: [] };
        continue;
      }
      current.actions.push(a);
    }
    groups.push(current);

    for (const group of groups) {
      if (!group.actions.length) continue;
      const useStep = config.emitSteps && group.label;
      const indent = useStep ? 4 : 2;
      if (useStep) lines.push(`  await test.step(${jsString(group.label)}, async () => {`);
      for (const a of group.actions) lines.push(...actionLines(a, indent, state));
      if (useStep) lines.push(`  });`);
    }

    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  function exportPlaywright(filename = `macro-playwright-v7-${resolvedMacroName()}-${Date.now()}.spec.js`) {
    deliver(filename, generatePlaywright(), 'text/javascript');
    console.log(`[logger] Playwright: ${macroLog.length} действий`);
  }

  // ----------------------------------------------------------------- stats

  function countsBy(list, fn) {
    const out = {};
    for (const item of list) {
      const key = fn(item);
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  function stats() {
    const rawCounts = countsBy(rawLog, e => `${e.kind}:${e.type}`);
    const macroCounts = countsBy(macroLog, e => e.action);
    const weak = macroLog.filter(a => a.locatorConfidence && a.locatorConfidence.level === 'low').length;
    const frames = streamLog.reduce((sum, s) => sum + (s.frames ? s.frames.length : 0), 0);
    console.log(`[logger] raw=${rawLog.length}, actions=${macroLog.length}, screens=${screenLog.length}, network=${networkLog.length}, streams=${streamLog.length}/${frames}кадров, weakLocators=${weak}, backup=${backupMode}, session=${session.id}`);
    console.table(Object.entries(rawCounts).sort((a, b) => b[1] - a[1]).map(([event, count]) => ({ event, count })));
    console.table(Object.entries(macroCounts).sort((a, b) => b[1] - a[1]).map(([action, count]) => ({ action, count })));
  }

  // ----------------------------------------------------------------- panel

  let panel = null;
  let rawCounterEl = null;
  let macroCounterEl = null;
  let statusEl = null;
  let modeEl = null;
  let panelFrame = null; // [8]

  function schedulePanelUpdate() {
    if (panelFrame) return;
    panelFrame = requestAnimationFrame(() => {
      panelFrame = null;
      updatePanel();
    });
  }

  function updatePanel() {
    if (rawCounterEl) rawCounterEl.textContent = String(rawLog.length);
    if (macroCounterEl) macroCounterEl.textContent = String(macroLog.length);
    if (statusEl) {
      statusEl.textContent = recording ? '● REC' : '○ PAUSE';
      statusEl.style.color = recording ? '#ff746c' : '#aaa';
    }
    if (modeEl) modeEl.textContent = config.mode.toUpperCase();
  }

  function button(label, id, extra = '') {
    return `<button id="${id}" style="padding:5px 6px;cursor:pointer;${extra}">${label}</button>`;
  }

  function buildPanel() {
    const old = document.getElementById('__action-logger-panel');
    if (old) old.remove();

    panel = document.createElement('div');
    panel.id = '__action-logger-panel';
    panel.style.cssText = `
      position:fixed;bottom:16px;right:16px;z-index:2147483647;
      width:228px;background:#1e1e1e;color:#eee;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;
      border:1px solid #444;border-radius:9px;box-shadow:0 5px 20px rgba(0,0,0,.45);
      user-select:none;overflow:hidden;
    `;

    panel.innerHTML = `
      <div id="__al-header" style="cursor:move;padding:7px 8px;background:#2b2b2b;display:flex;justify-content:space-between;align-items:center;">
        <b>Action Logger v7</b>
        <span id="__al-status">● REC</span>
      </div>
      <div style="padding:8px;display:grid;gap:6px;">
        <div style="display:flex;justify-content:space-between;color:#bbb">
          <span>raw <b id="__al-raw">0</b></span>
          <span>macro <b id="__al-macro">0</b></span>
          <span id="__al-mode">MACRO</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          ${button('⏸ Пауза', '__al-toggle')}
          ${button('◉ Режим', '__al-mode-btn')}
          ${button('🏷 Метка', '__al-mark')}
          ${button('📊 Статы', '__al-stats')}
          ${button('💾 AI JSON', '__al-export')}
          ${button('📝 Plan', '__al-export-plan')}
          ${button('🔌 API', '__al-export-api')}
          ${button('🌐 HAR', '__al-export-har')}
          ${button('▶ PW отдельно', '__al-export-pw')}
          ${button('■ Стоп + экспорт', '__al-stop')}
          ${button('📋 Копия', '__al-copy')}
          ${button('🗑 Очистить', '__al-clear', 'color:#ff9a9a;')}
        </div>
        <div style="color:#777;font-size:10px;">Ctrl+Shift+M — метка, Ctrl+Shift+S — стоп</div>
      </div>
    `;

    document.body.appendChild(panel);
    rawCounterEl = panel.querySelector('#__al-raw');
    macroCounterEl = panel.querySelector('#__al-macro');
    statusEl = panel.querySelector('#__al-status');
    modeEl = panel.querySelector('#__al-mode');
    updatePanel();

    panel.querySelector('#__al-toggle').addEventListener('click', () => {
      if (recording) pause();
      else start();
      panel.querySelector('#__al-toggle').textContent = recording ? '⏸ Пауза' : '▶ Дальше';
    });

    panel.querySelector('#__al-mode-btn').addEventListener('click', () => setMode(config.mode === 'macro' ? 'debug' : 'macro'));
    panel.querySelector('#__al-mark').addEventListener('click', () => {
      const label = native.prompt.call(window, 'Текст метки:');
      if (label) mark(label);
    });
    panel.querySelector('#__al-stats').addEventListener('click', stats);
    panel.querySelector('#__al-export').addEventListener('click', () => exportBundle());
    panel.querySelector('#__al-export-api').addEventListener('click', () => exportApi());
    panel.querySelector('#__al-export-har').addEventListener('click', () => exportHar());
    panel.querySelector('#__al-export-plan').addEventListener('click', () => exportPlan());
    panel.querySelector('#__al-export-pw').addEventListener('click', () => exportPlaywright());
    panel.querySelector('#__al-copy').addEventListener('click', copyLast);
    panel.querySelector('#__al-stop').addEventListener('click', stop);
    panel.querySelector('#__al-clear').addEventListener('click', () => {
      if (native.confirm.call(window, `Удалить ${rawLog.length} raw и ${macroLog.length} macro записей?`)) clear();
    });

    const header = panel.querySelector('#__al-header');
    let dragging = false;
    let offX = 0;
    let offY = 0;

    header.addEventListener('mousedown', e => {
      dragging = true;
      const r = panel.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = `${Math.max(0, e.clientX - offX)}px`;
      panel.style.top = `${Math.max(0, e.clientY - offY)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }, { signal: ac.signal });

    document.addEventListener('mouseup', () => { dragging = false; }, { signal: ac.signal });
  }

  // --------------------------------------------------------------- control

  function setMode(mode) {
    if (!['macro', 'debug'].includes(mode)) throw new Error('mode must be "macro" or "debug"');
    config.mode = mode;
    const debug = mode === 'debug';
    config.trackLowLevelMouse = debug;
    config.trackAllKeyboard = debug;
    config.trackFocus = debug;
    config.trackMouseMove = false;
    config.trackWheel = debug;
    config.trackDomMutations = debug;
    attachMutationObservers();
    updatePanel();
    console.log(`[logger] mode=${mode}`);
  }

  function start() {
    recording = true;
    updatePanel();
    console.log('%c[logger] запись включена', 'color:lime');
  }

  function pause() {
    flushAllInputs();
    recording = false;
    saveBackup(true);
    updatePanel();
    console.log('%c[logger] пауза', 'color:orange');
  }

  function stop() {
    flushAllInputs();
    finalizeAllActions();
    session.endedAt = new Date().toISOString();
    session.durationMs = Math.max(0, Date.now() - new Date(session.startedAt).getTime());
    recording = false;
    saveBackup(true);
    updatePanel();
    console.log('%c[logger] остановлено — формирую единый AI bundle', 'color:orange');
    if (config.autoExportOnStop) exportBundle();
  }

  function clear() {
    pendingInputs.forEach(v => clearTimeout(v.timer));
    pendingInputs.clear();
    rawLog.length = 0;
    macroLog.length = 0;
    screenLog.length = 0;
    networkLog.length = 0;
    streamLog.length = 0;
    tasksLog.length = 0;
    actionsById.clear();
    currentAction = null;
    currentTask = null;
    rawSeq = 0;
    macroSeq = 0;
    requestSeq = 0;
    pageSeq = 1;
    hoverCandidate = null;
    backupMode = 'full';
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    if (typeof indexedDB !== 'undefined' && !idbFailed) {
      openIdb().then(db => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete('session');
        } catch (_) {}
      }).catch(() => {});
    }
    updatePanel();
    console.log('[logger] очищено');
  }

  // [v7.2] Раз одна и та же утилита пишет макросы для разных задач/сайтов, файлы нужно
  // различать без открытия каждого — по умолчанию имя берётся из пути страницы, но лучше
  // явно задать __logger.setMacroName('add-js-asset') в начале записи.
  function slugify(s, fallback) {
    const x = String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return x || fallback || 'session';
  }

  function defaultMacroName() {
    try { return slugify(new URL(session.startUrl).pathname, 'session'); }
    catch (_) { return 'session'; }
  }

  function resolvedMacroName() {
    return slugify(session.macroName || defaultMacroName(), 'session');
  }

  function setMacroName(name) {
    session.macroName = name ? String(name).trim() : null;
    saveBackup(true);
    console.log(`%c[logger] имя макроса: ${resolvedMacroName()}`, 'color:cyan');
  }

  function mark(label) {
    const text = trunc(String(label), 200);
    pushRaw({ kind: 'mark', type: 'mark', label: text });
    pushMacro({ action: 'mark', label: text, frameChain: [] });
    console.log(`%c[logger] метка: ${text}`, 'color:magenta');
  }

  // [v7.1][19] __logger.beginTask({locale, path}) / endTask({status, reason}) — режет плоский
  // таймлайн на задачи (обычно "одна страница"), чтобы в bundle появился per-page рецепт.
  function beginTask(meta) {
    if (currentTask && !currentTask.endedAt) endTask({ status: 'superseded_by_next_task' });
    currentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: new Date().toISOString(),
      startActionSeq: macroLog.length,
      meta: sanitizeObject(meta || {}, 0, config.maxText)
    };
    pushRaw({ kind: 'task', type: 'begin', task: currentTask });
    saveBackup(true);
    console.log(`%c[logger] task начат`, 'color:cyan', currentTask.meta);
    return currentTask;
  }

  function endTask(result) {
    if (!currentTask) {
      console.log('[logger] нет активной задачи — beginTask() не вызывался.');
      return null;
    }
    currentTask.endedAt = new Date().toISOString();
    currentTask.endActionSeq = macroLog.length;
    currentTask.result = sanitizeObject(result || {}, 0, config.maxText);
    pushRaw({ kind: 'task', type: 'end', task: currentTask });
    tasksLog.push(currentTask);
    const finished = currentTask;
    currentTask = null;
    saveBackup(true);
    console.log(`%c[logger] task завершён`, 'color:cyan', finished.result);
    return finished;
  }

  // [v7.1][18] inferredExpected угадывает по факту последствий, но человек в ручном
  // прогоне знает больше ("здесь должно быть defer"). __logger.expect(...) и
  // __logger.note(...) привязывают человеческое утверждение к текущему/последнему действию.
  function expectFact(payload) {
    const entry = { ...sanitizeObject(payload, 0, config.maxLargeText), at: new Date().toISOString() };
    const a = currentActionForCorrelation() || lastInteractive();
    if (a) {
      a.humanExpected = a.humanExpected || [];
      a.humanExpected.push(entry);
      saveBackup(true);
    }
    pushRaw({ kind: 'expect', type: 'expect', actionId: a ? a.id : null, expect: entry });
    console.log('%c[logger] expect зафиксирован', 'color:lime', entry);
    return entry;
  }

  function note(text) {
    const entry = { text: trunc(String(text), 2000), at: new Date().toISOString() };
    const a = currentActionForCorrelation() || lastInteractive();
    if (a) {
      a.humanNotes = a.humanNotes || [];
      a.humanNotes.push(entry);
      saveBackup(true);
    }
    pushRaw({ kind: 'note', type: 'note', actionId: a ? a.id : null, note: entry });
    console.log('%c[logger] заметка сохранена', 'color:lime', entry.text);
    return entry;
  }

  function destroy() {
    flushAllInputs();
    saveBackup(true);
    recording = false;

    disconnectMutationObservers();
    effectObservers.forEach(o => { try { o.disconnect(); } catch (_) {} });
    effectObservers = [];
    iframeObservers.forEach(o => { try { o.disconnect(); } catch (_) {} });
    iframeObservers = [];

    ac.abort(); // [3] слушатели снимаются по-настоящему

    // [v7.1][13] fetch/XHR теперь патчатся по каждому окну (top + same-origin iframes) —
    // восстанавливаем нативные реализации для всех, а не только для window.
    for (const w of patchedWindowsList) {
      const n = nativeByWindow.get(w);
      if (!n) continue;
      try { if (n.fetch) w.fetch = n.fetch; } catch (_) {}
      try { if (n.xhrOpen) w.XMLHttpRequest.prototype.open = n.xhrOpen; } catch (_) {}
      try { if (n.xhrSend) w.XMLHttpRequest.prototype.send = n.xhrSend; } catch (_) {}
      try { if (n.xhrSetHeader) w.XMLHttpRequest.prototype.setRequestHeader = n.xhrSetHeader; } catch (_) {}
      try { if (n.webSocket) w.WebSocket = n.webSocket; } catch (_) {}
      try { if (n.eventSource) w.EventSource = n.eventSource; } catch (_) {}
      try { if (n.sendBeacon) w.navigator.sendBeacon = n.sendBeacon; } catch (_) {}
    }
    try { window.open = native.open; } catch (_) {}
    try { window.alert = native.alert; } catch (_) {}
    try { window.confirm = native.confirm; } catch (_) {}
    try { window.prompt = native.prompt; } catch (_) {}
    try { console.error = native.consoleError; } catch (_) {}
    try { console.warn = native.consoleWarn; } catch (_) {}
    try { console.log = native.consoleLog; } catch (_) {}
    try { console.info = native.consoleInfo; } catch (_) {}
    try { history.pushState = native.pushState; } catch (_) {}
    try { history.replaceState = native.replaceState; } catch (_) {}
    try { HTMLAnchorElement.prototype.click = native.anchorClick; } catch (_) {}
    try { if (native.createObjectURL) URL.createObjectURL = native.createObjectURL; } catch (_) {}

    if (panel) panel.remove();
    panel = null;
    delete window.__logger;
    console.log('[logger] полностью выгружен.');
  }

  // [v7.1][12] нужен для запуска как content script на document_start (см. manifest.json) —
  // патчить fetch/XHR/history/console нужно ДО того, как страница сделает первый запрос,
  // но document.body в этот момент ещё может не существовать, а buildPanel() пишет в body.
  function whenBodyReady(fn) {
    if (document.body) { fn(); return; }
    const obs = new MutationObserver(() => {
      if (document.body) { obs.disconnect(); fn(); }
    });
    try { obs.observe(document.documentElement, { childList: true }); } catch (_) { fn(); }
  }

  whenBodyReady(buildPanel);
  whenBodyReady(() => setTimeout(runIdAttributeDiscovery, 1200)); // даём странице отрендериться

  window.__logger = {
    version: VERSION,
    config,
    session,
    rawLog,
    macroLog,
    screenLog,
    networkLog,
    streamLog,
    log: rawLog,
    start,
    pause,
    stop,
    clear,
    mark,
    beginTask,
    endTask,
    tasksLog,
    setMacroName,
    expect: expectFact,
    note,
    registerProbe(name, fn) {
      if (typeof fn !== 'function') throw new Error('probe must be a function');
      probes[name] = fn;
      console.log(`[logger] probe зарегистрирован: ${name}`);
    },
    unregisterProbe(name) {
      delete probes[name];
    },
    stats,
    setMode,
    setRoot(selector) {
      config.mutationRoot = selector || null;
      attachMutationObservers();
      console.log(`[logger] mutation root: ${selector || 'document.documentElement'}`);
    },
    // [v7.2] тела запросов и без этого сохраняются для всего, что коррелирует с действием,
    // или для ошибок — это только ручной override сверху общего правила (фоновые запросы,
    // не привязанные ни к одному клику, но всё равно важные конкретно для вашего сайта)
    captureBodiesFor(pattern) {
      if (!pattern) return;
      if (!config.bodyCaptureAllowlist.includes(pattern)) config.bodyCaptureAllowlist.push(pattern);
      console.log(`[logger] тело запроса/ответа теперь всегда сохраняется для URL, содержащих: ${pattern}`);
    },
    rediscoverIdAttributes: runIdAttributeDiscovery,
    setTestIdAttribute(name) {
      if (!name) return;
      config.testIdAttribute = name;
      config.testIdAttributeManuallySet = true;
      console.log(`[logger] testIdAttribute вручную установлен: ${name}`);
    },
    export: exportBundle,
    exportAI: exportBundle,
    exportMacro,
    exportPlan,
    // [v7.3] exportHar — сетевая часть в стандартном формате (DevTools/Postman/Insomnia);
    // exportApi — только инвентарь вызовов и способ авторизации, без таймлайна.
    exportHar,
    exportApi,
    exportPlaywright,
    generatePlaywright,
    copyLast,
    save: () => saveBackup(true),
    hidePanel() { if (panel) panel.style.display = 'none'; },
    showPanel() { if (panel) panel.style.display = 'block'; },
    destroy
  };

  try {
    const initialScreen = screenSnapshot(document, ctxFor(document));
    if (initialScreen) recordScreen('session_start', null, ctxFor(document), initialScreen);
  } catch (_) {}

  pushRaw({
    kind: 'meta',
    type: restored ? 'logger_resumed' : 'logger_started',
    version: VERSION,
    pageTitle: document.title,
    env: session.env,
    restoredRawEvents: restored ? rawLog.length : 0,
    restoredMacroActions: restored ? macroLog.length : 0
  });

  // [v7.1][10] localStorage-восстановление выше синхронное и содержит только macroLog —
  // полный rawLog/screenLog/networkLog догружаются из IndexedDB асинхронно и досливаются
  // в те же массивы, на которые уже смотрят window.__actionLog/__screenLog/__networkLog.
  if (restored && typeof indexedDB !== 'undefined') {
    idbGet().then(payload => {
      if (!payload || !payload.session || payload.session.id !== session.id) return;
      let hydrated = 0;
      if (Array.isArray(payload.rawLog) && payload.rawLog.length > rawLog.length) {
        rawLog.length = 0; rawLog.push(...payload.rawLog);
        rawSeq = rawLog.length ? Math.max(...rawLog.map(x => Number(x.seq) || 0)) + 1 : rawSeq;
        hydrated++;
      }
      if (Array.isArray(payload.screenLog) && payload.screenLog.length > screenLog.length) {
        screenLog.length = 0; screenLog.push(...payload.screenLog);
        hydrated++;
      }
      if (Array.isArray(payload.networkLog) && payload.networkLog.length > networkLog.length) {
        networkLog.length = 0; networkLog.push(...payload.networkLog);
        hydrated++;
      }
      if (Array.isArray(payload.streamLog) && payload.streamLog.length > streamLog.length) {
        streamLog.length = 0; streamLog.push(...payload.streamLog);
        hydrated++;
      }
      if (hydrated) {
        schedulePanelUpdate();
        console.log('%c[logger] полный бэкап (raw/screens/network) восстановлен из IndexedDB.', 'color:lime');
      }
    }).catch(() => {});
  }

  console.log('%c[logger v7] запись идёт — AI-first Macro. Пройдите сценарий по порядку и нажмите «Стоп + экспорт».', 'color:cyan;font-weight:bold');
  console.log('[logger] debug: __logger.setMode("debug") | стоп: Ctrl+Shift+S | экспорт: __logger.export()');
})();
