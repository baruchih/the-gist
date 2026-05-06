// Generates Chrome Web Store screenshots from the static demo HTML files
// in screenshots/. Run via `npm run screenshots`.
//
// Sources:
//   demo-news.html      — news homepage with three overlay states (right-click
//                         menu, clickbait panel, legit panel) toggled per shot
//   demo-takeover.html  — full-page brutalist takeover screen
//   options.html        — the real options page, loaded with chrome.storage
//                         stubbed via addInitScript so it renders standalone
//
// Output: screenshots/output/*.png at 1280x800 with 2x DPR (gitignored).

import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

/**
 * Take a screenshot and write it as 24-bit PNG (no alpha channel).
 * The Chrome Web Store rejects 32-bit / RGBA PNGs.
 * @param {import('playwright').Page} page
 * @param {string} path
 */
async function shoot(page, path) {
  const buf = await page.screenshot({ omitBackground: false });
  const out = await sharp(buf).removeAlpha().png().toBuffer();
  await writeFile(path, out);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const demosDir = join(root, 'screenshots');
const outDir = join(root, 'screenshots', 'output');
mkdirSync(outDir, { recursive: true });

// Chrome Web Store requires exact pixel dimensions — 1280x800 (or 640x400).
// Promo tiles are 440x280 and 1400x560 exactly. We render at 1x DPR so the
// PNG dimensions match the store's spec; the store will reject larger.
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 1;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE,
});
const page = await context.newPage();

// ---- News homepage with overlays -------------------------------------------

const newsUrl = 'file://' + join(demosDir, 'demo-news.html');

/** @param {'menu'|'clickbait'|'legit'} overlay @param {string} name */
async function shotNews(overlay, name) {
  await page.goto(newsUrl, { waitUntil: 'networkidle' });
  // Position the right-click menu over the bait card (so it looks like the
  // user just right-clicked it). We measure the card's location at runtime
  // and place the menu top-left at the rough click point.
  if (overlay === 'menu') {
    await page.evaluate(() => {
      const card = document.getElementById('bait-card');
      const menu = document.querySelector('[data-overlay="menu"]');
      if (card && menu instanceof HTMLElement) {
        const rect = card.getBoundingClientRect();
        // Place menu at ~40% across the card, 30% down — feels like a
        // realistic click point.
        menu.style.left = (rect.left + rect.width * 0.4) + 'px';
        menu.style.top = (rect.top + rect.height * 0.3) + 'px';
      }
    });
  }
  await page.evaluate((o) => {
    document.querySelectorAll('[data-overlay]').forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = el.dataset.overlay !== o;
    });
  }, overlay);
  await page.waitForTimeout(400);
  const out = join(outDir, `${name}.png`);
  await shoot(page, out);
  console.log(`✓ ${out}`);
}

await shotNews('menu', 'rightclick-menu');
await shotNews('clickbait', 'panel-clickbait');
await shotNews('legit', 'panel-legit');

// ---- Takeover -------------------------------------------------------------

