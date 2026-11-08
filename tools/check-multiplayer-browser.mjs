#!/usr/bin/env node
// A network race in headless Chromium: one page hosts a named server, the others find it in the
// list and join, all say ready, the host starts, and the bot drives every car. Checks that each
// page runs the race with the others as puppets that follow them, then that all come back to the
// room with results. Needs `npm start` running and a fresh bundle, like the other browser checks.
//   node tools/check-multiplayer-browser.mjs [--peer] [--byname] [--players 3] [--seconds 40] [--laps 1] [--url http://127.0.0.1:4180/] [--out evidence/multiplayer]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const opt = (name, def) => {
  const k = process.argv.indexOf('--' + name);
  return k < 0 ? def : process.argv[k + 1];
};
const N = Number(opt('players', 3));
const SECONDS = Number(opt('seconds', 40));
const BASE = opt('url', 'http://127.0.0.1:4180/');
const OUT = opt('out', 'evidence/multiplayer');
const CARS = [0, 3, 1, 5, 2, 6, 4, 7];
// --peer: WebRTC through the public PeerJS broker, as on a static site; joined by name.
const PEER = process.argv.includes('--peer');
mkdirSync(OUT, { recursive: true });

const results = { players: N, checks: [] };
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'ok  ' : 'FAIL', name, detail);
};

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const pages = [];
const errors = [];
for (let k = 0; k < N; k++) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`p${k}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`p${k}: ${e.message}`));
  await page.goto(`${BASE}?form=TfrmMainScreen&bot=1${PEER ? '&lobby=peer' : ''}`);
  await page.waitForFunction(() => window.__app && window.__app.menu && window.__app.data && window.__app.data.player);
  await page.evaluate(() => window.__app.settings.set('fullscreen', false));
  pages.push(page);
}

const open = async (page, nick, car) => {
  await page.evaluate(() => window.__app.openMultiplayer());
  await page.fill('#mp-nick', nick);
  await page.evaluate((c) => {
    const ui = window.__app.lobby;
    ui.mineCar = c;
    ui.carSel.value = String(c);
  }, car);
};

const serverName = `Test ${Date.now() % 100000}`;
await open(pages[0], 'Host', CARS[0]);
await pages[0].fill('#mp-server', serverName);
await pages[0].click('button:has-text("Server maken")');
await pages[0].waitForSelector('.mp-room:not([hidden])');
check('host: room open', true, serverName);

for (let k = 1; k < N; k++) {
  const page = pages[k];
  await open(page, `Speler${k}`, CARS[k % CARS.length]);
  // From the list: through the lobby, or with --peer the servers on this network (LanDirectory).
  // --byname types the name instead, as for a server on another network.
  if (process.argv.includes('--byname')) {
    await page.waitForSelector('#mp-join');
    await page.fill('#mp-join', serverName);
    await page.click('.mp-browse .mp-row button:has-text("Meedoen")');
  } else {
    const row = page.locator('.mp-rooms li', { hasText: serverName });
    await row.waitFor({ timeout: 30000 });
    await row.locator('button').click();
  }
  await page.waitForSelector('.mp-room:not([hidden])');
  await page.click('.mp-actions button:has-text("Klaar")');
}
await pages[0].waitForFunction((n) => window.__app.lobby.session.room.players.length === n && window.__app.lobby.session.canStart(), N, { timeout: 15000 });
const roomText = await pages[0].locator('.mp-players').innerText();
check('host: everyone joined and ready', true, roomText.replace(/\s+/g, ' '));
await pages[0].evaluate((laps) => window.__app.lobby.session.setTrack(0, laps, 'Amsterdam'), Number(opt('laps', 1)));
await pages[0].click('button:has-text("Start de race")');

// All pages load, wait for each other, and start together.
await Promise.all(pages.map((p) => p.waitForFunction(() => window.__race && window.__app.runner.mp && window.__app.runner.race && window.__race.m.i32[0x6fba9c >> 2] === 1, null, { timeout: 120000 })));
const starts = await Promise.all(pages.map((p) => p.evaluate(() => window.__app.lobby.session.goClock)));
check('all started from one go time', starts.every((s) => Math.abs(s - starts[0]) < 0.05), starts.map((s) => s.toFixed(3)).join(' '));

const sample = async () => Promise.all(pages.map((p) => p.evaluate(() => {
  const net = window.__app.runner.mp.net;
  const out = { me: net.setup.me, puppets: net.puppets.size, own: net.read(net.local).p, seen: {}, standings: document.querySelector('.net-standings')?.innerText.replace(/\s+/g, ' ') };
  for (const [id, p] of net.puppets) out.seen[id] = { at: net.read(p.obj).p, age: p.sample ? window.__app.lobby.session.clock() - p.sample.ts : null };
  out.pos = net.position() + 1;
  return out;
})));

let worst = 0;
const t0 = Date.now();
let snaps = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await sample();
  const byId = new Map(s.map((x) => [x.me, x]));
  const errs = [];
  for (const x of s) {
    for (const [id, seen] of Object.entries(x.seen)) {
      const real = byId.get(id).own;
      errs.push(Math.hypot(seen.at[0] - real[0], seen.at[1] - real[1], seen.at[2] - real[2]));
    }
  }
  // The pages are sampled one after another, so a car moves on between two reads: this is an upper bound.
  const max = Math.max(...errs);
  worst = Math.max(worst, max);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`, 'positions', s.map((x) => x.pos).join(','), 'puppet gap max', max.toFixed(0), 'standings', s[0].standings);
  if (snaps++ === 1) for (let k = 0; k < N; k++) await pages[k].screenshot({ path: join(OUT, `race-p${k}.png`) });
}
const s = await sample();
check('every page has the others as puppets', s.every((x) => x.puppets === N - 1), s.map((x) => x.puppets).join(','));
check('samples arrive', s.every((x) => Object.values(x.seen).every((v) => v.age !== null && v.age < 1)), s.map((x) => Object.values(x.seen).map((v) => (v.age ?? -1).toFixed(2)).join('/')).join(' '));
check('positions are a permutation', [...s.map((x) => x.pos)].sort((a, b) => a - b).join() === Array.from({ length: N }, (_, k) => k + 1).join(), s.map((x) => x.pos).join(','));
results.worstGap = worst;

// Everyone leaves the race: Esc, then J. Back in the room.
for (const p of pages) {
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__race && window.__race.pause, null, { timeout: 5000 }).catch(() => {});
  await p.keyboard.down('j');
  await p.waitForTimeout(150);
  await p.keyboard.up('j');
}
await Promise.all(pages.map((p) => p.waitForSelector('.mp-room:not([hidden])', { timeout: 30000 })));
await pages[0].waitForFunction(() => window.__app.lobby.session.room.phase === 'lobby', null, { timeout: 10000 });
check('all back in the room, host can race again', true);
await pages[0].screenshot({ path: join(OUT, 'room-after.png') });
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
await browser.close();
process.exit(results.checks.every((c) => c.ok) ? 0 : 1);
