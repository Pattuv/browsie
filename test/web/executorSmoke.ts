import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Action, ActionResult } from '../../src/shared/web/actions';
import { ElectronCdpExecutor } from '../../src/main/web/executor';
import { handleDownloads } from '../../src/main/web/files';
import type { Snapshot } from '../../src/main/web/snapshot';
import type { MockServer } from './server';
import { type Check, log, sleep, stamp, VIEW, withTimeout } from './util';

// The executor on real pages, with no model: scripted actions, checked against what the mock server
// recorded. Proves clicks land (including inside an out-of-process iframe), typing and select work,
// settling waits for the page, and downloads, uploads and stopping behave.

const CHECK_TIMEOUT_MS = 45_000;

type Ctx = {
  server: MockServer;
  open: (pathname: string) => Promise<ElectronCdpExecutor>;
  folder: string;
  expect: (ok: boolean, message: string) => void;
  note: (message: string) => void;
};

// The control with that name (not a line of text that happens to match).
const refOf = (snapshot: Snapshot, name: string) => {
  const node = snapshot.nodes.find((n) => n.name === name && n.role !== 'StaticText');
  if (!node) throw new Error(`no element named ${JSON.stringify(name)} in:\n${snapshot.full}`);
  return node.ref;
};

const run = async (executor: ElectronCdpExecutor, build: (s: Snapshot) => Action[]) => {
  const snapshot = executor.current() ?? (await executor.snapshot());
  return executor.runBatch(build(snapshot), new AbortController().signal);
};

const effectKinds = (result: ActionResult) => (result.ok ? result.effects.map((e) => e.kind) : [`error:${result.error}`]);

