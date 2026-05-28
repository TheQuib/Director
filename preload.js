const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('director', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  sendCommand: (host, port, command) => ipcRenderer.invoke('send-command', { host, port, command }),
  sendCommandAll: (command) => ipcRenderer.invoke('send-command-all', { command }),
  getHealthAll: () => ipcRenderer.invoke('get-health-all'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  openConfigDir:  () => ipcRenderer.invoke('open-config-dir'),
  setLogVisible:  (visible) => ipcRenderer.invoke('set-log-visible', visible),
  getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:  () => ipcRenderer.invoke('download-update'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),
  onUpdater: (cb) => ipcRenderer.on('updater', (_e, data) => cb(data))
});