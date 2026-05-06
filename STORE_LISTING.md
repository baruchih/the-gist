# Chrome Web Store listing — copy/paste reference

Texts to paste into the Chrome Web Store Developer Console form when submitting `the-gist`.

## Required URLs

| Field | Value |
| --- | --- |
| Privacy policy URL | `https://github.com/baruchih/the-gist/blob/main/PRIVACY.md` |
| Homepage URL | `https://github.com/baruchih/the-gist` |
| Support URL | `https://github.com/baruchih/the-gist/issues` |

> Tip: GitHub renders Markdown directly at the URL above, which Chrome reviewers accept. If you'd rather host it as a styled HTML page, enable GitHub Pages on `main` (Settings → Pages → "Deploy from a branch" → `main` / `/root`) and the URL becomes `https://baruchih.github.io/the-gist/PRIVACY.html`.

## Category

`Productivity`

## Languages

`English (United States)` — set as primary listing language. The extension supports any language at runtime; the listing copy is just English.

## Single-purpose statement

> Summarize web pages and detect clickbait by comparing link anchor text against destination content.

## Short description (132-char manifest description)

Already in `manifest.json`:

> Right-click any link for a summary and clickbait verdict — comparing the headline against the page's real content.

## Detailed description (paste into "Description" field)

```
See past the clickbait — before you click.

Most "summary" extensions analyze articles you've already opened. By then, the bait already worked. the-gist flips that around: right-click any link and get a summary plus a clickbait verdict, BEFORE you commit to opening it.

What makes this different from a regular summarizer is anchor-text-aware clickbait detection. The extension compares the link text on the source page (the actual bait) against the destination's real content. A headline like "you won't believe which beloved club just closed" gets a red verdict even if the article behind it is perfectly good journalism — because the bait is the withholding, not the article.

▸ TWO PATTERNS THE EXTENSION CATCHES

• Curiosity gap — anchor deliberately hides the specific name, place, or finding. ("The TV show everyone's calling 'unmissable'" — which one?)
• Overpromise — emotional or sensational framing where the body underdelivers.

▸ HOW YOU USE IT

• Right-click any link → "gist this link" → fetched, summarized, and color-graded (green = legit / red = clickbait) without leaving your current page.
• Optional: auto-summarize every page you visit (off by default).
• Optional: full-page brutalist takeover for clickbait pages — the original page is preserved underneath; "see the original anyway" restores it.

▸ THREE AI PROVIDERS, YOUR CHOICE

• OpenAI — GPT-4.1, GPT-4.1-mini, GPT-4o
• Anthropic — Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
• Chrome AI — built-in Gemini Nano, runs locally on your device. Free, no API key, fully private.

Bring your own API key for OpenAI / Anthropic. Chrome AI needs no setup beyond a feature flag.

▸ PRIVACY

• API keys live in chrome.storage.sync, only sent to the provider's API.
• Page content is sent only to your chosen LLM provider — nowhere else. Chrome AI keeps everything on-device.
• No analytics, no telemetry, no third-party services.
• Skip-list ensures sensitive sites (Gmail, GitHub, Slack, ChatGPT, etc.) are never analyzed.
• The last 100 gists are stored locally (chrome.storage.local) — never synced.

▸ MORE

• Multi-language: works in any language; RTL detection for Hebrew, Arabic, Persian, Urdu, etc.
• Movable, collapsible panels.
• Built-in gist history viewer in settings.
• A typical gist costs less than a cent at the default models. Repeat views hit a 1-hour cache and cost nothing.

Source code (open source): https://github.com/baruchih/the-gist
```

## Permission justifications

The Console asks for a one-line justification per permission. Paste:

### `storage`

> Saves user settings (provider, model, skip-list, behavior toggles), API keys (in chrome.storage.sync, encrypted by Chrome), and the last 100 gist results (in chrome.storage.local, on this device only).

### `contextMenus`

> Adds a "gist this link" item to the right-click menu on links — the primary way users trigger the extension.

### Host permissions (`<all_urls>`)

> Required to fetch the HTML of a linked page on demand when the user picks "gist this link" from the context menu, and to extract page text when the optional auto-summarize-on-load setting is enabled. Page content is sent only to the LLM provider the user has chosen (OpenAI, Anthropic, or Chrome AI on-device).

## Data-handling disclosures

The Console asks you to declare what categories of data you collect/transmit. Use the following selections:

| Category | Selection | Note |
| --- | --- | --- |
| Personally identifiable information | **No** | Only present in page content the user chose to analyze. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes** | API keys (chrome.storage.sync). Never sent except to the corresponding API. |
| Personal communications | No | Default skip-list excludes Gmail and similar. |
| Location | No | |
| Web history | **Yes** | URLs of pages the user analyzes are sent to the chosen LLM provider. |
| User activity | No | |
| Website content | **Yes** | Page text is sent to the chosen LLM provider for analysis. |

**Use cases:** "App functionality" (the summarization service the user requested).

**Required certifications:**

- ☑ I do not sell or transfer user data to third parties, apart from the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Screenshot upload order

Recommended order in the Console (the first one becomes the listing's hero image):

1. `panel-clickbait.png` — leads with the differentiator (verdict bar + bait link)
2. `rightclick-menu.png` — shows the trigger
3. `panel-legit.png` — shows the green-verdict case
4. `takeover.png` — the brutalist option, eye-catching
5. `options.png` — settings
6. `history.png` — recent gists viewer

Five is the maximum the Console accepts; if you have to drop one, drop `history.png` (the lowest-priority feature).

## Final pre-submit checklist

- [ ] Run `npm run build` and zip the `build/` folder
- [ ] Pay the $5 one-time developer registration fee
- [ ] Upload zip
- [ ] Upload icon-128.png (already in `icons/`)
- [ ] Upload screenshots (from `screenshots/output/`)
- [ ] Paste detailed description, single-purpose statement, permission justifications
- [ ] Paste privacy policy URL
- [ ] Pick category, language
- [ ] Fill data-handling form
- [ ] Submit for review (typically 1–7 days for first submission)
