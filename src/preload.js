const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('theo', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  shouldAnimateOnboarding: () => ipcRenderer.invoke('should-animate-onboarding'),
  markOnboardingPlayed: () => ipcRenderer.invoke('mark-onboarding-played'),
});
