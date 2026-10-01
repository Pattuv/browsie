import { create } from 'zustand';

// Login gate only. Main owns the real session; this is the renderer's read-only mirror of it.
// LOADING exists only here: it's the moment before main has answered.
type AuthState = Omit<AuthSession, 'status'> & {
  status: 'LOADING' | AuthSession['status'];
};

export const useAuthStore = create<AuthState>()(() => ({ status: 'LOADING' }));

// Runs once, the first time any layer imports this file.
// Replace (not merge) so signing out also clears firstName, picture, etc.
const auth = window.browsie?.auth;

if (auth) {
  auth.onSessionChanged((session) => useAuthStore.setState(session, true));
  void auth.getSession().then((session) => useAuthStore.setState(session, true));
} else {
  useAuthStore.setState({ status: 'SIGNED_OUT' }, true);
}
