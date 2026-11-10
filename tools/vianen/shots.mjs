#!/usr/bin/env node
// Screenshots of the Vianen etappe as the bot drives it: at chunks given (default the start, the
// Stadhuis, the Lekpoort, the dike, the Grote Kerk). Needs npm start.
//   node tools/vianen/shots.mjs [--etappe 3] [--url http://127.0.0.1:4180/] [--out evidence/vianen] [--chunks 12,19,26,33,70]
import { chromium } from 'playwright';
const opt = (n, d) => { const k = process.argv.indexOf('--' + n); return k < 0 ? d : process.argv[k + 1]; };
const base = opt('url', 'http://127.0.0.1:4180/');
const out = opt('out', 'evidence/vianen');
const chunks = opt('chunks', '12,19,26,33,70').split(',').filter(Boolean).map(Number);
// --etappe 3: Wenen as Vianen; default the Vianen sketch.
const etappe = opt('etappe', 'vianen');
const prefix = opt('prefix', etappe === 'vianen' ? 'chunk' : `e${etappe}-chunk`);
const viewsFile = opt('views', '');
// Close views need the car to stay before the building while its camera is overridden: the
// original game still culls track planes against the car's own camera before the renderer.
const speed = opt('speed', viewsFile ? '1' : '4');
// --browser /path/to/chrome: reuse an installed Chromium when the pinned download is unavailable.
const browser = await chromium.launch({ executablePath: opt('browser', undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}?race=1&etappe=${etappe}&car=3&bot=1&speed=${speed}`);
await page.waitForFunction(() => window.__bot && window.__bot.state, null, { timeout: 90000 });
await page.evaluate(() => window.__app.settings.set('fullscreen', false));
for (const c of chunks) {
  await page.waitForFunction((c) => window.__bot.state && window.__bot.state.chunk === c, c, { timeout: 120000 });
  await page.screenshot({ path: `${out}/${prefix}-${c}.png` });
  console.log('chunk', c, await page.evaluate(() => window.__bot.state.speed.toFixed(1)));
}
// --views views.json: [{name, chunk, eye: [x,y,z], at: [x,y,z]}], a fixed camera at each, once
// the bot is near (the game draws only chunks near the car). Written by build-track.py with
// VIANEN_VIEWS=path.
if (viewsFile) {
  const { readFileSync } = await import('node:fs');
  for (const v of JSON.parse(readFileSync(viewsFile, 'utf8'))) {
    await page.waitForFunction((c) => window.__bot.state && Math.abs(window.__bot.state.chunk - c) <= 2, v.chunk, { timeout: 150000 });
    await page.evaluate(({ eye, at }) => {
      const sub = (a, b) => a.map((x, k) => x - b[k]);
      const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const z = norm(sub(at, eye)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
      globalThis.__viewOverride = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    }, v);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/view-${v.name}.png` });
    await page.evaluate(() => { globalThis.__viewOverride = null; });
    console.log('view', v.name);
  }
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exitCode = 1;
