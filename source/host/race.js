// One run of spel.dat: the original starts the process anew for every race, and so
// does this: a new Race means a new wasm instance. Replaces WinMain 0x00458270, whose
// loop would block the browser: tick() is one pass of that loop.
import { Machine, GameExit } from './machine.js';
import { installWin32, VirtualClock } from './win32.js';
import { installDirectX } from './directx.js';
import { installCoreHooks } from './hooks.js';
import { installVianenImpacts } from './vianen-impacts.js';

class BootDone extends Error {}

const FN = {
  SETTINGS: 0x00448cd0, INIT_MAIN: 0x004580e0, START_GAME: 0x0044cf60,
  HANDLE_GAME: 0x0044cb80, FOG_ZOOM: 0x004517f0, COUNT_FRAME: 0x0044e180,
  PUMP: 0x00458020, COP_RADIO: 0x0041c150, EXIT_MAIN: 0x00458210,
};
const DATA = { RUNNING: 0x006fb89c, COP_RADIO_OBJ: 0x005d3118, SETTINGS_OBJ: 0x006fa558, PAUSE_KIND: 0x006fb8d8, OVERLAY_STATE: 0x0071277c, CLOCK: 0x007128b0, CLOCK_RING: 0x00712868, CLOCK_INDEX: 0x007128c0, TRAFFIC_SHARE: 0x003f1000 };
// The ring's first two samples: the counter's value at clock init (0x004581c1, after the level
// load at 0x004581aa), and the time from init to the first tick, 8.4 ms in the reference runs of
// the original (evidence/reference-wine/results.md). Ticks 1 to 3 then read 0.1 and tick 4 does
// not, as measured there.
const INIT_TO_FIRST_TICK = 0.0084;
// The three race clocks a dialog stops: FUN_0044ca80.
const PAUSED_CLOCKS = [0, 3, 0xb];
const VK = { P: 0x50, ESC: 0x1b, J: 0x4a, Y: 0x59, N: 0x4e };

export class Race {
  /** host: { vfs, render, audio, input, screen, onMessageBox, onStdout } */
  constructor(meta, host) {
    this.meta = meta;
    this.host = host;
    this.m = new Machine(meta);
    this.clock = new VirtualClock();
    host.clock = this.clock;
    this.ended = false;
    this.exitCode = null;
    this.tickSeconds = host.tickSeconds || 1 / 60;
    // GetTickCount seeds rand: start the clock at a varying offset. Tests pass a fixed one.
    this.clock.seconds = host.clockStart ?? (Date.now() % 100000) / 1000 + 1;
  }

  async instantiate(wasm) {
    const { m, host } = this;
    await m.instantiate(wasm);
    m.f32[DATA.TRAFFIC_SHARE >> 2] = Math.min(1, this.tickSeconds * 25);
    installWin32(m, host);
    installDirectX(m, host);
    installCoreHooks(m, host);
    m.bindRaw('hook!WinMain', 16, (esp) => {
      this.winMain = [m.u32[(esp + 4) >> 2], m.u32[(esp + 16) >> 2]];
      throw new BootDone();
    });
    this.installPause();
    // FUN_004a6700 under the fixed tick: see tools/recomp/replacements.py. The 4-entry ring is
    // kept, so the start of a race (dt capped at 0.1 for 3 ticks, by the two samples above) and
    // the return from a dialog read as in the original. Every sample after that is exactly one
    // tick. A steady ring gives dt one tick in its last bit either way, alternating: clock noise
    // puts the original's dt*300 just under or over 5 at 60 ticks per second, so the truncating
    // gas step of FUN_0046f2a0 mixes +4 and +5, and full gas takes 21 to 23 ticks, measured.
    const tick32 = Math.fround(this.tickSeconds);
    const tickBelow = new Float32Array([tick32]);
    new Uint32Array(tickBelow.buffer)[0]--;
    let samples = 0;
    let lowBit = false;
    m.bindRaw('hook!updateClock', 0, () => {
      const { f32 } = m;
      const c = DATA.CLOCK >> 2;
      f32[c + 2] = this.clock.seconds;
      const ring = m.u32[DATA.CLOCK_RING >> 2] >> 2;
      let k = m.i32[DATA.CLOCK_INDEX >> 2];
      m.i32[DATA.CLOCK_INDEX >> 2] = (k + 1) & 3;
      f32[ring + k] = samples === 0 ? this.clock.seconds : samples === 1 ? INIT_TO_FIRST_TICK : tick32;
      samples++;
      let steady = f32[ring + k] === tick32;
      let dt = Math.fround(f32[ring + k] * 0.5);
      let scale = 0.5;
      for (let n = 1; n <= 3; n++) {
        k = (k + 3) & 3;
        if (n < 3) scale *= 0.5;
        if (f32[ring + k] !== tick32) steady = false;
        dt = Math.fround(scale * f32[ring + k] + dt);
      }
      lowBit = !lowBit;
      f32[c + 3] = steady ? (lowBit ? tickBelow[0] : tick32) : dt;
      return 0;
    });
    m.bindRaw('hook!hudDraw', 0, (esp, ecx, edx, eax) => {
      const r = host.render;
      if (r) r.hud = true;
      if (host.hudLayout) host.hudLayout.apply();
      const out = m.__call(0x00484fc0, esp, eax, ecx, edx);
      if (host.hudLayout) host.hudLayout.restore();
      if (r) r.hud = false;
      return out;
    });
    // FUN_00443770 builds the player's shadow in world space from the car's pose at +0x10 of its
    // object (copied at 0x443ab8), the matrix the car is drawn with in the same tick.
    const shadowPose = new Float32Array(16);
    m.bindRaw('hook!playerShadow', 0, (esp, ecx, edx, eax) => {
      const r = host.render;
      if (r && r.beginPlayerShadow) {
        const car = m.u32[0x715e50 >> 2] + m.u32[(esp + 4) >> 2] * 0xf0;
        const obj = m.u32[0x73b0d0 >> 2] + m.view.getInt32(car + 0x24, true) * 0xa9 + 0x10;
        for (let k = 0; k < 16; k++) shadowPose[k] = m.view.getFloat32(obj + k * 4, true);
        r.beginPlayerShadow(shadowPose);
      }
      const out = m.__call(0x00443770, esp, eax, ecx, edx);
      if (r && r.endPlayerShadow) r.endPlayerShadow();
      return out;
    });
    if (host.installHooks) host.installHooks(m, this);
    return this;
  }

