# Browsie Data Inventory

Audited from the source at commit `5f8ae64` (branch `privacy-security-fixes`), **including uncommitted working-tree changes** (`src/main/microphone.ts`, `src/renderer/onboarding-layer/pages/setup-pages/MicSetup.tsx`, and edits to `ipc.ts` / `preload.ts`). App version in `package.json`: 0.1.1.

This revision reflects the eight commits on `privacy-security-fixes` on top of `dc7dae6`: goto provenance, session memory cleared on account change, confirmation for calendar updates that email attendees, OpenRouter no-retention routing, card-number masking, fuller factory reset, downloads deletion and Google revocation on "Remove my data", and removal of the agent's settings-changing command. **This describes the branch, not `main`.** Until the branch is merged, the rows that mention these changes (mainly §2, §8 and §9) do not match what ships from `main`.

Every row cites the file it comes from. **UNVERIFIED** marks anything the code does not settle by itself, such as what a third party does with data after receiving it, or what Electron/Chromium does on its own.

Terms used below:
- **userData**: Electron's `app.getPath('userData')` folder. The code never overrides it (no `app.setPath`/`app.setName` in `src/main`). The exact folder name on disk is **UNVERIFIED**. `test/web/withAppKey.ts:12` assumes `%APPDATA%\Browsie` on Windows.
- **Account key**: the first 16 hex characters of SHA-256 of the Google account ID (`sub`). Used in file and folder names so the raw Google ID never appears on disk (`src/main/auth/accountKey.ts:6`).
- **safeStorage**: Electron's OS-backed encryption: macOS Keychain, Windows DPAPI (`src/main/auth/vault.ts:17-18`).

---

## 1. External services

### 1a. Services the packaged app contacts

