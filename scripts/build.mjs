// Copies the files Chrome actually loads into ./build, ready to be zipped
// and uploaded to the Chrome Web Store (or loaded unpacked from build/).
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build');

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let total = 0;
for (const rel of FILES) {
  const src = join(root, rel);
  const dst = join(out, rel);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  total += statSync(dst).size;
  console.log(`  ${rel}`);
}

console.log(`\n✓ build/ — ${FILES.length} files, ${(total / 1024).toFixed(1)} KB`);
