# Theo Profile Foundation & Google Auth

This document is the build plan for Theo’s **account / profile layer** — the signed-in identity foundation for the whole browser — so chrome and the webview can attach to that account later without redoing auth.

It is written against the **current repo as of now**, so you can implement this yourself step by step.

---

## 1. Product idea (read this first)

Login + Onboarding together are **not** throwaway welcome screens.

They live in the **onboarding layer** — Theo’s **single-account bootstrap**.

### Naming: onboarding layer vs Dashboard

| Term | Meaning |
|------|---------|
| **Onboarding layer** | The whole pre-browser experience: Login, future setup screens, and Dashboard |
| **Dashboard** | The caretaker home screen (formerly `Onboarding.tsx`) — welcome, CTA, support guide |
| **Login** | Continue with Google (to add) |
| **Setup** | Future screens in the same layer (prefs, accessibility, etc.) |

Code lives under `src/onboarding-layer/` (hyphenated — no spaces in folder names).

### Hard constraint: one account only

Theo is **not** a multi-profile browser. There is never a list of accounts to pick from.

- Exactly **one** Google account may be associated with the app at a time.
- That account owns the local session, prefs, and (later) bookmarks/history/agent context.
- Switching people means **log out**, then log in as someone else — which replaces the previous session.
- Do **not** design `StoredSession` as an array of profiles. One blob, one user.

Think “Chrome profile bootstrap UX,” not “Chrome’s multi-profile picker.”

| Concept | Theo |
|---------|------|
| Establish identity | `Login` (Continue with Google) |
| Caretaker home | `Dashboard` (welcome / open browser / guide) |
| Future setup | More screens inside `onboarding-layer/` |
| The account | One persisted session (Google identity + prefs + encrypted tokens) |
| After bootstrap | Browser chrome + webview bound to that one account |

Once bootstrap finishes, the rest of the app assumes:

> There is **the** signed-in account (or none). Who is this user? What tokens can we use? What prefs apply?

When you later build the address bar / webview / agent loop (`tips.md`), you do **not** re-solve identity. You consume that single session.

---

## 2. What exists today (ground truth)

### Stack

- **Electron Forge + Vite** (`forge.config.js`, `vite.*.config.mjs`)
- **React 19** renderer
- **Tailwind 4**
- **JavaScript only** (no TypeScript yet)
- Product name: **Theo** (`package.json` → `productName: "Theo"`)

### Process layout (already correct)

| Process | File(s) today | Role |
|---------|---------------|------|
| Main | `src/main.ts` | Window, menu, IPC handlers, Node-side work |
| Preload | `src/preload.ts` | `contextBridge` → `window.theo.*` |
| Renderer | `src/renderer.tsx` → `src/App.tsx` → onboarding-layer | React UI only |

This split is the foundation for secure auth. **Do not collapse it.**

### Renderer today

- `src/App.tsx` mounts **only** `Dashboard` — no routing, no login, no session check.
- `src/onboarding-layer/Dashboard.tsx` is the caretaker welcome UI (“Welcome, Caretaker”, CTA “Open browser for Pratyush”, support guide card).
- Hardcoded name **Pratyush** appears in the CTA and guide copy — this will become `firstName` from Google.
- Dashboard animation persistence is **session-only in memory** via IPC:
  - `should-animate-dashboard`
  - `mark-dashboard-played`
  - backed by `dashboardAnimatedThisSession` in `main.ts` (resets every app launch)

### Preload API today (`window.theo`)

```js
openExternal(url)
shouldAnimateDashboard()
markDashboardPlayed()
```

No auth methods yet.

### Main IPC today

```js
'open-external'
'should-animate-dashboard'
'mark-dashboard-played'
```

Window: hidden title bar, traffic lights at `{ x: 32, y: 32 }`, zoom disabled, preload attached. Default Electron `webPreferences` otherwise (keep `contextIsolation` on; do **not** enable `nodeIntegration` for the renderer).

### Visual / assets already in repo

- Fossil/museum background: `src/assets/onboardingbg.png` (applied on `body` in `src/index.css`)
- Wordmark, mascot, guidebook art under `src/assets/`
- Fonts: Inter + Bricolage Grotesque
- Animation utility: `.enter-blur` in `index.css`

### Login UI

Designed but **not in the repo yet**. Target screen:

- Cloud pattern background (not the fossil onboarding bg)
- “Let’s get started.”
- “Continue with Google”

That becomes `src/pages/Login.tsx` (after TS migration).

### Related notes already in repo

`tips.md` describes the **later** browser/agent build order (webview → address bar → a11y tree → AI → actions). **Do that after** this profile foundation. Auth is the pipe Google services and account-scoped data will reuse.

