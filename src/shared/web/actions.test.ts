import { describe as suite, expect, it } from 'vitest';
import { Action, BASE_RISK, describe, parseAction, parseBatch } from './actions';

const click = { type: 'click', snap: 3, ref: 'e12' };
const type = { type: 'type', snap: 3, ref: 'e4', text: 'Sam Lee', provenance: ['u1'] };
const finish = { type: 'finish', summary: 'Added to cart', evidence: ['Added to cart'] };

suite('parseAction', () => {
  it('accepts well-formed actions', () => {
    expect(parseAction(click).success).toBe(true);
    expect(parseAction(type).success).toBe(true);
    expect(parseAction({ type: 'press', snap: 0, key: 'Enter' }).success).toBe(true);
    expect(parseAction({ type: 'goto', url: 'https://example.com' }).success).toBe(true);
    expect(parseAction(finish).success).toBe(true);
  });

  it('rejects unknown action types', () => {
    expect(parseAction({ type: 'eval', code: 'alert(1)' }).success).toBe(false);
  });

  it('rejects extra fields instead of ignoring them', () => {
    expect(parseAction({ ...click, script: 'document.body.remove()' }).success).toBe(false);
  });

  it('rejects malformed refs and snapshot numbers', () => {
    expect(parseAction({ ...click, ref: '#submit' }).success).toBe(false);
    expect(parseAction({ ...click, ref: 'e' }).success).toBe(false);
    expect(parseAction({ ...click, snap: -1 }).success).toBe(false);
    expect(parseAction({ ...click, snap: 1.5 }).success).toBe(false);
    const { snap: _, ...noSnap } = click;
    expect(parseAction(noSnap).success).toBe(false);
  });

  it('requires provenance for typed text', () => {
    expect(parseAction({ ...type, provenance: [] }).success).toBe(false);
    const { provenance: _, ...noProvenance } = type;
    expect(parseAction(noProvenance).success).toBe(false);
  });

  it('only allows plain keys, no shortcuts', () => {
    expect(parseAction({ type: 'press', snap: 0, key: 'Control+W' }).success).toBe(false);
    expect(parseAction({ type: 'press', snap: 0, key: 'F12' }).success).toBe(false);
  });

  it('caps waits and requires evidence to finish', () => {
    expect(parseAction({ type: 'wait', ms: 60_000 }).success).toBe(false);
    expect(parseAction({ ...finish, evidence: [] }).success).toBe(false);
  });
});

suite('parseBatch', () => {
  it('allows up to three page actions', () => {
    expect(parseBatch([type, type, click]).success).toBe(true);
    expect(parseBatch([type, type, type, click]).success).toBe(false);
    expect(parseBatch([]).success).toBe(false);
  });

  it('keeps turn-ending actions on their own', () => {
    expect(parseBatch([finish]).success).toBe(true);
    expect(parseBatch([click, finish]).success).toBe(false);
    expect(parseBatch([{ type: 'ask_user', question: 'Which size?' }, click]).success).toBe(false);
  });
});

suite('risk and describe', () => {
  const samples: Action[] = [
    Action.parse(click),
    Action.parse(type),
    Action.parse({ type: 'press', snap: 0, key: 'Enter' }),
    Action.parse({ type: 'select', snap: 0, ref: 'e1', option: 'Large' }),
    Action.parse({ type: 'scroll', snap: 0, direction: 'down' }),
    Action.parse({ type: 'goto', url: 'https://shop.example.com/cart' }),
    Action.parse({ type: 'back' }),
    Action.parse({ type: 'wait', ms: 500 }),
    Action.parse({ type: 'request_help', reason: 'Password needed' }),
    Action.parse({ type: 'ask_user', question: 'Which size?' }),
    Action.parse(finish),
  ];

  it('covers every action type', () => {
    expect(new Set(samples.map((a) => a.type))).toEqual(new Set(Object.keys(BASE_RISK)));
  });

  it('never marks an action transact by type alone', () => {
    expect(Object.values(BASE_RISK)).not.toContain('transact');
  });

  it('gives every action a spoken phrase', () => {
    for (const action of samples) {
      expect(describe(action).length).toBeGreaterThan(0);
    }
  });

  it('uses the element name and keeps phrases short', () => {
    expect(describe(Action.parse(click), 'Add to cart')).toBe('Clicking "Add to cart"');
    expect(describe(Action.parse(click))).toBe('Clicking that');
    expect(describe(Action.parse({ type: 'goto', url: 'https://shop.example.com/cart' }))).toBe(
      'Going to shop.example.com',
    );
    expect(describe(Action.parse(click), 'x'.repeat(200)).length).toBeLessThan(60);
  });

  it('does not read typed text aloud', () => {
    expect(describe(Action.parse(type), 'Full name')).toBe('Typing into "Full name"');
    expect(describe(Action.parse(type), 'Full name')).not.toContain('Sam Lee');
  });
});
