const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('director', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  sendCommand: (host, port, command) => ipcRenderer.invoke('send-command', { host, port, command }),
  sendCommandAll: (command) => ipcRenderer.invoke('send-command-all', { command }),
  getHealthAll: () => ipcRenderer.invoke('get-health-all'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  openConfigDir: () => ipcRenderer.invoke('open-config-dir')
});