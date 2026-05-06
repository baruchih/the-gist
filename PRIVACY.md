# Privacy Policy — the-gist

_Last updated: 2026-05-06_

This is the privacy policy for the **the-gist** Chrome extension (the "Extension"). It explains what data the Extension handles, where it goes, and what it does not do.

## What the Extension does

the-gist summarizes web pages and detects clickbait. There are two ways it runs:

- **Right-click "gist this link"** — fetches and summarizes the page behind a link you right-click.
- **Auto-summarize on page load** (off by default) — summarizes pages you visit.

## We have no servers

the-gist has no backend infrastructure. We do not run any servers, databases, analytics, telemetry, or third-party tracking. There is no account, no login, and no usage reporting.

## What gets sent where

### When you choose OpenAI or Anthropic as your provider

The Extension sends, directly to the corresponding provider's API:

- The URL of the page or link being analyzed
- The extracted text content of that page (truncated to ~4,000 words)
- (For right-click gists) the anchor text of the link
- Your API key, in the request header

All requests go directly to either `api.openai.com` or `api.anthropic.com`. Nothing is sent to any other service.

The handling of this data after it reaches the provider is governed by the provider's privacy policy:

- OpenAI: https://openai.com/policies/privacy-policy/
- Anthropic: https://www.anthropic.com/legal/privacy

### When you choose Chrome AI as your provider

All analysis happens on-device using Chrome's built-in Gemini Nano model. **No data leaves your device.**

## What is stored on your device

The Extension uses Chrome's standard storage APIs:

| Data                             | Storage area               | Notes                                                                  |
| -------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| API keys                         | `chrome.storage.sync`      | Synced via your Chrome profile; encrypted by Chrome at rest.          |
| Settings (provider, model, etc.) | `chrome.storage.sync`      | Synced via your Chrome profile.                                       |
| Skip-list of domains             | `chrome.storage.sync`      | Synced via your Chrome profile.                                       |
| Recent gists (last 100 results)  | `chrome.storage.local`     | This device only. Never synced.                                       |
| URL result cache (1-hour TTL)    | `chrome.storage.session`   | Cleared when Chrome closes.                                           |

You can clear the gist history at any time from the Extension's options page.

## What the Extension does not do

- It does not transfer your data to anyone except the provider you explicitly chose.
- It does not sell, rent, or share your data.
- It does not use your data for advertising.
- It does not use your data for any purpose other than the immediate request you triggered (analyzing the page or link you asked about).
- It does not run on pages on your skip list. Defaults include Google, GitHub, YouTube, Gmail, Slack, Discord, ChatGPT, Claude, Notion, Figma, and more — these never have their content extracted or sent anywhere.

## Permissions

The Extension requests:

- **`storage`** — to store your settings, API keys, and gist history (described above).
- **`contextMenus`** — to add the "gist this link" right-click menu item.
- **Host permissions for all sites** (`<all_urls>`) — required to fetch the HTML of a link you right-click, and to extract page text when the optional auto-summarize-on-load setting is enabled. Content is only sent to the LLM provider you chose.

## Children

the-gist is not directed at children under 13.

## Changes to this policy

If this policy changes in a substantive way, the change will be reflected in the GitHub release notes and a new version of the Extension.

## Contact

The Extension is open source. For questions, concerns, or to report issues:

https://github.com/baruchih/the-gist/issues
