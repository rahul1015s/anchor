const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  snap: inv('snap'), start: inv('session:start'), breakStart: inv('session:break'), breakEnd: inv('session:endBreak'),
  unlockRequest: inv('unlock:request'), unlockConfirm: inv('unlock:confirm'), setSettings: inv('settings:set'), history: inv('history:list'),
  modal: inv('ui:modal'), extInfo: inv('ext:info'), extReveal: inv('ext:reveal'), extCopy: inv('ext:copy'), extOpenChrome: inv('ext:openChrome'), extOpenFirefox: inv('ext:openFirefox'),
  onSnap: (cb) => ipcRenderer.on('snap', (_e, s) => cb(s)),
  onBlocked: (cb) => ipcRenderer.on('blocked', (_e, b) => cb(b)),
  onEnded: (cb) => ipcRenderer.on('ended', (_e, s) => cb(s)),
});
