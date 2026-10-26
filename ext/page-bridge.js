// SMM — мост из мира страницы в расширение. Работает в мире страницы перед action-logger-v7.js:
// логгер видит window.__smmHost и отдаёт состояние сюда, а не в хранилище страницы.
// relay.js (изолированный мир) пересылает всё в ext/background.js. Обмен — синхронные
// CustomEvent на document со строкой в detail: строка проходит между мирами, и событие
// успевает уйти даже из pagehide, когда асинхронные сообщения уже не доставляются.
(() => {
  if (window.__smmHost) return;
  const docId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const MAX_HTML = 3_000_000;
  const MAX_DOMS = 40;
  let ready = false;
  const queue = [];
  let handlers = {};
  let doms = 0;
  let lastDomAt = 0;
  let lastUrl = location.href;
  let lastSent = '';
  const timers = [];

  const emit = (kind, data) => {
    const msg = JSON.stringify({ kind, docId, startedAt, url: location.href, title: document.title, ...data });
    if (!ready) { queue.push(msg); return; }
    document.dispatchEvent(new CustomEvent('smm:to-ext', { detail: msg }));
  };

  const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  function labelOf(el) {
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText, 120);
    return clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title'), 120) || null;
  }
  function field(el) {
    return {
      tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null,
      label: labelOf(el), required: !!el.required,
      options: el.tagName === 'SELECT' ? [...el.options].slice(0, 50).map((o) => clean(o.text, 80)) : undefined,
    };
  }
  /** What the page offers: links to follow, forms and fields to fill, buttons — the map an explorer script starts from. */
  function surface() {
    const links = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      if (links.size >= 3000) break;
      if (/^https?:/.test(a.href) && !links.has(a.href)) links.set(a.href, clean(a.innerText || a.getAttribute('aria-label'), 120));
    }
    const forms = [...document.forms].slice(0, 50).map((f) => ({
      action: f.action || null, method: (f.getAttribute('method') || 'get').toUpperCase(), id: f.id || null,
      name: f.getAttribute('name'), fields: [...f.elements].slice(0, 100).filter((el) => el.tagName !== 'FIELDSET').map(field),
    }));
    const loose = [...document.querySelectorAll('input,select,textarea,[contenteditable="true"]')].filter((el) => !el.form).slice(0, 200).map(field);
    const buttons = [...new Set([...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')]
      .slice(0, 400).map((b) => clean(b.innerText || b.value || b.getAttribute('aria-label'), 80)).filter(Boolean))];
    const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 100).map((h) => `${h.tagName.toLowerCase()}: ${clean(h.innerText, 120)}`);
    const meta = Object.fromEntries([...document.querySelectorAll('meta[name],meta[property]')].slice(0, 40)
      .map((m) => [m.getAttribute('name') || m.getAttribute('property'), clean(m.content, 200)]));
    return { links: [...links].map(([href, text]) => ({ href, text })), forms, fieldsOutsideForms: loose, buttons, headings, meta, lang: document.documentElement.lang || null };
  }
  function captureDom(reason) {
    if (doms >= MAX_DOMS || !document.documentElement) return;
    doms++; lastDomAt = Date.now();
    let html = '';
    try { html = document.documentElement.outerHTML; } catch (_) {}
    let s = null;
    try { s = surface(); } catch (_) {}
    emit('dom', { reason, html: html.slice(0, MAX_HTML), truncated: html.length > MAX_HTML, surface: s });
  }
  let domTimer = 0;
  const domSoon = (reason, ms, keepPending) => {
    if (domTimer && keepPending) return;
    clearTimeout(domTimer);
    domTimer = setTimeout(() => { domTimer = 0; captureDom(reason); }, ms);
  };

  function snapshot(force) {
    if (!handlers.snapshot) return null;
    const snap = handlers.snapshot();
    const sig = `${snap.actions}/${snap.requests}`;
    if (!force && sig === lastSent) return null;
    lastSent = sig;
    return snap;
  }

  document.addEventListener('smm:to-page', (e) => {
    let m; try { m = JSON.parse(e.detail); } catch (_) { return; }
    if (m.cmd === 'ready') {
      if (ready) return;
      ready = true;
      for (const q of queue.splice(0)) document.dispatchEvent(new CustomEvent('smm:to-ext', { detail: q }));
    } else if (m.cmd === 'snapshot') {
      try { const snap = snapshot(!!m.force); if (snap) emit('snapshot', { id: m.id || null, data: snap }); else if (m.id) emit('snapshot', { id: m.id, data: null }); } catch (_) {}
    } else if (m.cmd === 'note' && handlers.note) {
      try { handlers.note(m.text); } catch (_) {}
    } else if (m.cmd === 'detach') {
      timers.forEach(clearInterval);
      try { window.__logger && window.__logger.destroy(); } catch (_) {}
      delete window.__smmHost;
    }
  });

  window.__smmHost = {
    docId,
    listen(h) { handlers = h || {}; },
    action(a) {
      emit('action', { action: a });
      if (Date.now() - lastDomAt > 10000) domSoon('after_action', 1500, true);
    },
    final(snap) { emit('final', { data: snap }); },
  };

  emit('doc', { referrer: document.referrer || null });
  document.dispatchEvent(new CustomEvent('smm:to-ext', { detail: JSON.stringify({ kind: 'hello' }) }));
  const onLoad = () => domSoon('load', 1500);
  if (document.readyState === 'complete') onLoad(); else window.addEventListener('load', onLoad, { once: true });
  // leaving before the delayed capture ran: take it now, synchronously, or the page is lost from the archive
  window.addEventListener('pagehide', () => { if (domTimer) { clearTimeout(domTimer); domTimer = 0; captureDom('pagehide'); } });
  timers.push(setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    domSoon('url_change', 1200);
  }, 1000));
})();