await page.goto('file://' + join(demosDir, 'demo-takeover.html'), {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(800); // let Google Fonts settle
const takeoverOut = join(outDir, 'takeover.png');
await shoot(page, takeoverOut);
console.log(`✓ ${takeoverOut}`);

// ---- Options page ---------------------------------------------------------
// Stub chrome.* APIs so options.html runs outside the extension. We pre-fill
// realistic settings + sample history so the screenshot looks lived-in.

const FAKE_HISTORY = [
  {
    url: 'https://apple.com/tv-plus/mariner',
    title: 'Apple TV+\'s "Mariner" becomes 2026\'s surprise sci-fi hit',
    hostname: 'apple.com',
    language: 'en',
    is_clickbait: true,
    summary: [
      'Mariner is an 8-episode Apple TV+ original sci-fi drama.',
      'Critics praise the slow-burn pacing and grounded performances.',
      'Currently #1 on Apple TV+ charts in 14 countries.',
    ],
    clickbait_reason: 'Pattern A — curiosity gap. The headline withholds the show\'s name to manufacture a click.',
    anchorText: 'The TV show everyone\'s calling \'unmissable\' this week',
    timestamp: Date.now() - 1000 * 60 * 12,
  },
  {
    url: 'https://stanford.edu/research/feed-algorithms',
    title: 'Six-month study tracks how feed algorithms shape what 12,000 readers actually read',
    hostname: 'stanford.edu',
    language: 'en',
    is_clickbait: false,
    summary: [
      'Six-month observational study tracking actual reading behavior across 12,000 participants.',
      'Light personalization broadens the news diet by ~22% versus a chronological feed.',
      'Past a tuning threshold, the same systems narrow the diet by up to 40%.',
    ],
    clickbait_reason: null,
    timestamp: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    url: 'https://techreview.example/earbuds-12-tested',
    title: 'Soundcore Liberty 4 NC ranked #1 in our 12-earbud test, beating the Sony XM5',
    hostname: 'techreview.example',
    language: 'en',
    is_clickbait: true,
    summary: [
      'Soundcore Liberty 4 NC takes the top spot in a 12-product comparison.',
      'Beats Sony WF-1000XM5 on noise cancellation in identical test conditions.',
      'Price: $99 versus $300 for the Sony flagship.',
    ],
    clickbait_reason: 'Pattern A — cliffhanger phrasing. "Number 7 will surprise you" withholds which product and what\'s surprising.',
    anchorText: 'We tested 12 wireless earbuds — number 7 will surprise you',
    timestamp: Date.now() - 1000 * 60 * 60 * 28,
  },
];

const FAKE_SETTINGS = {
  provider: 'openai',
  openaiKey: 'sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4.1-mini',
  autoRun: false,
  hostileTakeover: true,
  skipDomains: ['mail.example.com', 'app.example.com'],
};

await page.addInitScript(({ settings, history }) => {
  /** @type {any} */
  const w = /** @type {any} */ (window);
  w.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...settings }),
        set: async () => {},
      },
      local: {
        get: async (defaults) => ({ ...defaults, history }),
        set: async () => {},
      },
    },
  };
  w.LanguageModel = { availability: async () => 'available' };
}, { settings: FAKE_SETTINGS, history: FAKE_HISTORY });

await page.goto('file://' + join(root, 'options.html'), { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const optionsOut = join(outDir, 'options.png');
await shoot(page, optionsOut);
console.log(`✓ ${optionsOut}`);

// Scroll the Recent gists fieldset to the top of the viewport (a bit of
// breathing room so the legend isn't clipped).
await page.evaluate(() => {
  const target = document.getElementById('history');
  const fieldset = target?.closest('fieldset');
  if (fieldset) {
    const y = fieldset.getBoundingClientRect().top + window.scrollY - 32;
    window.scrollTo({ top: y, behavior: 'instant' });
  }
});
await page.waitForTimeout(300);
const historyOut = join(outDir, 'history.png');
await shoot(page, historyOut);
console.log(`✓ ${historyOut}`);

// ---- Promo tiles ----------------------------------------------------------
// Different viewport sizes — Chrome Web Store specs:
//   small promo:    440 x 280
//   marquee promo: 1400 x 560
// We capture each at its native size with 2x DPR for retina-grade output.

const promos = [
  { file: 'promo-small.html',    name: 'promo-small',    width: 440,  height: 280 },
  { file: 'promo-marquee.html',  name: 'promo-marquee',  width: 1400, height: 560 },
];

for (const promo of promos) {
  await page.setViewportSize({ width: promo.width, height: promo.height });
  await page.goto('file://' + join(demosDir, promo.file), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800); // Google Fonts settle
  const out = join(outDir, `${promo.name}.png`);
  await shoot(page, out);
  console.log(`✓ ${out}`);
}

await browser.close();
console.log(`\nGenerated 6 screenshots and 2 promo tiles in screenshots/output/`);
