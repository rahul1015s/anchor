const q = new URLSearchParams(location.search), host = q.get('host') || '', target = q.get('url') || '', isAdult = q.get('adult') === '1';
const $ = (id) => document.getElementById(id);
const ext = typeof browser !== 'undefined' ? browser : chrome;
const ask = (path, method, body) => ext.runtime.sendMessage({ anchor: true, path, method, body }).then((r) => r || { status: 0, json: { error: 'Anchor app is not running' } }).catch(() => ({ status: 0, json: { error: 'Anchor app is not running' } }));
$('host').textContent = host; $('host2').textContent = host;
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
let readyAt = 0, st = null;

if (isAdult) {
  for (const id of ['goalp', 'leftp', 'need']) $(id).hidden = true;
  $('adultnote').hidden = false; $('blockedword').textContent = 'is blocked'; document.title = 'Blocked – Anchor';
}
async function refresh() {
  const r = await ask('/state');
  if (isAdult) { if (r.status === 200 && r.json.adultFilter === false) go(); return; } // only an explicit "filter off" lets you through
  if (r.status !== 200) { $('offline').hidden = false; return; }
  $('offline').hidden = true; st = r.json;
  if (!st.active || st.onBreak) return go(); // session over / break => let them through
  const now = Date.now(), h = host;
  const un = (st.unlocks || []).some((u) => u.until > now && (h === u.target || h.endsWith('.' + u.target)));
  if (un) return go();
  $('goal').textContent = st.goal || ''; $('left').textContent = fmt(st.endsAt - now);
}
function go() { if (target) location.replace(target); }

$('back').onclick = () => { if (history.length > 1) history.back(); else ext.tabs.create({}).then(() => window.close()).catch(() => window.close()); };
$('need').onclick = async () => {
  $('cool').hidden = false; $('need').disabled = true;
  const r = await ask('/unlock/request', 'POST', { host });
  if (r.status !== 200) { $('err').textContent = r.json.error || 'Could not start the wait.'; return; }
  readyAt = Date.now() + (r.json.readyAt - r.json.serverNow);
  tickWait(); $('reason').focus();
};
function tickWait() {
  const left = Math.ceil((readyAt - Date.now()) / 1000);
  $('count').textContent = Math.max(0, left);
  $('go').disabled = left > 0 || $('reason').value.trim().length < 10;
  if (readyAt) setTimeout(tickWait, 250);
}
$('reason').oninput = () => { if (readyAt) $('go').disabled = Math.ceil((readyAt - Date.now()) / 1000) > 0 || $('reason').value.trim().length < 10; };
$('go').onclick = async () => {
  $('go').disabled = true; $('err').textContent = '';
  const r = await ask('/unlock/confirm', 'POST', { host, reason: $('reason').value, minutes: +$('mins').value });
  if (r.status === 200) go(); else { $('err').textContent = r.json.error || 'Could not unlock.'; $('go').disabled = false; }
};
refresh(); setInterval(refresh, 1000);
