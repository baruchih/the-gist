// Renders icons/icon.svg to icon-{16,48,128}.png. Run via `npm run icons`.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const svg = readFileSync(join(root, 'icons/icon.svg'));

for (const size of [16, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
  const out = join(root, `icons/icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`✓ icons/icon-${size}.png (${png.length} bytes)`);
}
