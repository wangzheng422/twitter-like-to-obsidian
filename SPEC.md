# Twitter Likes to Obsidian — Chrome Extension Spec

## Overview

A Chrome Extension (Manifest V3) that automatically captures liked tweets as the user scrolls their Twitter/X likes page and saves them as markdown notes into an Obsidian vault via the Obsidian Local REST API.

**No companion server required.** The extension communicates directly with Obsidian's Local REST API plugin.

---

## Architecture

```
Twitter DOM (x.com/*/likes)
    │
    ▼
Content Script (MutationObserver)
    │  extracts tweet data as user scrolls
    ▼
Background Service Worker
    │  deduplicates, generates markdown, downloads images
    ▼
Obsidian Local REST API (http://127.0.0.1:27123)
    │  saves .md files and image assets
    ▼
Obsidian Vault (/Volumes/obsidian/wzh-twitter/)
```

### Components

1. **Content Script** — injected on `x.com/*/likes` and `twitter.com/*/likes`
   - Uses `MutationObserver` on the tweet feed container to detect new tweet elements loaded during infinite scroll
   - Extracts structured data from each tweet DOM element
   - Sends extracted data to the background service worker via `chrome.runtime.sendMessage`
   - Maintains an in-session `Set<string>` of processed tweet IDs to avoid re-processing during scrolling

2. **Background Service Worker** — handles all logic beyond extraction
   - Receives tweet data from content script
   - Checks Obsidian REST API for existing notes (deduplication)
   - Generates Obsidian-flavored markdown with YAML frontmatter
   - Downloads images and sends them as binary to the REST API
   - Handles Twitter Articles: fetches article content, saves as separate linked note
   - Queues failed saves for retry

3. **Extension Popup** — minimal settings UI
   - Input field for Obsidian REST API key
   - Status indicator (connected / disconnected)
   - Count of tweets saved in current session
   - Count of queued tweets pending retry
   - Button to manually retry queued tweets

---

## Content Script: Tweet Extraction

### Activation

- URL match patterns: `*://x.com/*/likes*` and `*://twitter.com/*/likes*`
- The content script should only activate on the likes page

### DOM Observation

- Attach a `MutationObserver` to the main tweet feed container (the scrollable timeline)
- On each mutation, scan for new tweet elements (identified by `[data-testid="tweet"]` or equivalent selector)
- Each tweet element is processed exactly once per session (tracked by tweet ID in a `Set`)

### Data Extraction

For each tweet element, extract:

| Field | How to Extract | Notes |
|-------|---------------|-------|
| `tweet_id` | From the tweet permalink `<a>` element's `href` (e.g., `/user/status/123`) | Primary key for dedup |
| `author_handle` | From the username link in the tweet header | Without `@` prefix in raw data, add `@` in display |
| `author_name` | From the display name element in the tweet header | |
| `timestamp` | From the `<time>` element's `datetime` attribute | ISO 8601 format |
| `text` | From the tweet text container `[data-testid="tweetText"]` | Preserve line breaks, expand t.co links if visible |
| `images` | From `<img>` elements inside the media container | Collect `src` URLs, use highest resolution (`?format=jpg&name=large`) |
| `video_thumbnail` | From video player poster image | Just the thumbnail URL |
| `video_url` | Constructed as the tweet URL itself | Users can click through to watch |
| `quote_tweet` | From the nested quoted tweet element | Recursively extract: author, text, media, URL |
| `reply_to` | From the "Replying to" header above the tweet | Author handle + link to original tweet |
| `article_url` | From article card link elements | URL pattern: `x.com/i/article/*` or similar |
| `tweet_url` | Constructed from `author_handle` and `tweet_id` | `https://x.com/{handle}/status/{tweet_id}` |

### Edge Cases

- **Tweets with only images/video and no text:** `text` field is empty string, still save the note
- **Deleted or unavailable quoted tweets:** Show "Quoted tweet unavailable" in the quote section
- **Multiple images:** Extract all (Twitter supports up to 4 images per tweet)
- **t.co shortened links in text:** Extract the visible expanded URL text if available in the DOM

---

## Markdown Output Format

### Tweet Note

**File path:** `wzh-twitter/{tweet_id}.md`

