'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCore, normalizeHost, normalizeApp, appMatches } = require('../core');

function mk(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'));
  const clock = { t: 1_700_000_000_000 };
  const dndCalls = [];
  const killed = [];
  const procs = extra.procs || [];
  const core = createCore({
    dataDir: dir, now: () => clock.t, dnd: { on: () => dndCalls.push('on'), off: () => dndCalls.push('off') },
    listProcs: () => procs, kill: (pid, sig) => { killed.push([pid, sig]); return true; },
  });
  return { core, clock, dir, dndCalls, killed, procs, adv: (ms) => { clock.t += ms; } };
}

test('normalizeHost / normalizeApp validation', () => {
  assert.equal(normalizeHost('https://www.Reddit.com/r/linux?x=1'), 'reddit.com');
  assert.equal(normalizeHost('youtube.com'), 'youtube.com');
  assert.equal(normalizeHost('localhost'), 'localhost');
  assert.equal(normalizeHost('not a host'), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeApp('Discord'), 'discord');
  assert.equal(normalizeApp('ab'), null, 'too short');
  for (const bad of ['bash', 'chrome', 'gnome-shell', 'code', 'node', 'anchor']) assert.equal(normalizeApp(bad), null, bad);
  assert.equal(normalizeApp('rm -rf'), null);
});

test('session needs a goal; only one at a time; DND toggles', () => {
  const { core, dndCalls } = mk();
  assert.throws(() => core.startSession({ goal: '  ', minutes: 25 }), /working on/);
  const s = core.startSession({ goal: 'Build the login page', minutes: 25 });
  assert.equal(s.plannedMin, 25);
  assert.throws(() => core.startSession({ goal: 'again', minutes: 25 }), /already running/);
  assert.deepEqual(dndCalls, ['on']);
  const sum = core.finishSession(false);
  assert.equal(sum.goal, 'Build the login page');
  assert.deepEqual(dndCalls, ['on', 'off']);
  assert.equal(core.hasSession(), false);
});

test('blocklist mode blocks listed sites incl. subdomains, not others', () => {
  const { core } = mk();
  core.setSettings({ sites: ['reddit.com', 'youtube.com'], mode: 'blocklist' });
  assert.equal(core.siteDecision('reddit.com').blocked, false, 'no session => nothing blocked');
  core.startSession({ goal: 'work on parser', minutes: 30 });
  assert.equal(core.siteDecision('reddit.com').blocked, true);
  assert.equal(core.siteDecision('old.reddit.com').blocked, true);
  assert.equal(core.siteDecision('notreddit.com').blocked, false, 'suffix must be a real subdomain');
  assert.equal(core.siteDecision('github.com').blocked, false);
  assert.equal(core.siteDecision('localhost').blocked, false);
});

test('allowlist mode blocks everything except allowed', () => {
  const { core } = mk();
  core.setSettings({ allow: ['github.com', 'localhost'], mode: 'allowlist' });
  core.startSession({ goal: 'ship the feature', minutes: 30 });
  assert.equal(core.siteDecision('github.com').blocked, false);
  assert.equal(core.siteDecision('gist.github.com').blocked, false);
  assert.equal(core.siteDecision('twitter.com').blocked, true);
  assert.equal(core.siteDecision('news.ycombinator.com').blocked, true);
});

test('rules are locked during a session (cannot weaken the blocklist)', () => {
  const { core } = mk();
  core.startSession({ goal: 'focus time please', minutes: 30 });
  assert.throws(() => core.setSettings({ sites: [] }), /locked/);
  assert.throws(() => core.setSettings({ cooldownSec: 30 }), /locked/);
  core.setSettings({ defaultMinutes: 40 }); // harmless prefs are fine
});

test('session snapshot keeps the block config from the start', () => {
  const { core } = mk();
  core.setSettings({ sites: ['reddit.com'] });
  core.startSession({ goal: 'snapshot semantic', minutes: 30 });
  assert.deepEqual(core._session().sites, ['reddit.com']);
});

test('cooldown: must request, wait, and give a real reason', () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'], cooldownSec: 60 });
  core.startSession({ goal: 'cooldown test run', minutes: 30 });
  assert.throws(() => core.confirmUnlock({ type: 'site', target: 'reddit.com', reason: 'need docs from there' }), /wait first/i);
  const r = core.requestUnlock({ type: 'site', target: 'old.reddit.com' });
  assert.equal(r.target, 'reddit.com', 'subdomain maps to the blocklist entry');
  assert.equal(r.cooldownSec, 60);
  adv(30_000);
  assert.throws(() => core.confirmUnlock({ type: 'site', target: 'reddit.com', reason: 'long enough reason here' }), /Wait 30 more seconds/);
  adv(30_000);
  assert.throws(() => core.confirmUnlock({ type: 'site', target: 'reddit.com', reason: 'short' }), /real reason/);
  const ok = core.confirmUnlock({ type: 'site', target: 'reddit.com', reason: 'the answer to my bug is there', minutes: 10 });
  assert.ok(ok.ok);
  assert.equal(core.siteDecision('reddit.com').blocked, false, 'unlocked');
  adv(10 * 60_000 + 1000);
  assert.equal(core.siteDecision('reddit.com').blocked, true, 'blocked again after the window');
});

