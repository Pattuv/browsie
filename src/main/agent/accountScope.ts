// Calls `onChange` each time the signed-in account differs from the last one seen: signing out (factory
// reset included), or someone else signing in. Not when the same account just changes (new Google
// permissions, setup finishing). No Electron in here, so tests can drive it.
export const watchAccount = (
  getAccountId: () => string | null,
  subscribe: (listener: () => void) => unknown,
  onChange: () => void,
) => {
  let last = getAccountId();
  subscribe(() => {
    const next = getAccountId();
    if (next === last) return;
    last = next;
    onChange();
  });
};
