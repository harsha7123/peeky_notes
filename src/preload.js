const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('peeky', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: on('state'),
  onPanel: on('panel'),
  onAuth: on('auth'),
  expand: (focus) => ipcRenderer.invoke('panel:expand', focus),
  collapse: () => ipcRenderer.invoke('panel:collapse'),
  signIn: () => ipcRenderer.invoke('auth:start'),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel'),
  signOut: () => ipcRenderer.invoke('auth:signout'),
  openWeb: (path) => ipcRenderer.invoke('open:web', path),
  createNote: () => ipcRenderer.invoke('note:create'),
  updateNote: (id, patch) => ipcRenderer.invoke('note:update', id, patch),
  deleteNote: (id) => ipcRenderer.invoke('note:delete', id),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  reminder: (id, action, minutes) => ipcRenderer.invoke('reminder:action', id, action, minutes),
  testBuddy: (buddy) => ipcRenderer.invoke('buddy:test', buddy),
  onBuddy: on('buddy:show'),
  onCursor: on('buddy:cursor'),
  buddyReady: () => ipcRenderer.send('buddy:ready'),
  buddyClosed: () => ipcRenderer.send('buddy:closed'),
  ignoreMouse: (ignore) => ipcRenderer.send('buddy:ignore', ignore),
});
