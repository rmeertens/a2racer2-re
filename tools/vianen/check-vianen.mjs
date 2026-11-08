#!/usr/bin/env node
// Boots the Vianen etappe headless and lets the bot drive it: what it reads, where it gets.
//   node tools/vianen/check-vianen.mjs [--seconds 60] [--opponents 0]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vfs } from '../../source/host/vfs.js';
import { Race } from '../../source/host/race.js';
import { pinRace } from '../../source/host/race-setup.js';
import { GameInput } from '../../source/input/keyboard.js';
import { Bot } from '../../source/dev/bot.js';
import { installVianen, vianenFiles, VIANEN } from '../../source/host/vianen.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const opt = (name, def) => {
  const k = process.argv.indexOf('--' + name);
  return k < 0 ? def : process.argv[k + 1];
};
const installDir = join(ROOT, 'public/assets/game');
const gameDir = join(ROOT, 'public/game');
const meta = JSON.parse(readFileSync(join(gameDir, 'spel.meta.json'), 'utf8'));
const vfs = new Vfs();
for (const name of readdirSync(installDir)) {
  const p = join(installDir, name);
  if (statSync(p).isFile()) vfs.addLazy(name, statSync(p).size, () => readFileSync(p));
}
pinRace(vfs, { etappe: VIANEN.slot, car: 0, laps: 1 });
vfs.iniSet('game.ini', 'OPTIONS', 'OPPONENTS', opt('opponents', '0'));
const files = new Map(vianenFiles().map((n) => [n, new Uint8Array(readFileSync(join(ROOT, 'public/assets/vianen', n)))]));
installVianen(vfs, files);
const reads = new Set();
vfs.onRead = (p) => { if (/vn_|etappe10/.test(p)) reads.add(p); };
const missing = new Set();
vfs.onMissing = (p) => { missing.add(p); return null; };
const dt = 1 / 60;
const host = {
  vfs, render: new Proxy({}, { get: () => () => {} }), audio: null, screen: { width: 640, height: 480 }, tickSeconds: dt, clockStart: 1,
  fixedDate: 971434016000, onFlip() {}, onMessageBox: (c, t) => console.log('MESSAGE', c, t), onStdout() {},
};
const race = new Race(meta, host);
await race.instantiate(new WebAssembly.Module(readFileSync(join(gameDir, 'spel.wasm'))));
const input = new GameInput(race.m);
host.input = input;
race.boot();
console.log('booted. read:', [...reads].join(' '));
if (missing.size) console.log('missing:', [...missing].filter((p) => !/\.(wav)$/.test(p)).slice(0, 20).join(' '));
const m = race.m;
console.log('chunks per lap', m.i32[0x715f04 >> 2], 'start chunk', m.i32[0x6fb8ac >> 2]);
const bot = new Bot(race, input);
for (let tick = 0; tick < Number(opt('seconds', 60)) * 60; tick++) {
  bot.tick();
  if (!race.tick(dt)) { console.log('race ended at', (tick / 60).toFixed(1)); break; }
  input.endTick();
  if (tick % 300 === 0) {
    const s = bot.state;
    console.log(String(tick / 60).padStart(4), 'chunk', s.chunk, 'driven', m.i32[0x6fbab4 >> 2], 'speed', s.speed.toFixed(1), 'pos', s.pos.map((x) => Math.round(x)).join(','), 'finished', m.i32[0x6fba98 >> 2]);
  }
}