| Item | Data sent | Destination | When / trigger | File path | Notes |
|---|---|---|---|---|---|
| Google OAuth consent | client_id, redirect_uri (127.0.0.1 loopback), scopes, PKCE challenge, state, `login_hint` (user's email, Workspace connect only) | `accounts.google.com/o/oauth2/v2/auth` (opened in the user's **system browser**) | User clicks sign-in, or asks for Gmail/Calendar/Drive for the first time | `src/main/auth/googleOAuth.ts:49-75`, `src/main/auth/session.ts:104,202-210` | `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` |
| Google token exchange / refresh | auth code + PKCE verifier, or refresh token; client_id + client_secret | `oauth2.googleapis.com/token` | After consent (user); access-token refresh (automatic, including one check at startup via `verifySession`) | `src/main/auth/googleOAuth.ts:77-104`, `src/main/auth/session.ts:251-293`, `src/main/main.ts:60` | Client secret is built into the app from `.env` (`src/main/config.ts`, `.env.example`) |
| Google token revoke | refresh token | `oauth2.googleapis.com/revoke` | Sign-out with **"Remove my data from this device"**, and **factory reset** (user); also automatic if the user picks a different Google account on the Workspace consent screen | `src/main/auth/googleOAuth.ts:107-109`, `src/main/auth/session.ts:216,322-339`, `src/main/ipc.ts:231` | A plain sign-out does **not** revoke. Revoking removes every permission the account gave Browsie and signs it out on other devices (`session.ts:322-324`) |
| Google profile picture | GET on the `picture` URL from the ID token | Google image host (URL supplied by Google) | Once per sign-in (automatic) | `src/main/auth/googleOAuth.ts:120-135`, `src/main/auth/session.ts:118-120` | Stored as a data: URL in the encrypted vault |
| Google Drive appDataFolder (sync) | Settings doc, bookmarks, history (see §4) | `www.googleapis.com/drive/v3/files`, `.../upload/drive/v3/files` | **Automatic**: at startup, 2s after a settings or bookmark change, 60s after a history change, every 5 minutes, on window focus (at most once a minute), on wake from sleep | `src/main/data/driveClient.ts`, `src/main/data/syncEngine.ts:9-13,190-208` | Only if the `drive.appdata` scope was granted (`session.ts:44,81`) |
| Gmail API | Search queries, message IDs, composed email (to/cc/subject/body), label changes | `gmail.googleapis.com/gmail/v1/users/me` | When the agent's INFO lane calls a Gmail tool for a spoken request | `src/main/google/gmail.ts`, `src/main/google/tools.ts` | Needs the `gmail.modify` scope |
| Google Calendar API | Event queries, new and updated events (title, times, location, description, attendees) | `www.googleapis.com/calendar/v3/calendars/primary/events` | INFO lane, from a spoken request | `src/main/google/calendar.ts` | Needs the `calendar` scope. `sendUpdates` is set on every write: create `all` with attendees / `none` without, update `all`, delete `all` (`calendar.ts:73,90,102`), so Google emails attendees about creates, changes and deletes |
| Google Drive / Docs API (files) | Search queries, file IDs, new doc title + text, appended text, new names | `www.googleapis.com/drive/v3/files`, `docs.googleapis.com/v1/documents` | INFO lane, from a spoken request | `src/main/google/drive.ts` | Needs the full `drive` scope |
| Google search suggestions | Text typed in the address bar (up to 200 chars), `safe=active` if SafeSearch is on | `suggestqueries.google.com/complete/search` | As the user types in the address bar (user-initiated, per keystroke batch); `warmSuggestions` pre-opens a socket | `src/main/browser/suggestions.ts:5,215-243` | Sent from an in-memory partition with `credentials: 'omit'`, so the website cookies are not attached (`suggestions.ts:12-14`) |
| Suggestion images | Image URL (Google-hosted only); the suggested site's domain via the `s2/favicons` URL | `*.gstatic.com`, `www.google.com/s2/favicons` | While suggestions are shown | `src/main/browser/suggestions.ts:33-48,69` | Restricted to Google hosts so the suggested site never learns what was typed |
| Default search engine | Search words | `www.google.com/search?q=` | User or agent submits non-URL text in the address bar | `src/main/browser/tabs.ts:76,713` | Loaded in the account's web partition, so the user's Google cookies are attached |
| Google web sign-in page | User's email in the URL (`Email=` parameter) | `accounts.google.com/ServiceLogin` | First tab of an account whose web partition is not logged in to Google (automatic) | `src/main/browser/googleWebLogin.ts:79-84`, `src/main/browser/tabs.ts:1806` | |
| Website favicons | GET on the favicon URL the page declares | The website's own server | Automatic, on page load | `src/main/browser/favicons.ts:25-46` | Sent through the account's web partition (site cookies attached) |
| Websites the user or agent visits | Normal browser traffic | Any site | User or agent navigation | `src/main/browser/tabs.ts`, `src/main/browser/webSession.ts` | User agent is Chromium/Electron with the app name removed (`webSession.ts:105-109`). On YouTube, the header `YouTube-Restrict: Strict` is added when SafeSearch is on (`webSession.ts:197-205`) |
| OpenRouter: key setup | User's **management key** (Bearer); `POST /keys` with name "Browsie", spend limit, reset period | `openrouter.ai/api/v1/credits`, `/keys`, `/keys/<hash>` | User saves or replaces a key or changes the cap (setup / settings) | `src/main/data/aiKey.ts:60-241` | Creates a separate "Browsie" key on the user's OpenRouter account |
| OpenRouter: delete Browsie key | `DELETE /keys/<hash>` with the management key | `openrouter.ai/api/v1/keys/<hash>` | When the key is replaced; on sign-out with "Remove my data"; on factory reset | `src/main/data/aiKey.ts:78-80,152-161`, `src/main/ipc.ts:239-242` | Best effort: errors are ignored |
| OpenRouter: usage card | Management key; reads `/credits` and `/keys/<hash>` | `openrouter.ai/api/v1` | When the profile menu or usage card is opened (cached for 10s) | `src/main/data/openRouterUsage.ts:44-147` | |
| OpenRouter: chat completions (AI models) | See §2 | `openrouter.ai/api/v1/chat/completions` | Each spoken request (user holds Space) | `src/main/agent/broker.ts:55-132`, `src/main/agent/config.ts:6-16` | Header `X-Title: Browsie`. Models: `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`. Sends `provider: { data_collection: "deny", zdr: true }` (`broker.ts:87`, `config.ts:31`) |
| OpenRouter: speech-to-text (ElevenLabs model) | Recorded WAV audio, base64 | `openrouter.ai/api/v1/audio/transcriptions`, model `elevenlabs/scribe-v2` | After each Space-held recording of at least 350 ms | `src/main/voice/speechApi.ts:68-79`, `src/main/agent/config.ts:37-39`, `src/main/voice/conductor.ts:399-404` | ElevenLabs is reached **only through OpenRouter**. No direct ElevenLabs endpoint in the app. Sends the same `provider` preferences (`speechApi.ts:71`) |
| OpenRouter: text-to-speech (ElevenLabs model) | Text Browsie speaks (up to 2,000 chars) | `openrouter.ai/api/v1/audio/speech`, model `elevenlabs/eleven-v4-turbo`, voice ID `cjVigY5qzO86Huf0OWal` | Whenever Browsie speaks a non-cached line | `src/main/voice/speechApi.ts:82-100`, `src/main/agent/config.ts:38-43` | Spoken text can include web page, email or calendar content summarised by the model. Sends the same `provider` preferences (`speechApi.ts:90`) |
| browsie.org links | None beyond a normal page visit | `browsie.org/terms`, `/privacy`, `/help-center`, `/setup-guide` | User clicks the link | `src/renderer/onboarding-layer/pages/setup-pages/Auth.tsx:6-7`, `Dashboard.tsx:33`, `SetupGuide.tsx:3` | Opened in the system browser via `shell.openExternal` (`src/main/ipc.ts:79-87`) |
| openrouter.ai dashboard links | None beyond a page visit | `openrouter.ai/settings/credits`, `/settings/keys` | User clicks | `src/renderer/components/ProfileMenu.tsx:10-12` | |
| OS microphone settings | None | `x-apple.systempreferences:` / `ms-settings:` | User clicks in the mic setup step | `src/main/microphone.ts:30-34` (uncommitted) | Local OS URL, not a network call |

### 1b. Services searched for and **not found**

| Item | Result | Evidence |
|---|---|---|
| Direct OpenAI API | Not found | No `openai` reference in `src/` (grep) |
| Direct ElevenLabs API | Not found | Only OpenRouter model IDs (`src/main/agent/config.ts:34-35`) |
| Auto-updater | Not found | No `autoUpdater` / `update-electron-app` in `src/`, `forge.config.js`, or `package.json` deps |
| Analytics (PostHog, Mixpanel, Amplitude, Segment, etc.) | Not found | grep across `src/`, `index.html`, `forge.config.js` |
| Crash reporting (Sentry, `crashReporter`) | Not found | grep across `src/main` |
| Remote fonts / CDNs | Not found | Fonts are bundled (`src/renderer/index.css:9-27`). The production CSP allows only `'self'` and `data:` (`vite.renderer.config.mjs:9-20`) |

### 1c. Development-only network use (not in the packaged app's runtime)

| Item | Data | Destination | File path | Notes |
|---|---|---|---|---|
| Voice clip generator | Fixed fallback lines (no user data) | OpenRouter TTS | `devscripts/clipcreator.ts:4-20` | Run manually with `npm run voice:clips` and a developer key |
| Eval harness | Test scenarios on local mock sites | OpenRouter (developer key); `127.0.0.1` | `test/web/*` | Not bundled into the app's runtime entry points (`forge.config.js:39-62`) |

---

## 2. Content sent to AI models