test('ending early needs the cooldown too and records the reason', () => {
  const { core, adv } = mk();
  core.startSession({ goal: 'end early flow', minutes: 60 });
  core.requestUnlock({ type: 'end' });
  adv(61_000);
  const r = core.confirmUnlock({ type: 'end', reason: 'urgent family emergency' });
  assert.ok(r.ended);
  assert.equal(r.summary.endedEarly, true);
  assert.equal(r.summary.endReason, 'urgent family emergency');
  assert.equal(core.hasSession(), false);
});

test('breaks: limited count, pause blocking, extend the session', () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'], maxBreaks: 1, breakMin: 5 });
  const s = core.startSession({ goal: 'break behaviour', minutes: 30 });
  const end0 = s.endsAt;
  core.startBreak();
  assert.equal(core.siteDecision('reddit.com').blocked, false, 'not blocked on a break');
  assert.equal(core._session().endsAt, end0 + 5 * 60_000, 'focus time is preserved');
  assert.throws(() => core.startBreak(), /already on a break/);
  adv(5 * 60_000 + 1000); core.tick();
  assert.equal(core.siteDecision('reddit.com').blocked, true, 'blocked again after break');
  assert.throws(() => core.startBreak(), /No breaks left/);
});

test('ending a break early gives back the unused time', () => {
  const { core, adv } = mk();
  const s = core.startSession({ goal: 'give back break', minutes: 30 });
  core.startBreak(); adv(60_000); core.endBreak();
  assert.equal(core._session().endsAt, s.endsAt + 60_000);
});

test('session ends by itself and is saved to history with a score', () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'] });
  core.startSession({ goal: 'auto finish', minutes: 25 });
  core.logAttempt('site', 'reddit.com');
  adv(25 * 60_000 + 500); core.tick();
  assert.equal(core.hasSession(), false);
  const h = core.history();
  assert.equal(h.length, 1);
  assert.equal(h[0].attempts, 1);
  assert.equal(h[0].endedEarly, false);
  assert.equal(h[0].score, 100);
  assert.equal(core.stats().totalSessions, 1);
});

test('unlocked time lowers the focus score', () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'], cooldownSec: 30 });
  core.startSession({ goal: 'score test session', minutes: 20 });
  core.requestUnlock({ type: 'site', target: 'reddit.com' }); adv(31_000);
  core.confirmUnlock({ type: 'site', target: 'reddit.com', reason: 'need a thread for the task', minutes: 5 });
  adv(20 * 60_000); core.tick();
  const h = core.history()[0];
  assert.equal(h.unlocks.length, 1);
  assert.ok(h.unlockMin >= 4 && h.unlockMin <= 5, 'unlockMin ' + h.unlockMin);
  assert.ok(h.score < 100 && h.score > 50, 'score ' + h.score);
});

test('attempts are de-duplicated within 5 seconds', () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'] });
  core.startSession({ goal: 'dedupe attempts', minutes: 20 });
  assert.equal(core.logAttempt('site', 'reddit.com'), true);
  assert.equal(core.logAttempt('site', 'reddit.com'), false);
  adv(6000);
  assert.equal(core.logAttempt('site', 'reddit.com'), true);
});

test('app blocker kills matching own processes only, escalates to SIGKILL, respects break/unlock', () => {
  const procs = [{ pid: 101, comm: 'Discord', exe: '/opt/discord/Discord', argv0: '/opt/discord/Discord' }, { pid: 202, comm: 'nvim', exe: '/usr/bin/nvim', argv0: 'nvim' }, { pid: 303, comm: 'chrome', exe: '/opt/google/chrome/chrome', argv0: 'chrome' }];
  const { core, killed, adv } = mk({ procs });
  core.setSettings({ apps: ['discord'] });
  core.startSession({ goal: 'app blocking test', minutes: 30 });
  let hits = core.scanApps();
  assert.deepEqual(hits.map((h) => h.pid), [101]);
  assert.deepEqual(killed, [[101, 'SIGTERM']]);
  adv(3000); core.scanApps();
  assert.deepEqual(killed[1], [101, 'SIGKILL'], 'second sighting within 15 s escalates');
  assert.equal(core.history().length, 0);
  core.startBreak(); killed.length = 0; core.scanApps();
  assert.equal(killed.length, 0, 'nothing killed during a break');
});

