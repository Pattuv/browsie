import { describe, expect, it, vi } from 'vitest';
import { watchAccount } from './accountScope';

describe('watchAccount', () => {
  const setup = (initial: string | null) => {
    let account = initial;
    let fire = () => {};
    const onChange = vi.fn();
    watchAccount(
      () => account,
      (listener) => {
        fire = listener;
      },
      onChange,
    );
    return {
      onChange,
      change: (next: string | null) => {
        account = next;
        fire();
      },
    };
  };

  it('fires on sign-out and when another account signs in', () => {
    const { onChange, change } = setup('alice');
    change(null);
    expect(onChange).toHaveBeenCalledTimes(1);
    change('bob');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not fire when the same account only changes its session', () => {
    const { onChange, change } = setup('alice');
    change('alice');
    expect(onChange).not.toHaveBeenCalled();
  });
});