---

## 3. Target architecture

### One rule

**Tokens never enter the renderer.**  
React only ever sees safe profile fields: `firstName`, `pictureUrl`, and flags like `onboardingCompleted`.

### Rooms

```
RENDERER (React)          PRELOAD                 MAIN (Node)
─────────────────         ─────────               ─────────────────
Login / Onboarding        window.theo.auth.*      Google OAuth
App router                IPC bridge only         token / profile vault
Future browser chrome                             refresh access tokens
                                                  Google API calls later
```

### Target file tree (new + renamed)

```
src/
  main.ts                 ← migrate from main.js; wire IPC + protocol
  preload.ts              ← migrate from preload.js; expose theo.auth
  renderer.tsx
  App.tsx                 ← route: Login | Dashboard | (later Browser)
  index.css
  onboarding-layer/
    Login.tsx             ← NEW — Continue with Google
    Dashboard.tsx         ← caretaker home; use profile fields
    # future setup screens go here too
  pages/                  ← LATER browser shell, etc. (not onboarding)
    Browser.tsx           ← LATER — chrome + webview
  auth/
    pkce.ts               ← NEW — state + PKCE helpers
    tokenStore.ts         ← NEW — safeStorage persistence
    googleOAuth.ts        ← NEW — authorize, callback, token exchange, userinfo
    googleApi.ts          ← LATER — Drive/Gmail/etc. using vaulted tokens
  types/
    profile.ts            ← NEW — PublicProfile vs StoredSession types
    theo-api.d.ts         ← NEW — window.theo typings for renderer
```

`forge.config.js` Vite entries must point at the new `.ts` / `.tsx` entry paths when you migrate.

---

## 4. Data model

### What Google gives us (after OAuth)

- `access_token` — short-lived (~1 hour); used for Google HTTP APIs
- `refresh_token` — long-lived; **this is “stay logged in”**
- Profile claims / userinfo — we only **need** for now:
  - `given_name` → `firstName`
  - `picture` → `pictureUrl`

Scopes for now: `openid profile`  
(`access_type=offline` + appropriate consent so Google returns a refresh token)

### Two TypeScript types (security boundary)

```ts
// Safe to send to React over IPC
type PublicProfile = {
  signedIn: true;
  firstName: string;
  pictureUrl: string;
  onboardingCompleted: boolean;
};

// Main-process only — NEVER import this from pages/*
type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  firstName: string;
  pictureUrl: string;
  onboardingCompleted: boolean;
  // optional later: googleSub, email, prefs, etc.
};
```

If React code tries to read `refreshToken`, TypeScript should make that impossible.

### What “logged in” means

> Main has an encrypted on-disk session containing a **refresh token** for the one account.

| Event | Result |
|-------|--------|
| Continue with Google succeeds | Save/replace the single `StoredSession`; show Dashboard |
| Quit and reopen app | Load store → still signed in → skip Login |
| Access token expires | Main refreshes silently with refresh token |
| User logs out | Clear store (optionally revoke at Google) → Login |
| Another Google account signs in | Only possible after logout; new login **overwrites** the one session slot |
| Close window | **Not** logout |

`tokenStore` always holds zero or one session — never a list.

---

## 5. End-to-end data flows

### A. First-time login

```
Login.tsx
  user clicks "Continue with Google"
  await window.theo.auth.signIn()
        │
        ▼
preload.ts  →  ipcRenderer.invoke('auth:sign-in')
        │
        ▼
main → googleOAuth.signIn()
  1. pkce: code_verifier, code_challenge, state
  2. open Google authorize URL (system browser or auth BrowserWindow)
  3. user consents
  4. redirect to theo://oauth/callback?code=...&state=...
     (or http://127.0.0.1:PORT/callback — pick one and stick to it)
  5. main verifies state
  6. POST code + code_verifier → Google token endpoint
  7. receive access_token + refresh_token + expires_in
  8. fetch userinfo (or decode id_token) → firstName, pictureUrl
  9. tokenStore.save(StoredSession)
 10. return PublicProfile to renderer   ← NO tokens
        │
        ▼
App.tsx sets state → render Dashboard with firstName + pictureUrl
```

### B. Cold start (stay logged in)

```
App.tsx on mount
  session = await window.theo.auth.getSession()
        │
        ├─ null / signedOut     → Login
        ├─ signedIn && !onboardingCompleted → Dashboard (or setup screens)
        └─ signedIn && onboardingCompleted  → Browser (later; for now Dashboard or a stub)
```

### C. Leave Dashboard → enter browser (later)

```
Dashboard "Open browser for {firstName}"
  → window.theo.auth.completeOnboarding()  // sets onboardingCompleted: true in store
  → App shows Browser shell bound to the single account
```

