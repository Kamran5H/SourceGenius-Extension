# Source Genius — Chrome Extension (v7.1.30)

> **Owner:** Kamran Ashraf. This is the packaged **Source Genius** Chrome extension (Manifest V3) — the Brand Website Finder for Amazon sellers. Folder is named `Api` for historical reasons; the product is *Source Genius*.

## What it does

Takes Amazon ASINs / product URLs, scrapes the product pages to extract **brand names**, then finds each brand's **official website** through a multi-tier search pipeline (DNS probing → DuckDuckGo → Yahoo → Brave → SearXNG → Bing). Runs as a background service worker with a side-panel UI. Features: multi-user auth, shared team dedup DB, live activity log, CSV export.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — permissions, service worker, side panel registration |
| `background.js` | Core logic: Amazon scraping, the search pipeline, state, logging |
| `sidepanel.html` / `sidepanel.js` | Side-panel UI, polling, log rendering, auth |
| `stealth.js` | Content script — anti-bot fingerprint spoofing |
| `watchdog.js` | Keeps the MV3 service worker alive / restarts on death |
| `user-livewrite.gs` | Google Apps Script backend (team DB / live shared writes) |
| `icons/` | Extension icons |

## How to load it

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
4. Open the side panel from the toolbar icon.

> Backend keys/endpoints and the Apps Script deployment URL are configured separately and are **not** stored in this repo.
