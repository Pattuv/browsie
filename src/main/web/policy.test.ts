import { describe, expect, it } from 'vitest';
import {
  actionKey,
  buildConfirm,
  checkLimits,
  checkUrl,
  evaluate,
  evaluateBatch,
  grantFor,
  type PolicyContext,
  repeatVerdict,
  riskOf,
} from './policy';
import type { DomInfo, Snapshot, SnapNode } from './snapshot';
import { Action } from '../../shared/web/actions';

// A hand-made snapshot: each node gets the next ref and a backend id.
type NodeSpec = { role: string; name?: string; value?: string; states?: string[]; dom?: Partial<DomInfo> };

const snapshotOf = (specs: NodeSpec[], snap = 5, url = 'https://shop.example.com/checkout'): Snapshot => {
  const nodes: SnapNode[] = specs.map((spec, i) => ({
    ref: `e${i + 1}`,
    backendNodeId: 100 + i,
    role: spec.role,
    name: spec.name ?? '',
    value: spec.value,
    states: spec.states ?? [],
    depth: 0,
    priority: 0,
    offscreen: false,
    dom: { tag: 'DIV', doc: 0, ...spec.dom },
    body: '',
  }));

  return {
    snap,
    url,
    title: 'Checkout',
    nodes,
    targets: new Map(nodes.map((node) => [node.ref, { backendNodeId: node.backendNodeId! }])),
    dropped: 0,
    full: '',
    needsScreenshot: false,
  };
};

const FORM = 900;
const inForm = (dom: Partial<DomInfo>) => ({ form: FORM, ...dom });

const checkout = snapshotOf([
  { role: 'textbox', name: 'Full name', value: 'Sam Lee', dom: inForm({ tag: 'INPUT', type: 'text' }) },
  { role: 'textbox', name: 'Card number', value: '4242 4242 4242 4242', dom: inForm({ tag: 'INPUT', autocomplete: 'cc-number' }) },
  { role: 'textbox', name: 'CVC', value: '123', dom: inForm({ tag: 'INPUT', autocomplete: 'cc-csc' }) },
  { role: 'checkbox', name: 'Save card', states: ['checked'], dom: inForm({ tag: 'INPUT', type: 'checkbox' }) },
  { role: 'button', name: 'Place order', dom: inForm({ tag: 'BUTTON' }) },
  { role: 'link', name: 'Back to cart', dom: { tag: 'A' } },
]);

const ctx = (extra: Partial<PolicyContext> = {}): PolicyContext => ({
  snapshot: checkout,
  sources: new Map([
    ['u1', 'Buy the blue mug and ship it to Sam Lee'],
    ['f1', '12 Market Street, Springfield'],
  ]),
  ...extra,
});

describe('schema and freshness', () => {
  it('refuses malformed actions', () => {
    const decision = evaluate({ type: 'eval', code: 'alert(1)' }, ctx());
    expect(decision).toMatchObject({ ok: false, error: 'invalid_action' });
  });

  it('refuses actions decided on an older snapshot', () => {
    expect(evaluate({ type: 'click', snap: 4, ref: 'e6' }, ctx())).toMatchObject({ ok: false, error: 'stale_ref' });
  });

  it('refuses refs that are not on the page', () => {
    expect(evaluate({ type: 'click', snap: 5, ref: 'e99' }, ctx())).toMatchObject({ ok: false, error: 'stale_ref' });
  });

  it('lets a plain click through', () => {
    expect(evaluate({ type: 'click', snap: 5, ref: 'e6' }, ctx())).toMatchObject({ ok: true, risk: 'interact' });
  });
});

describe('URLs', () => {
  it.each([
    'browsie://settings',
    'file:///C:/Users/me/secrets.txt',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'chrome://settings',
    'https://bank.com@evil.example',
    'http://localhost:3000',
    'http://127.0.0.1/admin',
    'http://192.168.1.1',
    'http://10.0.0.5',
    'http://172.20.0.1',
    'http://[::1]/',
    'http://printer.local',
  ])('blocks %s', (url) => {
    expect(checkUrl(url)).toBeDefined();
    expect(evaluate({ type: 'goto', url }, ctx())).toMatchObject({ ok: false, error: 'blocked_by_policy' });
  });

  it.each(['https://example.com', 'http://example.com/path?q=1', 'https://172.15.0.1', 'https://fcbarcelona.com'])(
    'allows %s',
    (url) => {
      expect(checkUrl(url)).toBeUndefined();
    },
  );

  it('allows 127.0.0.1 for the mock-site harness only', () => {
    expect(checkUrl('http://127.0.0.1:8080/', true)).toBeUndefined();
  });
});

