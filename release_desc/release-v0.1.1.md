# Browsie v0.1.1

The first tagged release of Browsie, a voice-controlled AI browser for blind and low-vision users. A sighted caretaker sets it up, and then the person using it controls everything by voice.

> **Note:** Browsie is still in development. This release has no installer, so it runs from source (`npm install` → `npm start`) on Windows and macOS. See the [Setup Guide](https://browsie.org/setup-guide).

## What's included

### Voice agent
- **Push-to-talk:** hold Space, speak, and let go. A speech pill shows when Browsie is listening.
- **Interrupt at any time:** tap Space, or say "stop" or "cancel". Holding Space while Browsie is speaking cuts it off.
- **Voice commands:** "repeat", "louder", "quieter", "slower" and "faster".
- **Speech:** ElevenLabs Scribe v2 handles transcription and Eleven v4 Turbo handles the voice. Stock lines use prerecorded clips.
- **Routing:** a fast classifier sends each request to the right lane: chat, help, browser control, the open page, or the Google account. A request that needs more than one lane is split into ordered tasks.
- **Model fallback:** Haiku 5.5 classifies, Sonnet 5.5 handles conversation and the lanes, and Opus 5.5 takes over after two failed steps.
- **Session sidebar** listing past agent sessions.

### Browsing by voice
- Open, close and switch tabs, go to a site or search, go back, zoom, and save or open bookmarks.
- Read the current page aloud, click things, and fill in forms with details the user says. This works from an accessibility snapshot of the page.
- Highlights on screen show what the agent is working on.

### Google Workspace
- **Gmail:** search, read, draft, send, mark read or unread, archive, star, and trash.
- **Calendar:** list, create, update, and delete events.
- **Drive:** search files, read Docs, Sheets and Slides, create and append to Docs, rename, and trash.
- Each service is connected separately from Settings → Integrations.

### Safety
- **Confirmation first:** before paying, sending mail, posting, or deleting, Browsie reads out the details and waits for a "yes".
- **No secrets:** Browsie never types passwords or verification codes.
- **Lockdown mode (on by default):** the mouse and keyboard do nothing on web pages, but voice still works.
- **Policy checks:** the main process keeps its own record of what the user said and checks every page action against navigation rules, confirmations, and a spending cap for each task.
- **Isolated agent:** the agent runs in a separate process with no API keys and no Electron access.
- **SafeSearch on by default** for Google, Bing, and DuckDuckGo.
- **Safe downloads:** files go to one folder per account, and executable files are blocked. Uploads can only come from that same folder.
- **Site permissions:** camera, microphone, location, and notifications are blocked unless allowed for a site.

### Browser
- Tabs, a toolbar with address suggestions, a bookmarks bar, and History, Bookmarks and New Tab pages.
- A site info panel showing the security certificate and permissions.
- A Google apps menu, a profile menu, and a utility menu.

### Setup and accounts
- Guided caretaker onboarding: Google sign-in, appearance, OpenRouter key, Google permissions, and a final confirmation.
- Google OAuth with PKCE, sandboxed so websites can't reach it.
- Settings, bookmarks, history, and site permissions back up to Google Drive and follow the account to other computers.
- A single OpenRouter key covers the AI models and speech, with usage tracking in Settings → Billing.
- Appearance themes: Light, Dark, High Contrast, and System.
- Factory reset and sign-out.

### Known limitations
- No packaged installer yet.
- Full WCAG compliance is still in progress.
