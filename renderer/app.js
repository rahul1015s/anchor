'use strict';
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const MIN = 60000;

let S = null;                       // latest snapshot from the engine
let tab = 'focus';                  // focus | rules | history | settings
let summary = null;                 // shown after a session ends
let skew = 0;                       // engine clock - local clock
let draft = { goal: '', minutes: null, mode: null };
let extBrowser = null;              // 'chrome' | 'firefox' (Settings tab)
let viewKey = '';
const nowMs = () => Date.now() + skew;

function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 5000 : 2800);
}
const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const fmtDate = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- boot ----------
api.onSnap((s) => {
  S = s; skew = s.now - Date.now();
  if (keyOf(s) !== viewKey) render(); else if (s.session) updateSession();
});
api.onBlocked((b) => toast(`Blocked ${b.target} – back to work`));
api.onEnded((sum) => { summary = sum; closeModal(); render(); });
api.snap().then((s) => { S = s; skew = s.now - Date.now(); render(); });

const keyOf = (s) => (s.session ? 'S' : summary ? 'U' : 'H' + tab) + (s.extensionConnected ? 'c' : 'x') + (s.settings.adultFilter ? 'f' : 'n');
function render() {
  if (!S) return;
  document.body.classList.toggle('session', !!S.session);
  viewKey = keyOf(S);
  if (S.session) renderSession(); else if (summary) renderSummary(); else renderHome();
}

// ---------- home ----------
function renderHome() {
  const nav = [['focus', 'Focus'], ['rules', 'Rules'], ['history', 'History'], ['settings', 'Settings']]
    .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  $app.innerHTML = `<div class="shell">
    <div class="top"><div class="brand"><img src="icon.svg" alt="">Anchor</div><div class="nav">${nav}</div></div>
    <div id="view"></div></div>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
  ({ focus: viewFocus, rules: viewRules, history: viewHistory, settings: viewSettings })[tab]($('view'));
}

function viewFocus(v) {
  const st = S.settings, mins = draft.minutes ?? st.defaultMinutes, mode = draft.mode ?? st.mode;
  const blocks = mode === 'allowlist' ? `Only ${st.allow.length} allowed site${st.allow.length === 1 ? '' : 's'} will open` : `Blocks ${st.sites.length} site${st.sites.length === 1 ? '' : 's'}`;
  const appsTxt = st.apps.length ? ` and closes ${st.apps.length} app${st.apps.length === 1 ? '' : 's'}` : '';
  const presets = [25, 45, 60, 90, 120];
  const days = S.stats.days, max = Math.max(30, ...days.map((d) => d.focusMin));
  v.innerHTML = `
    ${S.settings.adultFilter ? '' : `<div class="banner"><div><b>The adult site filter is OFF.</b> Porn and erotic sites are not being blocked.</div><button class="btn sm" id="filterOnBtn">Turn it on</button></div>`}
    ${S.extensionConnected ? '' : `<div class="banner"><div><b>Website blocking is off.</b> Connect the Chrome extension so Anchor can block sites (takes 2 minutes).</div><button class="btn ghost sm" id="setupExt">Set up</button></div>`}
    <div class="card start">
      <h1>What will you finish in this session?</h1>
      <input type="text" id="goal" class="goal" maxlength="140" placeholder="e.g. Build the login page and write its tests" value="${esc(draft.goal)}" autofocus>
      <div class="field"><label>Length</label>
        <div class="row"><div class="chips">${presets.map((p) => `<button class="chip ${mins === p ? 'on' : ''}" data-min="${p}">${p} min</button>`).join('')}</div>
        <input type="number" class="num" id="customMin" min="5" max="240" value="${presets.includes(mins) ? '' : mins}" placeholder="custom"></div></div>
      <div class="field"><label>During the session</label>
        <div class="row"><div class="seg"><button data-mode="blocklist" class="${mode === 'blocklist' ? 'on' : ''}">Block distracting sites</button><button data-mode="allowlist" class="${mode === 'allowlist' ? 'on' : ''}">Allow only work sites</button></div>
        <span class="summary-line">${blocks}${appsTxt}</span></div></div>
      <div class="row spread field"><span class="muted" style="font-size:13.5px">Getting around a block takes a ${st.cooldownSec}-second wait and a written reason. ${st.dnd ? 'Notifications are muted.' : ''}</span>
        <button class="btn big" id="start">Start focus session</button></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="eyebrow">Today</div><div class="stat">${fmtMin(S.stats.todayFocusMin)}<small>focused</small></div>
        <div class="muted" style="margin-top:4px">${S.stats.todaySessions} session${S.stats.todaySessions === 1 ? '' : 's'} today</div></div>
      <div class="card"><div class="eyebrow">Last 7 days</div>
        <div class="bars">${days.map((d) => `<div class="bar" title="${fmtMin(d.focusMin)}"><i class="${d.focusMin ? '' : 'zero'}" style="height:${Math.max(3, (d.focusMin / max) * 100)}%"></i><span>${new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}</div></div>
    </div>`;
  const goal = $('goal'); goal.oninput = () => (draft.goal = goal.value);
  v.querySelectorAll('[data-min]').forEach((b) => (b.onclick = () => { draft.minutes = +b.dataset.min; draft.goal = goal.value; render(); }));
  $('customMin').onchange = (e) => { const n = Math.round(+e.target.value); if (n >= 5 && n <= 240) { draft.minutes = n; draft.goal = goal.value; render(); } };
  v.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { draft.mode = b.dataset.mode; draft.goal = goal.value; render(); }));
  const se = $('setupExt'); if (se) se.onclick = () => { tab = 'settings'; render(); };
  const fo = $('filterOnBtn'); if (fo) fo.onclick = async () => { const r = await api.filterOn(); if (!r.ok) toast(r.error, true); else toast('Adult site filter is on'); };
  const go = async () => {
    const r = await api.start({ goal: goal.value, minutes: draft.minutes ?? st.defaultMinutes, mode: draft.mode ?? st.mode });
    if (!r.ok) return toast(r.error, true);
    draft.goal = '';
  };
  $('start').onclick = go; goal.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  goal.focus();
}

