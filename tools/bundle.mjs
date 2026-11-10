#!/usr/bin/env node
// Bundles source/ into public/src/ and copies the page shell.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = join(ROOT, 'public');
mkdirSync(join(out, 'src'), { recursive: true });
await build({
  entryPoints: { main: join(ROOT, 'source/main.js'), 'track-viewer': join(ROOT, 'source/dev/track-viewer.js') },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  outdir: join(out, 'src'),
  legalComments: 'none',
  logLevel: 'warning',
});
cpSync(join(ROOT, 'source/index.html'), join(out, 'index.html'));
cpSync(join(ROOT, 'source/style.css'), join(out, 'src/style.css'));
cpSync(join(ROOT, 'source/track-viewer.html'), join(out, 'track-viewer.html'));
cpSync(join(ROOT, 'source/dev/track-viewer.css'), join(out, 'src/track-viewer.css'));
console.log('bundled source/ to public/src/');
