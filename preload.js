const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onToggleDarkMode: (callback) => ipcRenderer.on('toggle-dark-mode', (event, isDark) => callback(isDark)),
  onFileOpen: (callback) => ipcRenderer.on('file-open', callback),
  onFileSave: (callback) => ipcRenderer.on('file-save', callback)
});
