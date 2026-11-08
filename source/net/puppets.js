// Other humans' cars in this browser's race. spel.dat has one human and up to six AI racers,
// so each other human takes an AI racer slot whose per-tick handler is swapped for one that
// leaves out the AI (FUN_00419600 without FUN_0040d490, FUN_00412570, FUN_0041a300) and moves
// the car to where its human's browser says it is: the vehicle teleport the reset key uses
// (vtable +0xC, FUN_004a2d70), then the body speed from the sample, so that the physics step
// carries it on and a collision with the local car meets a moving car. An eighth player gets a
// car made outside the racer table with the racers' own function FUN_0042a3d0.
//
// Every browser runs its own race: traffic, police and pickups are local. What is shared is
// each human's car pose, speed, chunk and progress, about 30 times a second.
import { MAX_RACER_SLOTS, EXTRA_CAR_NAME } from './race-files.js';

const A = {
  CARS: 0x715e50, OBJS: 0x73b0d0, PLAYER_OBJ: 0x6fba58, NR_OPP: 0x5d2ab0, RACERS: 0x5ce9e8,
  PLAYER_CHUNKS: 0x6fbab4, PLAYER_FINISHED: 0x6fba98, STARTED: 0x6fba9c, PLAYER_POS: 0x6fbaa4,
  START_CHUNK: 0x6fb8ac, BRAKE: 0x6fbac0, BRAKE_LIGHT: 0x6fba2c, CHUNKS_PER_LAP: 0x715f04, LAPS: 0x6fb8fc,
  DIR_A: 0x6fb8e8, DIR_B: 0x6fb954, PHYS_SCALE: 0x5af184, VIEW: 0x73b434, PROJ: 0x73b3f4,
};
const RACER_STRIDE = 0x294;
const RACER_CHUNKS = 0x50;
const CAR_STRIDE = 0xF0;
const OBJ_STRIDE = 0xA9;
// Car record: +0x6C the handler, +0x34, +0x38 chunk, +0x3C waypoint, +0x50 side (FUN_0042a3d0).
const HANDLER = 0x6c;
const ROUTE_FIELDS = [0x34, 0x38, 0x3c, 0x50];
const FN = {
  WHEELS: 0x435470, FORMAT: 0x49df90, CAR_ROW: 0x424660, CAR_LIST: 0x5d3458, WRAP_CHUNK: 0x4a71e0,
  CREATE_CAR: 0x42a3d0, COLLIDE: 0x44f970, NOOP: 0x42de50, CAR_PARTS: 0x4353e0, BEHIND: 0x412130,
};
/** The extra car's grid place: one behind the player's NrOpponents. */
const EXTRA_GRID = MAX_RACER_SLOTS + 1;
// Smoothing of other cars: how far a sample is carried forward, when it is too old to trust,
// how fast a correction fades per tick, and from what distance a car jumps instead (world units).
const MAX_LEAD = 0.25;
const STALE = 1.0;
const FADE = 0.82;
const SNAP = 60;
const TURN = 0.35;
// Seconds added to a sample's age when carrying it on: what the physics step after a teleport
// moves a car is less than a tick of its speed. Measured with tools/check-multiplayer.mjs.
const LEAD_BIAS = -0.0075;

function quatFromRows(r) {
  // Rows right, up, forward of a D3D world matrix: a rotation matrix by rows.
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = r;
  const t = m00 + m11 + m22;
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (m12 - m21) / s; y = (m20 - m02) / s; z = (m01 - m10) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m12 - m21) / s; x = 0.25 * s; y = (m10 + m01) / s; z = (m20 + m02) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m20 - m02) / s; x = (m10 + m01) / s; y = 0.25 * s; z = (m21 + m12) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m01 - m10) / s; x = (m20 + m02) / s; y = (m21 + m12) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

function rowsFromQuat([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) {
    const q = a.map((v, k) => v + (s * b[k] - v) * t);
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - t) * th) / Math.sin(th);
  const sb = (Math.sin(t * th) / Math.sin(th)) * s;
  return a.map((v, k) => v * sa + b[k] * sb);
}

const round = (v, k) => Math.round(v * k) / k;

export class NetRace {
  /**
   * setup: { me, players: [{ id, nick, car, grid }] } with grid 0..7, the same in every browser.
   * clock(): the room's shared time in seconds.
   */
  constructor(setup, clock) {
    this.setup = setup;
    this.clock = clock;
    this.me = setup.players.find((p) => p.id === setup.me);
    this.remotes = setup.players.filter((p) => p.id !== setup.me).sort((a, b) => a.grid - b.grid);
    this.puppets = new Map();
    this.byObj = new Map();
    this.finished = false;
    this.tickCount = 0;
  }

