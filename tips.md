# Architecture Tips for Browsie

## Build Order

1. Embed a `<webview>` tag so you can load real pages
2. Build an address bar that navigates
3. Write a content script that extracts meaningful DOM (text, roles, labels)
4. Send that to an AI API and get back actions
5. Execute those actions back in the webview

## Thread Separation (Electron already gives you this for free)

- **Renderer process** (`renderer.jsx`) — React UI, keep this light
- **Main process** (`main.js`) — Node.js, safe for heavy work without touching the UI
- **`<webview>` process** — runs in its own sandboxed process automatically

You get natural isolation before ever needing worker threads.

## Architecture Flow

```
Renderer (React UI)
    ↕ IPC
Main Process
    ↕ IPC
Webview / BrowserView  ← user's page loads here
    ↕ executeJavaScript / preload
DOM scraper             ← reads the page, sends to AI
    ↕ HTTP
AI API (Claude, OpenAI, etc.)
    ↕
Action executor         ← clicks, types, scrolls back in webview
```

## Use the Accessibility Tree, Not Raw HTML

For a visually impaired use case, scraping raw HTML is the wrong approach.
Use the **accessibility tree** instead — it is already structured, labeled, and
far cleaner than thousands of raw DOM nodes.

Options:
- Chrome DevTools Protocol: `Accessibility.getFullAXTree`
- Electron's `webContents.mainFrame` accessibility APIs
- `getComputedAccessibleNode` in the webview's content script

The a11y tree gives you roles (`button`, `link`, `textbox`), labels, and states
(`focused`, `disabled`) — exactly what an AI agent needs to reason about a page.
