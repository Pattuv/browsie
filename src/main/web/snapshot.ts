// Turns a tab's accessibility tree into the short text the WEB lane's model reads, and remembers which
// element each ref points at so the executor can act on it.
//
// Two layers. captureFrame/takeSnapshot make the CDP calls and nothing else. buildSnapshot, indexDom and
// diffSnapshots are pure: they get plain data, so tests can feed them fake trees without a browser.
// Nothing here imports Electron. The executor hands in a `send` bound to a tab's debugger.

// --- What CDP gives us (only the fields we read) ---

type AXValue = { type: string; value?: unknown };

export type AXNode = {
  nodeId: string;
  ignored: boolean;
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  properties?: { name: string; value: AXValue }[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  frameId?: string;
};

type DomSnapshotCapture = {
  strings: string[];
  documents: {
    frameId?: number;
    nodes: {
      parentIndex?: number[];
      nodeName?: number[];
      backendNodeId?: number[];
      attributes?: number[][];
    };
    layout: { nodeIndex: number[]; bounds: number[][] };
  }[];
};

export type CdpSend = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;

// --- What we build ---

export type Box = { x: number; y: number; width: number; height: number };

// What the DOM says about an element, which the accessibility tree doesn't: policy needs the tag, the input
// type, autocomplete, and which form it sits in. `box` is missing when the element isn't rendered at all.
export type DomInfo = {
  tag: string;
  type?: string;
  autocomplete?: string;
  // backendNodeId of the nearest <form> around it.
  form?: number;
  box?: Box;
  // Which document in this frame session's capture: 0 is the session's own page, higher are same-process iframes.
  doc: number;
};

// One frame session's raw capture: the top page, or an out-of-process iframe the executor auto-attached.
export type RawFrame = {
  sessionId?: string;
  // One accessibility tree per frame this session hosts.
  trees: AXNode[][];
  dom: Map<number, DomInfo>;
  // Only for the top page. Same coordinates as the DOM boxes (CSS pixels, from the top of the document).
  viewport?: Box;
};

export type SnapNode = {
  ref: string;
  sessionId?: string;
  backendNodeId?: number;
  role: string;
  name: string;
  value?: string;
  states: string[];
  // How many kept ancestors it has, for indenting.
  depth: number;
  // Lower is kept first when the page is too big. -1 is never dropped (what has focus).
  priority: number;
  offscreen: boolean;
  dom?: DomInfo;
  // The node as the model sees it, without indentation. Deltas compare these.
  body: string;
};

export type Snapshot = {
  snap: number;
  url: string;
  title: string;
  nodes: SnapNode[];
  // Where each ref points, for the executor. Refs from older snapshots aren't in here.
  targets: Map<string, { sessionId?: string; backendNodeId: number }>;
  // Nodes cut to fit the budget.
  dropped: number;
  full: string;
  // Only what changed since the previous snapshot, when that's shorter and still makes sense.
  delta?: string;
  // Too much of the page has no names to work from text alone, so the loop should add a screenshot.
  needsScreenshot: boolean;
};

// Per tab, kept by the executor. Refs stay the same for the same element across snapshots, so a delta can
// say "e12 changed" and the model's earlier picture of the page still holds.
export type SnapshotState = {
  snap: number;
  refs: Map<string, string>;
  nextRef: number;
  last?: Snapshot;
};

export const createSnapshotState = (): SnapshotState => ({ snap: 0, refs: new Map(), nextRef: 1 });

// --- Rules ---

// About 3K tokens at roughly 4 characters a token.
export const BUDGET_CHARS = 12_000;
// Past this many remembered elements, start the numbering again (refs are capped at 5 digits).
const MAX_REFS = 5_000;
const MAX_NAME = 80;
const MAX_TEXT = 160;
// When a delta would touch more than this share of the page, send the whole page instead.
const DELTA_LIMIT = 0.6;

const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
]);

// Headings and page regions, so the model knows where things are. Live regions (alert, status) are here
// because they carry messages like "Added to cart".
const STRUCTURE = new Set([
  'heading',
  'main',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'form',
  'region',
  'dialog',
  'alertdialog',
  'alert',
  'status',
]);

// Too common to be worth a line unless someone named them.
const NEEDS_NAME = new Set(['form', 'region']);