Until Browser exists, the button can call `completeOnboarding()` and stay on a placeholder, or simply mark complete and re-render Dashboard. Wire the real navigation when chrome lands.

### D. Logout

```
window.theo.auth.signOut()
  → tokenStore.clear()
  → optional Google revoke
  → App shows Login
```

### E. Later Google API call (Drive, etc.)

```
Renderer: theo.google.listFiles()   // or similar
  → Main: tokenStore.getValidAccessToken()
       (refresh if expired)
  → Main: call Google API with access token
  → Renderer: receives data only
```

Same vault. No second login.

---

## 6. Preload / IPC contract

Extend `window.theo` (keep existing helpers):

```ts
window.theo = {
  // existing
  openExternal(url: string): Promise<void>
  shouldAnimateDashboard(): Promise<boolean>
  markDashboardPlayed(): Promise<void>

  // new
  auth: {
    signIn(): Promise<PublicProfile>
    getSession(): Promise<PublicProfile | { signedIn: false }>
    signOut(): Promise<void>
    completeOnboarding(): Promise<PublicProfile>
  }
}
```

Main handlers (suggested channel names):

| Channel | Owner module |
|---------|----------------|
| `auth:sign-in` | `googleOAuth.ts` + `tokenStore.ts` |
| `auth:get-session` | `tokenStore.ts` (map to PublicProfile) |
| `auth:sign-out` | `tokenStore.ts` (+ revoke optional) |
| `auth:complete-onboarding` | `tokenStore.ts` |

**Pattern:** renderer uses `invoke` (request/response), then updates React state.  
Do not rely on push-style `ipcRenderer.on` for the primary login path.

---

## 7. Module responsibilities (implement in this order)

### Phase 0 — TypeScript migration

Goal: same UI as today, all TS.

1. Add TypeScript + types for React/Electron/Vite.
2. Convert (mostly done already):
   - `src/main.ts`, `preload.ts`, `renderer.tsx`, `App.tsx`
   - Onboarding UI lives at `src/onboarding-layer/Dashboard.tsx`
3. Keep `forge.config.js` entries and `index.html` script path in sync with `.ts` / `.tsx`.
4. Keep `src/vite-env.d.ts` (or `types/theo-api.d.ts`) so `window.theo` is typed in the renderer.
5. Confirm `npm start` still shows Dashboard.

**Exit criteria:** app boots; onboarding animation still works; no JS entrypoints left for app code.

### Phase 1 — Profile vault + IPC (no Google UI required)

1. `src/types/profile.ts` — `PublicProfile` / `StoredSession`
2. `src/auth/tokenStore.ts`
   - path under `app.getPath('userData')`
   - encrypt/decrypt with Electron `safeStorage`
   - `save`, `load`, `clear`, `getValidAccessToken` (refresh stub OK until Phase 2)
3. Register auth IPC in `main.ts`
4. Expose `theo.auth.*` in `preload.ts`
5. Optionally write a **dev-only** fake session to test App routing without Google

**Exit criteria:** renderer can `getSession` / save a fake profile / clear it across restarts.

### Phase 2 — Google OAuth in main

1. `src/auth/pkce.ts` — `createPkcePair()`, `createState()`
2. `src/auth/googleOAuth.ts`
   - build authorize URL
   - open auth UI
   - catch redirect (custom protocol `theo://` **or** loopback — choose one)
   - exchange code
   - load userinfo → `firstName`, `pictureUrl`
   - persist via `tokenStore`
3. Wire client ID via env / main-only config (**never** put secrets in renderer; prefer public OAuth client + PKCE for installed apps)
4. Implement access-token refresh in `tokenStore.getValidAccessToken()`

**Exit criteria:** real Google login; restart stays logged in; logout clears vault.

### Phase 3 — Onboarding-layer UI (Login + Dashboard)

1. Add `src/onboarding-layer/Login.tsx` (cloud UI + Continue with Google → `theo.auth.signIn()`)
2. Update `App.tsx` routing:

```ts
// conceptual
const session = await window.theo.auth.getSession()
if (!session.signedIn) return <Login />
return <Dashboard profile={session} onOpenBrowser={...} />
```

3. Update `Dashboard.tsx`:
   - Replace hardcoded “Pratyush” with `profile.firstName`
   - Optionally show `profile.pictureUrl` (avatar)
   - Keep existing animation + guide card + `openExternal` behavior
   - CTA eventually calls `completeOnboarding()` then navigates to Browser
4. Fossil background stays associated with **Dashboard** (current `body` background in `index.css` may need to become page-scoped so Login can use the cloud background instead)

