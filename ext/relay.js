// SMM — изолированный мир: пересылает события page-bridge.js в ext/background.js и команды обратно.
(() => {
  if (window.__smmRelay) return;
  window.__smmRelay = true;
  const toPage = (m) => document.dispatchEvent(new CustomEvent('smm:to-page', { detail: JSON.stringify(m) }));
  const toExt = (m) => { try { chrome.runtime.sendMessage({ ...m, smm: 'page' }).catch(() => {}); } catch (_) { /* extension reloaded */ } };
  const waiting = new Map();

  document.addEventListener('smm:to-ext', (e) => {
    let m; try { m = JSON.parse(e.detail); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'hello') { toPage({ cmd: 'ready' }); return; }
    if (m.kind === 'snapshot' && m.id && waiting.has(m.id)) {
      const reply = waiting.get(m.id); waiting.delete(m.id);
      reply(m);
      return;
    }
    if (m.kind === 'snapshot' && !m.data) return;
    toExt(m);
  });
  toPage({ cmd: 'ready' });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.smm !== 'cmd') return undefined;
    if (msg.cmd !== 'snapshot') { toPage(msg); return undefined; }
    // the snapshot goes back as the answer, so the background stores it before it builds the archive
    const id = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    waiting.set(id, sendResponse);
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); sendResponse(null); } }, 8000);
    toPage({ cmd: 'snapshot', id, force: true });
    return true;
  });

  // a tab that crashes or is killed never fires pagehide: keep a recent copy in the background
  setInterval(() => { if (document.visibilityState === 'visible') toPage({ cmd: 'snapshot' }); }, 15000);
})();
