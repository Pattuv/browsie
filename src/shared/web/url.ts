// Only real web addresses. Blocks file://, javascript:, other apps' custom schemes and our own pages.
// Lives here rather than in webSession.ts so the agent process can use it without loading Electron.
export const isWebUrl = (rawUrl: string) => {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};