All model calls go through `src/main/agent/broker.ts` to OpenRouter. The agent process has no key; main adds it (`broker.ts:4-6`). The request schema allows text and **only JPEG screenshots that main took itself** (`src/shared/agent/llm.ts:20-24`). The request body sets `model`, `messages`, `tools`, `tool_choice`, `max_tokens`, `usage` and `provider` (`broker.ts:77-88`).

**Provider routing.** Every OpenRouter request (chat, transcription, speech) sends `provider: { data_collection: "deny", zdr: true }` (`src/main/agent/config.ts:27-31`). Per OpenRouter's OpenAPI spec (`ProviderPreferences`, `STTRequest`, `SpeechRequest`), `data_collection: "deny"` means "use only providers which do not collect user data", and `zdr: true` restricts routing to "Zero Data Retention" endpoints that "do not retain prompts". If no provider qualifies, OpenRouter returns an error rather than routing elsewhere. What these providers actually retain is their own policy, not code: **UNVERIFIED**.

| Item | Data | Destination | File path | Notes |
|---|---|---|---|---|
| Classifier (every request) | System prompt; current tab's **hostname only** (or "no website open"); the last 3 session turns; the transcript | OpenRouter → `claude-haiku-5.5` | `src/agent/classifier.ts:34-56`, `src/main/voice/index.ts:40-44` | |
| Orchestrator (multi-step requests) | Hostname; transcript | OpenRouter → `claude-sonnet-5.5` | `src/agent/orchestrator.ts:9-23` | |
| CHAT / HELP lanes | The last 6 session turns; transcript | OpenRouter → Sonnet (chat) / Haiku (help) | `src/agent/lanes/talk.ts:14-37` | |
| Session memory used as context | For each past turn: what the user said, the label, Browsie's reply. Replies drawn from websites are wrapped in `<untrusted_page_summary>` | Included in classifier and chat/help prompts | `src/agent/sessionStore.ts:49-55`, `src/agent/turn.ts:51,88` | In memory, up to 20 turns (`src/shared/agent/session.ts:6`). The code comment says it holds summaries, never raw page text (`sessionStore.ts:5-7`). Emptied whenever the signed-in account changes (§9), so one account's turns are never context for another's |
| WEB lane: goal and sources | User's words; "sources" (things the user said or confirmed during the task, e.g. answers to questions) | OpenRouter → Sonnet; Opus after 2 failures in a row | `src/agent/web/loop.ts:132-136,165`, `src/agent/web/prompt.ts:95-109` | |
| WEB lane: accessibility tree | Page **URL and title**, plus roles, names (up to 80 chars; text up to 160), states and **current field values** (up to 80 chars) of page elements, including same-process and out-of-process iframes | OpenRouter | `src/main/web/snapshot.ts:119-120,227-232,305,339` | **Password and one-time-code field values are left out** (`snapshot.ts:187-188,232,305`). In every other field, any run of 13–19 digits (optionally grouped by spaces or dashes) is replaced with its last four digits, e.g. `•••• 4242`, before the value is cut to length (`snapshot.ts:190-196,305`). There is no checksum test, so long account or order numbers are masked too. Other field values (names, addresses, emails) are included. Element **names** and page text are not masked |
| WEB lane: screenshots | JPEG (quality 60) of the **visible viewport** | OpenRouter | `src/main/web/snapshot.ts:602-604`, `src/agent/web/loop.ts:119-142` | Taken only when the snapshot decides text isn't enough (`needsScreenshot`, `snapshot.ts:485`). A screenshot shows whatever is on screen at that moment, **including card numbers or anything else visible**: the masking above applies to the text only |
| WEB lane: action results | Navigated URLs, DOM change counts, download file names, the user's answers | OpenRouter | `src/agent/web/loop.ts:56-72,248-256` | |
| UI lane | Transcript; command results: tab titles (up to 120 chars) and hostnames; active tab's full URL; up to 50 bookmarks (title + hostname); up to 20 history matches (**title, full URL, visit time**) | OpenRouter → Sonnet / Opus | `src/agent/ui/lane.ts:133-134`, `src/main/agent/chromeView.ts:6-60` | Favicons are left out (`chromeView.ts:3-4`) |
| INFO lane: context | User's Google **email address**, the current time and time zone, which Google services lack permission | OpenRouter → Sonnet / Opus | `src/agent/info/lane.ts:76-89` | |
| INFO lane: Google data | Tool results wrapped in `<untrusted_google_data>`, each up to 12,000 chars. Gmail: sender, recipients, subject, date, preview (200 chars), **body text up to 6,000 chars**, attachment file names. Drive: file metadata (name, type, modified time, size, owner display name, link) and **file text up to 8,000 chars** (Docs, Sheets as CSV, Slides, plain text). Calendar: event details | OpenRouter | `src/agent/info/lane.ts:29,52-55`, `src/main/google/gmail.ts:7,59,135-136`, `src/main/google/drive.ts:10-13,72-82` | |
| Prompt caching | System prompts are marked `cache_control: ephemeral` | OpenRouter / model provider | e.g. `src/agent/classifier.ts:44` | Only the system prompt is marked (fixed app text, no user data). How long the provider keeps the cache, and how caching behaves on ZDR endpoints, is **UNVERIFIED** |
| Audio | Not sent to the chat models. Audio goes only to the transcription endpoint (§3) | — | `src/main/voice/speechApi.ts:10-12` | |

---

## 3. Audio

