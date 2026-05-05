// @ts-check
// the-gist — service worker
// Receives extracted page text from content.js, calls the configured LLM
// provider (Anthropic or OpenAI), returns a JSON verdict.

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';
const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';
const MAX_TOKENS = 1024;
const URL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SYSTEM_PROMPT = `You analyze web page content for clickbait. Respond ONLY with valid JSON, no markdown fences.

Clickbait detection — flag as clickbait if EITHER pattern is present:

PATTERN A — Curiosity gap (withholding key information):
The anchor or headline deliberately omits the specific entity, name, place, finding, or referent that the reader needs, in order to manufacture curiosity. Bright-line test: read the anchor in isolation. If the reader still needs to ask "who?", "what?", "which one?", or "what was it?" to make sense of it, the anchor was withholding by design. Markers:
- Vague references where a name is expected: "a beloved club", "a famous celebrity", "a major politician", "a recent study", "a popular restaurant".
- Cliffhanger phrasing: "you won't believe...", "what happened next will shock you", "number 7 will surprise you", "the reason will surprise you".
- Quote teasers — a person's name attached to a dramatic quote whose subject is hidden behind pronouns ("she", "he", "they", "it") or vague references. Example: 'Liraz Chamami: "I remember the first lie SHE told me"' — the bait is the unanswered "who is she? what was the lie?", and the quote's emotional charge sells the click. This pattern is extremely common in Hebrew entertainment media.
- Pronoun-as-withholding more generally: any anchor where the natural reader response is "wait, who?" or "wait, what?".
- Hebrew markers: "המועדון האהוב", "הסלב המוכר", "השחקן שכולם מכירים", "תתפלאו לגלות", "זוכרים את X?", and quote teasers with pronouns like "היא"/"הוא"/"הם" standing in for unnamed people.
This is clickbait EVEN IF the body fully delivers the answer. The manipulation lives in the anchor's withholding, not in body quality.

PATTERN B — Overpromise / sensational framing:
The anchor uses emotional or hyperbolic framing ("a BLOW to nightlife", "shocking", "outrage", "exposed") that's disproportionate to the actual story, OR the body's substance is thin / padded / mismatched relative to the anchor's drama.

When in doubt, lean toward clickbait. Both patterns count even when the body is legitimate journalism. Mainstream news sites (mako, ynet, walla, daily mail, buzzfeed, huffpost, etc.) routinely use both patterns — do not give them a pass.

When no Anchor text is provided, judge the destination title alone for the same patterns.

Other rules:
1. Summarize the destination's actual substance in 3-5 bullet points in the SAME language as the page content. Cut through the BS — give the reader what they actually wanted to know, including any name the headline withheld.
2. When is_clickbait=true, clickbait_reason MUST: (a) name the pattern (A=curiosity gap or B=overpromise), (b) quote the manipulative phrase from the anchor or title, and (c) say briefly what was withheld or oversold. Write the reason in the same language as the page.
3. The clickbait patterns (A and B) are universal — apply the same logic in any language. The Hebrew markers above are illustrative; equivalent patterns exist in every language.

Response format:
{
  "is_clickbait": true|false,
  "language": "ISO 639-1 code of the page language, e.g. 'en', 'he', 'ar', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'ru', 'pt'",
  "title": "cleaned up, honest title that reveals what the original withheld, in the page's language",
  "summary": ["point 1", "point 2", "..."],
  "clickbait_reason": "why it's clickbait (only if is_clickbait=true, null otherwise)"
}`;

/** @param {AnalyzePayload} args */
function buildUserMessage({ url, title, content, anchorText }) {
  const anchorLine = anchorText
    ? `\nAnchor text (what the user was promised): "${anchorText}"`
    : '';
  return `Analyze this page content:

URL: ${url}
Original title: ${title}${anchorLine}

Content:
${content}`;
}