const TEXT = new Set(['StaticText', 'image']);

// Text inside these is already their name, so it isn't repeated as its own line.
const NAMES_ITS_TEXT = new Set([...INTERACTIVE, 'heading']);

const OPTION_ROLES = new Set(['option', 'menuitem', 'MenuListOption']);
const MAX_FOLDED_OPTIONS = 6;

const HAS_VALUE = new Set(['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton']);

const ROLE_LABEL: Record<string, string> = { StaticText: 'text', image: 'img', RootWebArea: 'frame' };

// --- Pure building ---

const prop = (node: AXNode, name: string) => node.properties?.find((p) => p.name === name)?.value.value;

const clean = (raw: unknown, max: number) => {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Fields the page must never show the model, even as bullets.
const isSecretField = (dom?: DomInfo) =>
  dom?.type === 'password' || /one-time-code/.test(dom?.autocomplete ?? '');

const statesOf = (node: AXNode, role: string) => {
  const states: string[] = [];
  const level = prop(node, 'level');

  if (role === 'heading' && typeof level === 'number') states.push(`level=${level}`);
  if (prop(node, 'disabled') === true) states.push('disabled');
  if (prop(node, 'readonly') === true) states.push('readonly');
  if (prop(node, 'required') === true) states.push('required');
  if (prop(node, 'invalid') === 'true') states.push('invalid');

  const checked = prop(node, 'checked');
  if (checked === 'true') states.push('checked');
  if (checked === 'mixed') states.push('mixed');
  if (prop(node, 'pressed') === 'true') states.push('pressed');
  if (prop(node, 'selected') === true) states.push('selected');

  const expanded = prop(node, 'expanded');
  if (expanded === true) states.push('expanded');
  if (expanded === false) states.push('collapsed');
  if (prop(node, 'focused') === true) states.push('focused');

  return states;
};

const intersects = (box: Box, view: Box) =>
  box.x < view.x + view.width && box.x + box.width > view.x && box.y < view.y + view.height && box.y + box.height > view.y;

// One line, as the model reads it. Names and values go through JSON.stringify so a page can't break out of
// the quotes or start a fake line with a newline.
const bodyOf = (node: Omit<SnapNode, 'body'>, options?: { shown: string[]; total: number }) => {
  const parts = [node.ref, ROLE_LABEL[node.role] ?? node.role];

  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.value !== undefined) parts.push(`value=${JSON.stringify(node.value)}`);
  if (isSecretField(node.dom)) parts.push(node.dom?.type === 'password' ? 'password' : 'one-time-code');
  parts.push(...node.states);

  if (options?.shown.length) {
    const more = options.total - options.shown.length;
    parts.push(`options=${JSON.stringify(options.shown)}${more > 0 ? ` +${more} more` : ''}`);
  }

  if (node.offscreen) parts.push('offscreen');
  return parts.join(' ');
};

type Walked = Omit<SnapNode, 'ref' | 'body'> & { key: string; options?: { shown: string[]; total: number } };

