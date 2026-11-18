const $ = (id) => document.getElementById(id);
const send = (smm, extra) => chrome.runtime.sendMessage({ smm, ...extra });
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let state = { active: false };
let busy = false;

function render() {
  const on = !!state.active;
  $('dot').className = on ? 'on' : '';
  $('label').textContent = on ? `Идёт запись · ${mmss(Date.now() - state.startedAt)}` : 'Запись выключена';
  $('stats').textContent = on ? `шагов ${state.actions} · страниц ${state.pages} · запросов ${state.requests} · скриншотов ${state.shots} · комментариев ${state.comments}` : '';
  $('toggle').textContent = busy ? (on ? 'Собираю архив…' : 'Запускаю…') : on ? 'Стоп и скачать архив' : 'Старт';
  $('toggle').className = on ? 'stop' : '';
  $('toggle').disabled = busy;
  $('note').disabled = $('add').disabled = !on || busy;
}
async function refresh() { state = (await send('status')) || { active: false }; render(); }

$('toggle').onclick = async () => {
  busy = true; render();
  try { state = await send(state.active ? 'stop' : 'start'); } finally { busy = false; render(); }
};
async function addNote() {
  const text = $('note').value.trim();
  if (!text) return;
  state = await send('comment', { text });
  $('note').value = '';
  $('msg').textContent = 'Комментарий добавлен';
  setTimeout(() => { $('msg').textContent = ''; }, 2000);
  render();
}
$('add').onclick = addNote;
$('note').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); } });

refresh().then(() => { if (state.active) $('note').focus(); });
setInterval(() => { if (!busy) refresh(); }, 2000);