| Item | Data | Destination | File path | Notes |
|---|---|---|---|---|
| When the mic is open | Microphone stream | In memory (renderer) | `src/renderer/browser-chrome-layer/SpeechPill.tsx:342,359`, `src/renderer/voice-layer/useRecorder.ts:7-57` | Opened only while `live` is true (Space held). Tracks are stopped on release. The pill's level bars open the mic under the same condition (`SpeechPill.tsx:212-288`) |
| Recording format | webm/opus chunks in memory → converted to 16 kHz mono WAV | In memory | `useRecorder.ts:42-46`, `src/renderer/voice-layer/wav.ts:4` | |
| Hand-off to main | WAV bytes over IPC, at most 2.5 MB (about 1 minute) | Main process memory | `src/main/voice/index.ts:16-17,59-65` | Accepted only from the speech view |
| Transcription | Base64 WAV | OpenRouter → `elevenlabs/scribe-v2` | `src/main/voice/speechApi.ts:68-73` | Recordings under 350 ms or empty are dropped without sending (`conductor.ts:404`). Sent with `provider: { data_collection: "deny", zdr: true }` (`speechApi.ts:71`) |
| Written to disk? | **No code path writes recorded audio to disk** | — | Searched: every `writeFileSync`/`appendFileSync`/`createWriteStream` in `src/` (see §5) | No file write takes audio. Retention by OpenRouter / ElevenLabs beyond the ZDR routing request is **UNVERIFIED** |
| Retention in the app | The audio buffer is passed to `transcribe()` and not stored afterwards | Memory | `src/main/voice/conductor.ts:399-420` | Freed when garbage-collected. No explicit wipe |
| Transcripts | Kept in session memory (up to 20 turns) | Memory (agent process + main) | `src/agent/sessionStore.ts:32-44`, `src/main/agent/host.ts:586-589` | Until the user clears it, the signed-in account changes, or the app quits (§9) |
| TTS audio cache | MP3 of the last 40 spoken lines | Main process memory | `src/main/voice/speechApi.ts:31,50,97-98` | Not written to disk |
| Dev voice log | Recording duration and byte count, **transcript text**, routing, errors | `userData/logs/voice.log` + console | `src/main/voice/log.ts:5-22`, `conductor.ts:402,412` | **Only when `app.isPackaged` is false** (dev builds). Packaged builds keep no voice log |
| OS mic permission | Permission status only | macOS / Windows | `src/main/microphone.ts:11-28` (uncommitted), `forge.config.js:14-16` | macOS prompt text: "Browsie listens while you hold the spacebar…" |
| Website mic access | Blocked unless the user allows it per site | Chromium | `src/main/browser/webSession.ts:50-84`, `src/main/browser/sitePermissions.ts:5-8` | Starts blocked. Allowed only for the top-level page's own origin, never embedded frames |

---

## 4. Google

### 4a. OAuth scopes

| Scope | When requested | File path | Notes |
|---|---|---|---|
| `openid`, `profile`, `email` | At sign-in | `src/main/auth/googleOAuth.ts:7-8` | |
| `https://www.googleapis.com/auth/drive.appdata` | At sign-in | `googleOAuth.ts:7-8` | Sync is off if the user unticks it (`session.ts:44,129-130`) |
| `https://www.googleapis.com/auth/gmail.modify` | Incremental: the first time the user asks about mail, calendar or files, or clicks connect in Settings | `googleOAuth.ts:10-17`, `session.ts:190-243` | Code comment: restricted scope, needs Google verification for public release (`googleOAuth.ts:12`) |
| `https://www.googleapis.com/auth/calendar` | Same incremental request | `googleOAuth.ts:15` | All three Workspace scopes are requested together (`session.ts:207`) |
| `https://www.googleapis.com/auth/drive` | Same incremental request | `googleOAuth.ts:16` | Full Drive access, not just appData |

### 4b. Drive appDataFolder contents

| File | Data | Destination | File path | Notes |
|---|---|---|---|---|
| `browsie-data.json` | `schemaVersion`, `updatedAt`, `deviceId` (random UUID), `userMode`, `settings` | Google Drive hidden app folder | `src/main/data/driveClient.ts:9`, `src/main/data/localStore.ts:7-11`, `syncEngine.ts:40-73` | Settings keys found in code: `appearance` (`theme.ts:7`), `safeSearch` (`shared/web/safeSearch.ts:2`), `bookmarksBar` (`tabs.ts:1475`; changed only by the person, no longer by the agent, see §8), `sitePermissions` = map of website origin → allowed geolocation/camera/microphone/notifications (`sitePermissions.ts:9-14`). Newest copy wins. The local-only fields `dirty` and `lastSyncedAt` are not uploaded (`localStore.ts:13-21,141-144`) |
| `browsie-bookmarks.json` | Each bookmark: id, kind, url, title, favicon (data: URL ≤16 KB), parentId, position, createdAt, updatedAt, deviceId, deletion tombstone | Drive app folder | `driveClient.ts:10`, `src/main/data/bookmarks.ts:21-42`, `collectionSync.ts` | Merged item by item |
| `browsie-history.json` | Each visit: id, **full URL**, title (≤300 chars), visitedAt, updatedAt, deviceId; `clearedBefore` marker | Drive app folder | `driveClient.ts:11`, `src/main/data/history.ts:20-34` | Last 90 days, at most 20,000 visits (`history.ts:26-27,50-56`). Every http(s) page visit is recorded automatically (`history.ts:133-156`) |
| Drive file metadata | `appProperties.updatedAt` or `appProperties.version` (`<ISO time>|<deviceId>`) | Drive | `driveClient.ts:65-96`, `collectionSync.ts:97` | |
| Reading from the app folder | Finds each file by name, downloads it if newer, validates it, then merges or applies it | — | `driveClient.ts:67-85`, `collections.ts:101-116`, `localStore.ts:148-173` | |

### 4c. Tokens