const walkFrame = (frame: RawFrame, tree: AXNode[], isTopTree: boolean, out: Walked[]) => {
  const byId = new Map(tree.map((node) => [node.nodeId, node]));
  const root = tree.find((node) => !node.parentId) ?? tree[0];

  if (!root) return;

  const visit = (node: AXNode, depth: number, insideNamed: boolean) => {
    const role = typeof node.role?.value === 'string' ? node.role.value : '';

    // Hidden content stays hidden even when the page marks it up as something else.
    if (role === 'InlineTextBox' || prop(node, 'hidden') === true) return;

    const dom = node.backendDOMNodeId === undefined ? undefined : frame.dom.get(node.backendDOMNodeId);
    const isChildFrameRoot = role === 'RootWebArea' && !isTopTree;
    const name = clean(node.name?.value, TEXT.has(role) ? MAX_TEXT : MAX_NAME);

    let keep = false;
    if (!node.ignored) {
      if (INTERACTIVE.has(role)) keep = true;
      else if (STRUCTURE.has(role)) keep = !NEEDS_NAME.has(role) || Boolean(name);
      else if (TEXT.has(role)) keep = Boolean(name) && !insideNamed;
      else if (isChildFrameRoot) keep = true;
    }

    // Options in a <select> have no box of their own, so only check boxes for everything else.
    // An element with no box isn't rendered. Its children are still walked: a zero-size wrapper can hold
    // visible content.
    if (keep && dom && !OPTION_ROLES.has(role) && (!dom.box || dom.box.width * dom.box.height === 0)) {
      keep = false;
    }

    const offscreen = Boolean(
      keep && frame.viewport && dom?.doc === 0 && isTopTree && dom.box && !intersects(dom.box, frame.viewport),
    );

    // A closed dropdown lists its options on its own line instead of one line per option. A country picker
    // would otherwise use up the whole budget.
    const folds = keep && role === 'combobox' && prop(node, 'expanded') !== true;
    let options: Walked['options'];

    if (folds) {
      const names: string[] = [];
      const collect = (id: string) => {
        const child = byId.get(id);
        if (!child) return;
        const childRole = typeof child.role?.value === 'string' ? child.role.value : '';
        const childName = clean(child.name?.value, MAX_NAME);
        if (OPTION_ROLES.has(childRole) && childName) names.push(childName);
        child.childIds?.forEach(collect);
      };
      node.childIds?.forEach(collect);
      if (names.length) options = { shown: names.slice(0, MAX_FOLDED_OPTIONS), total: names.length };
    }

    if (keep) {
      const states = statesOf(node, role);
      const focused = states.includes('focused');
      const interactive = INTERACTIVE.has(role);
      const rawValue = HAS_VALUE.has(role) && !isSecretField(dom) ? clean(node.value?.value, MAX_NAME) : '';

      out.push({
        key: `${frame.sessionId ?? ''}:${node.backendDOMNodeId ?? `ax${node.nodeId}`}`,
        sessionId: frame.sessionId,
        backendNodeId: node.backendDOMNodeId,
        role,
        name,
        value: rawValue || undefined,
        states,
        depth,
        priority: focused ? -1 : interactive ? (offscreen ? 2 : 0) : TEXT.has(role) ? 3 : 1,
        offscreen,
        dom,
        options,
      });
    }

    if (folds) return;

    const childDepth = keep ? depth + 1 : depth;
    // A <label>'s text is already its field's name.
    const childInsideNamed = insideNamed || (keep && NAMES_ITS_TEXT.has(role)) || role === 'LabelText';
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child) visit(child, childDepth, childInsideNamed);
    }
  };

  visit(root, 0, false);
};

const urlKey = (url: string) => url.split('#')[0];

const headerOf = (snap: number, url: string, title: string, since?: number) =>
  [`snap ${snap}`, since === undefined ? undefined : `changes since snap ${since}`, url, JSON.stringify(title)]
    .filter(Boolean)
    .join(' · ');

const fitBudget = (nodes: SnapNode[], fixedChars: number) => {
  const lineLength = (node: SnapNode) => node.depth * 2 + node.body.length + 1;
  let total = fixedChars + nodes.reduce((sum, node) => sum + lineLength(node), 0);

  if (total <= BUDGET_CHARS) return { kept: nodes, dropped: 0 };

  // Room for the "N more not shown" line.
  const reserve = 80;
  const dropOrder = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.priority >= 0)
    // Least useful first, and within the same priority, the furthest down the page first.
    .sort((a, b) => b.node.priority - a.node.priority || b.index - a.index);
  const drop = new Set<number>();

  for (const { node, index } of dropOrder) {
    if (total + reserve <= BUDGET_CHARS) break;
    drop.add(index);
    total -= lineLength(node);
  }

  return { kept: nodes.filter((_, index) => !drop.has(index)), dropped: drop.size };
};

export type SnapshotDiff = {
  added: SnapNode[];
  removed: SnapNode[];
  changed: { before: SnapNode; after: SnapNode }[];
};

export const diffSnapshots = (prev: Snapshot, next: Snapshot): SnapshotDiff => {
  const before = new Map(prev.nodes.map((node) => [node.ref, node]));
  const after = new Map(next.nodes.map((node) => [node.ref, node]));

  return {
    added: next.nodes.filter((node) => !before.has(node.ref)),
    removed: prev.nodes.filter((node) => !after.has(node.ref)),
    changed: next.nodes.flatMap((node) => {
      const old = before.get(node.ref);
      return old && old.body !== node.body ? [{ before: old, after: node }] : [];
    }),
  };
};

