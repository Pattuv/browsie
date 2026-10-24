import { app } from 'electron';
import path from 'node:path';
import { connectWorkspace, getAccessToken, getAccountId, getSession, invalidateAccessToken, workspaceAccess } from '../auth/session';
import { createGoogleTools } from '../google/tools';
import { bringToFront, getBrowserWindow } from '../windows';
import { agentCursor, agentTabContents, isAgentContents, leaseAgentTab, releaseAgentTab, sendToChrome } from '../browser/tabs';
import { getDownloadsFolder, setDownloadPolicy } from '../browser/webSession';
import { readAiKey } from '../data/aiKey';
import { createBroker } from './broker';
import { createChromeApi } from './chromeApi';
import { chromeOperations } from './chromeOperations';
import { type AgentHost, createAgentHost } from './host';

// The app's one agent host, wired to the real tabs, the account's OpenRouter key and its downloads folder.
// Created the first time something needs it (the voice layer, from phase 6 on), so the agent process
// isn't started until there's a task for it.

let host: AgentHost | undefined;

export const getAgentHost = () => {
  if (host) return host;

  const broker = createBroker({
    getKey: () => {
      const accountId = getAccountId();
      return accountId ? readAiKey(accountId) : null;
    },
  });

  host = createAgentHost({
    // Built next to main.js by the worker entry in forge.config.js.
    workerPath: path.join(__dirname, 'worker.js'),
    broker,
    resolveTab: agentTabContents,
    leaseTab: leaseAgentTab,
    releaseTab: releaseAgentTab,
    downloadsFolder: getDownloadsFolder,
    chrome: createChromeApi(chromeOperations),
    cursor: agentCursor,
    google: {
      tools: createGoogleTools({ getToken: getAccessToken, invalidateToken: invalidateAccessToken }),
      access: workspaceAccess,
      email: () => getSession().email,
      // Google's page opens in the user's browser, like sign-in. Browsie comes back to the front after.
      connect: () =>
        connectWorkspace(() => {
          const window = getBrowserWindow();
          if (window && !window.isDestroyed()) bringToFront(window);
        }),
    },
  });

  // Only the tab the agent is working on may download, and the task hears about it.
  setDownloadPolicy({
    allow: isAgentContents,
    onStarted: (contents, fileName) => host?.noteDownload(contents, fileName),
  });

  host.onSession((turns) => sendToChrome('session:changed', turns));

  app.once('will-quit', () => host?.stop());
  return host;
};

export const getSessionTurns = () => host?.getSession() ?? [];

export const clearSessionTurns = () => host?.clearSession();
