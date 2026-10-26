// SMM — владелец записи. Сессия живёт здесь, а не в странице: переходы между сайтами,
// перезагрузки, новые вкладки и перезапуск service worker её не обрывают. Сам видит то, что
// странице не видно (вкладки, переходы, все запросы, загрузки, скриншоты); подробности каждого
// документа (клики, ввод, тела fetch/XHR, WebSocket) приходят от action-logger-v7.js.
importScripts('db.js');

const SCRIPTS = [
  { id: 'smm-page', js: ['ext/page-bridge.js', 'action-logger-v7.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true },
  { id: 'smm-relay', js: ['ext/relay.js'], matches: ['<all_urls>'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true },
];
const SHOT_GAP_MS = 700; // captureVisibleTab allows 2 calls a second
const MAX_SHOTS = 2000;
const MAX_HTML = 3_000_000;

let recCache;
const getRec = async () => {
  if (recCache === undefined) recCache = (await chrome.storage.local.get('rec')).rec || null;
  return recCache;
};
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.rec) recCache = c.rec.newValue || null; });

// ── timeline: events are buffered for half a second and written in one transaction ──
let buf = [];
let flushTimer = 0;
async function flush() {
  flushTimer = 0;
  const rows = buf.splice(0);
  if (rows.length) await SMMDB.add('events', rows).catch((e) => console.warn('[smm] events not saved', e));
}
async function log(kind, data) {
  const t = Date.now();
  const rec = await getRec();
  if (!rec?.active) return;
  buf.push({ sid: rec.sid, t, kind, ...data });
  if (!flushTimer) flushTimer = setTimeout(flush, 500);
}

// ── screenshots of the visible tab: on every action, page load, tab switch and comment ──
const shotState = new Map(); // windowId -> { last, timer, reason, tabId }
let shotCount = 0;
async function shoot(tabId, reason) {
  const rec = await getRec();
  if (!rec?.active || tabId == null || tabId < 0) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.active || !/^(https?|file):/.test(tab.url || '')) return;
  const st = shotState.get(tab.windowId) || { last: 0, timer: 0 };
  shotState.set(tab.windowId, st);
  st.reason = reason; st.tabId = tabId;
  const wait = st.last + SHOT_GAP_MS - Date.now();
  if (wait > 0) { if (!st.timer) st.timer = setTimeout(() => { st.timer = 0; take(tab.windowId); }, wait); return; }
  await take(tab.windowId);
}
async function take(windowId) {
  const st = shotState.get(windowId);
  const rec = await getRec();
  if (!st || !rec?.active || shotCount >= MAX_SHOTS) return;
  st.last = Date.now();
  try {
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
    const blob = await (await fetch(url)).blob();
    const tab = await chrome.tabs.get(st.tabId).catch(() => null);
    shotCount++;
    await SMMDB.add('shots', { sid: rec.sid, t: st.last, tabId: st.tabId, url: tab?.url || null, title: tab?.title || null, reason: st.reason, blob });
  } catch (_) { /* a page the browser does not let us capture */ }
}

// ── recording on / off ──
async function inject(tab) {
  if (!/^(https?|file):/.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['ext/page-bridge.js', 'action-logger-v7.js'], world: 'MAIN', injectImmediately: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['ext/relay.js'], injectImmediately: true });
  } catch (_) { /* a page we may not script */ }
}