const renderDelta = (prev: Snapshot, next: Snapshot) => {
  const diff = diffSnapshots(prev, next);
  const count = diff.added.length + diff.removed.length + diff.changed.length;

  if (count > next.nodes.length * DELTA_LIMIT) return undefined;

  const lines = [
    headerOf(next.snap, next.url, next.title, prev.snap),
    ...diff.added.map((node) => `+ ${node.body}`),
    ...diff.changed.map(({ before, after }) => `~ ${after.body} (was: ${before.body})`),
    ...diff.removed.map((node) => `- ${node.body}`),
  ];

  if (count === 0) lines.push('(no changes)');
  if (next.dropped) lines.push(`… ${next.dropped} more items not shown`);
  return lines.join('\n');
};

// Builds the next snapshot for a tab. Bumps the snapshot number and updates the tab's refs in `state`.
export const buildSnapshot = (
  frames: RawFrame[],
  state: SnapshotState,
  page: { url: string; title: string },
): Snapshot => {
  const previous = state.last;

  // A new page means none of the old elements exist any more: start the refs again and send it whole.
  const samePage = previous !== undefined && urlKey(previous.url) === urlKey(page.url);
  if (!samePage || state.refs.size > MAX_REFS) {
    state.refs.clear();
    state.nextRef = 1;
  }

  const walked: Walked[] = [];
  const seenFrames = new Set<string>();

  frames.forEach((frame, frameIndex) => {
    frame.trees.forEach((tree, treeIndex) => {
      // The top session can list an out-of-process iframe's frame too. Whichever session reports it first owns it.
      const frameId = tree.find((node) => !node.parentId)?.frameId;
      if (frameId && seenFrames.has(frameId)) return;
      if (frameId) seenFrames.add(frameId);
      walkFrame(frame, tree, frameIndex === 0 && treeIndex === 0, walked);
    });
  });

  const nodes: SnapNode[] = walked.map(({ key, options, ...node }) => {
    let ref = state.refs.get(key);
    if (!ref) {
      ref = `e${state.nextRef++}`;
      state.refs.set(key, ref);
    }
    const withRef = { ...node, ref };
    return { ...withRef, body: bodyOf(withRef, options) };
  });

  state.snap += 1;
  const header = headerOf(state.snap, page.url, page.title);
  const { kept, dropped } = fitBudget(nodes, header.length + 1);

  const lines = [header, ...kept.map((node) => `${'  '.repeat(node.depth)}${node.body}`)];
  if (dropped) lines.push(`… ${dropped} more items not shown`);

  const targets: Snapshot['targets'] = new Map();
  for (const node of kept) {
    if (node.backendNodeId !== undefined) {
      targets.set(node.ref, { sessionId: node.sessionId, backendNodeId: node.backendNodeId });
    }
  }

  const snapshot: Snapshot = {
    snap: state.snap,
    url: page.url,
    title: page.title,
    nodes: kept,
    targets,
    dropped,
    full: lines.join('\n'),
    needsScreenshot: needsScreenshot(kept, frames[0]),
  };

  if (samePage && previous) {
    const delta = renderDelta(previous, snapshot);
    if (delta && delta.length < snapshot.full.length) snapshot.delta = delta;
  }

  state.last = snapshot;
  return snapshot;
};

// What the loop puts in front of the model.
export const textForModel = (snapshot: Snapshot) => snapshot.delta ?? snapshot.full;

const UNNAMED_MIN = 5;
const UNNAMED_SHARE = 0.4;
const CANVAS_SHARE = 0.5;

const needsScreenshot = (nodes: SnapNode[], top?: RawFrame) => {
  const onscreen = nodes.filter((node) => INTERACTIVE.has(node.role) && !node.offscreen);
  const unnamed = onscreen.filter((node) => !node.name).length;

  if (unnamed >= UNNAMED_MIN && unnamed >= onscreen.length * UNNAMED_SHARE) return true;

  const view = top?.viewport;
  if (!top || !view) return false;

  // A canvas taking up most of the screen (maps, games, some editors) has nothing in the tree to read.
  const viewArea = view.width * view.height;
  for (const info of top.dom.values()) {
    if (info.tag !== 'CANVAS' || info.doc !== 0 || !info.box || !intersects(info.box, view)) continue;
    const width = Math.min(info.box.x + info.box.width, view.x + view.width) - Math.max(info.box.x, view.x);
    const height = Math.min(info.box.y + info.box.height, view.y + view.height) - Math.max(info.box.y, view.y);
    if (width * height >= viewArea * CANVAS_SHARE) return true;
  }

  return false;
};

