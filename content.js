// @ts-check
// the-gist — content script
// Extracts page text, asks the background worker to analyze it, and renders
// either a floating summary panel (legit content) or a full-screen overlay
// takeover (clickbait). The overlay does not replace document.body — it is
// a fixed-position node attached to <html>, so SPA state is preserved.

(() => {
  if (window !== window.top) return;
  if (/** @type {any} */ (window).__theGistInjected) return;
  /** @type {any} */ (window).__theGistInjected = true;

  const Z = '2147483647';
  const HOST_ID = 'the-gist-host';
  const TAKEOVER_ID = 'the-gist-takeover';

  // ---- Right-click anchor-text capture ------------------------------------
  // Real clickbait is about the gap between the link's anchor text (the
  // promise) and the destination's content (the delivery). We capture the
  // anchor on every contextmenu event so it's available when the user later
  // picks "gist this link" from the menu.

  /** @type {{ href: string, text: string } | null} */
  let lastRightClickedLink = null;

  document.addEventListener('contextmenu', (e) => {
    const target = /** @type {Element | null} */ (e.target);
    const a = target?.closest?.('a');
    if (a instanceof HTMLAnchorElement && a.href) {
      let text = (a.innerText || a.textContent || '').trim();
      if (!text) {
        const img = a.querySelector('img');
        text = (img?.alt || '').trim();
      }
      if (!text) text = a.getAttribute('aria-label') || a.title || '';
      lastRightClickedLink = { href: a.href, text: text.slice(0, 500) };
    } else {
      lastRightClickedLink = null;
    }
  }, true);

  // ---- Skip detection ----------------------------------------------------

  const HARDCODED_SKIPS = new Set([
    'chrome://',
    'chrome-extension://',
    'about:',
    'file://',
    'view-source:',
  ]);

  const DEFAULT_SKIP_DOMAINS = [
    'google.com',
    'mail.google.com',
    'docs.google.com',
    'drive.google.com',
    'calendar.google.com',
    'github.com',
    'gitlab.com',
    'youtube.com',
    'gmail.com',
    'localhost',
    'claude.ai',
    'chatgpt.com',
    'chat.openai.com',
    'web.whatsapp.com',
    'slack.com',
    'discord.com',
    'app.slack.com',
    'figma.com',
    'notion.so',
    'linear.app',
    'twitter.com',
    'x.com',
    'linkedin.com',
  ];

  /**
   * @param {string} href
   * @param {string[]} domains
   * @returns {boolean}
   */
  function urlIsBlocklisted(href, domains) {
    for (const p of HARDCODED_SKIPS) if (href.startsWith(p)) return true;
    /** @type {string} */
    let hostname;
    try {
      hostname = new URL(href).hostname;
    } catch {
      return true;
    }
    if (!hostname) return true;
    if (hostname === 'localhost' || hostname.startsWith('127.')) return true;
    return domains.some((d) => {
      const dd = String(d || '').trim().toLowerCase();
      if (!dd) return false;
      return hostname === dd || hostname.endsWith('.' + dd);
    });
  }

  function isHtmlPage() {
    const ct = document.contentType || '';
    if (ct && !ct.includes('html')) return false;
    if (document.location.pathname.endsWith('.pdf')) return false;
    return true;
  }

  // ---- Content extraction -------------------------------------------------

  /** @typedef {{ text: string, wordCount: number, hasArticle: boolean }} Extracted */

  /** @returns {Extracted} */
  function extractContent() {
    const candidates = ['article', 'main', '[role="main"]'];
    /** @type {HTMLElement | null} */
    let root = null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement) { root = el; break; }
    }
    if (!root) root = document.body;
    if (!root) return { text: '', wordCount: 0, hasArticle: false };

    const clone = /** @type {HTMLElement} */ (root.cloneNode(true));
    const drop = clone.querySelectorAll('script, style, nav, header, footer, aside, noscript, iframe, svg, form');
    drop.forEach((el) => el.remove());

    let text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    const words = text.split(' ').filter(Boolean);
    if (words.length > 4000) text = words.slice(0, 4000).join(' ');

    return {
      text,
      wordCount: words.length,
      hasArticle: !!document.querySelector('article'),
    };
  }

  /** @param {Extracted} extracted */
  function isAnalyzable(extracted) {
    if (extracted.wordCount < 100) return false;
    // Long enough → analyze. Short-but-has-article → analyze. Else skip.
    if (extracted.wordCount >= 500) return true;
    return extracted.hasArticle;
  }

  // ---- Page direction -----------------------------------------------------
  // All UI (loading pill, summary panel, link-gist panel) is positioned based
  // on the source page's direction so the loading state and the result land
  // on the same side. Text flow inside panels still uses result.language.

  function getPageDir() {
    if (document.documentElement.dir === 'rtl') return 'rtl';
    if (document.documentElement.dir === 'ltr') return 'ltr';
    const elem = document.body || document.documentElement;
    return getComputedStyle(elem).direction === 'rtl' ? 'rtl' : 'ltr';
  }

  function pinSide() {
    return getPageDir() === 'rtl' ? 'left: 16px;' : 'right: 16px;';
  }

  // ---- Shadow-DOM hosts ---------------------------------------------------

  /**
   * @param {string} id
   * @returns {ShadowRoot}
   */
  function makeShadowHost(id) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const host = document.createElement('div');
    host.id = id;
    // host element styles — the shadow content positions itself absolutely,
    // so the host can be a 0×0 anchor.
    host.style.cssText = `all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: ${Z};`;
    document.documentElement.appendChild(host);
    return host.attachShadow({ mode: 'open' });
  }

  /** @param {string} id */
  function removeNode(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // ---- Loading pill -------------------------------------------------------

  /** @type {ShadowRoot | null} */
  let pillRoot = null;

  /** @param {string} text */
  function showPill(text) {
    if (!pillRoot) pillRoot = makeShadowHost(HOST_ID);
    pillRoot.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .pill {
          position: fixed; top: 16px; ${pinSide()}
          font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #fff; background: rgba(15,15,15,0.85);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          padding: 8px 14px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          pointer-events: auto;
          animation: gistPulse 1.6s ease-in-out infinite;
        }
        @keyframes gistPulse {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
      </style>
      <div class="pill">🔍 ${text}</div>
    `;
  }

  /**
   * @param {string} text
   * @param {boolean} [autoFade]
   */
  function showError(text, autoFade = true) {
    if (!pillRoot) pillRoot = makeShadowHost(HOST_ID);
    pillRoot.innerHTML = `
      <style>
        .pill {
          position: fixed; top: 16px; ${pinSide()}
          font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #fff; background: rgba(120,30,30,0.92);
          padding: 8px 14px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.15);
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          pointer-events: auto; cursor: pointer;
          transition: opacity .4s ease;
        }
      </style>
      <div class="pill" id="p">⚠️ ${text}</div>
    `;
    pillRoot.getElementById('p')?.addEventListener('click', () => removeNode(HOST_ID));
    if (autoFade) {
      setTimeout(() => {
        const el = pillRoot && pillRoot.getElementById('p');
        if (el) el.style.opacity = '0';
        setTimeout(() => removeNode(HOST_ID), 500);
      }, 5000);
    }
  }

  function showSetupBanner() {
    if (!pillRoot) pillRoot = makeShadowHost(HOST_ID);
    pillRoot.innerHTML = `
      <style>
        .pill {
          position: fixed; top: 16px; ${pinSide()}
          font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #fff; background: rgba(15,15,15,0.92);
          padding: 8px 14px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          cursor: pointer; pointer-events: auto;
        }
        .x { margin-left: 8px; opacity: 0.6; }
      </style>
      <div class="pill" id="p">the-gist needs an API key — click to set up<span class="x">×</span></div>
    `;
    pillRoot.getElementById('p')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-options' });
      removeNode(HOST_ID);
    });
  }

  // ---- Summary panel ------------------------------------------------------

  /** @param {GistResult} result */
  function renderPanel(result) {
    const root = makeShadowHost(HOST_ID);
    pillRoot = root;
    const dir = result.language === 'he' ? 'rtl' : 'ltr';
    const summary = (result.summary || []).map(escapeHTML).map((s) => `<li>${s}</li>`).join('');

    root.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .panel {
          position: fixed; top: 16px; ${pinSide()} width: 360px;
          font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #f0f0f0; background: rgba(15,15,15,0.92);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px; pointer-events: auto;
          box-shadow: 0 12px 36px rgba(0,0,0,0.4);
          transition: width .25s ease, height .25s ease, padding .25s ease;
          overflow: hidden;
        }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08);
          user-select: none;
        }
        .brand { font-weight: 600; font-size: 12px; letter-spacing: 0.04em; opacity: 0.7; text-transform: lowercase; }
        .ctrls { display: flex; gap: 4px; }
        .ctrl {
          width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
          background: transparent; border: 0; color: #ccc; cursor: pointer;
          border-radius: 4px; font-size: 14px; line-height: 1;
        }
        .ctrl:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .body { padding: 12px 14px 14px; }
        .title { font-weight: 600; font-size: 15px; margin: 0 0 10px; line-height: 1.35; }
        ul { list-style: none; margin: 0; padding: 0; }
        li {
          position: relative; padding-${dir === 'rtl' ? 'right' : 'left'}: 14px;
          margin-bottom: 6px; font-size: 13px; line-height: 1.55;
        }
        li::before {
          content: '·'; position: absolute; ${dir === 'rtl' ? 'right' : 'left'}: 4px;
          opacity: 0.5; font-weight: 700;
        }
        /* Collapsed state — just the brand pill */
        .panel.collapsed { width: auto; }
        .panel.collapsed .body { display: none; }
        .panel.collapsed .head { border-bottom: 0; padding: 8px 12px; }
      </style>
      <div class="panel" id="panel" dir="${dir}">
        <div class="head">
          <span class="brand">the-gist</span>
          <div class="ctrls">
            <button class="ctrl" id="toggle" title="collapse">▾</button>
            <button class="ctrl" id="close" title="close">×</button>
          </div>
        </div>
        <div class="body">
          <h3 class="title">${escapeHTML(result.title || '')}</h3>
          <ul>${summary}</ul>
        </div>
      </div>
    `;

    const panel = root.getElementById('panel');
    const toggle = root.getElementById('toggle');
    const close = root.getElementById('close');
    if (!panel || !toggle || !close) return;

    let collapsed = false;
    /** @param {boolean} c */
    const setCollapsed = (c) => {
      collapsed = c;
      panel.classList.toggle('collapsed', c);
      toggle.textContent = c ? '▴' : '▾';
      toggle.title = c ? 'expand' : 'collapse';
    };
    toggle.addEventListener('click', () => setCollapsed(!collapsed));
    close.addEventListener('click', () => removeNode(HOST_ID));

    setTimeout(() => { if (!collapsed) setCollapsed(true); }, 15000);
  }

  // ---- Clickbait takeover (overlay, not body replacement) -----------------

  /**
   * @param {GistResult} result
   * @param {string} originalUrl
   */
  function renderTakeover(result, originalUrl) {
    removeNode(HOST_ID); // remove pill if present
    const root = makeShadowHost(TAKEOVER_ID);
    const dir = result.language === 'he' ? 'rtl' : 'ltr';
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const points = (result.summary || [])
      .map(escapeHTML)
      .map((s, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="pt">${s}</span></li>`)
      .join('');

    root.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=JetBrains+Mono:wght@500&display=swap');
        :host, * { box-sizing: border-box; }
        .scrim {
          position: fixed; inset: 0; z-index: 1;
          background: #FAFAF5; color: #1a1a1a;
          font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
          overflow: auto; padding: 64px 24px;
          pointer-events: auto;
          animation: gistFade .25s ease;
        }
        @keyframes gistFade { from { opacity: 0; } to { opacity: 1; } }
        .wrap { max-width: 640px; margin: 0 auto; }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          padding-bottom: 24px; margin-bottom: 48px;
          border-bottom: 1px solid #1a1a1a;
        }
        .mark { font: 600 22px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.02em; }
        .opts { font: 500 12px/1 'JetBrains Mono', ui-monospace, monospace; opacity: 0.5; }
        .badge {
          display: inline-block;
          font: 500 12px/1 'JetBrains Mono', ui-monospace, monospace;
          color: #FAFAF5; background: #D94F3B;
          padding: 7px 12px; letter-spacing: 0.08em; text-transform: lowercase;
          margin-bottom: 12px;
        }
        .reason { font-style: italic; color: #6a6a6a; font-size: 14px; margin: 0 0 36px; }
        .title {
          font-family: 'DM Serif Display', Georgia, serif;
          font-weight: 400; font-size: 44px; line-height: 1.12;
          margin: 0 0 48px; letter-spacing: -0.01em;
        }
        ul { list-style: none; margin: 0; padding: 0; }
        ul li {
          display: flex; align-items: baseline; gap: 16px;
          padding: 18px 0; border-top: 1px solid rgba(26,26,26,0.12);
          font-size: 17px; line-height: 1.55;
        }
        ul li:last-child { border-bottom: 1px solid rgba(26,26,26,0.12); }
        .num {
          font: 500 12px/1 'JetBrains Mono', ui-monospace, monospace;
          opacity: 0.45; flex-shrink: 0; padding-top: 4px;
        }
        .pt { flex: 1; }
        .foot {
          margin-top: 64px; display: flex; justify-content: space-between; align-items: center;
          font-size: 13px;
        }
        .actions { display: flex; gap: 18px; }
        .actions a {
          color: #1a1a1a; text-decoration: underline; text-underline-offset: 4px;
          cursor: pointer;
        }
        .actions a:hover { color: #D94F3B; }
        .by { opacity: 0.4; font: 500 11px/1 'JetBrains Mono', ui-monospace, monospace; }
        [dir="rtl"] .head, [dir="rtl"] .foot { flex-direction: row-reverse; }
      </style>
      <div class="scrim" dir="${dir}">
        <div class="wrap">
          <div class="head">
            <div class="mark">the-gist</div>
            <div class="opts">${escapeHTML(new URL(originalUrl).hostname)}</div>
          </div>
          <div class="badge">clickbait</div>
          ${result.clickbait_reason ? `<p class="reason">${escapeHTML(result.clickbait_reason)}</p>` : ''}
          <h1 class="title">${escapeHTML(result.title || '')}</h1>
          <ul>${points}</ul>
          <div class="foot">
            <div class="actions">
              <a id="orig">see the original anyway →</a>
              <a id="skip">never gist this site</a>
            </div>
            <span class="by">powered by the-gist</span>
          </div>
        </div>
      </div>
    `;

    root.getElementById('orig')?.addEventListener('click', () => {
      document.documentElement.style.overflow = previousOverflow;
      removeNode(TAKEOVER_ID);
      renderPanel(result);
    });
    root.getElementById('skip')?.addEventListener('click', async () => {
      try {
        const host = new URL(originalUrl).hostname.replace(/^www\./, '');
        const { skipDomains = [] } = await chrome.storage.sync.get({ skipDomains: [] });
        if (!skipDomains.includes(host)) {
          await chrome.storage.sync.set({ skipDomains: [...skipDomains, host] });
        }
      } catch {}
      document.documentElement.style.overflow = previousOverflow;
      removeNode(TAKEOVER_ID);
    });
  }

  // ---- Helpers ------------------------------------------------------------

  /** @param {unknown} s @returns {string} */
  function escapeHTML(s) {
    /** @type {Record<string, string>} */
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s ?? '').replace(/[&<>"']/g, (c) => map[c]);
  }

  // ---- Link-gist (context menu) -------------------------------------------

  /**
   * @param {string} linkUrl
   * @param {string} html
   */
  async function handleGistLink(linkUrl, html) {
    showPill('reading link…');

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.textContent?.trim() || linkUrl;
    const root = doc.querySelector('article')
      || doc.querySelector('main')
      || doc.querySelector('[role="main"]')
      || doc.body;
    if (!root) {
      showError('no readable content');
      return;
    }
    root
      .querySelectorAll('script, style, nav, header, footer, aside, noscript, iframe, svg, form')
      .forEach((el) => el.remove());

    let text = (root.textContent || '').replace(/\s+/g, ' ').trim();
    const words = text.split(' ').filter(Boolean);
    if (words.length < 100) {
      showError('not enough content');
      return;
    }
    if (words.length > 4000) text = words.slice(0, 4000).join(' ');

    // Pull the anchor text from the most recent right-click on this href.
    const anchorText =
      lastRightClickedLink && lastRightClickedLink.href === linkUrl
        ? lastRightClickedLink.text
        : undefined;

    /** @type {AnalyzeResponse | undefined} */
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'analyze',
        payload: { url: linkUrl, title, content: text, anchorText },
      });
    } catch {
      showError('the-gist failed');
      return;
    }
    if (!response?.ok) {
      if (!response?.ok && response?.error === 'NO_KEY') showSetupBanner();
      else showError('the-gist failed');
      return;
    }
    renderLinkGist(response.result, linkUrl);
  }

  /**
   * Panel for context-menu link gists. Always shown — never replaces the page.
   * Top bar is colored by clickbait verdict.
   * @param {GistResult} result
   * @param {string} linkUrl
   * @param {{ showOpenLink?: boolean }} [opts]
   */
  function renderLinkGist(result, linkUrl, opts = {}) {
    const showOpenLink = opts.showOpenLink !== false;
    const root = makeShadowHost(HOST_ID);
    pillRoot = root;
    const dir = result.language === 'he' ? 'rtl' : 'ltr';
    const summary = (result.summary || []).map(escapeHTML).map((s) => `<li>${s}</li>`).join('');
    let hostname = linkUrl;
    try { hostname = new URL(linkUrl).hostname; } catch {}

    root.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .panel {
          position: fixed; top: 16px; ${pinSide()} width: 380px;
          font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #f0f0f0; background: rgba(15,15,15,0.94);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px; pointer-events: auto;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5);
          overflow: hidden; max-height: 80vh; display: flex; flex-direction: column;
        }
        .verdict {
          padding: 11px 14px; font-weight: 600; font-size: 12px;
          letter-spacing: 0.06em; text-transform: lowercase;
          display: flex; align-items: center; gap: 8px;
        }
        .verdict.bait { background: #D94F3B; color: #fff; }
        .verdict.legit { background: #2e7a36; color: #fff; }
        .verdict .label { flex: 1; }
        .verdict .x {
          background: transparent; border: 0; color: #fff; cursor: pointer;
          opacity: 0.8; font-size: 16px; line-height: 1; padding: 2px 4px;
        }
        .verdict .x:hover { opacity: 1; }
        .reason {
          padding: 8px 14px 10px; font-size: 12px; color: #f3c8c0;
          background: rgba(217,79,59,0.18); font-style: italic;
        }
        .body { padding: 12px 14px 14px; overflow: auto; }
        .meta {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px; margin-bottom: 8px;
        }
        .brand { font-size: 11px; letter-spacing: 0.06em; opacity: 0.4; text-transform: lowercase; }
        .url {
          font: 11px/1.3 ui-monospace, SFMono-Regular, monospace; color: #888;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          max-width: 60%; direction: ltr;
        }
        .title { font-weight: 600; font-size: 16px; margin: 0 0 12px; line-height: 1.3; }
        ul { list-style: none; margin: 0 0 14px; padding: 0; }
        li {
          position: relative; padding-${dir === 'rtl' ? 'right' : 'left'}: 14px;
          margin-bottom: 6px; font-size: 13px; line-height: 1.55;
        }
        li::before {
          content: '·'; position: absolute; ${dir === 'rtl' ? 'right' : 'left'}: 4px;
          opacity: 0.5; font-weight: 700;
        }
        .open {
          display: block; padding: 9px 12px;
          background: rgba(255,255,255,0.06); color: #fff;
          text-align: center; text-decoration: none; border-radius: 6px;
          font-size: 13px; font-weight: 500;
          border: 1px solid rgba(255,255,255,0.08);
          transition: background .15s ease;
        }
        .open:hover { background: rgba(255,255,255,0.1); }
      </style>
      <div class="panel" dir="${dir}">
        <div class="verdict ${result.is_clickbait ? 'bait' : 'legit'}">
          <span>${result.is_clickbait ? '⚠' : '✓'}</span>
          <span class="label">${result.is_clickbait ? 'clickbait' : 'looks legit'}</span>
          <button class="x" id="close" title="close">×</button>
        </div>
        ${result.is_clickbait && result.clickbait_reason
          ? `<div class="reason">${escapeHTML(result.clickbait_reason)}</div>` : ''}
        <div class="body">
          <div class="meta">
            <span class="brand">the-gist</span>
            <span class="url" title="${escapeHTML(linkUrl)}">${escapeHTML(hostname)}</span>
          </div>
          <h3 class="title">${escapeHTML(result.title || '')}</h3>
          <ul>${summary}</ul>
          ${showOpenLink
            ? `<a class="open" href="${escapeHTML(linkUrl)}" target="_blank" rel="noopener noreferrer">open the link →</a>`
            : ''}
        </div>
      </div>
    `;

    root.getElementById('close')?.addEventListener('click', () => removeNode(HOST_ID));
  }

  // Listen for context-menu requests from the background worker. Registered
  // unconditionally — runs even on skip-listed domains so the user can gist
  // a link from anywhere.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'gist-link-start') {
      showPill('reading link…');
    } else if (msg?.type === 'gist-link') {
      handleGistLink(msg.linkUrl, msg.html);
    } else if (msg?.type === 'gist-link-error') {
      showError(`couldn't fetch: ${msg.error}`);
    }
  });

  // ---- Main ---------------------------------------------------------------

  async function main() {
    if (!isHtmlPage()) return;

    const settings = /** @type {Partial<GistSettings>} */ (
      await chrome.storage.sync.get({
        provider: 'anthropic',
        anthropicKey: '',
        openaiKey: '',
        skipDomains: [],
        autoRun: false,
        hostileTakeover: true,
      })
    );

    if (settings.autoRun !== true) return; // user opted out of auto-run

    const skipList = [...DEFAULT_SKIP_DOMAINS, ...(settings.skipDomains || [])];
    if (urlIsBlocklisted(location.href, skipList)) return;

    const extracted = extractContent();
    if (!isAnalyzable(extracted)) return;

    if (!settings.anthropicKey && !settings.openaiKey) {
      showSetupBanner();
      return;
    }

    showPill('reading…');

    /** @type {AnalyzeResponse | undefined} */
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'analyze',
        payload: {
          url: location.href,
          title: document.title || '',
          content: extracted.text,
        },
      });
    } catch {
      showError('the-gist failed');
      return;
    }

    if (!response?.ok) {
      if (response && !response.ok && response.error === 'NO_KEY') showSetupBanner();
      else showError('the-gist failed');
      return;
    }

    const result = response.result;
    if (result.is_clickbait) {
      if (settings.hostileTakeover !== false) renderTakeover(result, location.href);
      else renderLinkGist(result, location.href, { showOpenLink: false });
    } else {
      renderPanel(result);
    }
  }

  main().catch(() => {/* swallow — this is best-effort */});
})();
