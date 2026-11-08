#!/usr/bin/env node
// Headless network race: N browsers' races in one process, each with the bot on its own car and
// the others as puppets (source/net/puppets.js), samples passed with a delay as the lobby would.
// Prints, per second, how far each puppet is from the car it stands for, and the HUD positions.
//   node tools/check-multiplayer.mjs [--players 3] [--seconds 40] [--etappe 0] [--latency 4] [--json out.json]
// Needs about 300 MB of memory per player.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vfs } from '../source/host/vfs.js';
import { Race } from '../source/host/race.js';
import { pinRace } from '../source/host/race-setup.js';
import { GameInput } from '../source/input/keyboard.js';
import { Bot } from '../source/dev/bot.js';
import { NetRace } from '../source/net/puppets.js';
import { prepareRaceFiles } from '../source/net/race-files.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, def) => {
  const k = process.argv.indexOf('--' + name);
  return k < 0 ? def : process.argv[k + 1];
};
const N = Number(opt('players', 3));
const SECONDS = Number(opt('seconds', 40));
const ETAPPE = Number(opt('etappe', 0));
const LATENCY = Number(opt('latency', 4));
const CARS = (opt('cars', '') || '0,3,1,5,2,6,4,7').split(',').map(Number);
const installDir = join(ROOT, 'public/assets/game');
const gameDir = join(ROOT, 'public/game');
const meta = JSON.parse(readFileSync(join(gameDir, 'spel.meta.json'), 'utf8'));
const module = new WebAssembly.Module(readFileSync(join(gameDir, 'spel.wasm')));
const dt = 1 / 60;
let tick = 0;
const clock = () => tick * dt;
const players = Array.from({ length: N }, (_, k) => ({ id: 'p' + k, nick: 'P' + k, car: CARS[k % CARS.length], grid: k }));

const sims = [];
for (const me of players) {
  const vfs = new Vfs();
  for (const name of readdirSync(installDir)) {
    const p = join(installDir, name);
    if (statSync(p).isFile()) vfs.addLazy(name, statSync(p).size, () => readFileSync(p));
  }
  pinRace(vfs, { etappe: ETAPPE, car: me.car, laps: 2 });
  const net = new NetRace({ me: me.id, players }, clock);
  const files = prepareRaceFiles(vfs, { localCar: me.car, remoteCars: net.remoteCars });
  const host = {
    vfs, render: new Proxy({}, { get: () => () => {} }), audio: null, screen: { width: 640, height: 480 }, tickSeconds: dt,
    clockStart: 1, fixedDate: 971434016000, onFlip() {}, onMessageBox: (c, t) => console.log(me.id, 'message', c, t), onStdout() {},
  };
  const race = new Race(meta, host);
  await race.instantiate(module);
  const input = new GameInput(race.m);
  host.input = input;
  net.attach(race);
  race.boot();
  net.boot();
  sims.push({ me, race, input, net, bot: new Bot(race, input), files, queue: [] });
  console.log(me.id, 'car', me.car, 'booted: racers', net.nrOpp, 'puppets', net.puppets.size, 'grid', me.grid);
}

const rows = [];
let worst = 0;
for (; tick < SECONDS * 60; tick++) {
  for (const s of sims) {
    // Samples that have crossed the network by now.
    while (s.queue.length && s.queue[0].at <= tick) {
      const q = s.queue.shift();
      s.net.receive(q.from, q.sample);
    }
    s.bot.tick();
    if (!s.race.tick(dt)) throw new Error(s.me.id + ' race ended at ' + tick);
    s.input.endTick();
  }
  if (tick % 2 === 0) {
    for (const s of sims) {
      const sample = JSON.parse(JSON.stringify(s.net.sample()));
      for (const o of sims) if (o !== s) o.queue.push({ at: tick + LATENCY, from: s.me.id, sample });
    }
  }
  if (tick % 60 === 59) {
    // How far each puppet is from the real car it stands for, at the same moment.
    const row = { t: (tick + 1) / 60, err: {}, pos: {}, speed: {} };
    for (const s of sims) {
      row.pos[s.me.id] = s.net.position() + 1;
      const own = s.net.read(s.net.local).p;
      row.speed[s.me.id] = Math.round(s.race.m.view.getFloat32(s.net.car(s.net.local) + 0xC4, true));
      for (const o of sims) {
        if (o === s) continue;
        const p = o.net.puppets.get(s.me.id);
        const at = o.net.read(p.obj).p;
        const e = Math.hypot(at[0] - own[0], at[1] - own[1], at[2] - own[2]);
        row.err[`${s.me.id}@${o.me.id}`] = Math.round(e * 10) / 10;
        if (row.t > 3) worst = Math.max(worst, e);
      }
    }
    rows.push(row);
    const errs = Object.values(row.err);
    console.log(String(row.t).padStart(4), 'positions', JSON.stringify(row.pos), 'speed', JSON.stringify(row.speed), 'puppet error max', Math.max(...errs).toFixed(1), 'mean', (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1));
  }
}
console.log('worst puppet error after 3 s, world units (10 = 1 m):', worst.toFixed(1));
for (const s of sims) s.files.restore();
const out = opt('json', '');
if (out) writeFileSync(out, JSON.stringify({ players: N, latencyTicks: LATENCY, etappe: ETAPPE, worst, rows }, null, 1));
