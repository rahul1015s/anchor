'use strict';
// Anchor core: session engine, blocking rules, local API for the browser extension,
// app blocker and the cooldown ("wait + explain why") system. No Electron dependency, so it is testable.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');
const ADULT = require('./extension/adult.js');
const { execFile, execFileSync } = require('child_process');

const PORTS = [47821, 47822, 47823, 47824, 47825];
const MIN = 60000;

const DEFAULTS = {
  token: '',
  mode: 'blocklist', // 'blocklist' = block listed sites, 'allowlist' = block everything except listed sites
  sites: ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'reddit.com', 'snapchat.com', 'pinterest.com',
    'youtube.com', 'netflix.com', 'twitch.tv', 'primevideo.com', 'hotstar.com', '9gag.com', 'web.whatsapp.com', 'discord.com', 'web.telegram.org'],
  allow: ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'google.com', 'duckduckgo.com', 'npmjs.com', 'claude.ai', 'localhost', '127.0.0.1'],
  apps: ['discord', 'telegram', 'steam'],
  cooldownSec: 60,
  breakMin: 5,
  maxBreaks: 2,
  defaultMinutes: 50,
  dnd: true,
  // always-on adult/porn/erotic site filter (browser extension). Turning it off takes filterWaitSec + a written reason.
  adultFilter: true,
  filterWaitSec: 300,
};

// Names we never kill, whatever the user types (editors, terminals, browsers, system).
const NEVER = ['sh', 'bash', 'zsh', 'fish', 'dash', 'systemd', 'init', 'gnome', 'gnome-shell', 'xorg', 'xwayland', 'mutter', 'dbus', 'pipewire',
  'wireplumber', 'node', 'npm', 'electron', 'anchor', 'claude', 'sudo', 'ssh', 'sshd', 'tmux', 'kitty', 'alacritty', 'konsole', 'ptyxis',
  'terminal', 'chrome', 'google-chrome', 'chromium', 'firefox', 'brave', 'code', 'codium', 'vim', 'nvim', 'emacs', 'python', 'java'];

// ---------- pure helpers ----------
function normalizeHost(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('://')) { try { s = new URL(s).hostname; } catch { return null; } }
  s = s.replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  return /^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(s) && s.length <= 253 && (s.includes('.') || s === 'localhost') ? s : null;
}
function normalizeApp(input) {
  const s = String(input || '').trim().toLowerCase();
  if (s.length < 3 || s.length > 40 || !/^[a-z0-9._+-]+$/.test(s)) return null;
  if (NEVER.includes(s)) return null;
  return s;
}
const hostMatches = (host, entry) => host === entry || host.endsWith('.' + entry);
const matchesAny = (host, list) => list.some((e) => hostMatches(host, e));
const uniq = (a) => [...new Set(a)];

function appMatches(proc, pattern) {
  const names = [proc.comm, proc.exe && path.basename(proc.exe), proc.argv0 && path.basename(proc.argv0)].filter(Boolean).map((x) => x.toLowerCase());
  return names.some((n) => n === pattern || n.includes(pattern));
}

// ---------- default system adapters ----------
function defaultListProcs() {
  const out = [], uid = process.getuid ? process.getuid() : -1;
  let pids; try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const d of pids) {
    const pid = +d;
    if (pid === process.pid) continue;
    try {
      if (uid >= 0 && fs.statSync('/proc/' + d).uid !== uid) continue;
      const comm = fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim();
      let exe = ''; try { exe = fs.readlinkSync(`/proc/${d}/exe`); } catch {}
      let argv0 = ''; try { argv0 = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0')[0]; } catch {}
      out.push({ pid, comm, exe, argv0 });
    } catch { /* process vanished */ }
  }
  return out;
}
const defaultKill = (pid, sig) => { try { process.kill(pid, sig); return true; } catch { return false; } };