/** @returns {Promise<GistSettings>} */
async function getSettings() {
  /** @type {GistSettings} */
  const defaults = {
    provider: 'openai',
    anthropicKey: '',
    openaiKey: '',
    anthropicModel: ANTHROPIC_DEFAULT_MODEL,
    openaiModel: OPENAI_DEFAULT_MODEL,
    skipDomains: [],
    autoRun: false,
    hostileTakeover: true,
  };
  const stored = await chrome.storage.sync.get(defaults);
  return /** @type {GistSettings} */ ({ ...defaults, ...stored });
}

// ---- URL result cache (chrome.storage.session, MV3-only) -----------------

/**
 * @param {string} key
 * @returns {Promise<GistResult | null>}
 */
async function cacheGet(key) {
  try {
    const obj = await chrome.storage.session.get(key);
    const entry = obj[key];
    if (!entry) return null;
    if (Date.now() - entry.t > URL_CACHE_TTL_MS) {
      chrome.storage.session.remove(key);
      return null;
    }
    return /** @type {GistResult} */ (entry.v);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {GistResult} value
 */
async function cacheSet(key, value) {
  try {
    await chrome.storage.session.set({ [key]: { v: value, t: Date.now() } });
  } catch {
    // session storage may be unavailable; non-fatal
  }
}

/**
 * @param {string} input
 * @returns {Promise<string>}
 */
async function hashKey(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// ---- Provider adapters ----------------------------------------------------

/** @param {string} text @returns {string} */
function stripJsonFences(text) {
  // Some models wrap JSON in ```json ... ``` despite instructions.
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : text.trim();
}

/**
 * @param {ProviderCallArgs} args
 * @returns {Promise<unknown>}
 */
async function callAnthropic({ apiKey, model, userMessage }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.find?.((/** @type {any} */ b) => b.type === 'text')?.text;
  if (!text) throw new Error('Anthropic: no text in response');
  return JSON.parse(stripJsonFences(text));
}

/**
 * @param {ProviderCallArgs} args
 * @returns {Promise<unknown>}
 */
async function callOpenAI({ apiKey, model, userMessage }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI: no text in response');
  return JSON.parse(stripJsonFences(text));
}

/**
 * Pick which provider to use. Chrome AI doesn't need a key — explicit
 * selection always wins. For the cloud providers, the user's explicit
 * selection wins if they have a key for it; otherwise fall back to whichever
 * has a key. Returns null if no usable provider is configured.
 * @param {GistSettings} s
 * @returns {'anthropic' | 'openai' | 'chromeai' | null}
 */
function pickProvider(s) {
  const hasA = !!s.anthropicKey;
  const hasO = !!s.openaiKey;
  if (s.provider === 'chromeai') return 'chromeai';
  if (s.provider === 'openai' && hasO) return 'openai';
  if (s.provider === 'anthropic' && hasA) return 'anthropic';
  if (hasO) return 'openai';
  if (hasA) return 'anthropic';
  return null;
}

/**
 * Call Chrome's built-in Prompt API. Runs Gemini Nano locally on-device.
 * No key, no network. Throws a descriptive error if unavailable so the
 * options page can suggest the right flag to flip.
 * @param {{ userMessage: string }} args
 * @returns {Promise<unknown>}
 */
async function callChromeAI({ userMessage }) {
  const LM = /** @type {any} */ (self).LanguageModel;
  if (!LM) {
    throw new Error('Chrome AI not available — enable chrome://flags/#prompt-api-for-gemini-nano and reload.');
  }
  const availability = await LM.availability();
  if (availability === 'unavailable') {
    throw new Error('Chrome AI: device not supported (needs recent Chrome + capable hardware).');
  }
  const session = await LM.create({
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
  });
  try {
    const response = await session.prompt(userMessage);
    return JSON.parse(stripJsonFences(response));
  } finally {
    try { session.destroy(); } catch {}
  }
}

/**
 * @param {AnalyzePayload} args
 * @returns {Promise<GistResult>}
 */
async function analyze({ url, title, content, anchorText }) {
  const settings = await getSettings();
  const provider = pickProvider(settings);
  if (!provider) throw new Error('NO_KEY');

  const cacheKey = `r:${await hashKey(`${provider}|${url}|${anchorText || ''}|${content.slice(0, 1024)}`)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return { ...cached, _cached: true };

  const userMessage = buildUserMessage({ url, title, content, anchorText });

  /** @type {unknown} */
  let raw;
  if (provider === 'chromeai') {
    raw = await callChromeAI({ userMessage });
  } else if (provider === 'openai') {
    raw = await callOpenAI({
      apiKey: settings.openaiKey,
      model: settings.openaiModel || OPENAI_DEFAULT_MODEL,
      userMessage,
    });
  } else {
    raw = await callAnthropic({
      apiKey: settings.anthropicKey,
      model: settings.anthropicModel || ANTHROPIC_DEFAULT_MODEL,
      userMessage,
    });
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Bad response shape');
  }

  // Construct a fresh, validated result — the model occasionally returns
  // null for fields we expect to be present, so we coerce defensively.
  const r = /** @type {any} */ (raw);
  /** @type {GistResult} */
  const result = {
    is_clickbait: !!r.is_clickbait,
    // Trust the model's ISO code, default to 'en' if missing or malformed.
    language: typeof r.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(r.language)
      ? r.language.toLowerCase().slice(0, 2)
      : 'en',
    title: r.title || title,
    summary: Array.isArray(r.summary) ? r.summary : [],
    clickbait_reason: r.is_clickbait ? r.clickbait_reason || null : null,
  };

  await cacheSet(cacheKey, result);
  await saveToHistory(result, { url, title, content, anchorText });
  return result;
}

/**
 * Append a fresh result to chrome.storage.local. Capped at 100 entries.
 * Called only on cache miss — repeat views don't re-add.
 * @param {GistResult} result
 * @param {AnalyzePayload} payload
 */
async function saveToHistory(result, payload) {
  let hostname = '';
  try { hostname = new URL(payload.url).hostname; } catch {}
  /** @type {GistHistoryEntry} */
  const entry = {
    url: payload.url,
    title: result.title,
    hostname,
    language: result.language,
    is_clickbait: result.is_clickbait,
    summary: result.summary,
    clickbait_reason: result.clickbait_reason,
    anchorText: payload.anchorText,
    timestamp: Date.now(),
  };
  try {
    const obj = await chrome.storage.local.get({ history: [] });
    /** @type {GistHistoryEntry[]} */
    const history = obj.history;
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    await chrome.storage.local.set({ history });
  } catch {
    // non-fatal
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type !== 'analyze') return false;
  analyze(/** @type {AnalyzePayload} */ (msg.payload))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // async
});

// ---- Context menu: "gist this link" -------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  // Recreate the menu on every install/update so reloads pick up changes.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'gist-link',
      title: 'gist this link',
      contexts: ['link'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'gist-link') return;
  if (!info.linkUrl || !tab?.id) return;
  const tabId = tab.id;

  // Show the loading pill IMMEDIATELY — fetching the linked URL can take
  // seconds, and the user shouldn't see dead air after clicking the menu.
  chrome.tabs.sendMessage(tabId, { type: 'gist-link-start' }).catch(() => {});

  try {
    const html = await fetchHtml(info.linkUrl);
    chrome.tabs.sendMessage(tabId, {
      type: 'gist-link',
      linkUrl: info.linkUrl,
      html,
    });
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      type: 'gist-link-error',
      linkUrl: info.linkUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * Fetch a URL's HTML body. Capped at 2MB to keep us out of trouble on
 * pathological pages.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchHtml(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('html') && !ct.includes('text')) {
    throw new Error('not an HTML page');
  }
  const text = await res.text();
  return text.slice(0, 2 * 1024 * 1024);
}
