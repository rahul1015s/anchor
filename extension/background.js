// Anchor extension: asks the Anchor desktop app (127.0.0.1) whether a site is blocked and redirects to the block page.
// If the app is not running, everything is allowed (fail open) so you are never locked out of the web.
let cfg = null, port = null, state = null, stateAt = 0;

async function loadCfg() {
  if (!cfg) cfg = await (await fetch(chrome.runtime.getURL('config.json'), { cache: 'no-store' })).json();
  return cfg;
}
async function api(path, method = 'GET', body) {
  let c; try { c = await loadCfg(); } catch { return null; }
  for (const p of port ? [port] : c.ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}${path}`, {
        method, headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(1500),
      });
      if (r.status === 401) { if (port === p) port = null; continue; } // someone else (or a stale app) owns this port: try the next one
      port = p; return { status: r.status, json: await r.json() };
    } catch { if (port === p) port = null; }
  }
  return null;
}
async function getState(force) {
  if (!force && state && Date.now() - stateAt < 2000) return state;
  const r = await api('/state');
  state = r && r.status === 200 ? r.json : null; stateAt = Date.now();
  return state;
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const matches = (h, e) => h === e || h.endsWith('.' + e);

function decide(st, host) {
  if (!st || !st.active || st.onBreak || !host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return false;
  const now = Date.now();
  if ((st.unlocks || []).some((u) => u.until > now && matches(host, u.target))) return false;
  if (st.mode === 'allowlist') return !st.allow.some((e) => matches(host, e));
  return st.sites.some((e) => matches(host, e));
}
async function check(tabId, url) {
  if (!/^https?:/i.test(url || '')) return;
  const host = hostOf(url); if (!host) return;
  const st = await getState();
  if (!decide(st, host)) return;
  api('/attempt', 'POST', { host });
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL('blocked.html') + '?host=' + encodeURIComponent(host) + '&url=' + encodeURIComponent(url) }).catch(() => {});
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); }, { url: [{ schemes: ['http', 'https'] }] });
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); }, { url: [{ schemes: ['http', 'https'] }] });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await chrome.tabs.get(tabId); check(tabId, t.url); } catch {} });

// Heartbeat + sweep: redirect tabs that were already open on a blocked site when the session started.
async function sweep() {
  const st = await getState(true);
  if (!st || !st.active) return;
  for (const t of await chrome.tabs.query({})) if (t.url) check(t.id, t.url);
}
chrome.alarms.create('anchor-sweep', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'anchor-sweep') sweep(); });
chrome.runtime.onStartup.addListener(sweep);
chrome.runtime.onInstalled.addListener(sweep);

// block page -> background: proxy API calls (keeps the token inside the extension)
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || msg.anchor !== true) return;
  api(msg.path, msg.method || 'GET', msg.body).then((r) => reply(r || { status: 0, json: { error: 'Anchor app is not running' } }));
  return true;
});