  /** FUN_0044ca80 up to the point where the original spins on the keyboard. */
  installPause() {
    const { m } = this;
    m.bindRaw('hook!pauseBegin', 0, () => {
      const kind = m.u32[DATA.PAUSE_KIND >> 2];
      const volume = m.call(0x004ce0d0, [4]);
      m.call(0x004ce030, [4, 0]);
      for (const c of PAUSED_CLOCKS) m.call(0x00448330, [c]);
      m.call(0x0042e440);
      this.pause = { kind, volume, stage: 0, key: -1, scan: 0, seen: false };
      if (this.host.onPauseChange) this.host.onPauseChange(kind);
      return 0;
    });
  }

  /** The keyboard waits of FUN_0044c990 and FUN_0044c9f0, one step per tick. */
  pollPause() {
    const { pause: p } = this;
    const { vk } = this.host.input;
    // FUN_004c5e40: every key reads as up while Shift is down, so Shift alone resumes nothing.
    const down = (k) => vk[k] !== 0 && !vk[0x10];
    if (p.kind === 1) {
      if (p.stage === 0) {
        if (!down(VK.P)) p.stage = 1;
        return;
      }
      if (p.stage === 2) {
        if (down(p.key)) return;
        p.stage = 1;
        p.scan = p.key + 1;
      }
      // One sweep over all VKs waits for each key found down, and the first key ends the pause
      // when its sweep is over. VK 1, 2 and 4 are the mouse buttons.
      for (let k = p.scan; k < 256; k++) {
        if (down(k)) {
          p.key = k;
          p.stage = 2;
          p.seen = true;
          return;
        }
      }
      p.scan = 0;
      if (p.seen) this.endPause();
      return;
    }
    if (p.stage === 0) {
      if (!down(VK.ESC)) p.stage = 1;
    } else if (p.stage === 1) {
      const quit = down(VK.J) || down(VK.Y);
      if (quit) this.m.call(0x0044cda0, [4]);
      if (down(VK.ESC) || down(VK.N)) p.stage = 2;
      else if (quit) this.endPause();
    } else if (!down(VK.ESC)) {
      // Only Esc is waited for here, also after N.
      this.endPause();
    }
  }

  /** The rest of FUN_0044ca80 after its wait. */
  endPause() {
    const { m, pause } = this;
    m.u32[DATA.OVERLAY_STATE >> 2] = 1;
    for (const c of PAUSED_CLOCKS) m.call(0x004483a0, [c]);
    m.call(0x0042e4a0);
    m.call(0x004ce030, [4, pause.volume]);
    m.call(0x004a6840, [], DATA.CLOCK);
    this.pause = null;
    if (this.host.onPauseChange) this.host.onPauseChange(0);
  }

  /** What the HUD shows, and which keys the screen waits for: hud-overlay.md section 8. */
  get overlayState() {
    return this.m.u32[DATA.OVERLAY_STATE >> 2];
  }

  /** CRT start-up, then the part of WinMain before its loop. Blocks until loaded. */
  boot() {
    const { m } = this;
    try {
      m.__call(this.meta.entry, m.layout.STACK_TOP - 64, 0, 0, 0);
    } catch (e) {
      if (!(e instanceof BootDone)) throw e;
    }
    m.esp = m.layout.STACK_TOP - 0x100;
    m.call(FN.SETTINGS, [1], DATA.SETTINGS_OBJ);
    m.call(FN.INIT_MAIN, this.winMain);
    m.call(FN.START_GAME);
    this.m.esp = m.layout.STACK_TOP - 0x100;
    this.vianenImpacts = installVianenImpacts(m, this.host.vfs);
  }

  /** One pass of the original main loop. dt is game time in seconds. */
  tick(dt) {
    const { m } = this;
    if (this.ended) return false;
    try {
      if (this.pause) {
        // Only the race clocks stop: FUN_0044ca80. GetTickCount runs on through the blocking dialog,
        // so every other timer expires as it did and the resume moves the stopped ones forward.
        this.clock.advance(dt);
        this.pollPause();
        return true;
      }
      this.clock.advance(dt);
      if (!m.u32[DATA.RUNNING >> 2]) return this.finish();
      m.call(FN.HANDLE_GAME);
      m.call(FN.FOG_ZOOM);
      m.call(FN.COUNT_FRAME);
      if (m.call(FN.PUMP) !== 0) return this.finish();
      m.call(FN.COP_RADIO, [], DATA.COP_RADIO_OBJ);
    } catch (e) {
      if (e instanceof GameExit) {
        this.ended = true;
        this.exitCode = e.code;
        return false;
      }
      throw e;
    }
    return true;
  }

  finish() {
    const { m } = this;
    this.ended = true;
    try {
      m.call(FN.EXIT_MAIN);
    } catch (e) {
      if (!(e instanceof GameExit)) throw e;
      this.exitCode = e.code;
    }
    return false;
  }
}
