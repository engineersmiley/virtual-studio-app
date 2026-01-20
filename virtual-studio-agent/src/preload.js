const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  connect: (sessionCode, sessionToken) => 
    ipcRenderer.invoke('connect', { sessionCode, sessionToken }),
  disconnect: () => 
    ipcRenderer.invoke('disconnect'),
  stopControl: () => 
    ipcRenderer.invoke('stop-control'),
  getStatus: () => 
    ipcRenderer.invoke('get-status'),
  
  onConnectionStatus: (callback) => {
    ipcRenderer.on('connection-status', (event, data) => callback(data));
  },
  onControlStatus: (callback) => {
    ipcRenderer.on('control-status', (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, error) => callback(error));
  }
});