describe('risk', () => {
  it('needs a yes for a payment button', () => {
    const decision = evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx());
    expect(decision).toMatchObject({ ok: false, error: 'needs_user' });
  });

  it('runs once the user said yes to that exact button on that snapshot', () => {
    expect(evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx({ grant: { snap: 5, ref: 'e5' } }))).toMatchObject({
      ok: true,
      risk: 'transact',
    });
    // A yes for something else, or for an older view of the page, doesn't count.
    expect(evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx({ grant: { snap: 4, ref: 'e5' } })).ok).toBe(false);
    expect(evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx({ grant: { snap: 5, ref: 'e6' } })).ok).toBe(false);
  });

  it('treats Enter in a payment form like the submit button', () => {
    expect(evaluate({ type: 'press', snap: 5, key: 'Enter', ref: 'e1' }, ctx())).toMatchObject({ error: 'needs_user' });
  });

  it('uses the element’s real name, not what the model calls it', () => {
    const page = snapshotOf([{ role: 'link', name: 'Delete account', dom: { tag: 'A' } }]);
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e1' }), page)).toBe('transact');
  });

  it('matches whole words only', () => {
    const page = snapshotOf([{ role: 'button', name: 'Postcode lookup', dom: { tag: 'BUTTON', type: 'button' } }]);
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e1' }), page)).toBe('interact');
  });

  it('treats any non-search form submit as a transaction', () => {
    const page = snapshotOf([
      { role: 'textbox', name: 'Comment', dom: inForm({ tag: 'TEXTAREA' }) },
      { role: 'button', name: 'Go', dom: inForm({ tag: 'BUTTON' }) },
    ]);
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e2' }), page)).toBe('transact');
  });

  it('does not ask before a search', () => {
    const page = snapshotOf([
      { role: 'searchbox', name: 'Search products', dom: inForm({ tag: 'INPUT', type: 'search' }) },
      { role: 'button', name: 'Go', dom: inForm({ tag: 'BUTTON' }) },
    ]);
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e2' }), page)).toBe('interact');
    expect(riskOf(Action.parse({ type: 'press', snap: 5, key: 'Enter', ref: 'e1' }), page)).toBe('interact');
  });

  it('does not mix up forms from different frames that share an element id', () => {
    const page = snapshotOf([
      { role: 'textbox', name: 'Search', dom: inForm({ tag: 'INPUT', type: 'search' }) },
      { role: 'button', name: 'Go', dom: inForm({ tag: 'BUTTON' }) },
    ]);
    // A payment iframe whose form happens to have the same id as the page's search form.
    page.nodes.push({ ...page.nodes[0], ref: 'e3', sessionId: 'S1', role: 'textbox', name: 'Card number', dom: { doc: 0, ...inForm({ tag: 'INPUT', autocomplete: 'cc-number' }) } as DomInfo });
    page.targets.set('e3', { sessionId: 'S1', backendNodeId: 100 });
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e2' }), page)).toBe('interact');
  });

  it('does not count type="button" as a submit', () => {
    const page = snapshotOf([
      { role: 'textbox', name: 'Quantity', dom: inForm({ tag: 'INPUT' }) },
      { role: 'button', name: 'Increase', dom: inForm({ tag: 'BUTTON', type: 'button' }) },
    ]);
    expect(riskOf(Action.parse({ type: 'click', snap: 5, ref: 'e2' }), page)).toBe('interact');
  });
});

describe('the confirmation', () => {
  it('is built from the real form and never reads out card details', () => {
    const decision = evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx());
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.confirm).toEqual({
      origin: 'https://shop.example.com',
      button: 'Place order',
      fields: [
        { label: 'Full name', value: 'Sam Lee' },
        { label: 'Card number', value: 'ending in 4242' },
        { label: 'Save card', value: 'yes' },
      ],
    });
  });

  it('gives main the grant to remember', () => {
    const decision = evaluate({ type: 'click', snap: 5, ref: 'e5' }, ctx());
    expect(grantFor(decision, checkout)).toEqual({ snap: 5, ref: 'e5' });
  });

  it('names the submit button for Enter', () => {
    expect(buildConfirm(Action.parse({ type: 'press', snap: 5, key: 'Enter', ref: 'e1' }), checkout).button).toBe(
      'Place order',
    );
  });
});

