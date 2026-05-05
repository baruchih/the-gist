// @ts-check

/** @type {GistSettings} */
const DEFAULTS = {
  provider: 'anthropic',
  anthropicKey: '',
  openaiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4.1-mini',
  skipDomains: [],
  autoRun: false,
  hostileTakeover: true,
};

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function getEls() {
  return {
    pAnthropic: /** @type {HTMLInputElement} */ ($('p-anthropic')),
    pOpenai: /** @type {HTMLInputElement} */ ($('p-openai')),
    anthropicFs: $('anthropic-fs'),
    openaiFs: $('openai-fs'),
    anthropicKey: /** @type {HTMLInputElement} */ ($('anthropicKey')),
    openaiKey: /** @type {HTMLInputElement} */ ($('openaiKey')),
    anthropicModel: /** @type {HTMLSelectElement} */ ($('anthropicModel')),
    openaiModel: /** @type {HTMLSelectElement} */ ($('openaiModel')),
    skipDomains: /** @type {HTMLTextAreaElement} */ ($('skipDomains')),
    autoRun: /** @type {HTMLInputElement} */ ($('autoRun')),
    autoRunSub: $('autoRunSub'),
    hostileTakeover: /** @type {HTMLInputElement} */ ($('hostileTakeover')),
    save: /** @type {HTMLButtonElement} */ ($('save')),
    status: $('status'),
    anthropicShow: /** @type {HTMLButtonElement} */ ($('anthropicShow')),
    openaiShow: /** @type {HTMLButtonElement} */ ($('openaiShow')),
    history: $('history'),
    clearHistory: /** @type {HTMLButtonElement} */ ($('clearHistory')),
  };
}

/** @param {unknown} s @returns {string} */
function escapeHTML(s) {
  /** @type {Record<string, string>} */
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/** @param {number} ts */
function relativeTime(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

async function loadHistory() {
  const els = getEls();
  const obj = await chrome.storage.local.get({ history: [] });
  /** @type {GistHistoryEntry[]} */
  const history = obj.history;

  if (history.length === 0) {
    els.history.innerHTML = '<div class="history-empty">no gists yet — right-click a link and pick "gist this link"</div>';
    return;
  }

  els.history.innerHTML = history.map((h, i) => {
    const verdictClass = h.is_clickbait ? 'bait' : 'legit';
    const verdictText = h.is_clickbait ? '⚠ clickbait' : '✓ legit';
    const summary = (h.summary || []).map((s) => `<li>${escapeHTML(s)}</li>`).join('');
    return `
      <div class="hist-entry">
        <div class="hist-head" data-idx="${i}">
          <span class="hist-verdict ${verdictClass}">${verdictText}</span>
          <span class="hist-title">${escapeHTML(h.title || h.url)}</span>
          <span class="hist-meta">${escapeHTML(h.hostname || '')}</span>
          <span class="hist-meta">${relativeTime(h.timestamp)}</span>
        </div>
        <div class="hist-body" data-body="${i}" hidden>
          ${h.anchorText ? `<div class="hist-anchor">anchor: "${escapeHTML(h.anchorText)}"</div>` : ''}
          ${h.clickbait_reason ? `<div class="hist-reason">${escapeHTML(h.clickbait_reason)}</div>` : ''}
          <ul class="hist-summary">${summary}</ul>
          <a class="hist-open" href="${escapeHTML(h.url)}" target="_blank" rel="noopener noreferrer">open the link →</a>
        </div>
      </div>
    `;
  }).join('');

  els.history.querySelectorAll('.hist-head').forEach((head) => {
    head.addEventListener('click', () => {
      const idx = /** @type {HTMLElement} */ (head).dataset.idx;
      const body = els.history.querySelector(`[data-body="${idx}"]`);
      if (body instanceof HTMLElement) {
        body.hidden = !body.hidden;
      }
    });
  });
}

async function clearHistory() {
  if (!confirm('clear all gist history?')) return;
  await chrome.storage.local.set({ history: [] });
  loadHistory();
}

/**
 * Set a <select>'s value, adding it as a "(custom)" option if it wasn't in
 * the predefined list. Ensures we never silently change a saved model.
 * @param {HTMLSelectElement} select
 * @param {string} value
 */
function setSelectValue(select, value) {
  if (!value) return;
  const exists = Array.from(select.options).some((o) => o.value === value);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${value} (custom)`;
    select.appendChild(opt);
  }
  select.value = value;
}

function syncVendorVisibility() {
  const els = getEls();
  const isOpenAI = els.pOpenai.checked;
  els.anthropicFs.style.display = isOpenAI ? 'none' : '';
  els.openaiFs.style.display = isOpenAI ? '' : 'none';
}

async function load() {
  const els = getEls();
  const cfg = /** @type {GistSettings} */ (await chrome.storage.sync.get(DEFAULTS));
  els.pAnthropic.checked = cfg.provider !== 'openai';
  els.pOpenai.checked = cfg.provider === 'openai';
  els.anthropicKey.value = cfg.anthropicKey || '';
  els.openaiKey.value = cfg.openaiKey || '';
  setSelectValue(els.anthropicModel, cfg.anthropicModel || DEFAULTS.anthropicModel);
  setSelectValue(els.openaiModel, cfg.openaiModel || DEFAULTS.openaiModel);
  els.skipDomains.value = (cfg.skipDomains || []).join('\n');
  els.autoRun.checked = cfg.autoRun === true;
  els.hostileTakeover.checked = cfg.hostileTakeover !== false;
  syncSubOptionState();
  syncVendorVisibility();
}

function syncSubOptionState() {
  const els = getEls();
  els.autoRunSub.classList.toggle('disabled', !els.autoRun.checked);
}

async function save() {
  const els = getEls();
  /** @type {GistSettings} */
  const next = {
    provider: els.pOpenai.checked ? 'openai' : 'anthropic',
    anthropicKey: els.anthropicKey.value.trim(),
    openaiKey: els.openaiKey.value.trim(),
    anthropicModel: els.anthropicModel.value.trim() || DEFAULTS.anthropicModel,
    openaiModel: els.openaiModel.value.trim() || DEFAULTS.openaiModel,
    skipDomains: els.skipDomains.value
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    autoRun: els.autoRun.checked,
    hostileTakeover: els.hostileTakeover.checked,
  };
  await chrome.storage.sync.set(next);
  flashStatus('saved ✓', 'ok');
}

/**
 * @param {string} msg
 * @param {string} [cls]
 */
function flashStatus(msg, cls = '') {
  const el = getEls().status;
  el.textContent = msg;
  el.className = 'status ' + cls;
  setTimeout(() => {
    el.textContent = '';
    el.className = 'status';
  }, 2200);
}

/**
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} input
 */
function wireShowToggle(button, input) {
  button.addEventListener('click', () => {
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    button.textContent = isPwd ? 'hide' : 'show';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const els = getEls();
  load();
  loadHistory();
  els.save.addEventListener('click', save);
  els.clearHistory.addEventListener('click', clearHistory);
  els.autoRun.addEventListener('change', syncSubOptionState);
  els.pAnthropic.addEventListener('change', syncVendorVisibility);
  els.pOpenai.addEventListener('change', syncVendorVisibility);
  wireShowToggle(els.anthropicShow, els.anthropicKey);
  wireShowToggle(els.openaiShow, els.openaiKey);
});