| Token | Stored where | Encrypted | File path | Notes |
|---|---|---|---|---|
| Refresh token (covers every scope granted so far) | `userData/session.bin`, together with `sub`, first name, email, profile picture (data: URL), granted scopes | Yes, safeStorage (Keychain / DPAPI) | `src/main/auth/vault.ts:5-40` | Written **only after setup is complete** (`session.ts:136-145,307-315`). Not written at all if OS encryption is unavailable (`vault.ts:29-33`) |
| Access token | Main process memory only | n/a | `session.ts:25-28,83-86` | Refreshed 60s before expiry |
| ID token | Decoded once at sign-in, not stored | n/a | `googleOAuth.ts:114-117`, `session.ts:117` | Signature is not verified (comment explains why: `googleOAuth.ts:111-113`) |
| What the renderer sees | First name, email, picture, which services are connected. **No tokens, no `sub`** | — | `session.ts:46-64` | |
| Google website cookies (from signing in on google.com inside Browsie) | The account's Chromium partition | Chromium cookie encryption enabled by fuse (`forge.config.js:70`). Exact at-rest behaviour per OS is **UNVERIFIED** | `src/main/browser/webSession.ts:11-24` | Separate from the OAuth tokens |

---

## 5. Local storage on the user's machine

| Item | Data | Location | File path | Encrypted? |
|---|---|---|---|---|
| Sign-in vault | Refresh token, Google ID, first name, email, picture, scopes | `userData/session.bin` (+ `.tmp` during write) | `src/main/auth/vault.ts:15,36-38` | Yes (safeStorage) |
| OpenRouter keys | **Management key**, Browsie AI key, AI key hash | `userData/ai-keys/<account key>.bin` | `src/main/data/aiKey.ts:7-12,82-88` | Yes (safeStorage). Saving is refused if encryption is unavailable (`aiKey.ts:102-104`) |
| App data / settings | userMode, settings (appearance, safeSearch, bookmarksBar, sitePermissions), deviceId, updatedAt, dirty, lastSyncedAt | `userData/browsie-data.json` | `src/main/data/localStore.ts:13-23,41-45` | **No** (plain JSON; code comment: "preferences, not secrets") |
| Setup record | Account keys (hashed) that finished setup on this device | `userData/setup-complete.json` | `src/main/data/setupRecord.ts:9,31-35` | No |
| Bookmarks | As in §4b | `userData/library/<account key>/bookmarks.json` | `src/main/data/libraryPaths.ts:6-11`, `bookmarks.ts` | No |
| History | As in §4b | `userData/library/<account key>/history.json` | `libraryPaths.ts:10-11`, `history.ts` | No |
| Sync bookkeeping | `{dirty, version}` per collection | `userData/library/<account key>/*.sync.json` | `src/main/data/collectionSync.ts:52-76` | No. Never uploaded |
| Website data (per account) | Cookies, logins, localStorage/IndexedDB, cache, etc. for every site visited | Chromium partition `persist:web-<account key>` (under `userData/Partitions/`, **UNVERIFIED exact path**) | `src/main/browser/webSession.ts:11-27` | Cookies: Chromium cookie encryption fuse on (`forge.config.js:70`). Other site storage: **UNVERIFIED** |
| Website data (signed out) | Same, for guest browsing | In-memory partition `web-guest` | `webSession.ts:15-16` | Not persisted |
| Search-suggestion session | — | In-memory partition `suggestions` | `suggestions.ts:12-14` | Not persisted |
| Legacy shared web data | Old shared partition | `userData/Partitions/web` | `webSession.ts:250-261` | Deleted at startup |
| Legacy files | `user-mode.json`, `site-permissions.json` | userData | `localStore.ts:24,68`, `sitePermissions.ts:16,69` | Migrated, then deleted |
| Downloads | Files downloaded on the agent's tab | `userData/Browsie Downloads/<account key>/` (or `/guest`) | `webSession.ts:179-183,220-224`, `src/main/web/files.ts:39-57` | No. Only the agent's tab may download. Executable types are cancelled (`files.ts:9-14`). The account's folder is deleted by "Remove my data" and factory reset (`webSession.ts:227-229`); the `/guest` folder is never deleted |
| App-page localStorage | `browsie-setup-done = '1'` | Default (app) session | `src/renderer/onboarding-layer/setupGate.ts:4-25` | No |
| App-page sessionStorage | Launch flag | Default session | `src/renderer/browser-chrome-layer/BrowserChrome.tsx:37-50` | No, cleared with the window |
| Dev voice log | Transcripts etc. (§3) | `userData/logs/voice.log` | `src/main/voice/log.ts` | No. **Dev builds only** |
| In-memory only | Access token, session memory (20 turns), TTS cache (40 clips), favicon cache (200), certificate notes (500 hosts), usage-card cache (10s), per-task spend | Process memory | `session.ts`, `sessionStore.ts`, `speechApi.ts`, `favicons.ts:5-12`, `webSession.ts:88-101`, `openRouterUsage.ts:10`, `broker.ts:56` | Lost on quit |
| Chromium / Electron's own files | GPU cache, preferences, etc. | userData | Not written by app code | **UNVERIFIED** contents |

Temp files: every write above uses write-then-rename through a `.tmp` file next to the target (`vault.ts:36`, `aiKey.ts:85`, `localStore.ts:42`, `collections.ts:131`, `setupRecord.ts:32`, `collectionSync.ts:70`). The app writes no other temp files.

---

## 6. Logs and telemetry

| Item | Data | Destination | File path | Notes |
|---|---|---|---|---|
| Voice log | Transcripts, routing, errors | Local file + console | `src/main/voice/log.ts` | Dev builds only (`app.isPackaged` check, line 12) |
| OpenRouter usage debug | Raw `/credits` and `/keys/<hash>` responses (no usable key) | Console | `src/main/data/openRouterUsage.ts:73-77` | Dev builds only. Marked "TEMP" |
| Sync warnings | Error objects | Console (stdout) | `syncEngine.ts:122`, `collectionSync.ts:74` | Packaged builds too. Not written to a file by app code |
| Other `console.*` calls | 9 in `src/` (excluding tests) | Console | grep `console.(log|warn|error|info)` | Whether packaged-app stdout is captured anywhere is up to the OS: **UNVERIFIED** |
| Agent trace events | Snapshots, full model requests and responses, decisions | Only to an `onTrace` hook | `src/main/agent/traceEvents.ts:5-8`, `host.ts:49,129` | The app never passes `onTrace` (grep finds it only in `host.ts` and `traceEvents.ts`). Used by the eval harness |
| Analytics / crash reporting / usage tracking | — | — | §1b | **None found.** Nothing in the app's code sends telemetry off the device |
| Spend tracking | Per-task cost in USD (in memory); cost reported by OpenRouter | Memory | `broker.ts:44-53,116-117` | Used to enforce the $0.75-per-WEB-task cap (`config.ts:26`) |

