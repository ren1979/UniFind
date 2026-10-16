const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unifind', {
  chooseCharacter: (character, insert = true) =>
    ipcRenderer.invoke('character:choose', { character, insert }),
  hide: () => ipcRenderer.send('popup:hide'),
  getAppStatus: () => ipcRenderer.invoke('app:status'),
  onPopupShown: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('popup:shown', listener);
    return () => ipcRenderer.removeListener('popup:shown', listener);
  }
});
