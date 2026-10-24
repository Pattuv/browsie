import type { WebContents } from 'electron';
import type { Action, ActionError, ActionResult, Effect } from '../../shared/web/actions';
import {
  type CdpSend,
  createSnapshotState,
  diffSnapshots,
  type Snapshot,
  type SnapshotState,
  takeSnapshot,
  captureScreenshot,
} from './snapshot';

// The agent's hands: runs actions on one tab through Electron's built-in debugger (full CDP, no port, no
// --enable-automation). Policy has already approved every action that reaches here.
//
// It is handed a tab id, never a WebContents. The resolver that turns ids into pages is given by main (it
// only knows tab views), so the chrome, popups and Browsie's own pages can't be reached by construction.

export type TabResolver = (tabId: number) => WebContents | undefined;

// Cosmetic pointer drawn over the page while a web task runs. Coordinates are viewport CSS pixels.
// Missing in tests: actions then run with no animation and no extra wait.
export type AgentCursor = {
  move(x: number, y: number, durationMs?: number): Promise<void>;
  // Scale down, hold, scale back. Resolves after the trailing pause.
  click(): Promise<void>;
  hide(): void;
};

export type BatchResult = {
  // The batch's outcome: the first failure, or success with what changed.
  result: ActionResult;
  // How many actions ran before it stopped.
  ran: number;
  snapshot: Snapshot;
};

export interface Executor {
  readonly tabId: number;
  snapshot(signal?: AbortSignal): Promise<Snapshot>;
  // The last snapshot taken, which policy checks actions against.
  current(): Snapshot | undefined;
  runBatch(actions: readonly Action[], signal: AbortSignal): Promise<BatchResult>;
  screenshot(): Promise<string>;
  // A page asked for a file (an <input type=file> was clicked).
  fileChooserPending(): boolean;
  setFiles(paths: string[]): Promise<void>;
  // A download began on this tab, reported by files.ts.
  noteDownload(fileName: string): void;
  close(): void;
}

class ExecutorError extends Error {
  constructor(
    readonly code: ActionError,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: ActionError, message: string): never => {
  throw new ExecutorError(code, message);
};

// After the page goes quiet for this long, it's settled.
const QUIET_MS = 300;
// Give the page a moment to start reacting before checking for quiet.
const MIN_SETTLE_MS = 150;
const MAX_SETTLE_MS = 5_000;
const POLL_MS = 50;
const FIRST_LOAD_MS = 15_000;
// How long the real button stays down, matching the cursor graphic's press.
const CURSOR_CLICK_HOLD_MS = 160;

const KEY_CODES: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
};

// The only page functions the executor ever runs. Fixed code: nothing the model writes reaches a page.
const SELECT_ALL = `function () {
  if (typeof this.select === 'function') { this.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}`;

const CHOOSE_OPTION = `function (label) {
  if (!(this instanceof HTMLSelectElement)) return 'not-select';
  const option = Array.from(this.options).find((o) => o.label.trim() === label || o.text.trim() === label);
  if (!option) return 'no-option';
  if (option.disabled) return 'disabled';
  this.value = option.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
}`;

const SCROLL_ELEMENT = `function (direction) {
  this.scrollBy({ top: direction * Math.max(this.clientHeight * 0.8, 100) });
}`;

// Walks up through shadow roots too: a file input's button lives in the browser's own shadow DOM.
const CONTAINS = `function (node) {
  for (let current = node; current; current = current.parentNode || current.host) {
    if (current === this) return true;
  }
  return false;
}`;