test('app unlock lets the app live for the window', () => {
  const procs = [{ pid: 7, comm: 'steam', exe: '/usr/bin/steam', argv0: 'steam' }];
  const { core, killed, adv } = mk({ procs });
  core.setSettings({ apps: ['steam'], cooldownSec: 30 });
  core.startSession({ goal: 'unlock an app please', minutes: 30 });
  core.requestUnlock({ type: 'app', target: 'steam' }); adv(31_000);
  core.confirmUnlock({ type: 'app', target: 'steam', reason: 'must update a work tool', minutes: 5 });
  core.scanApps(); assert.equal(killed.length, 0);
  adv(5 * 60_000 + 1000); core.scanApps(); assert.equal(killed.length, 1);
});

test('appMatches uses process names, never arguments', () => {
  assert.equal(appMatches({ comm: 'Telegram', exe: '/x/Telegram', argv0: '' }, 'telegram'), true);
  assert.equal(appMatches({ comm: 'telegram-deskto' }, 'telegram'), true);
  assert.equal(appMatches({ comm: 'chrome', exe: '/opt/chrome/chrome', argv0: '/opt/chrome/chrome' }, 'discord'), false);
});

test('a running session survives a restart; an expired one is finalised', async () => {
  const a = mk();
  a.core.startSession({ goal: 'persist across restarts', minutes: 30 });
  const b = createCore({ dataDir: a.dir, now: () => a.clock.t, dnd: { on() {}, off() {} }, listProcs: () => [] });
  assert.equal(b.hasSession(), true);
  a.adv(31 * 60_000);
  const c = createCore({ dataDir: a.dir, now: () => a.clock.t, dnd: { on() {}, off() {} }, listProcs: () => [] });
  await c.start(); c.stop();
  assert.equal(c.hasSession(), false);
  assert.equal(c.history().length, 1);
});

async function call(port, token, method, url, body) {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}

test('local API: auth, state, attempts, and the server-side cooldown', async () => {
  const { core, adv } = mk();
  core.setSettings({ sites: ['reddit.com'], cooldownSec: 30 });
  await core.start();
  const port = core.getPort(), token = core.getToken();
  try {
    assert.ok(port >= 47821);
    const ping = await fetch(`http://127.0.0.1:${port}/ping`); assert.equal((await ping.json()).app, 'anchor');
    const bad = await call(port, 'wrong', 'GET', '/state'); assert.equal(bad.status, 401);
    let st = await call(port, token, 'GET', '/state'); assert.equal(st.json.active, false);
    assert.equal(core.snapshot().extensionConnected, true, 'a /state poll marks the extension as connected');
    core.startSession({ goal: 'api behaviour test', minutes: 30 });
    st = await call(port, token, 'GET', '/state');
    assert.equal(st.json.active, true); assert.deepEqual(st.json.sites, ['reddit.com']); assert.equal(st.json.goal, 'api behaviour test');
    await call(port, token, 'POST', '/attempt', { host: 'reddit.com' });
    await call(port, token, 'POST', '/attempt', { host: 'github.com' }); // not blocked => not logged
    assert.equal(core._session().attempts.length, 1);
    const early = await call(port, token, 'POST', '/unlock/confirm', { host: 'reddit.com', reason: 'trying to skip the wait' });
    assert.equal(early.status, 400);
    const req = await call(port, token, 'POST', '/unlock/request', { host: 'reddit.com' });
    assert.equal(req.status, 200);
    const tooSoon = await call(port, token, 'POST', '/unlock/confirm', { host: 'reddit.com', reason: 'trying to skip the wait' });
    assert.equal(tooSoon.status, 400); assert.match(tooSoon.json.error, /Wait/);
    adv(31_000);
    const ok = await call(port, token, 'POST', '/unlock/confirm', { host: 'reddit.com', reason: 'need the docs thread now', minutes: 5 });
    assert.equal(ok.status, 200);
    st = await call(port, token, 'GET', '/state'); assert.equal(st.json.unlocks.length, 1);
  } finally { core.stop(); }
});

test('exportExtension writes a private config', () => {
  const { core, dir } = mk();
  const src = path.join(dir, 'src'); fs.mkdirSync(src); fs.writeFileSync(path.join(src, 'manifest.json'), '{}');
  const dest = core.exportExtension(src, path.join(dir, 'out'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
  assert.equal(cfg.token, core.getToken()); assert.ok(cfg.ports.length >= 1);
});

test('extension manifest works for Chrome and Firefox', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, 'background.js', 'Chrome needs a service worker');
  assert.deepEqual(m.background.scripts, ['background.js'], 'Firefox needs background.scripts');
  assert.ok(m.browser_specific_settings.gecko.id, 'Firefox needs an add-on id');
  assert.ok(m.permissions.includes('webNavigation'));
  for (const f of ['background.js', 'blocked.html', 'blocked.js', 'blocked.css', 'icons/icon-48.png']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'extension', f)), f);
  const bg = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
  assert.ok(!/\bchrome\.(tabs|runtime|webNavigation|alarms)/.test(bg), 'use the cross-browser `ext` alias, not chrome.* directly');
});
