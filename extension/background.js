// Anchor extension (Chrome, Brave, Edge, Chromium and Firefox): asks the Anchor desktop app (127.0.0.1) whether a site is blocked
// and redirects to the block page. If the app is not running, everything is allowed (fail open).
const ext = typeof browser !== 'undefined' ? browser : chrome; // promise-based API in both browsers
if (typeof importScripts === 'function') importScripts('adult.js'); // Chrome service worker; Firefox loads it via manifest "scripts"
// Adult-site filter: ON by default. Only an explicit "off" from the Anchor app (after its long wait) turns it off,
// and the last known setting is remembered so the filter keeps working even if the app is closed.
let adultOn = true;
ext.storage.local.get('adultOn').then((v) => { if (v && v.adultOn === false) adultOn = false; }).catch(() => {});
let cfg = null, port = null, state = null, stateAt = 0;

async function loadCfg() {
  if (!cfg) cfg = await (await fetch(ext.runtime.getURL('config.json'), { cache: 'no-store' })).json();
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
  if (state && typeof state.adultFilter === 'boolean') { adultOn = state.adultFilter; ext.storage.local.set({ adultOn }).catch(() => {}); }
  return state;
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const matches = (h, e) => h === e || h.endsWith('.' + e);

// returns 'adult' (always-on filter), 'site' (session rule) or null
function decide(st, host) {
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  if ((st ? st.adultFilter !== false : adultOn) && AnchorAdult.isAdult(host)) return 'adult';
  if (!st || !st.active || st.onBreak) return null;
  const now = Date.now();
  if ((st.unlocks || []).some((u) => u.until > now && matches(host, u.target))) return null;
  if (st.mode === 'allowlist') return st.allow.some((e) => matches(host, e)) ? null : 'site';
  return st.sites.some((e) => matches(host, e)) ? 'site' : null;
}
async function check(tabId, url) {
  if (!/^https?:/i.test(url || '')) return;
  const host = hostOf(url); if (!host) return;
  const st = await getState();
  const why = decide(st, host);
  if (!why) return;
  api('/attempt', 'POST', { host });
  ext.tabs.update(tabId, { url: ext.runtime.getURL('blocked.html') + '?host=' + encodeURIComponent(host) + '&url=' + encodeURIComponent(url) + (why === 'adult' ? '&adult=1' : '') }).catch(() => {});
}

ext.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); }, { url: [{ schemes: ['http', 'https'] }] });
ext.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); }, { url: [{ schemes: ['http', 'https'] }] });
ext.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await ext.tabs.get(tabId); check(tabId, t.url); } catch {} });

// Heartbeat + sweep: redirect tabs that were already open on a blocked site when the session started.
async function sweep() {
  const st = await getState(true);
  if (st ? !(st.active || st.adultFilter !== false) : !adultOn) return;
  for (const t of await ext.tabs.query({})) if (t.url) check(t.id, t.url);
}
ext.alarms.create('anchor-sweep', { periodInMinutes: 0.5 });
ext.alarms.onAlarm.addListener((a) => { if (a.name === 'anchor-sweep') sweep(); });
ext.runtime.onStartup.addListener(sweep);
ext.runtime.onInstalled.addListener(sweep);

// block page -> background: proxy API calls (keeps the token inside the extension)
ext.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || msg.anchor !== true) return;
  api(msg.path, msg.method || 'GET', msg.body).then((r) => reply(r || { status: 0, json: { error: 'Anchor app is not running' } }));
  return true; // keep the channel open for the async reply (works in Chrome and Firefox)
});