async function start() {
  const now = new Date();
  const sid = `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
  await SMMDB.dropOthers(sid);
  recCache = { active: true, sid, startedAt: now.getTime() };
  await chrome.storage.local.set({ rec: recCache });
  shotCount = 0;
  await chrome.scripting.unregisterContentScripts({ ids: SCRIPTS.map((s) => s.id) }).catch(() => {});
  await chrome.scripting.registerContentScripts(SCRIPTS);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    log('tab', { type: 'open_at_start', tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, active: tab.active });
    await inject(tab);
  }
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ text: 'REC' });
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active) shoot(active.id, 'start');
}

async function saveDoc(rec, m, sender, final) {
  if (!m?.data || typeof m.docId !== 'string') return;
  await SMMDB.put('docs', {
    key: `${rec.sid}|${m.docId}`, sid: rec.sid, docId: m.docId, tabId: sender.tab?.id ?? null, startedAt: m.startedAt,
    url: m.url, title: m.title, updatedAt: Date.now(), final: !!final,
    bundle: m.data.bundle, har: m.data.har, actions: m.data.actions, requests: m.data.requests,
  });
}

async function stop() {
  const rec = await getRec();
  if (!rec?.active) return status();
  // the last word of every open page: its full bundle, stored before the archive is built
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    const m = await chrome.tabs.sendMessage(tab.id, { smm: 'cmd', cmd: 'snapshot' }, { frameId: 0 }).catch(() => null);
    if (m?.data) await saveDoc(rec, m, { tab }, true).catch(() => {});
  }));
  await log('session', { type: 'stop' });
  await flush();
  recCache = { ...rec, active: false, stoppedAt: Date.now() };
  await chrome.storage.local.set({ rec: recCache });
  await chrome.scripting.unregisterContentScripts({ ids: SCRIPTS.map((s) => s.id) }).catch(() => {});
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { smm: 'cmd', cmd: 'detach' }).catch(() => {});
  chrome.action.setBadgeText({ text: '' });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`ext/export.html?sid=${encodeURIComponent(rec.sid)}`) });
  return status();
}

async function comment(text) {
  const t = String(text || '').trim().slice(0, 4000);
  const rec = await getRec();
  if (!t || !rec?.active) return status();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await log('comment', { text: t, tabId: tab?.id ?? null, url: tab?.url || null, title: tab?.title || null });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { smm: 'cmd', cmd: 'note', text: t }, { frameId: 0 }).catch(() => {});
    shoot(tab.id, 'comment');
  }
  return status();
}

async function status() {
  const rec = await getRec();
  if (!rec) return { active: false };
  await flush();
  const [events, shots, docs] = await Promise.all(['events', 'shots', 'docs'].map((s) => SMMDB.count(s, rec.sid).catch(() => 0)));
  // shortcut: counts by reading the whole timeline; fine for hours of work, switch to running counters if the popup gets slow
  const all = await SMMDB.all('events', rec.sid).catch(() => []);
  const count = (k) => all.filter((e) => e.kind === k).length;
  return { ...rec, events, shots, docs, actions: count('action'), requests: count('request'), pages: count('doc'), comments: count('comment') };
}

// ── messages: control from the popup, data from pages (relay.js) ──
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return undefined;
  if (msg.smm === 'page' && sender.tab) { onPage(msg, sender); return undefined; }
  if (sender.tab) return undefined; // control only from the extension's own pages
  const run = { status, start: () => start().then(status), stop, comment: () => comment(msg.text) }[msg.smm];
  if (!run) return undefined;
  run().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});

async function onPage(m, sender) {
  const rec = await getRec();
  if (!rec?.active) return;
  const base = { tabId: sender.tab.id, docId: String(m.docId || '').slice(0, 40), url: String(m.url || sender.url || '').slice(0, 4000) };
  switch (m.kind) {
    case 'doc':
      log('doc', { ...base, title: m.title, referrer: m.referrer, docStartedAt: m.startedAt });
      break;
    case 'action':
      log('action', { ...base, action: m.action });
      shoot(sender.tab.id, `action-${String(m.action?.action || 'step').replace(/[^a-z_-]/gi, '')}`);
      break;
    case 'dom':
      await SMMDB.add('doms', {
        sid: rec.sid, t: Date.now(), ...base, title: m.title, reason: m.reason,
        html: String(m.html || '').slice(0, MAX_HTML), truncated: !!m.truncated, surface: m.surface || null,
      }).catch(() => {});
      break;
    case 'snapshot':
    case 'final':
      await saveDoc(rec, m, sender, m.kind === 'final').catch(() => {});
      break;
    default:
  }
}

// ── what only the browser sees: tabs, navigation, every request, downloads ──
chrome.tabs.onCreated.addListener((tab) => log('tab', { type: 'created', tabId: tab.id, openerTabId: tab.openerTabId ?? null, windowId: tab.windowId, url: tab.pendingUrl || tab.url || null }));
chrome.tabs.onRemoved.addListener((tabId) => log('tab', { type: 'closed', tabId }));
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => { log('tab', { type: 'activated', tabId, windowId }); shoot(tabId, 'tab'); });
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  log('nav', { type: 'committed', tabId: d.tabId, url: d.url, transition: d.transitionType, qualifiers: d.transitionQualifiers });
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) log('nav', { type: 'history', tabId: d.tabId, url: d.url, transition: d.transitionType }); });
chrome.webNavigation.onReferenceFragmentUpdated.addListener((d) => { if (d.frameId === 0) log('nav', { type: 'fragment', tabId: d.tabId, url: d.url }); });
chrome.webNavigation.onCompleted.addListener((d) => { if (d.frameId === 0) { log('nav', { type: 'loaded', tabId: d.tabId, url: d.url }); shoot(d.tabId, 'load'); } });
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => log('nav', { type: 'new_target', tabId: d.tabId, sourceTabId: d.sourceTabId, url: d.url }));

const reqStart = new Map(); // requestId -> start time
const REQ = { urls: ['<all_urls>'] };
chrome.webRequest.onBeforeRequest.addListener((d) => { reqStart.set(d.requestId, d.timeStamp); }, REQ);
function request(d, extra) {
  const started = reqStart.get(d.requestId);
  reqStart.delete(d.requestId);
  if (d.url.startsWith(chrome.runtime.getURL(''))) return;
  log('request', {
    tabId: d.tabId, frameId: d.frameId, type: d.type, method: d.method, url: d.url.slice(0, 4000), status: d.statusCode ?? null,
    ms: started ? Math.round(d.timeStamp - started) : null, initiator: d.initiator || null, fromCache: !!d.fromCache, ip: d.ip || null, ...extra,
  });
}
chrome.webRequest.onCompleted.addListener((d) => request(d, {}), REQ);
chrome.webRequest.onErrorOccurred.addListener((d) => request(d, { error: d.error }), REQ);
chrome.webRequest.onBeforeRedirect.addListener((d) => log('request', { tabId: d.tabId, type: d.type, method: d.method, url: d.url.slice(0, 4000), status: d.statusCode, redirectTo: d.redirectUrl }), REQ);

chrome.downloads.onCreated.addListener((d) => log('download', { type: 'started', id: d.id, url: d.finalUrl || d.url, mime: d.mime, filename: d.filename || null, referrer: d.referrer || null }));
chrome.downloads.onChanged.addListener((d) => { if (d.state?.current === 'complete' || d.filename) log('download', { type: d.state?.current || 'renamed', id: d.id, filename: d.filename?.current || null }); });

// the badge survives a service worker restart
getRec().then((rec) => chrome.action.setBadgeText({ text: rec?.active ? 'REC' : '' }));