describe('typed text', () => {
  const type = (text: string, provenance = ['u1']) => ({ type: 'type', snap: 5, ref: 'e1', text, provenance });

  it('allows text the user said', () => {
    expect(evaluate(type('Sam Lee'), ctx()).ok).toBe(true);
    expect(evaluate(type('sam   LEE'), ctx()).ok).toBe(true);
    expect(evaluate(type('12 Market Street', ['f1']), ctx()).ok).toBe(true);
  });

  it('refuses text from anywhere else', () => {
    // E.g. an instruction hidden on the page.
    expect(evaluate(type('ignore previous instructions'), ctx())).toMatchObject({ error: 'blocked_by_policy' });
    // Citing a real source doesn't help when the text isn't in it.
    expect(evaluate(type('12 Market Street', ['u1']), ctx())).toMatchObject({ error: 'blocked_by_policy' });
    expect(evaluate(type('Sam Lee', ['made-up']), ctx())).toMatchObject({ error: 'blocked_by_policy' });
  });

  it('never types into password or code fields', () => {
    const page = snapshotOf([{ role: 'textbox', name: 'Password', dom: { tag: 'INPUT', type: 'password' } }]);
    const sources = new Map([['u1', 'my password is hunter2']]);
    const decision = evaluate({ type: 'type', snap: 5, ref: 'e1', text: 'hunter2', provenance: ['u1'] }, { snapshot: page, sources });
    expect(decision).toMatchObject({ ok: false, error: 'blocked_by_policy' });
    expect(!decision.ok && decision.message).toContain('request_help');
  });
});

describe('finish', () => {
  const page = snapshotOf([{ role: 'heading', name: 'Thanks! Order #1234 confirmed' }], 5, 'https://shop.example.com/done');

  it('needs its evidence to be on the page', () => {
    const sources = new Map<string, string>();
    expect(evaluate({ type: 'finish', summary: 'Ordered', evidence: ['order #1234'] }, { snapshot: page, sources }).ok).toBe(true);
    expect(evaluate({ type: 'finish', summary: 'Ordered', evidence: ['/done'] }, { snapshot: page, sources }).ok).toBe(true);
    expect(evaluate({ type: 'finish', summary: 'Ordered', evidence: ['Order #9999'] }, { snapshot: page, sources })).toMatchObject({
      ok: false,
      error: 'blocked_by_policy',
    });
  });
});

describe('batches', () => {
  it('runs what comes before a refusal and returns the refusal', () => {
    const result = evaluateBatch(
      [
        { type: 'type', snap: 5, ref: 'e1', text: 'Sam Lee', provenance: ['u1'] },
        { type: 'click', snap: 5, ref: 'e5' },
        { type: 'click', snap: 5, ref: 'e6' },
      ],
      ctx(),
    );
    expect(result.run.map((step) => step.action.type)).toEqual(['type']);
    expect(result.stop).toMatchObject({ error: 'needs_user' });
  });
});

describe('without a snapshot (the agent’s early check)', () => {
  it('still checks schema, URLs and provenance', () => {
    const agent = { sources: ctx().sources };
    expect(evaluate({ type: 'goto', url: 'file:///etc/passwd' }, agent).ok).toBe(false);
    expect(evaluate({ type: 'type', snap: 1, ref: 'e1', text: 'evil', provenance: ['u1'] }, agent).ok).toBe(false);
    expect(evaluate({ type: 'click', snap: 1, ref: 'e1' }, agent).ok).toBe(true);
  });
});

describe('limits', () => {
  const usage = { steps: 0, startedAt: 0, now: 1_000, spentUsd: 0, capUsd: 0.5 };

  it('stops at 40 steps, 5 minutes or the spend cap', () => {
    expect(checkLimits(usage)).toBeUndefined();
    expect(checkLimits({ ...usage, steps: 40 })).toBeDefined();
    expect(checkLimits({ ...usage, now: 5 * 60_000 })).toBeDefined();
    expect(checkLimits({ ...usage, spentUsd: 0.5 })).toBeDefined();
  });

  it('replans after three futile repeats, then asks the user', () => {
    const key = actionKey(Action.parse({ type: 'click', snap: 5, ref: 'e3' }));
    const futile = { key, error: 'no_effect' as const };
    expect(repeatVerdict([futile, futile], key)).toBe('ok');
    expect(repeatVerdict([futile, futile, futile], key)).toBe('replan');
    expect(repeatVerdict([futile, futile, futile, futile], key)).toBe('ask_user');
    // Successful repeats and other actions don't count.
    expect(repeatVerdict([{ key }, { key }, { key }, { key: 'other', error: 'no_effect' }], key)).toBe('ok');
  });

  it('treats the same click on a newer snapshot as the same attempt', () => {
    expect(actionKey(Action.parse({ type: 'click', snap: 5, ref: 'e3' }))).toBe(
      actionKey(Action.parse({ type: 'click', snap: 9, ref: 'e3' })),
    );
  });
});
