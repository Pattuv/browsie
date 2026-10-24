// Tells the mock server what happened, so the harness grades runs on outcomes, not on what the agent claims.
const SITE = location.pathname.split('/')[1];

window.report = (kind, data = {}) =>
  fetch('/api/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: SITE, kind, data }),
  });