```markdown
---
tweet_id: "1912345678901234567"
author: "@elonmusk"
author_name: "Elon Musk"
date: 2026-04-19T14:30:00Z
url: https://x.com/elonmusk/status/1912345678901234567
type: tweet
tags:
  - twitter-like
---

# @elonmusk — Elon Musk

This is the tweet text content, preserving
line breaks as they appear.

## Media

![[wzh-twitter/assets/1912345678901234567_1.jpg]]
![[wzh-twitter/assets/1912345678901234567_2.jpg]]

## Video

[Video](https://x.com/elonmusk/status/1912345678901234567)
![Video Thumbnail](wzh-twitter/assets/1912345678901234567_video.jpg)

## Quote Tweet

> **@other_user** — Other User
>
> This is the quoted tweet text
>
> ![[wzh-twitter/assets/1912345678901234567_qt_1.jpg]]

## In Reply To

Reply to [@someone](https://x.com/someone/status/9876543210)
```

**Rules:**
- Sections (Media, Video, Quote Tweet, In Reply To) are **only included when that data is present**
- A text-only tweet is just frontmatter + heading + text
- Image filenames use the pattern `{tweet_id}_{index}.{ext}`
- Quote tweet images use `{tweet_id}_qt_{index}.{ext}`

### Article Note

**File path:** `wzh-twitter/articles/{article_id}.md`

```markdown
---
article_id: "123456"
author: "@writer"
author_name: "Writer Name"
date: 2026-04-18
url: https://x.com/i/article/123456
type: twitter-article
tags:
  - twitter-article
---

# Article Title

Full article content converted to markdown...
```

**Linking from tweet note:** When a tweet contains an article link, append to the tweet note:

```markdown
## Article

[[wzh-twitter/articles/{article_id}]]
```

### Assets

**File path:** `wzh-twitter/assets/{filename}`

All images (tweet images, video thumbnails, quote tweet images) are downloaded and saved as binary files via the REST API.

---

## Obsidian Local REST API Integration

**Base URL:** `http://127.0.0.1:27123`

**Authentication:** `Authorization: Bearer {api_key}` header on every request.

### API Calls

| Action | Method | Endpoint | Content-Type |
|--------|--------|----------|-------------|
| Check if note exists | `GET` | `/vault/wzh-twitter/{tweet_id}.md` | — |
| Create/update tweet note | `PUT` | `/vault/wzh-twitter/{tweet_id}.md` | `text/markdown` |
| Create/update article note | `PUT` | `/vault/wzh-twitter/articles/{article_id}.md` | `text/markdown` |
| Save image asset | `PUT` | `/vault/wzh-twitter/assets/{filename}` | `application/octet-stream` (binary) |
| Check API health | `GET` | `/` | — |

### Request Examples

**Check if note exists:**
```
GET http://127.0.0.1:27123/vault/wzh-twitter/1912345678901234567.md
Authorization: Bearer {api_key}
```
- `200` → note exists, skip (dedup)
- `404` → note does not exist, proceed to save

**Save a tweet note:**
```
PUT http://127.0.0.1:27123/vault/wzh-twitter/1912345678901234567.md
Authorization: Bearer {api_key}
Content-Type: text/markdown

{markdown content}
```

**Save an image:**
```
PUT http://127.0.0.1:27123/vault/wzh-twitter/assets/1912345678901234567_1.jpg
Authorization: Bearer {api_key}
Content-Type: application/octet-stream

{binary image data}
```

---

## Deduplication

### Two-Layer Strategy

1. **In-session (content script):** A `Set<string>` of tweet IDs processed during the current browsing session. Prevents re-extracting the same tweet if the user scrolls up and down. Cleared when the tab is closed/refreshed.

