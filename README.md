# Browsie: The assistive AI browser for visually impaired users.

Browsie is an agentic browser that navigates the web for those who cannot see.

[Official Website](https://browsie.org) · [Setup Guide](https://browsie.org/setup-guide)

## Project Overview
Browsie is a new paradigm in how those with low-vision navigate a digital environment. While traditional screen-readers are highly practical, they have a high learning curve and are not suitable for all types of users. Browsie solves this with it's primary interface: Browsie Agent. This agent verbally speaks to the user conversationally, powered by frontier ElevenLabs TTS to provide a natural experience. The agent navigates the browser and webpages for the user.

Browsie follows a bifurcated user model, meaning it is designed to be set up and monitored by a sighted caretaker before being handed off to the assisted individual (visually impaired). 

Browsie syncs with your Google Account (Oauth), syncs data in Drive, and connects to your calendar and Gmail via MCP.

Currently in progress: Full WCAG compliance to meet accessibility guidelines.

## Installation
Browsie is currently under development, so there is no packaged app available.

1. **Install dependencies**:

   ```bash
   # Use this to install all dependencies in node_modules
   npm install
   ```

2. **Google environment variables**:

   Sign-in needs an OAuth client that is not in the repo. Create one in [Google Cloud Console](https://console.cloud.google.com/):

   1. Create a project.
   2. Open **APIs & Services**, then **OAuth consent screen**. Choose **External**, fill in the app name and your email, and add your Google account under **Test users**. While the app is in testing, only those accounts can sign in.
   3. Open **APIs & Services**, and then **Library** and enable the Gmail API, Google Calendar API, and Google Drive API.
   4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**. Set the type to **Desktop app**. No redirect URI is required.
   5. Create a `.env` file and paste the client ID and secret like so:

   ```bash
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   `.env` stays on your machine. The OpenRouter key is entered later, inside the app.

2. **Run**:
   ```bash
   npm start
   # restart after major changes to node processes.
   ```

## How to Use

A sighted person finishes setup first: Google sign-in, the OpenRouter key, and permissions for Gmail, Calendar, and Drive. After that, the person using Browsie talks to it.

- Hold Space, say what you want, then let go. A pill at the bottom of the screen shows that Browsie is listening.
- Press Space once while it is working to stop it. "Stop" and "cancel" do the same. Holding Space while it is speaking cuts it off so you can talk.
- "Repeat" says the last reply again. "Louder", "quieter", "slower", and "faster" change the voice.
- Ask it to open, close, and switch tabs, go to a site or search, go back, zoom, and save or open bookmarks. Ask it to read a page, click, or fill a form with details you say.
- Mail, calendar, and files run against the signed-in Google account. The first time, Google asks for permission once.
- Before anything that cannot be undone, such as paying, sending mail, posting, or deleting, Browsie reads the details and waits for a yes. It never types passwords or verification codes.
- Lockdown is on by default, so the mouse and keyboard do nothing on web pages. Voice still works. A sighted person changes that in Settings.

## Architecture

Browsie is an Electron app written in TypeScript. Electron Forge and Vite bundle the main process, the agent utility process, and the preload script. The window is React, styled with Tailwind, and client state lives in Zustand. Zod checks every message the agent sends to main.

The React window is the browser chrome. Each website loads in its own tab view. The main process owns the window, the tabs, Google sign-in, and the voice loop. The agent runs in a separate utility process with no API keys and no Electron APIs. It talks to main over a message port, and main checks every request again before it runs.

One thing the user says is a turn:

1. Speech in main transcribes the recording and starts the turn.
2. A fast model classifies it as chat, help, browser control (UI), the open page (WEB), or the Google account (INFO). Anything uncertain is asked again.
3. A request that needs more than one of those is split into a short list of tasks, in order.
4. The UI lane runs browser commands. The WEB lane reads an accessibility snapshot of the page and sends clicks and typing back through main. The INFO lane calls Gmail, Calendar, and Drive.
5. A verbal reply is spoken aloud. Stock lines use prerecorded clips.

Main keeps its own copy of what the user said and runs policy on every page action. A confused or injected agent still cannot pass a navigation check, a spend cap, or a confirmation.

### Models

Models and speech both go through one OpenRouter key. The ids live in `src/main/agent/config.ts`.

| Role | Model |
| --- | --- |
| Classification, and questions about how to use Browsie | Claude Haiku 5.5 |
| Conversation, planning, and the UI, WEB, and INFO lanes | Claude Sonnet 5.5 |
| A UI, WEB, or INFO lane after two failed steps | Claude Opus 5.5 |
| Transcription | ElevenLabs Scribe v2 |
| Speech | ElevenLabs Eleven v4 Turbo |

<br>

### Rebrand Note

This was Theo.ai, a desktop accessibility agent prototype that **won 1st at TSA SLC and 4th for NLC** in Software Development.
[Theo.ai Repository](https://github.com/Pattuv/theo-v1)

The rebrand was done in order to prevent conflict with a venture-backed AI litigation company named Theo.ai.

Browsie is the market-ready, research backed,  and full-fledged reality of the same vision as Theo: a new paradigm for visually imparied users to navigate the digital world.


<br>

**Copyright © 2026 browsie.org**


## License

GPL-3.0. See [LICENSE](LICENSE).