// ---------- rules ----------
const SUGG_SITES = ['youtube.com', 'reddit.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com', 'twitch.tv', 'linkedin.com', 'quora.com', 'news.ycombinator.com', 'amazon.in', 'flipkart.com'];
const SUGG_ALLOW = ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'docs.python.org', 'react.dev', 'nodejs.org', 'wikipedia.org', 'chatgpt.com', 'claude.ai', 'localhost'];
const SUGG_APPS = ['discord', 'telegram', 'steam', 'slack', 'whatsapp', 'spotify', 'signal', 'obs'];

function chipEditor(title, hint, key, list, placeholder, sugg) {
  const left = sugg.filter((x) => !list.includes(x));
  return `<div class="card"><h3>${title}</h3><p class="hint">${hint}</p>
    <div class="chipbox">${list.length ? list.map((x) => `<span class="tag">${esc(x)}<button data-rm="${key}" data-v="${esc(x)}" title="Remove">×</button></span>`).join('') : '<span class="muted">Nothing yet.</span>'}</div>
    <div class="addrow"><input type="text" data-add="${key}" placeholder="${placeholder}"><button class="btn ghost" data-addbtn="${key}">Add</button></div>
    ${left.length ? `<div class="sugg">${left.slice(0, 9).map((x) => `<button data-sg="${key}" data-v="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : ''}</div>`;
}
function viewRules(v) {
  const st = S.settings;
  v.innerHTML = `
    <div class="card"><h3>Mode</h3><p class="hint">What the browser does during a session. Apps are always closed if listed below.</p>
      <div class="seg" style="margin-top:10px"><button data-gmode="blocklist" class="${st.mode === 'blocklist' ? 'on' : ''}">Block distracting sites</button><button data-gmode="allowlist" class="${st.mode === 'allowlist' ? 'on' : ''}">Allow only work sites</button></div></div>
    ${st.mode === 'blocklist'
      ? chipEditor('Websites to block', 'Subdomains are blocked too (reddit.com also covers old.reddit.com).', 'sites', st.sites, 'e.g. reddit.com', SUGG_SITES)
      : chipEditor('Allowed websites', 'Everything else is blocked during a session. Include the docs and tools you really need.', 'allow', st.allow, 'e.g. github.com', SUGG_ALLOW)}
    ${chipEditor('Apps to close', 'If one of these opens during a session, Anchor closes it. Use the program name (for example <b>discord</b>).', 'apps', st.apps, 'e.g. discord', SUGG_APPS)}`;
  const patch = async (p) => { const r = await api.setSettings(p); if (!r.ok) toast(r.error, true); else { S.settings = r.data; render(); } };
  v.querySelectorAll('[data-gmode]').forEach((b) => (b.onclick = () => { draft.mode = null; patch({ mode: b.dataset.gmode }); }));
  const add = (key, raw) => {
    const val = raw.trim(); if (!val) return;
    const before = S.settings[key].length;
    api.setSettings({ [key]: [...S.settings[key], val] }).then((r) => {
      if (!r.ok) return toast(r.error, true);
      if (r.data[key].length === before) toast(key === 'apps' ? 'That name is not allowed or not valid (editors, browsers and system programs are protected).' : 'That does not look like a website.', true);
      S.settings = r.data; render();
    });
  };
  v.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => patch({ [b.dataset.rm]: S.settings[b.dataset.rm].filter((x) => x !== b.dataset.v) })));
  v.querySelectorAll('[data-sg]').forEach((b) => (b.onclick = () => add(b.dataset.sg, b.dataset.v)));
  v.querySelectorAll('[data-add]').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') add(i.dataset.add, i.value); }));
  v.querySelectorAll('[data-addbtn]').forEach((b) => (b.onclick = () => add(b.dataset.addbtn, v.querySelector(`[data-add="${b.dataset.addbtn}"]`).value)));
}