  /** The cars of the race's files: which car each racer slot was made with. remoteCars order. */
  get remoteCars() {
    return this.remotes.map((p) => p.car);
  }

  get m() {
    return this.race.m;
  }

  car(o) {
    return this.m.u32[A.CARS >> 2] + o * CAR_STRIDE;
  }

  obj(o) {
    return this.m.u32[A.OBJS >> 2] + this.m.view.getInt32(this.car(o) + 0x24, true) * OBJ_STRIDE;
  }

  phys(o) {
    return this.m.u32[(this.car(o) + 0x10) >> 2];
  }

  core(wrapper) {
    return this.m.u32[(this.m.u32[(wrapper + 8) >> 2] + 0xA4) >> 2];
  }

  /** Pose and route fields of car o: rows of its world matrix, position, chunk fields. */
  read(o) {
    const v = this.m.view;
    const obj = this.obj(o);
    const rows = [];
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) rows.push(v.getFloat32(obj + 0x10 + k * 4, true));
    const p = [12, 13, 14].map((k) => v.getFloat32(obj + 0x10 + k * 4, true));
    const rec = this.car(o);
    return { rows, p, route: ROUTE_FIELDS.map((f) => v.getInt32(rec + f, true)) };
  }

  /** Teleports car o: the reset key's vehicle teleport, then the body and wheel speeds. */
  beam(o, p, rows, vel, rot) {
    const { m } = this;
    const v = m.view;
    const s = this.scratch;
    for (let k = 0; k < 3; k++) v.setFloat32(s + k * 4, p[k], true);
    const mat = s + 16;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) v.setFloat32(mat + (r * 4 + c) * 4, rows[r * 3 + c], true);
      v.setFloat32(mat + (r * 4 + 3) * 4, 0, true);
    }
    for (let k = 0; k < 3; k++) v.setFloat32(mat + (12 + k) * 4, p[k], true);
    v.setFloat32(mat + 15 * 4, 1, true);
    const phys = this.phys(o);
    m.call(m.u32[(m.u32[phys >> 2] + 0xC) >> 2], [s, mat], phys);
    const core = this.core(phys);
    for (let k = 0; k < 3; k++) {
      v.setFloat32(core + 0xA4 + k * 4, vel ? vel[k] : 0, true);
      v.setFloat32(core + 0x94 + k * 4, rot ? rot[k] : 0, true);
    }
    for (let w = 0; w < 4; w++) {
      const wc = this.core(m.u32[(phys + 0x34 + w * 4) >> 2]);
      for (let k = 0; k < 3; k++) v.setFloat32(wc + 0xA4 + k * 4, vel ? vel[k] : 0, true);
    }
  }

  setRoute(o, route) {
    const v = this.m.view;
    const rec = this.car(o);
    ROUTE_FIELDS.forEach((f, k) => v.setInt32(rec + f, route[k], true));
  }

  /** After Race.instantiate: nothing yet, the cars exist only after boot. */
  attach(race) {
    this.race = race;
  }

  /** After Race.boot: the grid, the puppets, the local car on its own grid place. */
  boot() {
    const { m } = this;
    this.scratch = m.lowAlloc(128);
    this.local = m.i32[A.PLAYER_OBJ >> 2];
    this.nrOpp = m.i32[A.NR_OPP >> 2];
    this.scale = m.f32[A.PHYS_SCALE >> 2] || 0.1;
    this.chunksPerLap = m.i32[A.CHUNKS_PER_LAP >> 2];
    this.laps = m.i32[A.LAPS >> 2];
    const thunk = m.makeThunk('net!puppet', 0, (esp) => this.handle(m.u32[(esp + 4) >> 2]));
    // Grid places as the game laid them out: racer r on place r, the player on NrOpponents.
    const grid = new Map();
    const slots = [];
    for (let r = 0; r < this.nrOpp; r++) {
      const o = m.i32[(A.RACERS + r * RACER_STRIDE) >> 2];
      slots.push(o);
      grid.set(r, this.read(o));
    }
    grid.set(this.nrOpp, this.read(this.local));
    if (this.remotes.length > this.nrOpp) {
      const extra = this.createCar(EXTRA_CAR_NAME, EXTRA_GRID, thunk);
      slots.push(extra);
      grid.set(EXTRA_GRID, this.read(extra));
    }
    this.grid = grid;
    this.remotes.forEach((p, k) => {
      const o = slots[k];
      if (o === undefined) return;
      const place = grid.get(p.grid) || grid.get(k);
      const puppet = { player: p, obj: o, racer: k < this.nrOpp ? k : -1, place, sample: null, off: [0, 0, 0], q: quatFromRows(place.rows), pos: place.p.slice(), gone: false, braking: 0 };
      this.puppets.set(p.id, puppet);
      this.byObj.set(o, puppet);
      if (k < this.nrOpp) m.u32[(this.car(o) + HANDLER) >> 2] = thunk;
    });
    // The local car to its own place, with the chunk count a racer on that place starts with.
    const mine = grid.get(this.me.grid);
    if (mine && this.me.grid !== this.nrOpp) {
      this.beam(this.local, mine.p, mine.rows, null, null);
      this.setRoute(this.local, mine.route);
      m.i32[A.PLAYER_CHUNKS >> 2] = this.nrOpp - this.me.grid;
    }
    this.startChunks = this.nrOpp - this.me.grid;
  }

  /** FUN_0042de60's body for one car, outside the racer table: car_cfg row refName on grid place `place`. */
  createCar(refName, place, handler) {
    const { m } = this;
    const name = m.lowAlloc(16);
    const text = m.lowAlloc(refName.length + 1);
    m.writeCStr(text, refName);
    m.call(FN.FORMAT, [name, text]);
    const row = m.call(FN.CAR_ROW, [name], FN.CAR_LIST);
    const carType = m.u32[(row + 0x44) >> 2];
    const chunk = m.call(FN.WRAP_CHUNK, [m.i32[A.START_CHUNK >> 2] - place]);
    const a = m.i32[A.DIR_A >> 2];
    const b = m.i32[A.DIR_B >> 2];
    const dir = a === 0 ? (b !== 1 ? 1 : 0) : (b === 1 ? 1 : 0);
    // The name goes by value, and FUN_0042a3d0 releases it.
    const words = [0, 1, 2, 3].map((k) => m.u32[(name >> 2) + k]);
    const o = m.call(FN.CREATE_CAR, [...words, chunk, place & 1, dir, 1, handler, FN.COLLIDE, 3, FN.NOOP]);
    const rec = this.car(o);
    m.u32[(rec + 0x60) >> 2] = 0;
    m.u32[(rec + 0x1c) >> 2] |= 3;
    m.call(FN.CAR_PARTS, [carType, o]);
    m.u32[(rec + 0x68) >> 2] = 1;
    return o;
  }

  /** The swapped handler: place the car, then the wheel and light visuals of FUN_00419600. */
  handle(o) {
    const p = this.byObj.get(o);
    if (p) {
      this.place(p);
      this.m.call(FN.WHEELS, [o, p.braking]);
    }
    return 1;
  }

  place(p) {
    const now = this.clock();
    if (p.gone) {
      // Out of the way, below its grid place: the human left the race.
      const at = p.place.p.slice();
      at[1] -= 5000;
      this.beam(p.obj, at, p.place.rows, null, null);
      return;
    }
    const s = p.sample;
    if (!s) {
      this.beam(p.obj, p.place.p, p.place.rows, null, null);
      return;
    }
    const live = now - s.ts < STALE;
    for (let k = 0; k < 3; k++) p.off[k] *= FADE;
    const pred = this.predict(s, now);
    const pos = [0, 1, 2].map((k) => pred[k] + p.off[k]);
    p.q = slerp(p.q, s.q, TURN);
    p.pos = pos;
    this.beam(p.obj, pos, rowsFromQuat(p.q), live ? s.v : null, live ? s.w : null);
    this.setRoute(p.obj, s.c);
    if (p.racer >= 0) this.m.i32[(A.RACERS + p.racer * RACER_STRIDE + RACER_CHUNKS) >> 2] = s.d;
    p.braking = s.b ? 1 : 0;
  }

  /** Where sample s puts its car at time t, carried on by its speed for at most MAX_LEAD. */
  predict(s, t) {
    const age = t - s.ts;
    const lead = age < STALE ? Math.min(MAX_LEAD, Math.max(0, age)) + LEAD_BIAS : 0;
    return [0, 1, 2].map((k) => s.p[k] + s.vw[k] * lead);
  }

  /** A sample from another browser. */
  receive(id, s) {
    const p = this.puppets.get(id);
    if (!p || !s || !Array.isArray(s.p) || s.p.length !== 3) return;
    if (p.sample && s.ts < p.sample.ts) return;
    const k = 1 / this.scale;
    s.vw = [s.v[0] * k, -s.v[1] * k, s.v[2] * k];
    // Where the old sample draws the car now against where the new one does: that gap fades out.
    const t = this.clock();
    const pred = this.predict(s, t);
    const was = p.sample ? this.predict(p.sample, t).map((x, j) => x + p.off[j]) : null;
    const off = was ? [0, 1, 2].map((j) => was[j] - pred[j]) : [0, 0, 0];
    if (!was || Math.hypot(...off) > SNAP) {
      p.off = [0, 0, 0];
      p.q = s.q.slice();
    } else {
      p.off = off;
    }
    p.sample = s;
    p.player.progress = s.d;
    p.player.finished = Boolean(s.f);
  }

  /** The human left the race or the room. */
  remove(id) {
    const p = this.puppets.get(id);
    if (p) p.gone = true;
  }

  /** The local car, for the others. */
  sample() {
    const { m } = this;
    const v = m.view;
    const s = this.read(this.local);
    const core = this.core(this.phys(this.local));
    const vel = [0, 1, 2].map((k) => round(v.getFloat32(core + 0xA4 + k * 4, true), 1000));
    const rot = [0, 1, 2].map((k) => round(v.getFloat32(core + 0x94 + k * 4, true), 1000));
    const braking = v.getFloat32(A.BRAKE, true) > 0 || m.i32[A.BRAKE_LIGHT >> 2] ? 1 : 0;
    return {
      ts: round(this.clock(), 1000),
      p: s.p.map((x) => round(x, 100)),
      q: quatFromRows(s.rows).map((x) => round(x, 10000)),
      v: vel,
      w: rot,
      c: s.route,
      d: this.progress,
      b: braking,
      f: this.finishedNow ? 1 : 0,
    };
  }

  get progress() {
    return this.m.i32[A.PLAYER_CHUNKS >> 2];
  }

  get finishedNow() {
    return this.m.i32[A.PLAYER_FINISHED >> 2] !== 0;
  }

  /** Lap of a progress value, 1-based: chunks per lap from 0x715f04. */
  lapOf(progress) {
    if (!this.chunksPerLap) return 1;
    return Math.max(1, Math.min(this.laps || 1, Math.floor((progress - this.startChunks) / this.chunksPerLap) + 1));
  }

  /**
   * The HUD's position counts racers only: an eighth player's car is outside the table, so the
   * position goes one down when that car is ahead. Called just before the HUD draws.
   */
  beforeHud() {
    const { m } = this;
    const raw = this.gamePosition();
    const pos = this.position();
    this.hudPos = pos;
    this.rawPos = raw;
    m.i32[A.PLAYER_POS >> 2] = pos;
  }

  /** What FUN_004128a0 left, before beforeHud added the extra car: once per tick only. */
  gamePosition() {
    const now = this.m.i32[A.PLAYER_POS >> 2];
    return this.hudPos !== undefined && now === this.hudPos ? this.rawPos : now;
  }

  /** The local car's 0-based place: the game's, counting the extra car too. */
  position() {
    const { m } = this;
    let pos = this.gamePosition();
    if (m.i32[A.PLAYER_FINISHED >> 2]) return pos;
    for (const p of this.puppets.values()) {
      if (p.racer >= 0 || p.gone || !p.sample) continue;
      const mine = this.progress;
      if (p.sample.d > mine) pos += 1;
      // On the same chunk FUN_004128a0 asks FUN_00412130 whether the other car is behind.
      else if (p.sample.d === mine && this.behind(p.pos) === 0) pos += 1;
    }
    return pos;
  }

  behind(at) {
    const bits = new Uint32Array(new Float32Array(at).buffer);
    return this.m.call(FN.BEHIND, [this.local, bits[0], bits[1], bits[2]]);
  }

  /** Screen positions of the other cars, for their name tags: [{ id, x, y, z }] in clip space. */
  tags() {
    const { m } = this;
    const v = m.view;
    const out = [];
    const view = [];
    const proj = [];
    for (let k = 0; k < 16; k++) {
      view.push(v.getFloat32(A.VIEW + k * 4, true));
      proj.push(v.getFloat32(A.PROJ + k * 4, true));
    }
    for (const p of this.puppets.values()) {
      if (p.gone || !p.sample) continue;
      const w = [p.pos[0], p.pos[1] + 22, p.pos[2], 1];
      const e = [0, 1, 2, 3].map((c) => w[0] * view[c] + w[1] * view[4 + c] + w[2] * view[8 + c] + w[3] * view[12 + c]);
      const c = [0, 1, 2, 3].map((j) => e[0] * proj[j] + e[1] * proj[4 + j] + e[2] * proj[8 + j] + e[3] * proj[12 + j]);
      if (c[3] <= 1) continue;
      out.push({ id: p.player.id, x: c[0] / c[3], y: c[1] / c[3], dist: e[2] });
    }
    return out;
  }
}