---

## 7. Third-party dependencies that may send data on their own

Runtime dependencies (`package.json`): `@hugeicons/core-free-icons`, `@hugeicons/react`, `@tailwindcss/vite`, `bootstrap-icons`, `electron-squirrel-startup`, `react`, `react-dom`, `tailwindcss`, `zod`, `zustand`.

| Item | Behaviour | File path | Notes |
|---|---|---|---|
| Icons, React, Tailwind, zod, zustand | Bundled locally. No network code found in their use | `package.json` | The renderer's CSP blocks outside connections (`vite.renderer.config.mjs:16`) |
| `electron-squirrel-startup` | On Windows install/update/uninstall events, runs the local `Update.exe` to add or remove shortcuts. No network call | `node_modules/electron-squirrel-startup/index.js` | |
| Electron / Chromium | Any background requests Chromium makes on its own (e.g. **spellcheck dictionary downloads**, component updates) | — | **UNVERIFIED.** The app sets no `spellcheck` option and no dictionary URL (grep `spellcheck` in `src/main`: none), so Electron's defaults apply |
| OpenRouter → model providers | OpenRouter passes requests on to the model provider | `src/main/agent/config.ts:27-31` | The app asks for no-data-collection, ZDR-only routing on every request. OpenRouter's public ZDR endpoint list (`openrouter.ai/api/v1/endpoints/zdr`, checked 2026-11-24, not code) offered the app's Claude models only via **Amazon Bedrock** and **Google**, and the ElevenLabs models via **ElevenLabs**, so those are where requests would go. This can change on OpenRouter's side. The providers' actual retention practices are **UNVERIFIED** |

---

## 8. Agent actions on web pages

### 8a. What the agent can do without asking

| Item | Allowed without a yes | File path | Notes |
|---|---|---|---|
| WEB: click | Yes, unless the click is classed as "transact" (8b) | `src/shared/web/actions.ts:136-148`, `src/main/web/policy.ts:215-241` | |
| WEB: type | Yes, but **only text found inside something the user said or confirmed** (provenance check) | `policy.ts:286-298,326-332` | Text taken from a page can never pass. Note: the task goal counts as something the user said (it is source `u1`, `host.ts:537`), and for multi-step requests or handoffs that goal is written by the model |
| WEB: type into password / one-time-code fields | **Never.** Refused outright; the agent must hand over to the user (`request_help`) | `policy.ts:302-303,327-329` | |
| WEB: press keys, select options, scroll, wait, back | Yes (Enter on a transact form counts as transact) | `policy.ts:231-238`, `actions.ts:136-148` | |
| WEB: goto URL | Only to (a) an address this task's tab already showed, ignoring the `#fragment`, or (b) a host whose every label the user named, where every word of the path, query and fragment is something the user said or confirmed. Also blocked: non-http(s) schemes, URLs with a username/password, localhost and private-network hosts | `policy.ts:92-158,320-324`, `host.ts:207,214-224,261` | "What the user said" is the turn's transcript, confirmed facts and the user's answers, never a model-written goal, page text or Google data. Pages a site redirected to by itself also count as "already showed". Words of one character in the path/query and common filler (`www`, `com`, `html`, `index`, etc., `policy.ts:110`) are ignored |
| WEB: download | Yes, on the agent's tab only, into the Browsie Downloads folder. Executables are cancelled | `webSession.ts:179-183,213-218`, `files.ts` | |
| WEB: upload a file | Only a file the user names out loud, from the Browsie Downloads folder | `src/agent/web/loop.ts:144-157`, `host.ts:396-405`, `files.ts:60-77` | Code comment marks this feature "WIP NOT DONE" (`loop.ts:144`) |
| UI lane: tabs, navigation, zoom, bookmarks add/remove/open, history search | Yes, no confirmation. Includes closing tabs and removing bookmarks | `src/agent/ui/lane.ts:30-36`, `src/main/agent/chromeOperations.ts` | The agent can no longer change the bookmarks bar setting (8c) |
| INFO: Gmail search/read, Calendar list, Drive search/read | Yes (risk `read`) | `src/shared/google/tools.ts:25-33,79,122-134` | |
| INFO: Gmail **draft**, Gmail **modify** (read/unread, archive, star), Calendar **create without attendees**, Calendar **update when no one else is invited**, Drive **create doc**, **append to doc**, **rename** | **Yes, without confirmation** (risk `write`) | `src/shared/google/tools.ts:8,51-63,86-111,139-152`, `src/main/google/tools.ts:52-58` | |

### 8b. Confirmation steps and guardrails

