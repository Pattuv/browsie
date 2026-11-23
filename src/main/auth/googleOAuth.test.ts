import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' }));

const { buildAuthUrl, WORKSPACE_SCOPES } = await import('./googleOAuth');

const params = (extra?: { extraScopes?: string[] }) =>
  new URL(buildAuthUrl({ redirectUri: 'http://127.0.0.1:1234', codeChallenge: 'c', state: 's', ...extra }))
    .searchParams;

describe('buildAuthUrl', () => {
  // Signing back in must bring back Gmail, Calendar and Drive without reconnecting them.
  it('asks for previously granted permissions on a plain sign-in', () => {
    const query = params();
    expect(query.get('include_granted_scopes')).toBe('true');
    expect(query.get('scope')).not.toContain(WORKSPACE_SCOPES.gmail);
  });

  it('keeps earlier permissions when connecting Google Workspace', () => {
    const query = params({ extraScopes: Object.values(WORKSPACE_SCOPES) });
    expect(query.get('include_granted_scopes')).toBe('true');
    expect(query.get('scope')).toContain(WORKSPACE_SCOPES.gmail);
  });
});