const CHECKS: Record<string, (t: Ctx) => Promise<void>> = {
  async 'click, navigate, type, select, Enter'(t) {
    const x = await t.open('/checkout/');
    let r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Add Blue mug to cart') }]);
    t.expect(effectKinds(r.result).includes('dom_changed'), `add to cart changed the page (${effectKinds(r.result)})`);
    t.expect(r.snapshot.full.includes('Added Blue mug to cart'), 'the status message shows');

    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Cart (1)') }]);
    t.expect(effectKinds(r.result).includes('navigated'), `the cart link navigated (${effectKinds(r.result)})`);

    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Checkout') }]);
    t.expect(r.snapshot.url.endsWith('/shipping.html'), `checkout went to shipping (${r.snapshot.url})`);

    r = await run(x, (s) => [
      { type: 'type', snap: s.snap, ref: refOf(s, 'Full name'), text: 'Sam Lee', provenance: ['u1'] },
      { type: 'type', snap: s.snap, ref: refOf(s, 'Street address'), text: '12 Market Street', provenance: ['u1'] },
      { type: 'type', snap: s.snap, ref: refOf(s, 'City'), text: 'Springfield', provenance: ['u1'] },
    ]);
    t.expect(r.result.ok && r.ran === 3, `three fields typed in one batch (${JSON.stringify(r.result)})`);
    t.expect(r.snapshot.full.includes('value="Sam Lee"'), 'the typed name is in the snapshot');

    r = await run(x, (s) => [{ type: 'select', snap: s.snap, ref: refOf(s, 'Delivery'), option: 'Express' }]);
    t.expect(r.result.ok && r.snapshot.full.includes('value="Express"'), `select chose Express (${JSON.stringify(r.result)})`);

    r = await run(x, (s) => [{ type: 'type', snap: s.snap, ref: refOf(s, 'Full name'), text: 'Sam Q Lee', provenance: ['u1'], replace: true }]);
    t.expect(r.snapshot.full.includes('value="Sam Q Lee"'), 'replace cleared the field first');

    r = await run(x, (s) => [{ type: 'press', snap: s.snap, key: 'Enter', ref: refOf(s, 'City') }]);
    t.expect(r.snapshot.url.endsWith('/payment.html'), `Enter submitted the form (${r.snapshot.url})`);
    x.close();
  },

  async 'disabled and missing targets'(t) {
    const x = await t.open('/checkout/cart.html');
    let r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Checkout') }]);
    t.expect(!r.result.ok && r.result.error === 'not_enabled', `a disabled button is refused (${JSON.stringify(r.result)})`);
    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: 'e999' }]);
    t.expect(!r.result.ok && r.result.error === 'stale_ref', `an unknown ref is refused (${JSON.stringify(r.result)})`);
    x.close();
  },

  async 'clicks inside an out-of-process iframe'(t) {
    t.server.reset();
    const x = await t.open('/iframe-form/');
    await sleep(800);
    await x.snapshot();
    const r = await run(x, (s) => [
      { type: 'type', snap: s.snap, ref: refOf(s, 'Email for the newsletter'), text: 'sam@example.com', provenance: ['u1'] },
      { type: 'click', snap: s.snap, ref: refOf(s, 'Subscribe') },
    ]);
    await sleep(300);
    const event = t.server.events.find((e) => e.kind === 'subscribe');
    t.expect(event?.data.email === 'sam@example.com', `the iframe form was submitted (${JSON.stringify(t.server.events)}, ${JSON.stringify(r.result)})`);
    t.expect(Boolean(event?.origin.includes('localhost')), 'from the iframe origin');
    x.close();
  },

  async 'waits for a slow page, then clicks'(t) {
    t.server.reset();
    const x = await t.open('/spa/');
    let r = await run(x, () => [{ type: 'wait', ms: 2_000 }]);
    t.expect(r.snapshot.full.includes('Select flight BA 117'), 'the flights appeared after waiting');
    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Select flight BA 117') }]);
    await sleep(200);
    t.expect(t.server.events.some((e) => e.kind === 'select' && e.data.flight === 'BA 117'), 'the flight was selected');
    t.expect(effectKinds(r.result).includes('navigated'), `the client-side route change counts as navigating (${effectKinds(r.result)})`);
    x.close();
  },

  async 'uploads a file the user picked'(t) {
    t.server.reset();
    const resume = path.join(t.folder, 'resume.pdf');
    fs.writeFileSync(resume, '%PDF-1.4 resume');
    const x = await t.open('/upload/');
    let r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: s.nodes.find((n) => n.dom?.type === 'file')!.ref }]);
    t.expect(effectKinds(r.result).includes('file_chooser_opened') && x.fileChooserPending(), `clicking the file input opened no dialog, just a request (${effectKinds(r.result)})`);
    await x.setFiles([resume]);
    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Upload') }]);
    await sleep(300);
    t.expect(t.server.events.some((e) => e.kind === 'upload' && e.data.fileName === 'resume.pdf'), 'the server got resume.pdf');
    x.close();
  },

  async 'downloads into the folder, never an executable'(t) {
    const x = await t.open('/download/');
    let r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Download the Q3 report (PDF)') }]);
    t.expect(effectKinds(r.result).includes('download_started'), `a download started (${effectKinds(r.result)})`);
    r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Download the report viewer') }]);
    await sleep(800);
    const saved = fs.readdirSync(t.folder);
    t.expect(saved.includes('report.pdf'), `report.pdf was saved (${saved})`);
    t.expect(!saved.some((f) => f.endsWith('.exe')), `the executable was refused (${saved})`);
    x.close();
  },

  async 'stops mid-action'(t) {
    const x = await t.open('/checkout/');
    await x.snapshot();
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 200);
    const r = await x.runBatch([{ type: 'wait', ms: 8_000 }], controller.signal);
    t.expect(!r.result.ok && r.result.error === 'aborted', `the wait was stopped (${JSON.stringify(r.result)})`);
    t.expect(Date.now() - started < 1_500, `promptly (${Date.now() - started}ms)`);
    x.close();
  },

  async 'goes back'(t) {
    const x = await t.open('/checkout/');
    let r = await run(x, (s) => [{ type: 'click', snap: s.snap, ref: refOf(s, 'Cart (0)') }]);
    r = await run(x, () => [{ type: 'back' }]);
    t.expect(r.snapshot.url.endsWith('/checkout/'), `back returned to the shop (${r.snapshot.url})`);
    x.close();
  },
};

export const runExecutorSmoke = async (server: MockServer) => {
  const checks: Check[] = [];
  const runStamp = stamp();

  for (const [name, test] of Object.entries(CHECKS)) {
    const check: Check = { name, failures: [], notes: [] };
    checks.push(check);
    log(`executor check ${name}`);

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'browsie-eval-files-'));
    const window = new BrowserWindow({
      show: false,
      ...VIEW,
      webPreferences: { backgroundThrottling: false, partition: `exec-${runStamp}-${checks.length}` },
    });
    let executor: ElectronCdpExecutor | undefined;
    handleDownloads(window.webContents.session, () => folder, () => true, (_contents, fileName) => executor?.noteDownload(fileName));

    const t: Ctx = {
      server,
      folder,
      open: async (pathname) => {
        executor?.close();
        await window.loadURL(`${server.origin}${pathname}`);
        executor = await ElectronCdpExecutor.open(1, (id) => (id === 1 ? window.webContents : undefined));
        await executor.snapshot();
        return executor;
      },
      expect: (ok, message) => {
        if (!ok) check.failures.push(message);
      },
      note: (message) => check.notes.push(message),
    };

    try {
      await withTimeout(test(t), CHECK_TIMEOUT_MS, name);
    } catch (error) {
      check.failures.push(`threw: ${error instanceof Error ? error.stack : String(error)}`);
    } finally {
      executor?.close();
      window.destroy();
    }
  }

  return checks;
};
