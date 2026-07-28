import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('theo', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateOnboarding: () => ipcRenderer.invoke('should-animate-onboarding'),
  markOnboardingPlayed: () => ipcRenderer.invoke('mark-onboarding-played'),
});