| Item | Rule | File path | Notes |
|---|---|---|---|
| "Transact" web actions need a yes | Clicking a button, link or menu item whose name contains send, pay, buy, order, delete, post, confirm, place, purchase, publish, transfer, donate or subscribe; clicking a form's submit button (search forms are exempt); any button in a form that has a password, card or OTP field; Enter in such a form | `policy.ts:161-241,341-353` | Decided by code from the page structure, not by the model (`policy.ts:214`) |
| Confirmation content | Read aloud from the **real form state**: site origin, button, field values. Passwords, OTP and CVC are left out; card numbers are read as "ending in ####" | `policy.ts:245-280`, `src/main/voice/conductor.ts:86-96` | Ends with "Shall I go ahead? Say yes or no." Field values come from the snapshot, which already masks card-number-like digits (§2) |
| Deciding yes or no | Deterministic parser, no AI model. Any "no", "don't" or "not" anywhere counts as no. Unclear answers are asked again | `src/shared/agent/controlRules.ts:44-52`, `conductor.ts:280-290` | |
| Who can grant | Only main grants. The agent process cannot say yes | `host.ts:640-649` | |
| Grant scope | One action on one element in one snapshot, used once | `policy.ts:343`, `host.ts:267,363` | |
| Google actions needing a yes | `gmail_send`, `gmail_trash`, `calendar_delete`, `drive_trash`, `calendar_create` **with attendees**, and `calendar_update` **when the real event has other people invited** (read from Google before deciding) | `src/shared/google/tools.ts:38,71,114,157`, `src/main/google/tools.ts:52-58`, `host.ts:355` | The summary read aloud is built from Google's own data (`google/tools.ts:61-134`). For an update it names the event, its time, the number of other people invited, and each field being changed (`google/tools.ts:99-115`) |
| WEB goto provenance | See the goto row in 8a | `policy.ts:92-158` | Enforced in main. The agent's own early check runs without this context and skips it (`policy.ts:30,322`); main's answer is final |
| Limits per WEB task | 40 steps, 5 minutes, $0.75 spend; repeated no-effect actions → replan → ask the user | `policy.ts:392-413`, `config.ts:26` | |
| Finish evidence | The "done" claim must quote text actually on the page | `policy.ts:382-388` | |
| Prompt-injection handling | Page and Google content are wrapped as untrusted; the prompts tell the model to treat it as information, not instructions | `src/agent/web/prompt.ts:15`, `src/agent/info/lane.ts:52-55` | A prompt instruction, not enforcement. The enforcement is the policy rows above |
| UI lane navigation check | The agent may only open a host the user mentioned, or one it saw in this task's tab, bookmark or history lists. Searches are always allowed | `src/shared/chrome/policy.ts:27-37`, `host.ts:297-310` | |
| Restricted requests | Settings, lockdown, accounts, AI keys, site permissions, clearing data and signing out are labelled RESTRICTED, and the agent refuses them | `src/agent/prompts/classifier.md:12`, `src/agent/turn.ts:37-40,92-95` | Classification is done by the model (Haiku). It is backed in code by 8c: the agent has no tool for any of these |
| Content safety | Prompt rules against explicit content and harmful requests | `src/agent/prompts/safety.md` | Prompt-level only |
| SafeSearch | On by default. Search engine URLs are rewritten; YouTube gets the restrict header | `webSession.ts:29-36,185-205`, `shared/web/safeSearch.ts` | The user can turn it off in Settings |
| Stop | Space stops a running task | `conductor.ts:7-16` | |
| Lockdown | While on, a person cannot click or type on pages; the agent still can | `src/main/browser/tabs.ts:97-99,119` | |

### 8c. What the agent cannot change

Checked against every path from the agent process into main.

| Item | Finding | File path | Notes |
|---|---|---|---|
| Agent RPC surface | The agent process can call only `llm.complete`, `web.observe`, `web.act`, `web.finish`, `files.list`, `files.choose`, `chrome.execute`, `google.context`, `google.call`, `turn.run_task` | `src/main/agent/host.ts:382-413` | It has no Electron and no IPC to the renderer. None of these methods touches settings, lockdown, keys, site permissions, sign-out or data clearing |
| Browsie settings | **No agent command changes them.** The former `bookmarksBar.set` UI command (which wrote `settings.bookmarksBar`) has been removed from the schema, main's chrome API and the UI lane tool | `src/shared/chrome/actions.ts:43-65`, `src/main/agent/chromeApi.ts`, `src/agent/ui/lane.ts:30-36` | Test: `src/shared/chrome/actions.test.ts` ("has no command that changes Browsie settings") |
| Browsie's own pages (Settings, History, Bookmarks) | The WEB lane can't act on them: a tab showing a Browsie page can't be leased, and its contents aren't handed to the agent | `src/main/browser/tabs.ts:1947-1981` | So the agent can't click Factory reset, Clear history or site-permission controls. The UI lane's `page.open` accepts only `history` and `bookmarks` (`actions.ts:34`) |
| Website tabs | No preload, so no web page (or the agent acting on it) can reach `window.browsie` | `src/main/browser/tabs.ts:1023` | IPC also refuses any sender that isn't an app page (`src/main/ipc.ts:43-49`) |
| Lockdown, site permissions | Changed only through IPC from the browser window's own chrome | `src/main/ipc.ts:163-170` | |
| Browsie's Drive sync files | The INFO lane's Drive tools never pass `spaces=appDataFolder`, so they search and read only the user's normal Drive | `src/main/google/drive.ts` | |
| Not settings, still without confirmation | Closing tabs, removing a bookmark, zooming | `src/main/agent/chromeOperations.ts` | |
| Third-party sites | The WEB lane can operate account pages on other sites (e.g. openrouter.ai key settings, Google account permissions) like any website | — | Only the transact confirmation (8b) and goto provenance guard these |

---

## 9. Data deletion