// Reads DOMSnapshot.captureSnapshot's string-table format into a lookup by backendNodeId.
export const indexDom = (capture: DomSnapshotCapture) => {
  const info = new Map<number, DomInfo>();
  const str = (index: number | undefined) =>
    index === undefined || index < 0 ? undefined : capture.strings[index];

  capture.documents.forEach((document, doc) => {
    const { parentIndex = [], nodeName = [], backendNodeId = [], attributes = [] } = document.nodes;
    const boxes = new Map<number, Box>();

    document.layout.nodeIndex.forEach((nodeIndex, i) => {
      const [x, y, width, height] = document.layout.bounds[i] ?? [];
      if ([x, y, width, height].every((n) => typeof n === 'number')) boxes.set(nodeIndex, { x, y, width, height });
    });

    // Nodes come parents first, so each node's nearest form is known by the time we reach it.
    const formAround: (number | undefined)[] = [];

    for (let i = 0; i < nodeName.length; i++) {
      const tag = (str(nodeName[i]) ?? '').toUpperCase();
      const parent = parentIndex[i];
      const form = parent !== undefined && parent >= 0 ? formAround[parent] : undefined;
      formAround[i] = tag === 'FORM' ? backendNodeId[i] : form;

      const attrs = new Map<string, string>();
      const pairs = attributes[i] ?? [];
      for (let a = 0; a + 1 < pairs.length; a += 2) {
        const name = str(pairs[a]);
        if (name) attrs.set(name.toLowerCase(), str(pairs[a + 1]) ?? '');
      }

      info.set(backendNodeId[i], {
        tag,
        type: attrs.get('type')?.toLowerCase(),
        autocomplete: attrs.get('autocomplete')?.toLowerCase(),
        form,
        box: boxes.get(i),
        doc,
      });
    }
  });

  return info;
};

// --- Live capture ---

type FrameTree = { frame: { id: string }; childFrames?: FrameTree[] };

const frameIdsOf = (tree: FrameTree): string[] => [tree.frame.id, ...(tree.childFrames ?? []).flatMap(frameIdsOf)];

// Everything one frame session needs. The executor has already enabled Page, DOM and Accessibility on it.
export const captureFrame = async (send: CdpSend, sessionId?: string, isTop = false): Promise<RawFrame> => {
  const [{ frameTree }, capture] = await Promise.all([
    send('Page.getFrameTree', {}, sessionId),
    send('DOMSnapshot.captureSnapshot', { computedStyles: [] }, sessionId),
  ]);

  // Frames hosted by another session fail here. That's expected: their own session reports them.
  const trees = await Promise.all(
    frameIdsOf(frameTree).map((frameId) =>
      send('Accessibility.getFullAXTree', { frameId }, sessionId)
        .then((result) => (result.nodes ?? []) as AXNode[])
        .catch(() => [] as AXNode[]),
    ),
  );

  let viewport: Box | undefined;
  if (isTop) {
    const { cssVisualViewport: view } = await send('Page.getLayoutMetrics', {}, sessionId);
    viewport = { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight };
  }

  return { sessionId, trees: trees.filter((tree) => tree.length > 0), dom: indexDom(capture), viewport };
};

// `sessionIds` lists the out-of-process iframes the executor has attached to. The top page is always first.
export const takeSnapshot = async (
  send: CdpSend,
  sessionIds: string[],
  state: SnapshotState,
  page: { url: string; title: string },
) => {
  const frames = await Promise.all([
    captureFrame(send, undefined, true),
    // An iframe that navigates away mid-capture shouldn't fail the whole snapshot.
    ...sessionIds.map((id) => captureFrame(send, id).catch(() => undefined)),
  ]);

  return buildSnapshot(
    frames.filter((frame): frame is RawFrame => frame !== undefined),
    state,
    page,
  );
};

// Only for when needsScreenshot says text isn't enough. Viewport only, JPEG, to keep it small.
export const captureScreenshot = async (send: CdpSend) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
  return data as string;
};
