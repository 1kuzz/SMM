// SMM — хранилище записи в IndexedDB расширения: одно на все сайты и вкладки, переживает
// перезагрузки страниц и перезапуск service worker.
//   events  таймлайн (вкладки, переходы, запросы, действия, комментарии)
//   shots   скриншоты (Blob)
//   doms    HTML и «поверхность» страницы (ссылки, формы, кнопки)
//   docs    последний снимок логгера по каждому документу (AI bundle + HAR)
const SMMDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open('smm', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of ['events', 'shots', 'doms']) db.createObjectStore(name, { autoIncrement: true }).createIndex('sid', 'sid');
      db.createObjectStore('docs', { keyPath: 'key' }).createIndex('sid', 'sid');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    add: (store, rows) => tx(store, 'readwrite', (s) => { for (const r of [].concat(rows)) s.add(r); }),
    put: (store, row) => tx(store, 'readwrite', (s) => s.put(row)),
    all: (store, sid) => tx(store, 'readonly', (s) => s.index('sid').getAll(sid)),
    count: (store, sid) => tx(store, 'readonly', (s) => s.index('sid').count(sid)),
    /** Everything except this session: one recording is kept until the next one starts. */
    async dropOthers(sid) {
      for (const name of ['events', 'shots', 'doms', 'docs']) {
        await tx(name, 'readwrite', (s) => {
          const req = s.openCursor();
          req.onsuccess = () => { const c = req.result; if (!c) return; if (c.value.sid !== sid) c.delete(); c.continue(); };
        });
      }
    },
  };
})();
