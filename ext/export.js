const sid = new URLSearchParams(location.search).get('sid');
const $ = (id) => document.getElementById(id);
const mb = (n) => `${(n / 1048576).toFixed(1)} МБ`;
let saved = null;

function save() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(saved.blob);
  a.download = saved.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

window.__smmZip = (async () => {
  const { rec } = await chrome.storage.local.get('rec');
  if (!rec || rec.sid !== sid) throw new Error('эта запись уже удалена: архив хранится до начала следующей');
  rec.version = chrome.runtime.getManifest().version;
  const [events, shots, doms, docs] = await Promise.all(['events', 'shots', 'doms', 'docs'].map((s) => SMMDB.all(s, sid)));
  const files = SMMArchive.build({ rec, events, shots, doms, docs });
  const blob = await SMMZip.build(files);
  saved = { blob, name: `smm-${sid}.zip` };
  save();
  const s = JSON.parse(files.find((f) => f.name === 'session.json').data).counts;
  $('status').textContent = `Архив ${saved.name} (${mb(blob.size)}) сохранён в загрузки.`;
  $('summary').innerHTML = [
    `страниц: ${s.pages}, вкладок: ${s.tabs}`, `шагов: ${s.actions}`, `запросов: ${s.requests}`,
    `скриншотов: ${s.screenshots}, снимков DOM: ${s.domSnapshots}`, `комментариев: ${s.comments}`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('again').hidden = false;
  return blob;
})();
window.__smmZip.catch((e) => { $('status').textContent = `Не удалось собрать архив: ${e.message || e}`; $('status').className = 'err'; });
$('again').onclick = save;
