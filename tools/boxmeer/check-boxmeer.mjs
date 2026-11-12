#!/usr/bin/env node
// Boots the Boxmeer etappe headless and lets the bot drive it: what it reads, where it gets.
//   node tools/boxmeer/check-boxmeer.mjs [--seconds 60] [--opponents 0]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vfs } from '../../source/host/vfs.js';
import { Race } from '../../source/host/race.js';
import { pinRace } from '../../source/host/race-setup.js';
import { GameInput } from '../../source/input/keyboard.js';
import { Bot } from '../../source/dev/bot.js';
import { installBoxmeer, boxmeerFiles, BOXMEER } from '../../source/host/boxmeer.js';

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
pinRace(vfs, { etappe: BOXMEER.slot, car: Number(opt('car','0')), laps: Number(opt('laps','1')) });
vfs.iniSet('game.ini', 'OPTIONS', 'OPPONENTS', opt('opponents', '0'));
if(process.argv.includes('--tuned'))for(const key of ['MOTOR','BANDEN','ABS','VERSNELLINGSBAK'])vfs.iniSet('game.ini','PLAYER',key,'1');
const files = new Map(boxmeerFiles().map((n) => [n, new Uint8Array(readFileSync(join(ROOT, 'public/assets/boxmeer', n)))]));
installBoxmeer(vfs, files);
const reads = new Set();
vfs.onRead = (p) => { if (/bm_|etappe11/.test(p)) reads.add(p); };
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
let finished = false;
const snapshots = [];
let finishAttempts=0,finishSeconds=null, peakSpeed=0, speedSum=0, speedTicks=0, slowTicks=0,maximumChassisHeight=0;
for (let tick = 0; tick < Number(opt('seconds', 60)) * 60; tick++) {
  bot.tick();
  if(!finished)maximumChassisHeight=Math.max(maximumChassisHeight,bot.state.pos[1]);
  if(tick>420 && !finished){const speed=Math.abs(bot.state.speed);peakSpeed=Math.max(peakSpeed,speed);speedSum+=speed;speedTicks++;if(speed<3)slowTicks++;}
  if (!race.tick(dt)) { console.log('race ended at', (tick / 60).toFixed(1)); break; }
  input.endTick();
  if (m.i32[0x6fba98 >> 2]) { if(!finished) {finishSeconds=tick/60;finishAttempts=bot.attempts;} finished = true; }
  if (tick % 300 === 0) {
    snapshots.push({ tick, chunk:bot.state.chunk, speed:bot.state.speed, finished:m.i32[0x6fba98 >> 2] });
    const s = bot.state;
    console.log(String(tick / 60).padStart(4), 'chunk', s.chunk, 'driven', m.i32[0x6fbab4 >> 2], 'speed', s.speed.toFixed(1), 'pos', s.pos.map((x) => Math.round(x)).join(','), 'finished', m.i32[0x6fba98 >> 2]);
  }
}

const requiredMissing=[...missing].filter(p=>!/\.wav$/.test(p));
const summary={finished,boundsRecoveries:race.boxmeerBounds?.recoveries||0,requiredMissing,finishSeconds,maximumChassisHeightMetres:maximumChassisHeight/10,peakKmh:peakSpeed*3.6,averageKmh:speedSum/Math.max(1,speedTicks)*3.6,slowSeconds:slowTicks/60,recoveryAttempts:finishAttempts,snapshots};
console.log(JSON.stringify(summary));
if(opt('out',null))writeFileSync(opt('out'),JSON.stringify(summary,null,2));
if(!finished || requiredMissing.length) process.exitCode=1;