const DOM_EVENTS = new Set([
  'DOM.childNodeInserted',
  'DOM.childNodeRemoved',
  'DOM.attributeModified',
  'DOM.attributeRemoved',
  'DOM.characterDataModified',
  'DOM.childNodeCountUpdated',
  'DOM.setChildNodes',
  'DOM.documentUpdated',
  'Page.frameNavigated',
  'Page.lifecycleEvent',
]);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ExecutorError('aborted', 'Stopped.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ExecutorError('aborted', 'Stopped.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const urlKey = (url: string) => url.split('#')[0];

const center = (quad: number[]) => ({
  x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
  y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
});

const area = (quad: number[]) =>
  Math.abs(
    (quad[0] * quad[3] - quad[2] * quad[1] + (quad[2] * quad[5] - quad[4] * quad[3]) + (quad[4] * quad[7] - quad[6] * quad[5]) + (quad[6] * quad[1] - quad[0] * quad[7])) /
      2,
  );

type FrameSession = { frameId: string; parent?: string };

export class ElectronCdpExecutor implements Executor {
  private readonly frames = new Map<string, FrameSession>();
  private readonly state: SnapshotState = createSnapshotState();
  private readonly needsDocument = new Set<string | undefined>();
  private lastActivity = Date.now();
  private gone = false;
  private chooser: { sessionId?: string; backendNodeId: number } | undefined;
  private downloads: string[] = [];
  private choosersOpened = 0;
  private readonly send: CdpSend;

  private constructor(
    readonly tabId: number,
    private readonly contents: WebContents,
    private readonly cursor?: AgentCursor,
  ) {
    const debug = contents.debugger;
    this.send = (method, params = {}, sessionId) => {
      if (this.gone || contents.isDestroyed()) fail('target_gone', 'The tab is gone.');
      return debug.sendCommand(method, params, sessionId);
    };
  }

  // Attaches to a tab view. The tab must have loaded something already: a page with no renderer yet never
  // answers CDP commands.
  static async open(tabId: number, resolve: TabResolver, cursor?: AgentCursor): Promise<ElectronCdpExecutor> {
    const contents = resolve(tabId);
    if (!contents || contents.isDestroyed()) fail('target_gone', 'That tab has no web page.');

    const page = contents!;
    if (!page.getURL() || page.isLoadingMainFrame()) {
      await new Promise<void>((done) => {
        const timer = setTimeout(done, FIRST_LOAD_MS);
        page.once('did-stop-loading', () => {
          clearTimeout(timer);
          done();
        });
      });
    }
    if (!page.getURL()) fail('target_gone', 'The tab never loaded a page.');

    if (page.debugger.isAttached()) {
      fail('target_gone', 'Another debugger (DevTools?) is attached to this tab.');
    }
    page.debugger.attach('1.3');

    const executor = new ElectronCdpExecutor(tabId, page, cursor);
    executor.listen();
    await executor.prepare();
    return executor;
  }

  private listen() {
    const debug = this.contents.debugger;

    debug.on('message', (_event, method, params, sessionId) => {
      if (DOM_EVENTS.has(method)) this.lastActivity = Date.now();
      if (method === 'DOM.documentUpdated') this.needsDocument.add(sessionId || undefined);

      if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        this.frames.set(params.sessionId, { frameId: params.targetInfo.targetId, parent: sessionId || undefined });
        this.prepare(params.sessionId).catch(() => this.frames.delete(params.sessionId));
      }
      if (method === 'Target.detachedFromTarget') this.frames.delete(params.sessionId);

      if (method === 'Page.fileChooserOpened' && typeof params.backendNodeId === 'number') {
        this.chooser = { sessionId: sessionId || undefined, backendNodeId: params.backendNodeId };
        this.choosersOpened += 1;
      }
    });

    debug.on('detach', () => {
      this.gone = true;
    });
    this.contents.once('destroyed', () => {
      this.gone = true;
    });
  }

  private async prepare(sessionId?: string) {
    await Promise.all([
      this.send('Page.enable', {}, sessionId),
      this.send('DOM.enable', {}, sessionId),
      this.send('Accessibility.enable', {}, sessionId),
      this.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId),
      // File inputs open no OS dialog: the page reports the request and the user picks from Browsie's folder.
      this.send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId),
    ]);
    // DOM change events only flow for nodes we've asked for, so ask for the whole tree.
    await this.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId);
    // Out-of-process iframes become their own sessions on this same connection.
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  }

  current() {
    return this.state.last;
  }

  async snapshot(signal?: AbortSignal) {
    if (signal?.aborted) fail('aborted', 'Stopped.');
    return takeSnapshot(this.send, [...this.frames.keys()], this.state, {
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
    });
  }

  screenshot() {
    return captureScreenshot(this.send);
  }

  fileChooserPending() {
    return this.chooser !== undefined;
  }

  async setFiles(paths: string[]) {
    const chooser = this.chooser ?? fail('invalid_action', 'No page is asking for a file.');
    await this.send('DOM.setFileInputFiles', { files: paths, backendNodeId: chooser.backendNodeId }, chooser.sessionId);
    this.chooser = undefined;
  }

  noteDownload(fileName: string) {
    this.downloads.push(fileName);
  }

  close() {
    this.cursor?.hide();
    if (!this.gone && !this.contents.isDestroyed()) {
      try {
        this.contents.debugger.detach();
      } catch {
        // Already detached.
      }
    }
    this.gone = true;
  }

  // --- Running actions ---

  async runBatch(actions: readonly Action[], signal: AbortSignal): Promise<BatchResult> {
    const before = this.state.last ?? (await this.snapshot(signal));
    const downloadsBefore = this.downloads.length;
    const choosersBefore = this.choosersOpened;
    let ran = 0;
    let failure: { code: ActionError; message: string } | undefined;

    try {
      for (const action of actions) {
        if (signal.aborted) fail('aborted', 'Stopped.');
        await this.run(action, before, signal);
        ran += 1;
      }
    } catch (error) {
      failure =
        error instanceof ExecutorError
          ? { code: error.code, message: error.message }
          : { code: this.gone ? 'target_gone' : 'timeout', message: error instanceof Error ? error.message : String(error) };
    }

    if (failure?.code === 'aborted' || failure?.code === 'target_gone') {
      return { result: { ok: false, snap: before.snap, error: failure.code, message: failure.message }, ran, snapshot: before };
    }

    const waitMs = actions.reduce((max, action) => (action.type === 'wait' ? Math.max(max, action.ms) : max), 0);
    try {
      await this.settle(signal, Math.max(MAX_SETTLE_MS, waitMs));
    } catch (error) {
      if (error instanceof ExecutorError && error.code === 'aborted') {
        return { result: { ok: false, snap: before.snap, error: 'aborted', message: 'Stopped.' }, ran, snapshot: before };
      }
    }

    const after = await this.snapshot();
    if (failure) {
      return { result: { ok: false, snap: after.snap, error: failure.code, message: failure.message }, ran, snapshot: after };
    }

    const effects = this.effectsBetween(before, after, downloadsBefore, choosersBefore);
    const onlyWaits = actions.every((action) => action.type === 'wait');
    if (effects.length === 0 && !onlyWaits) {
      return {
        result: { ok: false, snap: after.snap, error: 'no_effect', message: 'Nothing on the page changed.' },
        ran,
        snapshot: after,
      };
    }

    return { result: { ok: true, snap: after.snap, effects }, ran, snapshot: after };
  }

  private effectsBetween(before: Snapshot, after: Snapshot, downloadsBefore: number, choosersBefore: number) {
    const effects: Effect[] = [];
    if (urlKey(before.url) !== urlKey(after.url)) effects.push({ kind: 'navigated', url: after.url });
    else {
      const diff = diffSnapshots(before, after);
      const counts = { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length };
      if (counts.added + counts.removed + counts.changed > 0) effects.push({ kind: 'dom_changed', ...counts });
    }
    for (const fileName of this.downloads.slice(downloadsBefore)) effects.push({ kind: 'download_started', fileName });
    if (this.choosersOpened > choosersBefore) effects.push({ kind: 'file_chooser_opened' });
    return effects;
  }

  // Waits until loading has stopped and the DOM has been quiet for a moment, or until the time is up.
  private async settle(signal: AbortSignal, maxMs: number) {
    const started = Date.now();
    this.lastActivity = Math.max(this.lastActivity, started);

    while (Date.now() - started < maxMs) {
      await sleep(POLL_MS, signal);
      // A new document since we last asked: ask again, or its changes go unreported.
      for (const sessionId of [...this.needsDocument]) {
        this.needsDocument.delete(sessionId);
        if (sessionId === undefined || this.frames.has(sessionId)) {
          await this.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId).catch(() => undefined);
        }
      }
      const now = Date.now();
      if (now - started >= MIN_SETTLE_MS && !this.contents.isLoading() && now - this.lastActivity >= QUIET_MS) return;
    }
  }

  private target(ref: string, snapshot: Snapshot) {
    const target = snapshot.targets.get(ref) ?? fail('stale_ref', `${ref} isn't on the page any more.`);
    const node = snapshot.nodes.find((n) => n.ref === ref);
    return { ...target, node };
  }

  private async objectId(backendNodeId: number, sessionId?: string) {
    const { object } = await this.send('DOM.resolveNode', { backendNodeId }, sessionId).catch(() =>
      fail('stale_ref', 'That element is gone from the page.'),
    );
    return object.objectId as string;
  }

  private async callOn(backendNodeId: number, sessionId: string | undefined, fn: string, args: unknown[] = []) {
    const objectId = await this.objectId(backendNodeId, sessionId);
    const { result } = await this.send(
      'Runtime.callFunctionOn',
      { objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true },
      sessionId,
    );
    return result?.value;
  }

  // Where a frame session's viewport sits inside the top page, so its coordinates can be clicked from the top.
  private async frameOffset(sessionId?: string): Promise<{ x: number; y: number }> {
    if (!sessionId) return { x: 0, y: 0 };
    const frame = this.frames.get(sessionId) ?? fail('target_gone', 'That frame is gone.');
    const { backendNodeId } = await this.send('DOM.getFrameOwner', { frameId: frame.frameId }, frame.parent);
    const { model } = await this.send('DOM.getBoxModel', { backendNodeId }, frame.parent);
    const parent = await this.frameOffset(frame.parent);
    return { x: parent.x + model.content[0], y: parent.y + model.content[1] };
  }

  // Scrolls the element into view and returns the top-page point to click, after checking nothing covers it.
  private async clickPoint(backendNodeId: number, sessionId?: string) {
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sessionId).catch(() => undefined);
    const { quads } = await this.send('DOM.getContentQuads', { backendNodeId }, sessionId).catch(() => ({ quads: [] }));
    const visible = (quads as number[][]).filter((quad) => area(quad) > 1);
    if (visible.length === 0) fail('not_visible', "That element isn't visible.");

    const local = center(visible.reduce((best, quad) => (area(quad) > area(best) ? quad : best)));
    const hit = await this.send('DOM.getNodeForLocation', {
      x: Math.round(local.x),
      y: Math.round(local.y),
      includeUserAgentShadowDOM: true,
    }, sessionId).catch(() => undefined);

    if (hit?.backendNodeId !== undefined && hit.backendNodeId !== backendNodeId) {
      const hitObject = await this.objectId(hit.backendNodeId, sessionId).catch(() => undefined);
      const objectId = await this.objectId(backendNodeId, sessionId);
      const covered = hitObject
        ? !(await this.send(
            'Runtime.callFunctionOn',
            { objectId, functionDeclaration: CONTAINS, arguments: [{ objectId: hitObject }], returnByValue: true },
            sessionId,
          )).result?.value
        : false;
      if (covered) fail('not_visible', 'Something else is covering that element.');
    }

    const offset = await this.frameOffset(sessionId);
    return { x: local.x + offset.x, y: local.y + offset.y };
  }

  // Where the pointer should sit, in top-page viewport pixels. Undefined when the element has no box.
  private async aimPoint(backendNodeId: number, sessionId?: string) {
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sessionId).catch(() => undefined);
    const { quads } = await this.send('DOM.getContentQuads', { backendNodeId }, sessionId).catch(() => ({ quads: [] }));
    const visible = (quads as number[][]).filter((quad) => area(quad) > 1);
    if (visible.length === 0) return undefined;
    const local = center(visible.reduce((best, quad) => (area(quad) > area(best) ? quad : best)));
    const offset = await this.frameOffset(sessionId);
    return { x: local.x + offset.x, y: local.y + offset.y };
  }

  // Glide the on-screen cursor to a page point and wait until it lands. No cursor: returns at once.
  private async glide(x: number, y: number, signal: AbortSignal) {
    if (!this.cursor) return;
    if (signal.aborted) fail('aborted', 'Stopped.');
    const zoom = this.contents.isDestroyed() ? 1 : this.contents.getZoomFactor();
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new ExecutorError('aborted', 'Stopped.'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.cursor.move(x * scale, y * scale), aborted]);
    } catch (error) {
      if (error instanceof ExecutorError && error.code === 'aborted') throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async aim(backendNodeId: number, sessionId: string | undefined, signal: AbortSignal) {
    if (!this.cursor) return;
    const point = await this.aimPoint(backendNodeId, sessionId);
    if (point) await this.glide(point.x, point.y, signal);
  }

  private async mouse(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  }

  private async key(name: string) {
    const key = KEY_CODES[name] ?? fail('invalid_action', `Unknown key ${name}.`);
    const base = { key: name, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
    await this.send('Input.dispatchKeyEvent', { ...base, type: key.text ? 'keyDown' : 'rawKeyDown', text: key.text });
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  private async run(action: Action, snapshot: Snapshot, signal: AbortSignal) {
    switch (action.type) {
      case 'click': {
        const { backendNodeId, sessionId, node } = this.target(action.ref, snapshot);
        if (node?.states.includes('disabled')) fail('not_enabled', 'That control is disabled.');
        const { x, y } = await this.clickPoint(backendNodeId, sessionId);
        await this.glide(x, y, signal);
        await this.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
        await this.mouse('mousePressed', x, y);
        if (!this.cursor) {
          await this.mouse('mouseReleased', x, y);
          return;
        }
        // The graphic presses while the real button is held, then eases back.
        const visual = this.cursor.click().catch(() => undefined);
        try {
          await sleep(CURSOR_CLICK_HOLD_MS, signal);
        } catch (error) {
          await this.mouse('mouseReleased', x, y).catch(() => undefined);
          throw error;
        }
        await this.mouse('mouseReleased', x, y);
        await visual;
        return;
      }

      case 'type': {
        const { backendNodeId, sessionId, node } = this.target(action.ref, snapshot);
        if (node?.states.includes('disabled') || node?.states.includes('readonly')) {
          fail('not_enabled', "That field can't be typed into.");
        }
        // Policy blocks this already. Checked again because it must never happen.
        if (node?.dom?.type === 'password' || /one-time-code/.test(node?.dom?.autocomplete ?? '')) {
          fail('blocked_by_policy', 'Passwords and codes are for the user to type.');
        }
        await this.aim(backendNodeId, sessionId, signal);
        await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sessionId).catch(() => undefined);
        await this.send('DOM.focus', { backendNodeId }, sessionId).catch(() =>
          fail('not_enabled', "That element can't take typing."),
        );
        if (action.replace) await this.callOn(backendNodeId, sessionId, SELECT_ALL);
        await this.send('Input.insertText', { text: action.text });
        return;
      }

      case 'press': {
        if (action.ref) {
          const { backendNodeId, sessionId } = this.target(action.ref, snapshot);
          await this.aim(backendNodeId, sessionId, signal);
          await this.send('DOM.focus', { backendNodeId }, sessionId).catch(() => undefined);
        }
        await this.key(action.key);
        return;
      }

      case 'select': {
        const { backendNodeId, sessionId } = this.target(action.ref, snapshot);
        await this.aim(backendNodeId, sessionId, signal);
        const outcome = await this.callOn(backendNodeId, sessionId, CHOOSE_OPTION, [action.option]);
        if (outcome === 'not-select') fail('invalid_action', "That isn't a dropdown list. Click it to open it instead.");
        if (outcome === 'no-option') fail('invalid_action', `There's no option called ${JSON.stringify(action.option)}.`);
        if (outcome === 'disabled') fail('not_enabled', 'That option is disabled.');
        return;
      }

      case 'scroll': {
        const direction = action.direction === 'down' ? 1 : -1;
        if (action.ref) {
          const { backendNodeId, sessionId } = this.target(action.ref, snapshot);
          await this.aim(backendNodeId, sessionId, signal);
          await this.callOn(backendNodeId, sessionId, SCROLL_ELEMENT, [direction]);
          return;
        }
        const { cssLayoutViewport: view } = await this.send('Page.getLayoutMetrics');
        const x = view.clientWidth / 2;
        const y = view.clientHeight / 2;
        await this.glide(x, y, signal);
        if (this.cursor) await this.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
        await this.mouse('mouseWheel', x, y, {
          button: 'none',
          clickCount: 0,
          deltaX: 0,
          deltaY: direction * view.clientHeight * 0.8,
        });
        return;
      }

      case 'goto':
        // Redirects reject with ERR_ABORTED. That's normal browsing; settle waits for the result.
        this.contents.loadURL(action.url).catch(() => undefined);
        return;

      case 'back':
        if (!this.contents.navigationHistory.canGoBack()) fail('no_effect', "There's nothing to go back to.");
        this.contents.navigationHistory.goBack();
        return;

      case 'wait':
        await sleep(action.ms, signal);
        return;

      default:
        fail('invalid_action', `${action.type} isn't something the executor runs.`);
    }
  }
}
