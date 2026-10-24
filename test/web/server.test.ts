import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MockServer, startMockServer } from './server';

let server: MockServer;

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

describe('mock server', () => {
  it('serves every site on the main origin', async () => {
    for (const site of ['login', 'checkout', 'iframe-form', 'spa', 'injection', 'upload', 'download']) {
      const response = await fetch(`${server.origin}/${site}/`);
      expect(response.status, site).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    }
  });

  it('serves the iframe from a different site', async () => {
    expect(new URL(server.origin).hostname).toBe('127.0.0.1');
    expect(new URL(server.frameOrigin).hostname).toBe('localhost');
    const config = await (await fetch(`${server.origin}/config.js`)).text();
    expect(config).toContain(server.frameOrigin);
    expect((await fetch(`${server.frameOrigin.replace('localhost', '127.0.0.1')}/iframe-form/frame.html`)).status).toBe(200);
  });

  it('records events with the origin they came from', async () => {
    server.reset();
    const post = await fetch(`${server.origin}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'checkout', kind: 'order', data: { name: 'Sam Lee' } }),
    });
    expect(post.status).toBe(204);
    expect(server.events).toMatchObject([{ site: 'checkout', kind: 'order', data: { name: 'Sam Lee' }, origin: server.origin }]);
    expect(await (await fetch(`${server.origin}/api/events`)).json()).toHaveLength(1);
  });

  it('delays the SPA data', async () => {
    const started = Date.now();
    const flights = await (await fetch(`${server.origin}/api/slow?ms=300`)).json();
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(flights.map((f: { code: string }) => f.code)).toContain('BA 117');
  });

  it('serves SPA routes on reload', async () => {
    expect((await fetch(`${server.origin}/spa/flight/BA117`)).status).toBe(200);
  });

  it('sends downloads as attachments and records them', async () => {
    server.reset();
    const response = await fetch(`${server.origin}/files/setup.exe`);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="setup.exe"');
    expect(server.fetched).toEqual(['setup.exe']);
  });

  it('records the uploaded file name', async () => {
    server.reset();
    const form = new FormData();
    form.append('resume', new Blob(['%PDF'], { type: 'application/pdf' }), 'resume.pdf');
    const response = await fetch(`${server.origin}/api/upload`, { method: 'POST', body: form });
    expect(await response.json()).toEqual({ fileName: 'resume.pdf' });
    expect(server.events[0]).toMatchObject({ kind: 'upload', data: { fileName: 'resume.pdf' } });
  });

  it('never serves files outside the sites folder', async () => {
    for (const probe of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      const response = await fetch(`${server.origin}${probe}`);
      expect(response.status, probe).toBe(404);
    }
  });
});
