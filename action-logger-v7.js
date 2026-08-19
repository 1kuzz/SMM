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
 * Команды:
 *   __logger.start() / pause() / stop() / destroy()
 *   __logger.stats() / clear()
 *   __logger.export()               // единый v7 AI bundle
 *   __logger.exportPlaywright()     // опционально, если нужен отдельный .spec.js
 *   __logger.generatePlaywright()
 *   __logger.copyLast()
 */
(function () {
  'use strict';

  const VERSION = '7.0.0';
  const STORAGE_KEY = '__actionLoggerBackup_v7';

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
    maxRawEvents: 12000,
    maxMacroActions: 3000,
    maxScreenSnapshots: 3500,
    maxNetworkEntries: 6000,

    // [7] бэкап по времени, а не по количеству событий
    autoSaveMs: 2500,
    backupRawTail: 1500,
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

    trackLowLevelMouse: false,
    trackAllKeyboard: false,
    trackFocus: false,
    trackScroll: true,
    trackMouseMove: false,
    trackWheel: false,
    trackDomMutations: false,
    trackNetwork: true,
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

    // [9][10] генерация теста
    playwrightTextMethod: 'fill', // fill | pressSequentially
    playwrightLocators: 'semantic', // semantic | css
    testIdAttribute: 'data-testid',
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
    unstableTokenPattern: /(^\d{4,}$)|([a-f0-9]{10,})|([A-Za-z0-9_-]{18,})|(^css-)|(^sc-)|(^jss)|(^Mui[A-Z].*-\d+$)|(^_[A-Za-z0-9]{7,}_)/i
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

  function sanitizeValue(el, value) {
    if (isSensitiveElement(el)) return '[REDACTED]';
    return trunc(value);
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

  function sanitizeObject(value, depth = 0) {
    if (depth > 5) return '[MAX_DEPTH]';
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return trunc(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitizeObject(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value).slice(0, 100)) {
        out[k] = config.sensitiveNamePattern.test(k) ? '[REDACTED]' : sanitizeObject(v, depth + 1);
      }
      return out;
    }
    return trunc(String(value));
  }

  function sanitizeBody(body) {
    if (body == null) return null;
    if (!config.captureNetworkBodies) return '[BODY_NOT_CAPTURED]';
    try {
      if (body instanceof URLSearchParams) {
        const out = {};
        for (const [k, v] of body.entries()) out[k] = config.sensitiveNamePattern.test(k) ? '[REDACTED]' : trunc(v);
        return out;
      }
      if (body instanceof FormData) {
        const out = {};
        for (const [k, v] of body.entries()) {
          if (config.sensitiveNamePattern.test(k)) out[k] = '[REDACTED]';
          else if (v instanceof File) out[k] = { file: v.name, size: v.size, type: v.type };
          else out[k] = trunc(v);
        }
        return out;
      }
      if (typeof body === 'string') {
        try {
          return sanitizeObject(JSON.parse(body));
        } catch (_) {
          return trunc(body);
        }
      }
      return sanitizeObject(body);
    } catch (_) {
      return '[UNREADABLE_BODY]';
    }
  }

  function stableToken(token) {
    return !!token && !config.unstableTokenPattern.test(String(token));
  }

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

    for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
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

  function compactElement(el) {
    if (!isElement(el)) return null;
    const loc = locatorInfo(el);
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

  function screenSnapshot(doc = document, ctx = null) {
    if (!config.captureScreenSnapshots || !doc) return null;
    const win = doc.defaultView || window;
    const c = ctx || ctxFor(doc);
    const headings = visibleElements(doc, 'h1,h2,h3,[role="heading"]')
      .map(el => collapse(el.innerText || el.textContent || '', 220)).filter(Boolean);
    const dialogs = visibleElements(doc, 'dialog,[role="dialog"],[aria-modal="true"]', 15).map(compactElement).filter(Boolean);
    const alerts = visibleElements(doc, '[role="alert"],[role="status"],[aria-live]', 20).map(compactElement).filter(Boolean);
    const buttons = visibleElements(doc, 'button,[role="button"],input[type="button"],input[type="submit"]')
      .map(compactElement).filter(Boolean);
    const inputs = visibleElements(doc, 'input,textarea,select,[contenteditable="true"]')
      .map(el => {
        const x = compactElement(el);
        if (!x) return null;
        x.value = 'value' in el ? sanitizeValue(el, el.value) : sanitizeValue(el, el.textContent || '');
        if (el.tagName === 'SELECT') x.selectedText = uniqueStrings(Array.from(el.selectedOptions || []).map(o => o.text), 10);
        return x;
      }).filter(Boolean);
    const tables = visibleElements(doc, 'table,[role="grid"],[role="table"]', 12).map(el => {
      let headers = [];
      let rowCount = null;
      try {
        headers = uniqueStrings(Array.from(el.querySelectorAll('th,[role="columnheader"]')).map(x => x.innerText || x.textContent), 20);
        rowCount = el.querySelectorAll('tbody tr,[role="row"]').length;
      } catch (_) {}
      return { locator: locatorInfo(el), headers, rowCount, textPreview: collapse(el.innerText || el.textContent || '', 500) };
    });
    let activeElement = null;
    try { activeElement = compactElement(doc.activeElement); } catch (_) {}
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
      capturedAt: new Date().toISOString()
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
    return {
      urlChanged: before.url !== after.url ? { from: before.url, to: after.url } : null,
      titleChanged: before.title !== after.title ? { from: before.title, to: after.title } : null,
      fingerprintChanged: before.fingerprint !== after.fingerprint,
      headings: diffStrings(before.headings, after.headings),
      dialogs: diffObjects(before.dialogs, after.dialogs),
      alerts: diffObjects(before.alerts, after.alerts),
      buttons: diffObjects(before.buttons, after.buttons)
    };
  }

  function meaningfulMutationNode(node) {
    if (!isElement(node) || isIgnoredEl(node)) return null;
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
      if (parsed.version !== VERSION) {
        native.consoleWarn.call(console, `[logger] бэкап версии ${parsed.version} несовместим с ${VERSION}, начинаю новую сессию.`);
        return null;
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
    env: environment()
  };
  if (!session.env) session.env = environment();

  const rawLog = restored && Array.isArray(restored.rawLog) ? restored.rawLog : [];
  const macroLog = restored && Array.isArray(restored.macroLog) ? restored.macroLog : [];
  const screenLog = restored && Array.isArray(restored.screenLog) ? restored.screenLog : [];
  const networkLog = restored && Array.isArray(restored.networkLog) ? restored.networkLog : [];

  window.__actionLog = rawLog;
  window.__macroLog = macroLog;
  window.__screenLog = screenLog;
  window.__networkLog = networkLog;

  let recording = true;
  let rawSeq = rawLog.length ? Math.max(...rawLog.map(x => Number(x.seq) || 0)) + 1 : 0;
  let macroSeq = macroLog.length ? Math.max(...macroLog.map(x => Number(x.seq) || 0)) + 1 : 0;
  let lastKnownUrl = restored && restored.lastUrl ? restored.lastUrl : location.href;
  let lastTitle = document.title;
  let internalDepth = 0;
  let pageSeq = restored && restored.pageSeq ? restored.pageSeq : 1;
  let requestSeq = restored && restored.requestSeq ? restored.requestSeq : 0;
  let currentAction = null;
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

  // ----------------------------------------------- [7] бэкап c деградацией

  let saveTimer = null;
  let backupMode = 'full'; // full | macro-only | off

  function backupPayload() {
    const base = {
      version: VERSION,
      session,
      lastUrl: location.href,
      savedAt: new Date().toISOString(),
      macroLog,
      screenLog: screenLog.slice(-300),
      networkLog: networkLog.slice(-500),
      pageSeq,
      requestSeq
    };
    if (backupMode === 'full') {
      base.rawLog = rawLog.length > config.backupRawTail ? rawLog.slice(-config.backupRawTail) : rawLog;
      base.rawTruncated = rawLog.length > config.backupRawTail;
    }
    return base;
  }

  function writeBackup() {
    if (backupMode === 'off') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backupPayload()));
    } catch (e) {
      if (backupMode === 'full') {
        backupMode = 'macro-only';
        native.consoleWarn.call(console, '[logger] квота localStorage исчерпана — в бэкап пишется только macroLog.');
        writeBackup();
        return;
      }
      backupMode = 'off';
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      native.consoleWarn.call(console, '[logger] бэкап отключён (localStorage недоступен). Экспортируйте лог вручную.');
    }
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
    }
    for (const n of (effects.network || []).filter(x => x.phase === 'end' && x.status >= 400).slice(0, 5)) add('network_error_observed', { method: n.method, url: n.requestUrl, status: n.status }, 'high');
    const seen = new Set();
    return out.filter(x => {
      const k = simpleHash(JSON.stringify(x));
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
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
    if (!action.effects) action.effects = { network: [], ui: [], dialogs: [], downloads: [], errors: [], navigation: null, popup: null };
    return action.effects;
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
    action.effects = action.effects || { network: [], ui: [], dialogs: [], downloads: [], errors: [], navigation: null, popup: null };
    const ctx = action.__ctx || ctxFor(action.__doc || document);
    const doc = action.__doc || document;
    action.before = screenSnapshot(doc, ctx);
    if (action.before) recordScreen('before', action, ctx, action.before);
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

  // -------------------------------------------------------------- listeners

  const docContexts = new WeakMap();
  const attachedDocs = new WeakSet();
  const pendingInputs = new Map();
  let dragSource = null;
  let mutationObservers = [];
  let effectObservers = [];
  let iframeObservers = [];
  let hoverCandidate = null;

  function ctxFor(doc) {
    return docContexts.get(doc) || { label: 'top', frameChain: [], pageId: 'page-1' };
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

  function currentEditableValue(el) {
    if (el.isContentEditable) return sanitizeValue(el, el.innerText || el.textContent || '');
    return sanitizeValue(el, 'value' in el ? el.value : '');
  }

  function flushInput(el, reason = 'debounce') {
    const pending = pendingInputs.get(el);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingInputs.delete(el);

    const value = currentEditableValue(el);
    const prev = macroLog[macroLog.length - 1];

    if (prev && prev.action === 'fill' && sameLocator(prev.locator, pending.locator) && Date.now() - prev.t < 2500) {
      prev.value = value;
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
      value,
      sensitive: isSensitiveElement(el),
      reason,
      rawSeqStart: pending.rawSeqStart
    });
  }

  function scheduleInput(el, ctx) {
    const old = pendingInputs.get(el);
    if (old) clearTimeout(old.timer);
    const base = macroTarget(el, ctx);
    const timer = setTimeout(() => flushInput(el, 'debounce'), config.inputDebounceMs);
    pendingInputs.set(el, { ...base, rawSeqStart: old && Number.isInteger(old.rawSeqStart) ? old.rawSeqStart : Math.max(0, rawSeq - 1), timer });
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
    const after = screenSnapshot(el.ownerDocument || document, candidate.ctx);
    const diff = screenDiff(candidate.before, after);
    let related = false;
    try { related = !!(el.contains(clickEl) || clickEl.contains(el)); } catch (_) {}
    const changed = !!(diff && diff.fingerprintChanged);
    if (!changed && !related) return;
    const a = pushMacro({ action: 'hover', ...macroTarget(el, candidate.ctx), inferred: true, hoverEvidence: { relatedToClick: related, uiChanged: changed, diff } });
    if (a && after) { a.after = after; a.diff = diff; a.inferredExpected = deriveExpected(a); }
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
          ensureEffects(action).popup = info;
          action.inferredExpected = deriveExpected(action);
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
          el: t, ctx, at: Date.now(), before: screenSnapshot(t.ownerDocument || doc, ctx)
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
        pushMacro({ action: 'setFiles', ...macroTarget(t, ctx), files: raw.files });
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
          if (!target || isIgnoredEl(target)) continue;
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
        if (target && isIgnoredEl(target)) continue;

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

  function requestBodyOf(input, init) {
    if (init && init.body != null) return sanitizeBody(init.body);
    if (!config.captureNetworkBodies) return input && typeof input.clone === 'function' ? '[BODY_NOT_CAPTURED]' : null;
    if (input && typeof input.clone === 'function' && input.method && input.method !== 'GET') {
      return '[REQUEST_BODY_ASYNC]'; // тело Request читается только асинхронно, не блокируем запрос
    }
    return null;
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

  if (typeof native.fetch === 'function') {
    window.fetch = function (input, init) {
      const rawUrl = requestUrlOf(input);
      if (!config.trackNetwork || isIgnoredUrl(rawUrl)) return native.fetch.apply(this, arguments);

      const url = sanitizeUrl(rawUrl);
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const start = Date.now();
      const requestId = `r-${++requestSeq}`;
      const correlated = currentActionForCorrelation(config.networkCorrelationMs);
      const actionId = correlated ? correlated.id : null;
      const body = requestBodyOf(input, init);

      pushRaw({ kind: 'network', type: 'fetch_start', requestId, actionId, requestUrl: url, method, body });
      pushNetwork({ phase: 'start', transport: 'fetch', requestId, requestUrl: url, method, body }, actionId);

      return native.fetch.apply(this, arguments).then(res => {
        const base = {
          phase: 'end', transport: 'fetch', requestId,
          requestUrl: url, finalUrl: sanitizeUrl(res.url), method,
          status: res.status, ok: res.ok, durationMs: Date.now() - start
        };

        if (!config.captureResponseBodies) {
          pushRaw({ kind: 'network', type: 'fetch_end', actionId, ...base });
          pushNetwork(base, actionId);
          return res;
        }

        try {
          res.clone().text()
            .then(text => {
              const withBody = { ...base, responsePreview: trunc(text) };
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

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__alMeta = { method: String(method || 'GET').toUpperCase(), rawUrl: url, url: sanitizeUrl(url) };
    return native.xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__alMeta;
    if (!meta || !config.trackNetwork || isIgnoredUrl(meta.rawUrl)) return native.xhrSend.apply(this, arguments);

    meta.start = Date.now();
    meta.requestId = `r-${++requestSeq}`;
    const correlated = currentActionForCorrelation(config.networkCorrelationMs);
    meta.actionId = correlated ? correlated.id : null;
    const requestBody = sanitizeBody(body);
    pushRaw({ kind: 'network', type: 'xhr_start', requestId: meta.requestId, actionId: meta.actionId, requestUrl: meta.url, method: meta.method, body: requestBody });
    pushNetwork({ phase: 'start', transport: 'xhr', requestId: meta.requestId, requestUrl: meta.url, method: meta.method, body: requestBody }, meta.actionId);

    this.addEventListener('loadend', () => {
      const base = {
        phase: 'end', transport: 'xhr', requestId: meta.requestId,
        requestUrl: meta.url, finalUrl: sanitizeUrl(this.responseURL), method: meta.method,
        status: this.status, ok: this.status >= 200 && this.status < 400, durationMs: Date.now() - meta.start
      };
      if (config.captureResponseBodies) {
        try { if (!this.responseType || this.responseType === 'text') base.responsePreview = trunc(this.responseText); } catch (_) {}
      }
      pushRaw({ kind: 'network', type: 'xhr_end', actionId: meta.actionId, ...base });
      pushNetwork(base, meta.actionId);
    }, { once: true });

    return native.xhrSend.apply(this, arguments);
  };

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
      if (!['fill','select','check','uncheck','setFiles'].includes(a.action)) continue;
      let value = a.value;
      if (a.action === 'check' || a.action === 'uncheck') value = !!a.checked;
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
      if (a.resultPopup && a.resultPopup.attachable === false) warnings.push({ type: 'popup_not_instrumented', actionId: a.id, popup: a.resultPopup, note: 'target=_blank popup cannot be automatically instrumented from a one-shot DevTools page script' });
    }
    return warnings;
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
      case 'check': return `Check ${JSON.stringify(name || 'checkbox')}`;
      case 'uncheck': return `Uncheck ${JSON.stringify(name || 'checkbox')}`;
      case 'press': return `Press ${pressKey(a)} on ${JSON.stringify(name || 'active element')}`;
      case 'dragTo': return 'Drag source to destination';
      case 'setFiles': return `Set files ${(a.files || []).map(f => f.name).join(', ')}`;
      case 'navigate': return `Navigate to ${a.toUrl}`;
      default: return `${a.action} ${name}`.trim();
    }
  }

  function generateDraftSpec(actions) {
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
    for (const a of actions) {
      if (a.action === 'mark') continue;
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
    return lines.join('\n');
  }

  function finalizeAllActions() {
    flushAllInputs();
    if (actionFinalizeTimer) { clearTimeout(actionFinalizeTimer); actionFinalizeTimer = null; }
    for (const a of macroLog) if (a && !a.finalizedAt) finalizeAction(a, 'export');
    for (const a of macroLog) if (a) a.inferredExpected = deriveExpected(a);
  }

  function exportBundle(filename = `action-log-v7-${Date.now()}.json`) {
    finalizeAllActions();
    saveBackup(true);
    const actions = macroLog.map(cleanActionForExport);
    const variables = buildVariables(actions);
    const warnings = buildWarnings(actions);
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
        screenSnapshots: screenLog.length,
        networkEntries: networkLog.length,
        weakLocators: actions.filter(a => a.locatorConfidence && a.locatorConfidence.level === 'low').length,
        backupMode
      },
      aiInstructions: {
        sourceOfTruth: 'timeline order/actionId plus correlated effects; rawLog is supporting forensic detail',
        userWillDescribeIntentLater: true,
        doNotReorderStepsWithoutEvidence: true,
        useBeforeAfterAndEffectsToInferWaitsAndAssertions: true,
        secrets: 'Values marked REDACTED must be parameterized, never guessed',
        locatorRule: 'Prefer high-confidence semantic/test-id locators; low-confidence locators require repair instead of blindly using .first()',
        popupRule: 'pageId separates browser pages when observable; target=_blank may be recorded but not instrumented by a one-shot page script'
      },
      timeline: actions,
      variables,
      warnings,
      screens: screenLog,
      network: networkLog,
      rawLog,
      generated: {
        playwright: generatePlaywright(),
        technicalSpecMarkdown: config.generateDraftSpec ? generateDraftSpec(actions) : null
      }
    };
    deliver(filename, JSON.stringify(payload, null, 2));
    console.log(`[logger] AI bundle: ${rawLog.length} raw / ${actions.length} actions / ${networkLog.length} network / ${screenLog.length} screens`);
    return payload;
  }

  function exportMacro(filename = `macro-log-v7-${Date.now()}.json`) {
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
        if (sel) actionExpr = `${sel}.selectOption(${Array.isArray(a.value) ? jsValue(a.value) : jsString(a.value)})`;
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

  function exportPlaywright(filename = `macro-playwright-v7-${Date.now()}.spec.js`) {
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
    console.log(`[logger] raw=${rawLog.length}, actions=${macroLog.length}, screens=${screenLog.length}, network=${networkLog.length}, weakLocators=${weak}, backup=${backupMode}, session=${session.id}`);
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
    actionsById.clear();
    currentAction = null;
    rawSeq = 0;
    macroSeq = 0;
    requestSeq = 0;
    pageSeq = 1;
    hoverCandidate = null;
    backupMode = 'full';
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    updatePanel();
    console.log('[logger] очищено');
  }

  function mark(label) {
    const text = trunc(String(label), 200);
    pushRaw({ kind: 'mark', type: 'mark', label: text });
    pushMacro({ action: 'mark', label: text, frameChain: [] });
    console.log(`%c[logger] метка: ${text}`, 'color:magenta');
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

    try { window.fetch = native.fetch; } catch (_) {}
    try { window.open = native.open; } catch (_) {}
    try { window.alert = native.alert; } catch (_) {}
    try { window.confirm = native.confirm; } catch (_) {}
    try { window.prompt = native.prompt; } catch (_) {}
    try { console.error = native.consoleError; } catch (_) {}
    try { console.warn = native.consoleWarn; } catch (_) {}
    try { history.pushState = native.pushState; } catch (_) {}
    try { history.replaceState = native.replaceState; } catch (_) {}
    try { XMLHttpRequest.prototype.open = native.xhrOpen; } catch (_) {}
    try { XMLHttpRequest.prototype.send = native.xhrSend; } catch (_) {}
    try { HTMLAnchorElement.prototype.click = native.anchorClick; } catch (_) {}
    try { if (native.createObjectURL) URL.createObjectURL = native.createObjectURL; } catch (_) {}

    if (panel) panel.remove();
    panel = null;
    delete window.__logger;
    console.log('[logger] полностью выгружен.');
  }

  buildPanel();

  window.__logger = {
    version: VERSION,
    config,
    session,
    rawLog,
    macroLog,
    screenLog,
    networkLog,
    log: rawLog,
    start,
    pause,
    stop,
    clear,
    mark,
    stats,
    setMode,
    setRoot(selector) {
      config.mutationRoot = selector || null;
      attachMutationObservers();
      console.log(`[logger] mutation root: ${selector || 'document.documentElement'}`);
    },
    export: exportBundle,
    exportAI: exportBundle,
    exportMacro,
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

  console.log('%c[logger v7] запись идёт — AI-first Macro. Пройдите сценарий по порядку и нажмите «Стоп + экспорт».', 'color:cyan;font-weight:bold');
  console.log('[logger] debug: __logger.setMode("debug") | стоп: Ctrl+Shift+S | экспорт: __logger.export()');
})();