| Action | What is deleted | What is **not** deleted | File path |
|---|---|---|---|
| **Sign out** (plain) | `session.bin` vault; the access token in memory; local `settings` reset to `{}` (userMode kept); **session memory** in main and the agent process (the agent process is restarted) | OpenRouter key file and the Browsie key on OpenRouter; bookmarks/history files; website partition (cookies, logins); downloads; Drive copy; Google access **not revoked** | `src/main/ipc.ts:217-250`, `session.ts:325-339`, `syncEngine.ts:153-168`, `localStore.ts:188-192`, `src/main/agent/index.ts:61-67` |
| **Sign out + "Remove my data from this device"** | All of the above, plus: one last upload attempt to Drive (up to 8s); the account's website partition storage and cache; `library/<account key>/` (bookmarks, history, sync state); the account's **Browsie Downloads folder**; OpenRouter key file; the Browsie key on OpenRouter (best effort); **Google refresh token revoked** with Google | Drive copy (kept on purpose, as the UI text says); the user's own OpenRouter management key on OpenRouter (comment: "theirs to revoke"); the `Browsie Downloads/guest` folder | `ipc.ts:222-242`, `syncEngine.ts:172-187`, `webSession.ts:227-229,247-253`, `libraryPaths.ts:13-17`, `aiKey.ts:150-161`, `SignOutDialog.tsx:84-110` |
| **Factory reset** (Settings) | Everything "Remove my data" deletes, plus the setup record entry; browser window closed. Main treats factory reset as also removing device data, whatever the renderer passes | Same as "Remove my data" (Drive copy, the management key on OpenRouter, the guest downloads folder) | `src/renderer/components/SettingsContent.tsx:91`, `ipc.ts:219-221` |
| Revoking Google access (side effects) | Every permission the account gave Browsie | — | `session.ts:322-324`. The account is also signed out of Browsie on other devices, and Gmail, Calendar and Drive must be connected again. The sign-out dialog says so (`SignOutDialog.tsx:103-108`) |
| Remove one history visit | Marked as a tombstone; the deletion syncs to other devices and Drive | — | `history.ts:209-219`, `collections.ts:13-14,33` |
| Clear history | All visits; `clearedBefore` syncs, so every device and the Drive copy drop older visits on the next sync | — | `history.ts:221-230`, `collections.ts:64-70` |
| Remove a bookmark | Tombstone, synced | — | `bookmarks.ts:237-243`, `ipc.ts:153` |
| Clear session memory | Sidebar button clears the session turns in main and in the agent process | — | `SessionSidebar.tsx:121`, `ipc.ts:132`, `host.ts:586-589`, `src/agent/worker.ts:134` |
| Account change (automatic) | Session memory in main and in the agent process. Fires on sign-out, factory reset, or a different account signing in; not when the same account only gains permissions or finishes setup | — | `src/main/agent/index.ts:61-67`, `src/main/agent/accountScope.ts`. Running turns and tasks are stopped and the agent process is restarted, so a turn in progress can't write itself back |
| Quit the app | All in-memory data (access token, session memory, caches) | Files on disk | `src/main/agent/index.ts:70` |
| Clear one site's data | Cookies and storage for the active site's origin | — | `src/main/browser/siteInfo.ts:66-79` |
| Automatic expiry | History older than 90 days or beyond 20,000 visits; tombstones after 30 days | — | `history.ts:26-27`, `collections.ts:33` |
| Google expired or revoked | On `invalid_grant`, the vault is cleared and the user is signed out | Same as plain sign-out | `session.ts:257-263` |
| Drive appData deletion | **No in-app code deletes Browsie's files in Drive.** A code comment refers to the user deleting the hidden data in Drive settings | — | `syncEngine.ts:66` |

---

## Open questions

These can't be settled from the code:

1. **Model-provider retention.** The app now asks OpenRouter for no-data-collection, ZDR-only routing (§2). What OpenRouter itself logs, and what Amazon Bedrock, Google and ElevenLabs actually keep, are their policies, not code. Account-level OpenRouter privacy settings belong to the user and can't be seen from code.
2. **Exact userData path** on each OS, and therefore the exact on-disk locations in §5. The code never sets it.
3. **Chromium at-rest encryption** for non-cookie website storage (localStorage, IndexedDB, cache) in the per-account partitions.
4. **Electron/Chromium background requests**, such as spellcheck dictionary downloads, since `spellcheck` is left at Electron's default.
5. **Packaged-app console output.** Whether stdout/stderr from `console.warn` (e.g. sync errors) ends up in an OS log.
6. **Guest downloads.** `Browsie Downloads/guest` (downloads made while nobody was signed in) is never deleted by any in-app action.
7. **Drive appData deletion.** No in-app action deletes Browsie's files in the user's Drive, including factory reset. Revoking Google access does not by itself delete them; how and when Google removes hidden app data after access is revoked is **UNVERIFIED**.
8. **Typed-text provenance and model-written goals.** Typing into pages is checked against the task goal (`u1`), which the model writes for multi-step requests and handoffs. Only goto uses the turn's real transcript.
9. **Prompt caching on ZDR endpoints.** Whether `cache_control` works the same on the Bedrock and Google endpoints, and how long any cache lives there.
10. **Screenshots.** Card-number masking (§2) applies to the text snapshot only. A screenshot sent to the model shows whatever is visible on screen.
11. **Google OAuth verification status.** The code comment says the restricted Gmail scope needs verification before public release (`googleOAuth.ts:12`). Verification status and the Google API Services User Data Policy disclosures are outside the code.
12. **Uncommitted files.** This audit includes the uncommitted `microphone.ts` / `MicSetup.tsx` changes. If they are not shipped, the OS mic-permission rows in §1a and §3 change.
13. **Accuracy of the session-memory comment.** `sessionStore.ts` says it holds "never raw page text", but replies come from model summaries of page, email or file content. How much personal content those summaries contain varies and can't be bounded from code.
14. **Untested in a running app.** The deletion paths in §9 (factory reset, "Remove my data", revocation) and the session-memory clearing on account change have no automated tests that run Electron. They should be checked by hand before the policy describes them as fact.

Resolved by the `privacy-security-fixes` branch (open when this inventory was first written at `dc7dae6`): session memory surviving sign-out; factory reset leaving local data; downloads never being deleted; calendar updates emailing attendees without confirmation (and `calendar_update` already sent `sendUpdates=all`, so the earlier wording that it relied on API defaults was wrong); WEB `goto` opening any public URL; no provider-routing preference being sent.
