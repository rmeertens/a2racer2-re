#!/usr/bin/env node
// Screenshots of the Vianen etappe as the bot drives it: at chunks given (default the start, the
// Stadhuis, the Lekpoort, the dike, the Grote Kerk). Needs npm start.
//   node tools/vianen/shots.mjs [--url http://127.0.0.1:4180/] [--out evidence/vianen] [--chunks 12,19,26,33,70]
import { chromium } from 'playwright';
const opt = (n, d) => { const k = process.argv.indexOf('--' + n); return k < 0 ? d : process.argv[k + 1]; };
const base = opt('url', 'http://127.0.0.1:4180/');
const out = opt('out', 'evidence/vianen');
const chunks = opt('chunks', '12,19,26,33,70').split(',').map(Number);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}?race=1&etappe=vianen&car=3&bot=1&speed=4`);
await page.waitForFunction(() => window.__bot && window.__bot.state, null, { timeout: 90000 });
await page.evaluate(() => window.__app.settings.set('fullscreen', false));
for (const c of chunks) {
  await page.waitForFunction((c) => window.__bot.state && window.__bot.state.chunk === c, c, { timeout: 120000 }).catch(() => console.log('did not reach chunk', c));
  await page.screenshot({ path: `${out}/chunk-${c}.png` });
  console.log('chunk', c, await page.evaluate(() => window.__bot.state.speed.toFixed(1)));
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
