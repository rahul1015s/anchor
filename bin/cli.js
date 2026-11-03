#!/usr/bin/env node
// Anchor installer.   npx github:rahul1015s/anchor            install for this user and launch
//                     npx github:rahul1015s/anchor uninstall  [--purge]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const SRC = path.join(__dirname, '..');
const pkg = require(path.join(SRC, 'package.json'));
const HOME = os.homedir();
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const APP = path.join(DATA, 'anchor-app');
const BIN = path.join(HOME, '.local', 'bin');
const APPS = path.join(DATA, 'applications');
const ICONS = path.join(DATA, 'icons', 'hicolor');
const LAUNCHER = path.join(BIN, 'anchor');
const DESKTOP = path.join(APPS, 'anchor.desktop');
const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || 'install';
const has = (f) => args.includes(f);
const log = (m = '') => console.log(m);
const step = (m) => console.log('\x1b[36m▸\x1b[0m ' + m);
const die = (m) => { console.error('\x1b[31m✗ ' + m + '\x1b[0m'); process.exit(1); };
const which = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim();

function install() {
  if (process.platform !== 'linux') die('Anchor currently supports Linux desktops only.');
  if (!which('npm')) die('npm was not found. Install Node.js first (Fedora: sudo dnf install nodejs).');
  log('\n  Anchor – focus sessions that block distractions\n');
  step('Installing app files to ' + APP);
  fs.mkdirSync(APP, { recursive: true });
  for (const d of ['renderer', 'assets', 'extension']) { fs.rmSync(path.join(APP, d), { recursive: true, force: true }); fs.cpSync(path.join(SRC, d), path.join(APP, d), { recursive: true }); }
  for (const f of ['main.js', 'core.js', 'preload.js', 'LICENSE', 'README.md']) if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(APP, f));
  fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: 'main.js', license: pkg.license, dependencies: { electron: pkg.devDependencies.electron } }, null, 2) + '\n');

  step('Installing Electron (first time downloads ~100 MB)…');
  if (spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: APP, stdio: 'inherit' }).status !== 0) die('npm install failed.');
  const electron = path.join(APP, 'node_modules', 'electron');
  if (!fs.existsSync(path.join(electron, 'dist', 'electron'))) spawnSync(process.execPath, [path.join(electron, 'install.js')], { stdio: 'inherit' });
  if (!fs.existsSync(path.join(electron, 'dist', 'electron'))) die('Electron binary is missing (download failed?).');

  step('Creating the `anchor` command and app-menu entry');
  fs.mkdirSync(BIN, { recursive: true });
  fs.writeFileSync(LAUNCHER, `#!/bin/bash\ncd "${APP}" && exec ./node_modules/.bin/electron . "$@"\n`, { mode: 0o755 });
  for (const s of [48, 64, 128, 256, 512]) { const d = path.join(ICONS, `${s}x${s}`, 'apps'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(SRC, 'assets', `icon-${s}.png`), path.join(d, 'anchor.png')); }
  const sc = path.join(ICONS, 'scalable', 'apps'); fs.mkdirSync(sc, { recursive: true }); fs.copyFileSync(path.join(SRC, 'assets', 'icon.svg'), path.join(sc, 'anchor.svg'));
  fs.mkdirSync(APPS, { recursive: true });
  fs.writeFileSync(DESKTOP, `[Desktop Entry]\nName=Anchor\nComment=Focus sessions that block distracting sites and apps\nExec=${LAUNCHER}\nIcon=anchor\nTerminal=false\nType=Application\nCategories=Utility;Education;\nStartupWMClass=Anchor\n`);
  spawnSync('update-desktop-database', [APPS], { stdio: 'ignore' });
  spawnSync('gtk-update-icon-cache', ['-f', '-t', ICONS], { stdio: 'ignore' });

  log(); log('\x1b[32m✓ Anchor installed.\x1b[0m  Open it from your app menu, or run: anchor');
  log('  Next: open Anchor → Settings → "Browser extension" and load the extension in Chrome (2 minutes) to block websites.');
  if (!(process.env.PATH || '').split(':').includes(BIN)) log(`  Note: add ${BIN} to your PATH to use the \`anchor\` command.`);
  if (!has('--no-launch') && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) spawn(LAUNCHER, [], { detached: true, stdio: 'ignore' }).unref();
}
function uninstall() {
  step('Removing Anchor');
  for (const p of [LAUNCHER, DESKTOP, APP]) fs.rmSync(p, { recursive: true, force: true });
  for (const s of ['48x48', '64x64', '128x128', '256x256', '512x512', 'scalable']) for (const e of ['png', 'svg']) fs.rmSync(path.join(ICONS, s, 'apps', 'anchor.' + e), { force: true });
  spawnSync('update-desktop-database', [APPS], { stdio: 'ignore' });
  if (has('--purge')) { fs.rmSync(path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Anchor'), { recursive: true, force: true }); log('Settings and history deleted.'); }
  else log('Your settings and history were kept (~/.config/Anchor). Use --purge to delete them too.');
  log('Remember to remove the Anchor extension from chrome://extensions.');
  log('\x1b[32m✓ Uninstalled.\x1b[0m');
}
if (cmd === 'install') install(); else if (cmd === 'uninstall') uninstall(); else die('Unknown command: ' + cmd + '  (try: install, uninstall)');
