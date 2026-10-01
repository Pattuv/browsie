import http from 'node:http';
import type { AddressInfo } from 'node:net';
import bricolageFont from '../../assets/fonts/Bricolage/BricolageGrotesque-VariableFont_opsz,wdth,wght.ttf?inline';
import mascotSvg from '../../assets/mascot.svg?raw';

// Thrown when the attempt ends without an error worth showing: the user cancelled,
// denied consent, or never finished in time. Session treats it as "still signed out".
export class SignInAborted extends Error {}

export type Loopback = {
  redirectUri: string;
  code: Promise<string>;
  cancel: () => void;
};

// The server closes right after sending this page, so the browser can't come back for
// images or fonts. Everything is baked in: the mascot as raw SVG markup, the heading font
// as a base64 data: URL. Body text uses Inter if installed, else the system font (near-identical).
const PAGE_STYLES = `
  @font-face {
    font-family: "Bricolage Grotesque";
    src: url("${bricolageFont}") format("truetype");
    font-weight: 200 800;
  }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #000;
         font-family: Inter, -apple-system, system-ui, sans-serif; text-align: center; }
  main { display: flex; flex-direction: column; align-items: center; padding: 2rem; }
  svg { height: 128px; width: auto; }
  h1 { margin: 0.25rem 0 0; font-family: "Bricolage Grotesque", system-ui, sans-serif;
       font-size: 2.2rem; font-weight: 400; letter-spacing: -0.05em; }
  p { margin: 1rem 0 0; font-size: 1.125rem; letter-spacing: -0.025em; color: #52525b; }
`;

// Static strings only (never echo request data into HTML).
const page = (title: string, message: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · Browsie</title>
    <style>${PAGE_STYLES}</style>
  </head>
  <body>
    <main>
      ${mascotSvg}
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

const SUCCESS_PAGE = page('You’re signed in', 'You can close this tab and return to Browsie.');
const DENIED_PAGE = page('Sign-in cancelled', 'You can close this tab and return to Browsie.');

// Listens on 127.0.0.1 only (unreachable from other machines), on a port the OS picks,
// for exactly one valid callback, then shuts down. Also shuts down on cancel or timeout.
export const startLoopback = async (expectedState: string, timeoutMs: number): Promise<Loopback> => {
  const server = http.createServer();
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Mark as handled so a cancel/timeout before anyone awaits `code` isn't an "unhandled rejection".
  code.catch(() => undefined);

  const shutDown = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };

  const timer = setTimeout(() => {
    shutDown();
    rejectCode(new SignInAborted('timeout'));
  }, timeoutMs);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}`;

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);

    // Browsers also ask for /favicon.ico etc. Only the root path is the real callback.
    // A wrong state means someone else's request: refuse it but keep waiting for ours.
    if (url.pathname !== '/' || url.searchParams.get('state') !== expectedState) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const authCode = url.searchParams.get('code');

    if (authCode) {
      resolveCode(authCode);
      res.end(SUCCESS_PAGE, shutDown);
      return;
    }

    // e.g. ?error=access_denied when the user clicks Cancel on Google's screen.
    rejectCode(new SignInAborted(url.searchParams.get('error') ?? 'no_code'));
    res.end(DENIED_PAGE, shutDown);
  });

  return {
    redirectUri,
    code,
    cancel: () => {
      shutDown();
      rejectCode(new SignInAborted('cancelled'));
    },
  };
};