// ---------- history ----------
async function viewHistory(v) {
  v.innerHTML = '<div class="card muted">Loading…</div>';
  const list = await api.history();
  if (!list.length) { v.innerHTML = '<div class="card"><h3>No sessions yet</h3><p class="muted">Finished sessions show up here with your focus score and any reasons you gave to unlock something.</p></div>'; return; }
  v.innerHTML = `<div class="card">${list.map((s) => {
    const cls = s.score >= 85 ? 'hi' : s.score >= 60 ? 'mid' : 'lo';
    const tops = Object.entries(s.byTarget || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return `<div class="sess-row"><div class="row spread"><span class="g">${esc(s.goal)}</span><span class="score ${cls}">${s.score}%</span></div>
      <div class="m">${fmtDate(s.startedAt)} · ${fmtMin(s.actualMin)} (${fmtMin(s.focusMin)} focused)${s.endedEarly ? ' · ended early' : ''} · ${s.attempts} blocked attempt${s.attempts === 1 ? '' : 's'}</div>
      ${(tops.length || s.unlocks.length || s.endReason) ? `<details><summary>Details</summary><ul>
        ${tops.map(([t, n]) => `<li>${esc(t)} – ${n} attempt${n === 1 ? '' : 's'}</li>`).join('')}
        ${s.unlocks.map((u) => `<li>Unlocked ${esc(u.target)}: “${esc(u.reason)}”</li>`).join('')}
        ${s.endReason ? `<li>Ended early: “${esc(s.endReason)}”</li>` : ''}</ul></details>` : ''}</div>`;
  }).join('')}</div>`;
}