2. **Cross-session (background worker):** Before saving any tweet, the background worker calls `GET /vault/wzh-twitter/{tweet_id}.md` on the Obsidian REST API.
   - `200` response → tweet already saved, skip entirely (don't re-download images either)
   - `404` response → tweet is new, proceed to save

### Dedup Flow

```
Tweet extracted by content script
    │
    ├─ In session Set? → YES → skip
    │
    ├─ NO → send to background worker
    │
    ▼
Background worker: GET /vault/wzh-twitter/{tweet_id}.md
    │
    ├─ 200 → already exists → skip
    │
    ├─ 404 → new tweet → save note + images
    │
    └─ Error → queue for retry
```

---

## Error Handling & Retry

### Connection Failures

- If the Obsidian REST API is unreachable (connection refused, timeout):
  - Show a red badge on the extension icon
  - Queue the tweet data in `chrome.storage.local`
  - Periodically check API availability (every 30 seconds)
  - When API comes back, process the queue in order

### Queue Structure

```json
{
  "pendingTweets": [
    {
      "tweet_id": "123...",
      "data": { /* full extracted tweet data */ },
      "queued_at": "2026-04-19T14:30:00Z",
      "retry_count": 0
    }
  ]
}
```

### Badge Indicators

| Badge | Meaning |
|-------|---------|
| No badge | Normal operation, connected |
| Red dot | API unreachable |
| Number (e.g., "3") | Number of tweets queued for retry |
| Green check (briefly) | Tweet successfully saved |

---

## Extension Popup UI

A minimal popup accessible by clicking the extension icon.

### Elements

1. **API Key input** — password field with save button, stored in `chrome.storage.sync`
2. **Connection status** — green "Connected" or red "Disconnected" indicator
3. **Session stats** — "Saved: 12 tweets this session"
4. **Queue status** — "3 tweets pending retry" with a "Retry Now" button
5. **Settings link** — opens options page if needed in the future

---

## Chrome Extension Manifest (V3)

```json
{
  "manifest_version": 3,
  "name": "Twitter Likes to Obsidian",
  "version": "1.0.0",
  "description": "Automatically save liked tweets to Obsidian as you scroll",
  "permissions": [
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "https://x.com/*",
    "https://twitter.com/*",
    "http://127.0.0.1:27123/*",
    "https://pbs.twimg.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://x.com/*/likes",
        "https://twitter.com/*/likes"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## File Structure

```
twitter-likes-obsidian/
├── manifest.json
├── background.js          # Service worker: dedup, markdown gen, API calls
├── content.js             # Content script: DOM observation, tweet extraction
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── popup.css              # Popup styles
├── lib/
│   ├── extractor.js       # Tweet data extraction from DOM elements
│   ├── markdown.js        # Markdown generation with frontmatter
│   ├── obsidian-api.js    # Obsidian REST API client
│   ├── dedup.js           # Deduplication logic
│   ├── queue.js           # Retry queue management
│   └── article.js         # Twitter article fetching and parsing
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Obsidian Vault Structure (Output)

```
/Volumes/obsidian/
└── wzh-twitter/
    ├── 1912345678901234567.md    # Tweet notes (named by tweet ID)
    ├── 1912345678901234568.md
    ├── ...
    ├── articles/
    │   ├── 123456.md             # Twitter article notes
    │   └── ...
    └── assets/
        ├── 1912345678901234567_1.jpg    # Tweet images
        ├── 1912345678901234567_2.jpg
        ├── 1912345678901234567_video.jpg # Video thumbnails
        └── ...
```

---

## Twitter Article Handling

### Detection

- Content script detects article cards in tweets by looking for links matching patterns like `x.com/i/article/*` or article card DOM elements
- The article URL is included in the extracted tweet data

### Fetching

- Background worker fetches the article page
- Extracts the article title and body content
- Converts HTML content to markdown

### Saving

1. Save article note to `wzh-twitter/articles/{article_id}.md`
2. In the tweet note, add an `## Article` section with an Obsidian wiki-link: `[[wzh-twitter/articles/{article_id}]]`

### Deduplication

- Articles are deduped the same way as tweets: `GET /vault/wzh-twitter/articles/{article_id}.md` before saving
- If the article already exists (saved from a previous tweet that linked to it), only the wiki-link is added to the new tweet note

---

## Key Technical Notes

1. **Twitter DOM selectors are fragile.** Twitter uses dynamically generated class names. Prefer `data-testid` attributes (e.g., `[data-testid="tweet"]`, `[data-testid="tweetText"]`) and semantic structure over class names.

2. **Image resolution.** Twitter image URLs support quality parameters. Use `?format=jpg&name=large` for high-resolution downloads.

3. **Rate limiting.** The Obsidian REST API is local and has no rate limits, but avoid flooding it. Process tweets sequentially with a small delay (~100ms) between API calls.

4. **Service worker lifecycle.** Manifest V3 service workers can be terminated by Chrome. Use `chrome.storage.local` for any state that must persist (queue, settings). Do not rely on in-memory state in the background worker.

5. **CORS.** The Obsidian REST API may need CORS headers for requests from `x.com`. The extension's `host_permissions` for `http://127.0.0.1:27123/*` should handle this, as Chrome extensions bypass CORS for hosts listed in permissions.

6. **Content script URL matching.** The `matches` pattern in manifest.json should cover both `x.com/*/likes` and `twitter.com/*/likes`. The content script should also verify the URL on page navigation (Twitter is a SPA, so URL changes without full page reloads). Listen to `chrome.webNavigation` or use a URL check interval.