const DND_KEY = ['org.gnome.desktop.notifications', 'show-banners'];
function defaultDnd(dir) {
  const file = path.join(dir, 'dnd-prev');
  const get = () => { try { return execFileSync('gsettings', ['get', ...DND_KEY], { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return null; } };
  const set = (v) => { try { execFileSync('gsettings', ['set', ...DND_KEY, v], { timeout: 3000 }); return true; } catch { return false; } };
  return {
    on() { const cur = get(); if (cur === null) return false; if (cur === 'false' && !fs.existsSync(file)) return false; /* already muted by someone else (e.g. Playlearn): leave it alone */ if (!fs.existsSync(file)) fs.writeFileSync(file, cur); set('false'); return true; },
    off() { if (!fs.existsSync(file)) return; const v = fs.readFileSync(file, 'utf8').trim(); if (v === 'true' || v === 'false') set(v); fs.rmSync(file, { force: true }); },
  };
}

// ---------- core ----------
function createCore(opts) {
  const { dataDir } = opts;
  const now = opts.now || Date.now;
  const listProcs = opts.listProcs || defaultListProcs;
  const kill = opts.kill || defaultKill;
  fs.mkdirSync(dataDir, { recursive: true });
  const dnd = opts.dnd || defaultDnd(dataDir);
  const bus = new EventEmitter();
  const files = { settings: path.join(dataDir, 'settings.json'), state: path.join(dataDir, 'state.json'), history: path.join(dataDir, 'sessions.json'), filterlog: path.join(dataDir, 'filterlog.json') };

  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };

  // settings
  let settings = { ...DEFAULTS, ...readJson(files.settings, {}) };
  if (!settings.token) { settings.token = crypto.randomBytes(24).toString('hex'); writeJson(files.settings, settings); }
  const cleanHosts = (l) => uniq((Array.isArray(l) ? l : []).map(normalizeHost).filter(Boolean));
  const cleanApps = (l) => uniq((Array.isArray(l) ? l : []).map(normalizeApp).filter(Boolean));
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);

  let session = readJson(files.state, null);
  let filterLog = readJson(files.filterlog, []);
  let filterPending = null;
  let extSeen = 0, lastBlockedAt = {}, killed = {}, server = null, apiPort = 0, timer = null;

  const publicSettings = () => { const { token, ...rest } = settings; return rest; };
  function setSettings(patch) {
    const locked = ['mode', 'sites', 'allow', 'apps', 'cooldownSec', 'maxBreaks', 'breakMin'];
    if (session && locked.some((k) => k in patch)) throw new Error('Blocklists and rules are locked while a session is running.');
    const n = { ...settings };
    if ('mode' in patch) n.mode = patch.mode === 'allowlist' ? 'allowlist' : 'blocklist';
    if ('sites' in patch) n.sites = cleanHosts(patch.sites);
    if ('allow' in patch) n.allow = cleanHosts(patch.allow);
    if ('apps' in patch) n.apps = cleanApps(patch.apps);
    if ('cooldownSec' in patch) n.cooldownSec = clamp(patch.cooldownSec, 30, 600, 60);
    if ('breakMin' in patch) n.breakMin = clamp(patch.breakMin, 1, 15, 5);
    if ('maxBreaks' in patch) n.maxBreaks = clamp(patch.maxBreaks, 0, 5, 2);
    if ('defaultMinutes' in patch) n.defaultMinutes = clamp(patch.defaultMinutes, 5, 240, 50);
    if ('dnd' in patch) n.dnd = !!patch.dnd;
    if ('filterWaitSec' in patch) {
      const v = clamp(patch.filterWaitSec, 60, 1800, 300);
      if (settings.adultFilter && v < settings.filterWaitSec) throw new Error('The filter wait can only be raised while the filter is on.');
      n.filterWaitSec = v;
    }
    if ('adultFilter' in patch) {
      if (settings.adultFilter && !patch.adultFilter) throw new Error('Use the wait to turn the adult filter off.');
      n.adultFilter = !!patch.adultFilter;
    }
    settings = n; writeJson(files.settings, settings); bus.emit('change');
    return publicSettings();
  }

  const persist = () => { if (session) writeJson(files.state, session); else fs.rmSync(files.state, { force: true }); };
  const onBreak = () => !!session && session.breaks.until > now();

  // ---------- session ----------
  function startSession({ goal, minutes, mode } = {}) {
    if (session) throw new Error('A session is already running.');
    goal = String(goal || '').trim().slice(0, 140);
    if (!goal) throw new Error('Write what you are working on first.');
    minutes = clamp(minutes, 5, 240, settings.defaultMinutes);
    const t = now();
    session = {
      id: crypto.randomUUID(), goal, startedAt: t, endsAt: t + minutes * MIN, plannedMin: minutes,
      mode: mode === 'allowlist' ? 'allowlist' : mode === 'blocklist' ? 'blocklist' : settings.mode,
      sites: [...settings.sites], allow: [...settings.allow], apps: [...settings.apps],
      cooldownSec: settings.cooldownSec, breakMin: settings.breakMin,
      breaks: { used: 0, max: settings.maxBreaks, until: 0, totalMs: 0 },
      unlocks: [], attempts: [], pending: {},
    };
    persist();
    if (settings.dnd) { try { dnd.on(); } catch {} }
    bus.emit('change'); bus.emit('started', publicSession());
    return publicSession();
  }

  function startBreak() {
    if (!session) throw new Error('No session is running.');
    if (onBreak()) throw new Error('You are already on a break.');
    if (session.breaks.used >= session.breaks.max) throw new Error('No breaks left in this session.');
    const ms = session.breakMin * MIN;
    session.breaks.used++; session.breaks.until = now() + ms; session.breaks.totalMs += ms;
    session.endsAt += ms; // the session keeps its planned focus time
    persist(); bus.emit('change'); return publicSession();
  }
  function endBreak() {
    if (!session || !onBreak()) return publicSession();
    const left = session.breaks.until - now();
    session.breaks.totalMs -= left; session.endsAt -= left; session.breaks.until = 0; // give back unused break time
    persist(); bus.emit('change'); return publicSession();
  }

  function finishSession(early, reason) {
    if (!session) return null;
    const s = session, t = now();
    const actualMs = Math.max(0, (early ? t : Math.min(t, s.endsAt)) - s.startedAt);
    const breakMs = Math.min(actualMs, s.breaks.totalMs - (s.breaks.until > t ? s.breaks.until - t : 0));
    const unlockMs = s.unlocks.filter((u) => u.type !== 'end').reduce((a, u) => a + Math.max(0, Math.min(u.until, s.startedAt + actualMs) - u.at), 0);
    const focusMs = Math.max(0, actualMs - breakMs - unlockMs);
    const byTarget = {};
    for (const a of s.attempts) byTarget[a.target] = (byTarget[a.target] || 0) + 1;
    const summary = {
      id: s.id, goal: s.goal, startedAt: s.startedAt, endedAt: t, plannedMin: s.plannedMin, actualMin: Math.round(actualMs / MIN),
      focusMin: Math.round(focusMs / MIN), breakMin: Math.round(breakMs / MIN), unlockMin: Math.round(unlockMs / MIN),
      score: actualMs > 0 ? Math.round((focusMs / actualMs) * 100) : 100, endedEarly: !!early, endReason: reason || '',
      attempts: s.attempts.length, byTarget, unlocks: s.unlocks.filter((u) => u.type !== 'end').map((u) => ({ type: u.type, target: u.target, reason: u.reason, at: u.at })),
    };
    const hist = readJson(files.history, []); hist.push(summary); writeJson(files.history, hist.slice(-500));
    session = null; persist(); killed = {}; lastBlockedAt = {};
    try { dnd.off(); } catch {}
    bus.emit('change'); bus.emit('ended', summary);
    return summary;
  }

  // ---------- cooldown: request -> wait -> confirm with a written reason ----------
  // ---------- adult filter: works with or without a session ----------
  function logFilter(kind, reason) { filterLog = [...filterLog, { at: now(), kind, reason }].slice(-100); writeJson(files.filterlog, filterLog); }
  function requestFilterOff() {
    if (!settings.adultFilter) throw new Error('The filter is already off.');
    const t = now(), readyAt = t + settings.filterWaitSec * 1000;
    if (!filterPending || filterPending.expires < t) filterPending = { readyAt, expires: readyAt + 10 * MIN };
    return { key: 'filter:adult', target: 'adult', readyAt: filterPending.readyAt, cooldownSec: settings.filterWaitSec, serverNow: t };
  }
  function confirmFilterOff(reason) {
    const t = now();
    if (!filterPending || filterPending.expires < t) throw new Error('Start the wait first.');
    if (t < filterPending.readyAt) throw new Error(`Wait ${Math.ceil((filterPending.readyAt - t) / 1000)} more seconds.`);
    reason = String(reason || '').trim().slice(0, 300);
    if (reason.length < 20) throw new Error('Write a real reason (at least 20 characters).');
    filterPending = null; settings = { ...settings, adultFilter: false }; writeJson(files.settings, settings);
    logFilter('off', reason); bus.emit('change');
  }
  /** Turning the filter back on is always instant. */
  function turnFilterOn() {
    if (settings.adultFilter) return;
    settings = { ...settings, adultFilter: true }; writeJson(files.settings, settings); filterPending = null;
    logFilter('on', ''); bus.emit('change');
  }

  function requestUnlock({ type, target }) {
    if (type === 'filter') return requestFilterOff();
    if (!session) throw new Error('No session is running.');
    if (!['site', 'app', 'end'].includes(type)) throw new Error('Bad request.');
    target = type === 'site' ? siteUnlockTarget(String(target || '')) : type === 'app' ? String(target || '').toLowerCase() : 'session';
    if (!target) throw new Error('Bad target.');
    const key = type + ':' + target, t = now();
    const readyAt = t + session.cooldownSec * 1000;
    if (!session.pending[key] || session.pending[key].expires < t) session.pending[key] = { readyAt, expires: readyAt + 10 * MIN };
    persist();
    return { key, target, readyAt: session.pending[key].readyAt, cooldownSec: session.cooldownSec, serverNow: t };
  }
  function confirmUnlock({ type, target, reason, minutes }) {
    if (type === 'filter') { confirmFilterOff(reason); return { ok: true }; }
    if (!session) throw new Error('No session is running.');
    target = type === 'site' ? siteUnlockTarget(String(target || '')) : type === 'app' ? String(target || '').toLowerCase() : 'session';
    const key = type + ':' + target, p = session.pending[key], t = now();
    if (!p || p.expires < t) throw new Error('Start the wait first.');
    if (t < p.readyAt) throw new Error(`Wait ${Math.ceil((p.readyAt - t) / 1000)} more seconds.`);
    reason = String(reason || '').trim().slice(0, 300);
    if (reason.length < 10) throw new Error('Write a real reason (at least 10 characters).');
    delete session.pending[key];
    if (type === 'end') { return { ended: true, summary: finishSession(true, reason) }; }
    const mins = clamp(minutes, 5, 30, 10);
    session.unlocks.push({ type, target, reason, at: t, until: t + mins * MIN });
    persist(); bus.emit('change');
    return { ok: true, until: t + mins * MIN };
  }
  function siteUnlockTarget(host) {
    const h = normalizeHost(host); if (!h) return null;
    if (session && session.mode === 'blocklist') { const e = session.sites.find((x) => hostMatches(h, x)); if (e) return e; }
    return h;
  }
  const unlocked = (type, target) => !!session && session.unlocks.some((u) => u.type === type && u.until > now() && (type === 'site' ? hostMatches(target, u.target) : u.target === target));

  // ---------- decisions ----------
  function siteDecision(hostIn) {
    const host = normalizeHost(hostIn);
    if (host && host !== 'localhost' && host !== '127.0.0.1' && settings.adultFilter && ADULT.isAdult(host)) return { blocked: true, host, adult: true };
    if (!session || onBreak() || !host) return { blocked: false };
    if (host === 'localhost' || host === '127.0.0.1') return { blocked: false };
    if (unlocked('site', host)) return { blocked: false };
    if (session.mode === 'allowlist') return { blocked: !matchesAny(host, session.allow), host };
    return { blocked: matchesAny(host, session.sites), host };
  }
  function logAttempt(type, target) {
    if (!session) return false;
    const key = type + ':' + target, t = now();
    if (lastBlockedAt[key] && t - lastBlockedAt[key] < 5000) return false; // one attempt per 5 s per target
    lastBlockedAt[key] = t; session.attempts.push({ t, type, target }); persist();
    bus.emit('change'); bus.emit('blocked', { type, target }); return true;
  }

  // ---------- app blocker ----------
  function scanApps() {
    if (!session || onBreak() || !session.apps.length) return [];
    const hits = [], t = now();
    for (const p of listProcs()) {
      const pat = session.apps.find((a) => appMatches(p, a));
      if (!pat || unlocked('app', pat)) continue;
      const again = killed[p.pid] && t - killed[p.pid] < 15000;
      kill(p.pid, again ? 'SIGKILL' : 'SIGTERM'); killed[p.pid] = t;
      hits.push({ pid: p.pid, app: pat }); logAttempt('app', pat);
    }
    return hits;
  }

  // ---------- tick ----------
  function tick() {
    if (!session) return;
    const t = now();
    if (session.breaks.until && session.breaks.until <= t) { session.breaks.until = 0; persist(); bus.emit('change'); }
    if (t >= session.endsAt) { finishSession(false); return; }
    scanApps();
    bus.emit('tick');
  }

  // ---------- snapshots ----------
  function publicSession() {
    if (!session) return null;
    const { pending, ...s } = session;
    return { ...s, onBreak: onBreak(), now: now(), attemptCount: s.attempts.length };
  }
  function history() { return readJson(files.history, []); }
  function stats() {
    const h = history(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const day = (i) => d0.getTime() - i * 86400000;
    const days = [];
    for (let i = 6; i >= 0; i--) { const a = day(i), b = a + 86400000; days.push({ date: a, focusMin: h.filter((x) => x.startedAt >= a && x.startedAt < b).reduce((s, x) => s + x.focusMin, 0) }); }
    const today = days[6];
    return { todayFocusMin: today.focusMin, todaySessions: h.filter((x) => x.startedAt >= day(0)).length, days, totalSessions: h.length, totalFocusMin: h.reduce((s, x) => s + x.focusMin, 0) };
  }
  const snapshot = () => ({ filterLog: filterLog.slice(-20), now: now(), settings: publicSettings(), session: publicSession(), extensionConnected: now() - extSeen < 75000, apiPort, stats: stats() });

  // ---------- local API for the browser extension ----------
  function api(req, res) {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = (req.url || '').split('?')[0];
    if (url === '/ping') return send(200, { ok: true, app: 'anchor' });
    const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const want = Buffer.from(settings.token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return send(401, { error: 'unauthorized' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let j = {}; try { j = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad json' }); }
      try {
        if (req.method === 'GET' && url === '/state') {
          extSeen = now(); bus.emit('ext');
          const s = session;
          return send(200, {
            serverNow: now(), adultFilter: settings.adultFilter, active: !!s, goal: s && s.goal, endsAt: s && s.endsAt, mode: s && s.mode, onBreak: onBreak(), breakUntil: s ? s.breaks.until : 0,
            sites: s ? s.sites : [], allow: s ? s.allow : [], cooldownSec: s ? s.cooldownSec : 60,
            unlocks: s ? s.unlocks.filter((u) => u.type === 'site' && u.until > now()).map((u) => ({ target: u.target, until: u.until })) : [],
          });
        }
        if (req.method === 'POST' && url === '/attempt') { const d = siteDecision(j.host); if (d.blocked && session) logAttempt('site', d.host); return send(200, { ok: true }); }
        if (req.method === 'POST' && url === '/unlock/request') return send(200, requestUnlock({ type: 'site', target: j.host }));
        if (req.method === 'POST' && url === '/unlock/confirm') return send(200, confirmUnlock({ type: 'site', target: j.host, reason: j.reason, minutes: j.minutes }));
        return send(404, { error: 'not found' });
      } catch (e) { return send(400, { error: e.message }); }
    });
  }
  function listen() {
    return new Promise((resolve) => {
      const tryPort = (i) => {
        if (i >= PORTS.length) return resolve(0);
        const s = http.createServer(api);
        s.once('error', () => tryPort(i + 1));
        s.listen(PORTS[i], '127.0.0.1', () => { server = s; apiPort = PORTS[i]; resolve(apiPort); });
      };
      tryPort(0);
    });
  }

  // copy the extension template and write its private config (token + ports)
  function exportExtension(srcDir, destDir) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(srcDir, destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'config.json'), JSON.stringify({ token: settings.token, ports: PORTS }));
    return destDir;
  }

  async function start() {
    await listen();
    if (!session) { try { dnd.off(); } catch {} } // recover from a crash that left Do Not Disturb on
    else { if (now() >= session.endsAt) finishSession(false); else if (settings.dnd) { try { dnd.on(); } catch {} } }
    timer = setInterval(tick, 1000); timer.unref && timer.unref();
  }
  function stop() { clearInterval(timer); if (server) server.close(); }

  return Object.assign(bus, {
    start, stop, tick, snapshot, history, stats, exportExtension,
    getSettings: publicSettings, setSettings, requestFilterOff, confirmFilterOff, turnFilterOn, startSession, startBreak, endBreak, requestUnlock, confirmUnlock, siteDecision, logAttempt, scanApps,
    finishSession, hasSession: () => !!session, getToken: () => settings.token, getPort: () => apiPort,
    _session: () => session,
  });
}

module.exports = { createCore, normalizeHost, normalizeApp, appMatches, hostMatches, DEFAULTS, PORTS };
