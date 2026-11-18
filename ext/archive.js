// SMM — из сырых журналов записи собирается список файлов архива. Чистая функция без DOM и
// chrome.*: её проверяет test/archive.test.mjs в node.
const SMMArchive = (() => {
  const pad = (n, w = 3) => String(n).padStart(w, '0');
  const slug = (url) => {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`.toLowerCase().replace(/[^a-z0-9а-яё.]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
    } catch (_) { return 'page'; }
  };
  const clock = (t) => new Date(t).toISOString().slice(11, 19).replace(/:/g, '');
  const parse = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };
  const json = (v) => JSON.stringify(v, null, 1);

  /** Requests worth seeing in the timeline: page loads, anything that changes state, failures. The rest is in network/requests.json. */
  const notable = (e) => e.type === 'main_frame' || e.type === 'sub_frame' || (e.method && e.method !== 'GET' && e.method !== 'OPTIONS') || e.error || e.status >= 400 || e.redirectTo;

  function build({ rec, events, shots, doms, docs }) {
    const files = [];
    const t0 = rec.startedAt;
    const rel = (t) => { const s = Math.max(0, Math.round((t - t0) / 1000)); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const byT = (a, b) => a.t - b.t;

    // pages: every document the recording saw, in the order they opened
    const pages = new Map();
    for (const e of events.filter((x) => x.kind === 'doc').sort(byT)) {
      if (!pages.has(e.docId)) pages.set(e.docId, { docId: e.docId, tabId: e.tabId, t: e.docStartedAt || e.t, url: e.url, title: e.title, referrer: e.referrer });
    }
    for (const d of docs) if (!pages.has(d.docId)) pages.set(d.docId, { docId: d.docId, tabId: d.tabId, t: d.startedAt || d.updatedAt, url: d.url, title: d.title });
    const ordered = [...pages.values()].sort(byT);
    ordered.forEach((p, i) => { p.folder = `pages/${pad(i + 1)}-${slug(p.url)}`; });
    const folderOf = new Map(ordered.map((p) => [p.docId, p.folder]));

    const docById = new Map(docs.map((d) => [d.docId, d]));
    const endpoints = [];
    const har = { log: { version: '1.2', creator: { name: 'smm', version: rec.version || '' }, pages: [], entries: [] } };
    for (const p of ordered) {
      const d = docById.get(p.docId);
      p.actions = d?.actions ?? 0;
      p.requests = d?.requests ?? 0;
      p.snapshot = d ? (d.final ? 'final' : 'periodic') : 'none';
      if (d?.bundle) {
        files.push({ name: `${p.folder}/bundle.json`, data: d.bundle });
        const b = parse(d.bundle);
        for (const ep of b?.endpoints || []) endpoints.push({ page: p.folder, ...ep });
      }
      const h = d?.har && parse(d.har);
      if (h?.log) {
        for (const pg of h.log.pages || []) har.log.pages.push({ ...pg, id: `${p.folder}:${pg.id}` });
        for (const en of h.log.entries || []) har.log.entries.push({ ...en, pageref: en.pageref ? `${p.folder}:${en.pageref}` : undefined });
      }
    }
    har.log.entries.sort((a, b) => String(a.startedDateTime).localeCompare(String(b.startedDateTime)));

    const domItems = doms.slice().sort(byT).map((d, i) => {
      const folder = folderOf.get(d.docId) || 'pages/unknown';
      const base = `${folder}/dom-${pad(i + 1)}-${d.reason || 'dom'}`;
      files.push({ name: `${base}.html`, data: d.html || '' });
      if (d.surface) files.push({ name: `${base}.surface.json`, data: json({ url: d.url, title: d.title, ...d.surface }) });
      return { t: d.t, kind: 'dom', url: d.url, title: d.title, reason: d.reason, file: `${base}.html`, surface: d.surface ? `${base}.surface.json` : null, truncated: d.truncated || undefined };
    });

    const shotItems = shots.slice().sort(byT).map((s, i) => {
      const file = `screenshots/${pad(i + 1, 4)}-${clock(s.t)}-${String(s.reason || 'shot').slice(0, 30)}.jpg`;
      files.push({ name: file, data: s.blob, store: true });
      return { t: s.t, kind: 'screenshot', tabId: s.tabId, url: s.url, title: s.title, reason: s.reason, file };
    });

    const requests = events.filter((e) => e.kind === 'request').sort(byT);
    const timeline = [
      ...events.filter((e) => e.kind !== 'request' || notable(e)).map(({ sid, ...e }) => (e.docId && folderOf.has(e.docId) ? { ...e, page: folderOf.get(e.docId) } : e)),
      ...domItems, ...shotItems,
    ].sort(byT).map((e) => ({ at: new Date(e.t).toISOString(), rel: rel(e.t), ...e }));

    // the map for explorer scripts: where the person went, and what each page offered that they did not try
    const visited = new Map();
    for (const e of events) if ((e.kind === 'nav' && (e.type === 'committed' || e.type === 'history')) || e.kind === 'doc') {
      const v = visited.get(e.url) || { url: e.url, title: e.title || null, visits: 0, firstAt: new Date(e.t).toISOString() };
      if (e.kind === 'nav') v.visits++;
      if (!v.title && e.title) v.title = e.title;
      visited.set(e.url, v);
    }
    const links = new Map();
    const forms = new Map();
    for (const d of doms) {
      for (const l of d.surface?.links || []) {
        const x = links.get(l.href) || { href: l.href, text: l.text, seenOn: [] };
        if (x.seenOn.length < 5 && !x.seenOn.includes(d.url)) x.seenOn.push(d.url);
        links.set(l.href, x);
      }
      for (const f of d.surface?.forms || []) forms.set(`${d.url}|${f.method}|${f.action}|${f.fields.map((x) => x.name).join(',')}`, { page: d.url, ...f });
    }
    const origins = {};
    for (const v of visited.values()) {
      let o; try { o = new URL(v.url).origin; } catch (_) { continue; }
      (origins[o] ||= { visited: [], notVisited: [] }).visited.push(v);
    }
    for (const l of links.values()) {
      let o; try { o = new URL(l.href).origin; } catch (_) { continue; }
      if (!origins[o] || visited.has(l.href)) continue;
      origins[o].notVisited.push(l);
    }

    const comments = events.filter((e) => e.kind === 'comment').sort(byT).map((e) => ({ at: new Date(e.t).toISOString(), rel: rel(e.t), url: e.url, text: e.text }));
    const session = {
      schema: 'smm-session-v1',
      id: rec.sid,
      startedAt: new Date(rec.startedAt).toISOString(),
      stoppedAt: rec.stoppedAt ? new Date(rec.stoppedAt).toISOString() : null,
      durationSec: rec.stoppedAt ? Math.round((rec.stoppedAt - rec.startedAt) / 1000) : null,
      counts: {
        pages: ordered.length, actions: events.filter((e) => e.kind === 'action').length, requests: requests.length,
        screenshots: shotItems.length, domSnapshots: domItems.length, comments: comments.length,
        tabs: new Set(events.map((e) => e.tabId).filter((x) => x != null)).size,
      },
      comments,
      pages: ordered.map(({ docId, tabId, t, url, title, referrer, folder, actions, requests: n, snapshot }) => ({ folder, url, title, tabId, openedAt: new Date(t).toISOString(), rel: rel(t), referrer, actions, requests: n, snapshot, docId })),
      timeline,
    };

    files.unshift(
      { name: 'README.md', data: readme(session) },
      { name: 'session.json', data: json(session) },
      { name: 'sitemap.json', data: json({ origins, forms: [...forms.values()] }) },
      { name: 'endpoints.json', data: json(endpoints) },
      { name: 'network/requests.json', data: json(requests.map(({ sid, kind, ...e }) => ({ at: new Date(e.t).toISOString(), ...e }))) },
      { name: 'network/session.har', data: JSON.stringify(har) },
    );
    return files;
  }

  function readme(s) {
    const c = s.counts;
    return `# Запись сессии ${s.id}

${s.startedAt} — ${s.stoppedAt || '…'}${s.durationSec != null ? ` (${Math.round(s.durationSec / 60)} мин)` : ''}.
Страниц: ${c.pages}, шагов: ${c.actions}, запросов: ${c.requests}, скриншотов: ${c.screenshots}, снимков DOM: ${c.domSnapshots}, комментариев: ${c.comments}, вкладок: ${c.tabs}.

Это запись того, как человек вручную работал в браузере. По ней пишется автоматизация
и скрипты-исследователи, которые доизучат платформу. Сначала прочитай этот файл целиком.

## Что где лежит

| Файл | Что внутри |
| --- | --- |
| \`session.json\` | Главный файл. \`timeline\` — всё по времени, на всех сайтах и во всех вкладках: переходы (\`nav\`), шаги (\`action\`), значимые запросы (\`request\`: загрузки страниц, всё кроме GET, ошибки, редиректы), загрузки файлов, комментарии человека, ссылки на скриншоты и снимки DOM. \`pages\` — каждый открытый документ и его папка. \`comments\` — что человек пояснял по ходу: это его намерения, главный источник смысла. |
| \`pages/NNN-…/bundle.json\` | Подробная запись одного документа (схема \`action-logger-ai-v7\`): шаги с локаторами и уверенностью, последствия шагов, тела fetch/XHR, WebSocket/SSE, \`endpoints\`, \`authProfile\`, \`openQuestions\`, черновик Playwright. Правила чтения — в его \`aiInstructions\`. |
| \`pages/NNN-…/dom-*.html\` | HTML страницы в момент загрузки, смены адреса или после шага. |
| \`pages/NNN-…/dom-*.surface.json\` | Что страница предлагала: ссылки, формы с полями, поля вне форм, кнопки, заголовки, meta. |
| \`screenshots/\` | Скриншоты видимой вкладки на каждом шаге, загрузке, переключении вкладки и комментарии. Время и причина — в имени файла и в \`timeline\`. |
| \`sitemap.json\` | По каждому сайту: где человек был (\`visited\`) и какие ссылки видел, но не открывал (\`notVisited\`), плюс все формы. Отсюда начинается обход для скриптов-исследователей. |
| \`endpoints.json\` | Инвентарь API со всех страниц вместе (METHOD + шаблон пути, формы тел, нужные заголовки, \`write\`). |
| \`network/requests.json\` | Все запросы браузера, включая те, что страница не делала сама: документы, редиректы, формы, картинки, скрипты. Только метаданные. |
| \`network/session.har\` | HAR 1.2 по fetch/XHR всех страниц (с телами, где они были). Открывается в DevTools, Postman, Insomnia. |

## Как работать с записью

1. Пройди \`session.json → timeline\` по порядку вместе со скриншотами и комментариями и опиши сценарий своими словами: что человек делал и зачем.
2. Собери все \`openQuestions\` из \`bundle.json\` и задай их одним списком, прежде чем писать код.
3. Реши, где автоматизировать через API (\`endpoints.json\`, \`write: true\`), а где через UI. Как входить — по \`authProfile\`, не угадывая.
4. Для изучения платформы: из \`sitemap.json\` (\`notVisited\`, формы) и \`surface.json\` предложи скрипты-исследователи — какие разделы обойти, какие формы и фильтры перебрать, какие эндпоинты опросить с другими параметрами — и что каждый из них должен сохранить.
5. Локаторы с \`locatorConfidence.level === 'low'\` не используй как есть; шаги с \`destructive: true\` — только с подтверждением; значения \`[REDACTED]\` — параметры, а не константы.

## Секреты

Значения паролей, токенов, cookie и секретных заголовков в записи заменены на \`[REDACTED]\` (имена сохранены).
Снимки DOM и скриншоты показывают страницу как есть, поэтому обращайся с архивом как с внутренним документом.
`;
  }

  return { build, slug };
})();
if (typeof module !== 'undefined') module.exports = SMMArchive;
