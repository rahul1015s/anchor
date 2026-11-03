const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { createCore } = require('./core');

// Run through XWayland so "always on top" works for the compact session window (Wayland ignores it).
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.setDesktopName('anchor.desktop');

let win = null, core = null, normalBounds = null, compact = false;
const HOME_SIZE = { width: 1040, height: 760 };
const COMPACT = { width: 380, height: 400 };

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

function enterCompact() {
  if (!win || compact) return; compact = true;
  normalBounds = win.getBounds();
  win.setMinimumSize(340, 300);
  win.setSize(COMPACT.width, COMPACT.height);
  const wa = screen.getPrimaryDisplay().workArea;
  win.setPosition(wa.x + wa.width - COMPACT.width - 24, wa.y + 24);
  win.setAlwaysOnTop(true, 'floating');
  win.show();
}
function leaveCompact() {
  if (!win || !compact) return; compact = false;
  win.setAlwaysOnTop(false); win.setMinimumSize(760, 560);
  win.setSize(HOME_SIZE.width, HOME_SIZE.height); win.center(); win.show(); win.focus();
}
function resizeForModal(open) { if (win && compact) { win.setSize(open ? 420 : COMPACT.width, open ? 520 : COMPACT.height); } }

function createWindow() {
  win = new BrowserWindow({
    ...HOME_SIZE, minWidth: 760, minHeight: 560, backgroundColor: '#0e1419', title: 'Anchor', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-finish-load', () => { if (core.hasSession()) enterCompact(); send('snap', core.snapshot()); });
  // While a session runs the window can only be minimised, not closed (ending requires the cooldown).
  win.on('close', (e) => { if (core.hasSession()) { e.preventDefault(); win.minimize(); } });
}

function notify(title, body) { try { if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show(); } catch {} }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    core = createCore({ dataDir: app.getPath('userData') });
    await core.start();
    core.exportExtension(path.join(__dirname, 'extension'), path.join(app.getPath('userData'), 'extension'));

    core.on('change', () => send('snap', core.snapshot()));
    core.on('tick', () => send('snap', core.snapshot()));
    core.on('ext', () => {});
    core.on('started', () => enterCompact());
    core.on('blocked', (b) => send('blocked', b));
    core.on('ended', (summary) => {
      leaveCompact(); send('ended', summary); send('snap', core.snapshot());
      notify(summary.endedEarly ? 'Session ended early' : 'Session complete', `${summary.goal} · ${summary.focusMin} min focused · ${summary.score}%`);
    });

    const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message }; } };
    ipcMain.handle('snap', () => core.snapshot());
    ipcMain.handle('session:start', wrap((o) => core.startSession(o)));
    ipcMain.handle('session:break', wrap(() => core.startBreak()));
    ipcMain.handle('session:endBreak', wrap(() => core.endBreak()));
    ipcMain.handle('unlock:request', wrap((o) => core.requestUnlock(o)));
    ipcMain.handle('unlock:confirm', wrap((o) => core.confirmUnlock(o)));
    ipcMain.handle('settings:set', wrap((p) => core.setSettings(p)));
    ipcMain.handle('history:list', () => core.history().slice().reverse());
    ipcMain.handle('ui:modal', (_e, open) => resizeForModal(open));
    ipcMain.handle('ext:info', () => ({ dir: path.join(app.getPath('userData'), 'extension'), port: core.getPort(), connected: core.snapshot().extensionConnected }));
    ipcMain.handle('ext:reveal', () => shell.showItemInFolder(path.join(app.getPath('userData'), 'extension', 'manifest.json')));
    ipcMain.handle('ext:copy', () => { clipboard.writeText(path.join(app.getPath('userData'), 'extension')); return true; });
    ipcMain.handle('ext:openChrome', () => {
      try { const p = spawn('google-chrome', ['chrome://extensions'], { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); return true; } catch { return false; }
    });
    createWindow();
  });
  app.on('before-quit', (e) => { if (core && core.hasSession()) e.preventDefault(); });
  app.on('window-all-closed', () => { if (!core || !core.hasSession()) app.quit(); });
  app.on('will-quit', () => { if (core) core.stop(); });
}
