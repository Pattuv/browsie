import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

// Serves the mock sites for the WEB lane's eval, and records what actually happened on them (orders placed,
// emails subscribed, files uploaded or fetched) so runs are graded on outcomes rather than on what the agent
// says it did.
//
// Two listeners on loopback share one handler and one log. The second is reached as `localhost`, which is a
// different site from `127.0.0.1`, so a page embedding it gets a real out-of-process iframe.

// From the project root, where npm scripts run. The harness is bundled elsewhere, so __dirname would be wrong.
export const SITES_DIR = path.resolve(process.cwd(), 'test/web/sites');

export type MockEvent = {
  site: string;
  kind: string;
  data: Record<string, unknown>;
  // Which listener the request came in on, e.g. the iframe's origin.
  origin: string;
  at: number;
};

export type MockServer = {
  origin: string;
  frameOrigin: string;
  events: MockEvent[];
  // Files requested from /files/, whether or not the browser kept them.
  fetched: string[];
  reset: () => void;
  close: () => Promise<void>;
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

// Small but real enough for a browser to treat as the right kind of file.
const FILES: Record<string, { type: string; body: Buffer }> = {
  'report.pdf': { type: 'application/pdf', body: Buffer.from('%PDF-1.4\n% Mug Shop Q3 report\n%%EOF\n') },
  'setup.exe': { type: 'application/octet-stream', body: Buffer.from('MZ\x90\x00 mock executable') },
};

const FLIGHTS = [
  { code: 'TP 1351', time: '06:40', price: 189 },
  { code: 'BA 117', time: '08:15', price: 240 },
  { code: 'FR 8364', time: '11:05', price: 74 },
  { code: 'U2 7613', time: '14:30', price: 96 },
  { code: 'TP 1357', time: '19:50', price: 205 },
];

const MAX_JSON = 64 * 1024;
const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_SLOW_MS = 5_000;

const readBody = (req: http.IncomingMessage, limit: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const send = (res: http.ServerResponse, status: number, body: string | Buffer = '', headers: http.OutgoingHttpHeaders = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

const json = (res: http.ServerResponse, value: unknown) => send(res, 200, JSON.stringify(value), { 'Content-Type': TYPES['.json'] });

// Resolves a URL path to a file under the sites folder, or undefined. Never leaves the folder.
const resolveStatic = (sitesDir: string, pathname: string) => {
  const target = path.resolve(sitesDir, `.${pathname}`);
  if (target !== sitesDir && !target.startsWith(sitesDir + path.sep)) return undefined;

  const candidate = pathname.endsWith('/') ? path.join(target, 'index.html') : target;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  // The SPA's client-side routes still load its page on a reload.
  if (pathname.startsWith('/spa/')) return path.join(sitesDir, 'spa', 'index.html');
  return undefined;
};

export const startMockServer = async (sitesDir = SITES_DIR): Promise<MockServer> => {
  const events: MockEvent[] = [];
  const fetched: string[] = [];
  const origins = { origin: '', frameOrigin: '' };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const origin = `http://${req.headers.host ?? ''}`;

    if (req.method === 'GET' && url.pathname === '/config.js') {
      const config = JSON.stringify(origins);
      return send(res, 200, `window.MOCK = ${config};`, { 'Content-Type': TYPES['.js'] });
    }

    if (req.method === 'POST' && url.pathname === '/api/event') {
      const body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}');
      events.push({
        site: String(body.site ?? ''),
        kind: String(body.kind ?? ''),
        data: typeof body.data === 'object' && body.data ? body.data : {},
        origin,
        at: Date.now(),
      });
      return send(res, 204);
    }

    if (req.method === 'GET' && url.pathname === '/api/events') return json(res, events);

    // A stand-in for OpenRouter, for checking the agent plumbing at no cost: always says it's done, citing
    // the SPA's heading as evidence.
    if (req.method === 'POST' && url.pathname === '/fake-openrouter') {
      await readBody(req, MAX_UPLOAD);
      return json(res, {
        model: 'fake/model',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'fake1',
                  type: 'function',
                  function: {
                    name: 'act',
                    arguments: JSON.stringify({
                      plan: ['Check the page'],
                      actions: [{ type: 'finish', summary: 'The page lists flights to Lisbon.', evidence: ['Flights to Lisbon'] }],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/slow') {
      const ms = Math.min(Number(url.searchParams.get('ms')) || 0, MAX_SLOW_MS);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return json(res, FLIGHTS);
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const body = (await readBody(req, MAX_UPLOAD)).toString('latin1');
      // Good enough for one file field: the multipart header names the file.
      const fileName = body.match(/filename="([^"]*)"/)?.[1] ?? '';
      events.push({ site: 'upload', kind: 'upload', data: { fileName, bytes: body.length }, origin, at: Date.now() });
      return json(res, { fileName });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const name = url.pathname.slice('/files/'.length);
      const file = FILES[name];
      if (!file) return send(res, 404, 'Not found');
      fetched.push(name);
      return send(res, 200, file.body, {
        'Content-Type': file.type,
        'Content-Disposition': `attachment; filename="${name}"`,
      });
    }

    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

    const file = resolveStatic(sitesDir, decodeURIComponent(url.pathname));
    if (!file) return send(res, 404, 'Not found');
    return send(res, 200, fs.readFileSync(file), {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
  };

  const listener = (req: http.IncomingMessage, res: http.ServerResponse) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 400, 'Bad request');
    });
  };

  const listen = (server: http.Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });

  const main = http.createServer(listener);
  const frame = http.createServer(listener);
  const [mainPort, framePort] = await Promise.all([listen(main), listen(frame)]);

  origins.origin = `http://127.0.0.1:${mainPort}`;
  origins.frameOrigin = `http://localhost:${framePort}`;

  const close = (server: http.Server) =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  return {
    ...origins,
    events,
    fetched,
    reset: () => {
      events.length = 0;
      fetched.length = 0;
    },
    close: async () => {
      await Promise.all([close(main), close(frame)]);
    },
  };
};