// ---------- settings ----------
async function viewSettings(v) {
  const st = S.settings, info = await api.extInfo();
  if (!extBrowser) extBrowser = /firefox/.test(info.defaultBrowser || '') ? 'firefox' : 'chrome';
  const num = (id, label, sub, val, min, max) => `<div class="setting"><div>${label}<small>${sub}</small></div><input type="number" class="num" id="${id}" min="${min}" max="${max}" value="${val}"></div>`;
  v.innerHTML = `
    <div class="card"><div class="row spread"><h3>Adult site filter</h3><span class="pill ${st.adultFilter ? 'ok' : 'warn'}"><span class="dot"></span>${st.adultFilter ? 'On' : 'Off'}</span></div>
      <p class="hint">Blocks porn and erotic sites in your browser <b>all the time</b>, not just during sessions (needs the browser extension below). It keeps blocking even if Anchor is closed. Turning it off takes a long wait and a written reason; turning it on is instant.</p>
      <div class="row" style="margin-top:12px">${st.adultFilter ? '<button class="btn ghost sm" id="filterOff">Turn off…</button>' : '<button class="btn sm" id="filterOnS">Turn on</button>'}</div>
      ${(S.filterLog || []).length ? `<ul class="flog">${S.filterLog.slice(-5).reverse().map((e) => `<li>${esc(fmtDate(e.at))} – turned ${esc(e.kind)}${e.reason ? ': “' + esc(e.reason) + '”' : ''}</li>`).join('')}</ul>` : ''}</div>
    <div class="card"><h3>Session rules</h3>
      ${num('cooldownSec', 'Wait before unlocking', 'Seconds you must wait (and then explain why) to open a blocked site, unlock an app or end a session early.', st.cooldownSec, 30, 600)}
      ${num('filterWaitSec', 'Wait to turn the adult filter off', 'Seconds. Can only be raised while the filter is on.', st.filterWaitSec, 60, 1800)}
      ${num('maxBreaks', 'Breaks per session', 'Each break pauses blocking and adds its time to the session.', st.maxBreaks, 0, 5)}
      ${num('breakMin', 'Break length (minutes)', '', st.breakMin, 1, 15)}
      ${num('defaultMinutes', 'Default session length (minutes)', '', st.defaultMinutes, 5, 240)}
      <div class="setting"><div>Mute notifications during sessions<small>Uses GNOME “Do Not Disturb”. Restored when the session ends.</small></div>
        <div class="seg"><button data-dnd="1" class="${st.dnd ? 'on' : ''}">On</button><button data-dnd="0" class="${st.dnd ? '' : 'on'}">Off</button></div></div></div>
    <div class="card"><div class="row spread"><h3>Browser extension</h3><span class="pill ${info.connected ? 'ok' : 'warn'}"><span class="dot"></span>${info.connected ? 'Connected' : 'Not connected'}</span></div>
      <p class="hint">Needed to block websites. Install it in every browser you use. It only talks to this app on your computer.</p>
      <div class="seg" style="margin:12px 0 4px"><button data-br="chrome" class="${extBrowser === 'chrome' ? 'on' : ''}">Chrome · Brave · Edge</button><button data-br="firefox" class="${extBrowser === 'firefox' ? 'on' : ''}">Firefox</button></div>
      ${extBrowser === 'chrome' ? `
      <ol class="steps"><li>Open <b>chrome://extensions</b> and turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and choose this folder:<br><code>${esc(info.dir)}</code><br><span class="hint">Shortcut in your home folder: <code>Anchor-extension</code></span></li>
        <li>This page shows <b>Connected</b> within a minute.</li></ol>
      <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="openChrome">Open Chrome extensions page</button><button class="btn ghost sm" id="copyDir">Copy folder path</button><button class="btn ghost sm" id="revealDir">Show folder</button></div>`
      : `
      <ol class="steps"><li>Click <b>Open Firefox add-on page</b> below (or open <b>about:debugging#/runtime/this-firefox</b>).</li>
        <li>Click <b>Load Temporary Add-on…</b> and choose <b>manifest.json</b> inside:<br><code>${esc(info.dir)}</code></li>
        <li>This page shows <b>Connected</b> within a minute.</li></ol>
      <p class="hint"><b>Firefox forgets temporary add-ons when it restarts</b>, so repeat step 2 after restarting Firefox, or make it permanent (free, one time):</p>
      <details><summary>Make it permanent with a Mozilla signature</summary>
        <ol class="steps"><li>Create API keys at <code>addons.mozilla.org/developers/addon/api/key/</code> (needs a free Mozilla account).</li>
          <li>In a terminal run:<br><code>npx web-ext sign --channel=unlisted --source-dir "${esc(info.dir)}" --api-key=YOUR_KEY --api-secret=YOUR_SECRET</code></li>
          <li>Open the <code>.xpi</code> it creates in Firefox (drag it onto the window) and accept.</li></ol>
        <p class="hint">The signed file contains this app's private connection key, so keep it to yourself. Needs Firefox 128 or newer.</p></details>
      <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="openFirefox">Open Firefox add-on page</button><button class="btn ghost sm" id="copyDir">Copy folder path</button><button class="btn ghost sm" id="revealDir">Show folder</button></div>`}</div>
    <div class="card"><h3>About</h3><p class="hint">Anchor is a self-control aid, not a security tool: it helps you resist impulses, but you can still quit it from outside (for example with a terminal). Everything stays on this computer.</p></div>`;
  ['cooldownSec', 'filterWaitSec', 'maxBreaks', 'breakMin', 'defaultMinutes'].forEach((id) => ($(id).onchange = async (e) => { const r = await api.setSettings({ [id]: +e.target.value }); if (!r.ok) toast(r.error, true); else S.settings = r.data; }));
  v.querySelectorAll('[data-dnd]').forEach((b) => (b.onclick = async () => { const r = await api.setSettings({ dnd: b.dataset.dnd === '1' }); if (r.ok) { S.settings = r.data; render(); } }));
  { const off = $('filterOff'); if (off) off.onclick = () => cooldownModal({ type: 'filter', target: 'adult', title: 'Turn off the adult filter?', intro: 'This is deliberately slow. If it is an impulse, it will pass. Otherwise wait, and write why.', confirm: 'Turn off', minReason: 20 });
    const on = $('filterOnS'); if (on) on.onclick = async () => { const r = await api.filterOn(); if (!r.ok) toast(r.error, true); }; }
  v.querySelectorAll('[data-br]').forEach((b) => (b.onclick = () => { extBrowser = b.dataset.br; render(); }));
  const oc = $('openChrome'); if (oc) oc.onclick = async () => { if (!(await api.extOpenChrome())) toast('Could not start Chrome – open chrome://extensions yourself.', true); };
  const of = $('openFirefox'); if (of) of.onclick = async () => { if (!(await api.extOpenFirefox())) toast('Could not start Firefox – open about:debugging#/runtime/this-firefox yourself.', true); };
  $('copyDir').onclick = async () => { await api.extCopy(); toast('Folder path copied'); };
  $('revealDir').onclick = () => api.extReveal();
}

// ---------- session (compact window) ----------
function renderSession() {
  const s = S.session;
  $app.innerHTML = `<div class="sess" id="sess">
    <div class="label">Focusing on</div><div class="goal" id="sg"></div>
    <div class="ring"><svg width="128" height="128" viewBox="0 0 150 150"><circle cx="75" cy="75" r="66" fill="none" stroke="var(--line)" stroke-width="9"/>
      <circle class="fg" id="rfg" cx="75" cy="75" r="66" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="414.7" stroke-dashoffset="0"/></svg>
      <div class="t"><b id="clock">--:--</b><span id="sub">remaining</span></div></div>
    <div class="pills" id="pills"></div>
    <div class="acts" id="acts"></div></div>`;
  $('sg').textContent = s.goal;
  updateSession();
}
function sessionBlocking(s) {
  const web = s.mode === 'allowlist' || s.sites.length > 0;
  return web ? (S.extensionConnected ? '<span class="pill ok"><span class="dot"></span>Websites protected</span>' : '<span class="pill warn" id="extWarn" title="Load the browser extension to block websites"><span class="dot"></span>Browser extension offline</span>') : '';
}
function updateSession() {
  const s = S.session; if (!s || !$('clock')) return;
  const t = nowMs(), onBreak = s.breaks.until > t;
  $('sess').classList.toggle('onbreak', onBreak);
  $('clock').textContent = onBreak ? fmtClock(s.breaks.until - t) : fmtClock(s.endsAt - t);
  $('sub').textContent = onBreak ? 'break' : 'remaining';
  const frac = onBreak ? (s.breaks.until - t) / (s.breakMin * MIN) : Math.min(1, Math.max(0, (s.endsAt - t) / Math.max(1, s.endsAt - s.startedAt)));
  $('rfg').style.strokeDashoffset = String(414.7 * (1 - frac));
  const left = s.breaks.max - s.breaks.used;
  const pills = onBreak ? '<span class="pill warn" style="cursor:default"><span class="dot"></span>Blocking paused</span>' : sessionBlocking(s);
  const html = `${pills}<span class="pill">Blocked ${s.attemptCount}</span><span class="pill">Breaks left ${left}</span>`;
  if ($('pills').dataset.h !== html) { $('pills').innerHTML = html; $('pills').dataset.h = html; const w = $('extWarn'); if (w) w.onclick = () => toast('Open Anchor after this session → Settings → Browser extension.'); }
  const acts = onBreak
    ? `<button class="btn" id="endBreak">End break</button>`
    : `<button class="btn ghost sm" id="brk" ${left > 0 ? '' : 'disabled'}>Break (${s.breakMin} min)</button>${s.apps.length ? '<button class="btn ghost sm" id="unApp">Unlock an app</button>' : ''}<button class="btn ghost sm danger" id="endSess">End session</button>`;
  if ($('acts').dataset.h !== acts) {
    $('acts').innerHTML = acts; $('acts').dataset.h = acts;
    const b = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    b('endBreak', async () => { const r = await api.breakEnd(); if (!r.ok) toast(r.error, true); });
    b('brk', async () => { const r = await api.breakStart(); if (!r.ok) toast(r.error, true); });
    b('unApp', openAppUnlock);
    b('endSess', () => cooldownModal({ type: 'end', target: 'session', title: 'End this session early?', intro: 'Ending early is logged in your history. Take the wait, and be honest about why.', confirm: 'End session' }));
  }
}

// ---------- cooldown modal ----------
let modalTimer = null;
function closeModal() { clearInterval(modalTimer); const o = $('overlay'); if (o) o.remove(); api.modal(false); }
function openAppUnlock() {
  api.modal(true);
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'overlay';
  ov.innerHTML = `<div class="modal"><h3>Unlock an app</h3><p>Pick the app you need. You'll take the wait and give a reason.</p>
    <div class="applist">${S.session.apps.map((a) => `<button class="btn ghost" data-app="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="mcancel">Cancel</button></div></div>`;
  $app.appendChild(ov);
  $('mcancel').onclick = closeModal;
  ov.querySelectorAll('[data-app]').forEach((b) => (b.onclick = () => { const a = b.dataset.app; ov.remove(); cooldownModal({ type: 'app', target: a, title: `Unlock ${a}?`, intro: 'It stays unlocked for the time you choose.', confirm: 'Unlock', minutes: true, keepSize: true }); }));
}
async function cooldownModal({ type, target, title, intro, confirm, minutes, keepSize, minReason = 10 }) {
  if (!keepSize) api.modal(true);
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'overlay';
  ov.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><p>${esc(intro)}</p>
    <div class="wait"><b id="mcount">…</b><span>seconds to wait</span></div>
    <textarea id="mreason" rows="3" maxlength="300" placeholder="Why? (at least ${minReason} characters)"></textarea>
    ${minutes ? '<select id="mmins" style="margin-top:10px"><option value="5">for 5 minutes</option><option value="10" selected>for 10 minutes</option><option value="20">for 20 minutes</option></select>' : ''}
    <div class="err" id="merr"></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost sm" id="mcancel">Never mind</button><button class="btn sm" id="mgo" disabled>${esc(confirm)}</button></div></div>`;
  $app.appendChild(ov);
  $('mcancel').onclick = closeModal;
  const r = await api.unlockRequest({ type, target });
  if (!r.ok) { $('merr').textContent = r.error; return; }
  const readyAt = Date.now() + (r.data.readyAt - r.data.serverNow);
  const upd = () => {
    const left = Math.ceil((readyAt - Date.now()) / 1000);
    $('mcount').textContent = Math.max(0, left);
    $('mgo').disabled = left > 0 || $('mreason').value.trim().length < minReason;
  };
  clearInterval(modalTimer); modalTimer = setInterval(upd, 250); upd();
  $('mreason').oninput = upd; $('mreason').focus();
  $('mgo').onclick = async () => {
    $('mgo').disabled = true;
    const res = await api.unlockConfirm({ type, target, reason: $('mreason').value, minutes: minutes ? +$('mmins').value : undefined });
    if (!res.ok) { $('merr').textContent = res.error; upd(); return; }
    closeModal(); if (type === 'app') toast(`${target} unlocked`);
  };
}

// ---------- summary ----------
function renderSummary() {
  const s = summary, cls = s.score >= 85 ? 'var(--good)' : s.score >= 60 ? 'var(--warn)' : 'var(--bad)';
  const tops = Object.entries(s.byTarget || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const msg = s.endedEarly ? 'Session ended early' : s.score >= 85 ? 'Strong session' : s.score >= 60 ? 'Decent session' : 'Rough one – it happens';
  $app.innerHTML = `<div class="sum"><div class="score-big" style="color:${cls}">${s.score}%</div><h1>${msg}</h1><div class="muted">${esc(s.goal)}</div>
    <div class="facts"><div><b>${fmtMin(s.focusMin)}</b><span>focused</span></div><div><b>${s.attempts}</b><span>blocked attempts</span></div><div><b>${s.unlocks.length}</b><span>unlocks</span></div></div>
    ${tops.length ? `<div class="list"><h3>Top distractions</h3>${tops.map(([t, n]) => `<div><span>${esc(t)}</span><span class="muted">${n}×</span></div>`).join('')}</div>` : ''}
    ${s.unlocks.length ? `<div class="list"><h3>Why you unlocked things</h3>${s.unlocks.map((u) => `<q>${esc(u.target)}: ${esc(u.reason)}</q>`).join('')}</div>` : ''}
    ${s.endReason ? `<div class="list"><h3>Why you ended early</h3><q>${esc(s.endReason)}</q></div>` : ''}
    <button class="btn big" id="done" style="margin-top:14px">Done</button></div>`;
  $('done').onclick = () => { summary = null; tab = 'focus'; render(); };
}

setInterval(() => { if (S && S.session) updateSession(); }, 500);