**Exit criteria:** Login → Google → Dashboard with real name/photo; cold start skips Login when session exists.

### Phase 4 — Browser chrome consumes the profile

Only after Phase 3. Aligns with `tips.md`:

1. `Browser.tsx` (toolbar + webview/BrowserView)
2. Address bar navigation
3. A11y-tree extraction
4. Agent loop
5. `googleApi.ts` for Google services using the same vault

Browser chrome reads `firstName` / `pictureUrl` for account UI and never touches tokens.

---

## 8. Security checklist (non-negotiable)

- [ ] `contextIsolation: true` (default — keep it)
- [ ] `nodeIntegration: false` for renderer
- [ ] Preload expose **only** narrow `theo.auth` methods — never raw `ipcRenderer`
- [ ] Tokens only in main + `safeStorage` file
- [ ] IPC returns `PublicProfile` only
- [ ] PKCE on authorize + token exchange
- [ ] Validate OAuth `state`
- [ ] Redirect URI handling only in main
- [ ] Do not log access/refresh tokens
- [ ] TypeScript types enforce the Public vs Stored split

TypeScript reduces foot-guns. It does **not** replace this checklist.

---

## 9. How current files change (cheat sheet)

| Current file | What you do |
|--------------|-------------|
| `src/App.tsx` | Become router: Login vs Dashboard (vs Browser later) |
| `src/onboarding-layer/Dashboard.tsx` | Keep UI/animation; parameterize name/photo from profile |
| `src/preload.js` | Add `auth` namespace beside existing methods |
| `src/main.js` | Register auth IPC; import `auth/*`; register protocol/loopback |
| `src/index.css` | Split backgrounds so Login ≠ Dashboard fossil bg |
| `tips.md` | Still valid for post-profile browser/agent work |
| `forge.config.js` | Point Vite entries at `.ts` files after migration |

New work lives mostly under `src/auth/` and `src/pages/Login.tsx`.

---

## 10. Suggested App state machine

```
                    ┌─────────────┐
                    │  App boot   │
                    └──────┬──────┘
                           │ getSession()
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     signedOut      signedIn &&      signedIn &&
                    !onboardingDone  onboardingDone
           │               │               │
           ▼               ▼               ▼
        Login          Dashboard        Browser
           │               │            (Phase 4)
           │ signIn OK     │ CTA
           └───────►───────┴── completeOnboarding()
```

(`Login` + `Dashboard` (+ future setup) = onboarding layer.)

Same idea as opening a browser that already knows its one signed-in account, then showing UI for that account.

---

## 11. What “done” looks like for this foundation

You can ship the profile layer when:

1. TypeScript is the app language.
2. Continue with Google creates an encrypted on-disk session in main.
3. Restart does not ask for Google again.
4. Dashboard shows Google `firstName` + `pictureUrl`.
5. Explicit logout returns to Login and wipes the vault.
6. Renderer never receives tokens (verify by reading IPC return types / network tab habits / not storing tokens in React state).
7. Adding Browser chrome is “attach UI to `getSession()`,” not “build a second auth system.”

---

## 12. Implementation order (short)

```
0. Migrate to TypeScript
1. tokenStore + typed IPC + preload auth API
2. googleOAuth (PKCE + redirect + exchange + userinfo)
3. Login.tsx + App routing + Dashboard profile fields (all under `onboarding-layer/`)
4. Browser chrome / webview / agent (tips.md) on top of the single account
```

Do not start webview or Google product APIs before step 3 works end-to-end.

### Immediate next steps (do these next)

1. ~~Folder cleanup: `onboarding-layer/Dashboard.tsx`~~ (done)
2. Add `src/types/profile.ts` (`PublicProfile` / `StoredSession`)
3. Add `src/auth/tokenStore.ts` + wire `theo.auth.getSession` / `signOut` stubs in preload/main
4. Add `src/onboarding-layer/Login.tsx` shell (UI only) and route it from `App.tsx`
5. Then implement real Google OAuth in main (`pkce.ts` + `googleOAuth.ts`)

---

## 13. Open choices to decide while building

These are intentional forks; pick once and document in code comments:

1. **Redirect style:** custom protocol `theo://oauth/callback` vs loopback `http://127.0.0.1:<port>/callback`
2. **Auth UI host:** system browser vs dedicated Electron `BrowserWindow`
3. **Client ID storage:** env var at build/dev time vs config file loaded only in main

**Not an open choice:** account model is permanently **single-account**. No profile list, no side-by-side users, no “add another account.” Logout is the only way to change who Theo belongs to.

---

*This doc is the source of truth for the profile/auth foundation. Update it if you change redirect strategy or the PublicProfile shape.*
