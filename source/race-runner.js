// Runs one race on the page: loads its files, boots a fresh recompiled instance, then
// drives the fixed simulation tick and presents frames at the browser's rate.
import { Race } from './host/race.js';
import { GameExit } from './host/machine.js';
import { D3DRenderer } from './render/d3d-renderer.js';
import { HudLayout } from './host/hud-layout.js';
import { GameAudio } from './audio/game-audio.js';
import { GameInput, bindKeyboard } from './input/keyboard.js';
import { TouchControls, onRelease } from './input/touch.js';
import { GamepadInput } from './input/gamepad.js';
import { Bot } from './dev/bot.js';
import { SettingsPanel } from './ui/settings-panel.js';
import { safeAreaInsets } from './ui/safe-area.js';
import { useTouch, fullscreenElement } from './settings.js';
import { NetOverlay } from './net/overlay.js';
import { VIANEN, WENEN, waitScreenBase, reskinWenenRace } from './host/vianen.js';

// One pass of the original main loop per tick. docs/original-behavior.md, timing section.
export const TICK_SECONDS = 1 / 60;
const MAX_TICKS_PER_FRAME = 6;
// Size of the object table at 0x715e50, read in a race.
const OBJECT_SLOTS = 2500;
// Finish table and game-over screens: OVERLAY_STATE from 0x0043ac80 and 0x0043bc20.
const RESULT_OVERLAYS = new Set([5, 6, 7, 12]);
// The original has no pointer over the race, but the gear button needs one: shown when it moves.
const POINTER_SHOWN_MS = 2000;
// A key-up the browser swallowed must not hold the page on the last frame for ever.
const RELEASE_WAIT_MS = 5000;
// A failure's message stays this long on the menu that comes back.
const NOTE_MS = 10000;
// OVL_PROGRESS_BAR's frames ovl_p00..p10: hud-overlay.md section 9.
const BAR_FRAMES = 11;

export class RaceRunner {
  constructor(app) {
    this.app = app;
    this.renderer = null;
    this.race = null;
    this.input = null;
    this.running = false;
    this.lastFrame = 0;
    this.acc = 0;
    this.paused = false;
    this.bound = false;
    this.wasmModule = null;
    this.meta = null;
    this.pauseKind = 0;
    this.resultScreen = false;
  }

  async loadCode() {
    if (!this.meta) this.meta = await (await fetch('game/spel.meta.json')).json();
    if (!this.wasmModule) {
      try {
        this.wasmModule = await WebAssembly.compileStreaming(fetch('game/spel.wasm'));
      } catch {
        // A server that does not send application/wasm.
        this.wasmModule = await WebAssembly.compile(await (await fetch('game/spel.wasm')).arrayBuffer());
      }
    }
  }

  layout() {
    if (!this.renderer) return;
    const dpr = window.devicePixelRatio || 1;
    const app = this.app;
    const page = document.documentElement;
    const cw = Math.max(1, Math.round(window.innerWidth * dpr));
    const ch = Math.max(1, Math.round(window.innerHeight * dpr));
    // Portrait: the view and HUD take the top, the controls get the bottom. Elsewhere the
    // view fills the screen. docs/intentional-differences.md. style.css keys on this one rule.
    const portrait = ch > cw * 1.15;
    page.classList.toggle('race-portrait', portrait);
    let area = { x: 0, y: 0, w: cw, h: ch };
    if (portrait) {
      const usesTouch = this.useTouch;
      const h = usesTouch ? Math.min(Math.round(ch * 0.62), Math.round(cw * 1.2)) : Math.min(ch, Math.round(cw * 1.5));
      area = { x: 0, y: 0, w: cw, h };
    }
    const cssW = area.w / dpr;
    const cssH = area.h / dpr;
    const grid = this.renderer.indexed ? this.renderer.modeGrid(area) : null;
    const size = app.settings.renderSize(cssW, cssH, dpr, this.renderer.maxTextureSize, grid);
    this.renderer.setRenderSize(cw, ch, area, size);
    this.effectiveSize = size;
    if (this.panel && this.panel.isOpen) this.panel.refresh(size);
    // CSS pixels per unit of the 640x480 canvas, hud-overlay.md section B: style.css places the
    // controls around the HUD's corner groups with it.
    let unit = 0.99 * Math.min(cssW / 640, cssH / 480);
    page.style.setProperty('--panel-top', `${cssH}px`);
    if (this.host && this.host.hudLayout) {
      const hud = this.host.hudLayout;
      const safe = safeAreaInsets();
      hud.setShape(area.w / area.h, {
        left: (safe.left * dpr) / area.w, right: (safe.right * dpr) / area.w,
        top: (safe.top * dpr) / area.h, bottom: area.h === ch ? (safe.bottom * dpr) / area.h : 0,
      }, { w: cssW, h: cssH }, this.renderer.clipY);
      unit *= hud.scale || 1;
      // Touch in landscape: the wheel sits bottom left, so the Communicator moves right of it.
      hud.leftShift = 0;
      let lifted = false;
      if (this.useTouch && !portrait) {
        const wheel = document.getElementById('touch-wheel').getBoundingClientRect();
        if (wheel.width > 0) {
          hud.leftShift = ((wheel.right + 8) / window.innerWidth) * 2 * hud.xr;
          // Between it and the Speedometer the action buttons may not fit. Canvas widths: section 9.
          const communicatorRight = wheel.right + 8 + 207.2 * unit;
          const speedometerLeft = window.innerWidth - safe.right - 205 * unit;
          const actions = document.querySelector('.touch-actions').getBoundingClientRect();
          lifted = communicatorRight + 8 + actions.width + 8 > speedometerLeft;
        }
      }
      page.classList.toggle('actions-lifted', lifted);
    }
    page.style.setProperty('--hud-unit', `${unit}px`);
    if (this.touch) this.touch.relayout();
  }

  /**
   * Resolves when the race has ended and spel.dat would have exited. mp: a network race,
   * { net: NetRace, session: NetSession, seed, cars }, source/net/.
   */
  async run(mp = null) {
    const app = this.app;
    app.say('');
    this.endWaitStart = 0;
    this.mp = mp;
    let race;
    try {
      race = await this.load();
      if (mp) await this.waitForGo(mp);
    } catch (e) {
      // S:0x4c4150 ends in ExitProcess(1) and the launcher runs menu.exe /Default whatever the
      // result, so a failure comes back to the menu: startup-flow.md section 5. A GameExit has
      // already put its message up.
      console.error('Race not started:', e);
      if (!(e instanceof GameExit)) app.say('De race kon niet starten: ' + e.message, NOTE_MS);
      // A fetch fails before S:0x4491f0 clears this, and the last race's value would read as a result.
      app.vfs.iniSet('game.ini', 'PLAYER', 'finished', '0');
      this.cleanup();
      return;
    }
    this.bot = null;
    if (app.params.has('bot')) {
      this.bot = new Bot(race, this.input);
      window.__bot = this.bot;
    }
    this.speed = mp ? 1 : Number(app.params.get('speed')) || 1;
    if (mp) {
      this.netOverlay = this.netOverlay || new NetOverlay(document.getElementById('net-hud'));
      this.netOverlay.start(mp, this.renderer);
    }
    window.__race = race;
    window.__renderer = this.renderer;
    this.acc = 0;
    this.lastFrame = performance.now();
    await new Promise((resolve) => {
      this.finish = resolve;
      requestAnimationFrame((t) => this.frame(t));
    });
    this.cleanup();
  }

  /** Everything before the first tick. Returns the booted race, or throws. */
  async load() {
    const app = this.app;
    const ini = app.vfs.parsedIni('game.ini');
    const etappe = Number(ini.get('ETAPPE', 'ETAPPE') || 0);
    const car = Number(ini.get('PLAYER', 'CAR') || 0);
    // The 8-bit path decodes other pictures: raser.ini [wait_lo] at RESOLUTION 0, the PCX of [wait_hi] at 1.
    const resolution = parseInt(app.vfs.parsedIni('raser.ini').get('PROGRAM', 'RESOLUTION'), 10);
    const eight = resolution === 0 || resolution === 1;
    const art = document.getElementById('loading-art');
    art.src = `${waitScreenBase(etappe)}e${String(etappe).padStart(2, '0')}${eight ? (resolution === 0 ? '-lo' : '-8') : ''}.png`;
    document.getElementById('loading-stage').classList.toggle('pixels', eight);
    document.getElementById('loading-bar').removeAttribute('src');
    document.getElementById('loading').hidden = false;
    this.barFrames = this.barFrames || {};
    this.barFrames[eight] = this.barFrames[eight] || Array.from({ length: BAR_FRAMES }, (_, k) => {
      const frame = new Image();
      frame.onload = () => this.showBar(this.barPercent);
      frame.src = `assets/loading/bar${eight ? '8' : ''}-${String(k).padStart(2, '0')}.png`;
      return frame;
    });
    this.barSet = this.barFrames[eight];
    this.showBar(0);
    await this.loadCode();
    // Vianen, etappe 10, places Amsterdam's objects: it reads what a race there reads.
    const lists = etappe === VIANEN.slot ? VIANEN.like : etappe;
    await app.files.prepareRace(lists, car, (a, b) => this.showBar((a / b) * 90));
    // A network race also draws the other humans' cars.
    for (const other of this.mp ? this.mp.cars : []) if (other !== car) await app.files.prepareRace(lists, other);
    // Wenen races as Vianen: its textures, once its own files are in.
    this.restoreReskin = etappe === WENEN ? await reskinWenenRace(app.vfs) : null;
    if (!this.renderer) this.renderer = new D3DRenderer(app.canvasRace, { staticTrack: !app.params.has('nostatic') });
    this.renderer.resetForRace();
    const audio = new GameAudio(app.getAudioContext(), app.getMasterOutput());
    this.audio = audio;
    const host = {
      vfs: app.vfs,
      render: this.renderer,
      audio,
      input: null,
      screen: { width: 640, height: 480 },
      joystickPresent: false,
      onFlip: () => this.renderer.endFrame(),
      onMessageBox: (c, t) => {
        console.error('Game message', c, t);
        app.say(`${c}: ${t}`);
      },
      onStdout: () => {},
      onPauseChange: (kind) => {
        this.pauseKind = kind;
        if (!kind) this.dialogByPointer = false;
        this.updateDialogKeys();
        if (kind) audio.pauseAll();
        else audio.resumeAll();
      },
    };
    // ?bench=1: fixed seeds, so the same input gives the same race. docs/validation.md.
    this.repeatable = app.params.has('bench');
    if (this.repeatable) {
      host.fixedDate = 971434016000;
      host.clockStart = 1;
    }
    // A network race: every browser seeds rand alike, so traffic starts the same everywhere.
    if (this.mp) {
      host.fixedDate = 971434016000;
      host.clockStart = this.mp.seed;
    }
    this.host = host;
    const race = new Race(this.meta, host);
    await race.instantiate(this.wasmModule);
    this.race = race;
    this.renderer.attach(race.m, host);
    audio.attach(race.m, race.clock);
    host.hudLayout = new HudLayout(race.m);
    if (this.mp) {
      this.mp.net.attach(race);
      const hud = host.hudLayout;
      const apply = hud.apply.bind(hud);
      hud.apply = () => {
        apply();
        if (this.mp) this.mp.net.beforeHud();
      };
    }
    this.input = new GameInput(race.m);
    host.input = this.input;
    this.bind();
    this.input.onClear = () => this.touch.releaseAll();
    this.gamepad.resync();
    this.chooseDevice();
    document.getElementById('race-settings').hidden = false;
    document.getElementById('fps').hidden = !app.settings.get('showFps');
    this.updateStop();
    app.canvasRace.classList.add('no-pointer');
    this.layout();
    this.showBar(95);
    // The game loads in one go here: let the browser paint the splash screen first.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    race.boot();
    if (this.mp) this.mp.net.boot();
    // The mode is known now, and the 8-bit modes size their view by it.
    if (this.renderer.indexed) this.layout();
    if (!this.mp) document.getElementById('loading').hidden = true;
    return race;
  }

  /** A network race starts when every browser has loaded it, at the same moment in all. */
  async waitForGo(mp) {
    const note = document.getElementById('loading-note');
    note.textContent = 'Wachten op de andere spelers...';
    note.hidden = false;
    this.showBar(100);
    try {
      await mp.session.loaded(mp.net);
    } finally {
      note.hidden = true;
      document.getElementById('loading').hidden = true;
    }
  }

  /** The wait screen's bar, as 0x004976d0 selects its frame: ftol(11 * pct * 0.01). */
  showBar(percent) {
    this.barPercent = percent;
    const frame = this.barSet[Math.min(BAR_FRAMES - 1, Math.floor(11 * percent * 0.01))];
    if (frame.complete && frame.naturalWidth) document.getElementById('loading-bar').src = frame.src;
  }

  /** The page's listeners, once: they outlive a race and look up the current one. */
  bind() {
    if (this.bound) return;
    this.bound = true;
    const app = this.app;
    bindKeyboard(window, () => (this.panelOpen ? null : this.input));
    this.touch = new TouchControls(document.getElementById('touch-controls'), () => this.input);
    this.gamepad = new GamepadInput(() => app.settings.get('deadzone'));
    this.gamepad.onFound = () => {
      // DEVICE is read once at load, 0x0046ee10: a pad cannot take over a keyboard race.
      if (this.input && this.input.device === 1 && !app.params.has('bot')) app.say('Gamepad werkt vanaf de volgende race', 4000);
    };
    this.panel = new SettingsPanel(document.getElementById('settings-panel'), app.settings, {
      onOpenChange: (open, closedBy) => {
        this.panelOpen = open;
        if (this.input) this.input.clear();
        else if (this.touch) this.touch.releaseAll();
        if (open) {
          if (this.audio) this.audio.suspend();
        } else {
          if (this.input && closedBy) this.input.ignoreCode = closedBy;
          this.lastFrame = performance.now();
          this.acc = 0;
          if (this.audio && !this.holdsSound()) this.audio.resume();
        }
      },
    });
    const togglePanel = () => {
      if (this.panel.isOpen) this.panel.close();
      else this.panel.open(this.effectiveSize);
    };
    onRelease(document.getElementById('race-settings'), togglePanel);
    window.addEventListener('keydown', (e) => {
      if (!this.race) return;
      if (e.code === 'F9') {
        e.preventDefault();
        if (!e.repeat) togglePanel();
      } else if (e.code === 'Escape' && this.panelOpen) {
        e.preventDefault();
        if (!e.repeat) this.panel.close(e.code);
      }
    });
    for (const b of document.querySelectorAll('#dialog-keys button, #race-stop')) {
      this.touch.bindKey(b, Number(b.dataset.vk), Number(b.dataset.dik) || 0);
    }
    // A mouse user who asked for the quit prompt on screen can answer it on screen.
    document.getElementById('race-stop').addEventListener('pointerdown', () => {
      this.dialogByPointer = true;
    });
    const canvas = app.canvasRace;
    canvas.addEventListener('pointerdown', (e) => this.canvasPress(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => this.canvasRelease());
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.race) this.showPointer();
    });
    app.settings.listeners.add((key) => this.settingChanged(key));
    document.addEventListener('visibilitychange', () => this.visibility());
    window.addEventListener('blur', () => {
      // A network race runs on while the page is visible: the others are still driving.
      if (this.mp && !document.hidden) {
        if (this.touch) this.touch.releaseAll();
        if (this.input) this.input.clear();
        return;
      }
      this.setFocus(false);
    });
    window.addEventListener('focus', () => this.setFocus(true));
  }

  /** What is left after a race or a failed start. */
  cleanup() {
    const page = document.documentElement;
    if (this.audio) this.audio.stopAll();
    if (this.touch) this.touch.setVisible(false);
    if (this.panel) this.panel.close();
    for (const id of ['loading', 'dialog-keys', 'race-settings', 'race-stop', 'fps']) document.getElementById(id).hidden = true;
    if (this.netOverlay) this.netOverlay.stop();
    this.mp = null;
    if (this.restoreReskin) this.restoreReskin();
    this.restoreReskin = null;
    page.classList.remove('race-portrait', 'race-touch', 'race-results', 'actions-lifted');
    this.app.canvasRace.classList.remove('no-pointer');
    clearTimeout(this.pointerTimer);
    this.race = null;
    this.input = null;
    this.pauseKind = 0;
    this.resultScreen = false;
    this.dialogByPointer = false;
    this.suspended = false;
    // A race can end while it holds the context the menu's sound shares.
    const c = this.app.audioContext;
    if (c && c.state === 'suspended' && !document.hidden) c.resume();
  }

  /**
   * Which virtual device the race binds at start: the game cannot change it during a race.
   * Touch or a connected pad use DEVICE 2 unless the player chose joystick or wheel.
   * Keyboard-only sessions stay on DEVICE 1, the original ramps. input.md H4.
   */
  chooseDevice() {
    const app = this.app;
    const ini = app.vfs.parsedIni('game.ini');
    let device = Number(ini.get('INPUT', 'DEVICE') || 1);
    this.useTouch = useTouch(app.settings);
    const pad = this.gamepad && this.gamepad.connected();
    // The bot drives with the keyboard device, so its route is the same in every profile.
    if ((this.useTouch || pad) && device === 1 && !app.params.has('bot')) device = 2;
    if (device !== 1) {
      this.host.joystickPresent = true;
      this.host.joystickCaps = { devType: device === 2 ? 0x0604 : 0x0204, axes: 2, buttons: 4 };
    }
    this.input.device = device;
    const { keys } = this.input;
    for (const [field, name] of [['left', 'LEFT'], ['right', 'RIGHT'], ['up', 'UP'], ['down', 'DOWN'], ['extra1', 'EXTRA1'], ['extra2', 'EXTRA2'], ['extra3', 'EXTRA3']]) {
      keys[field] = Number(ini.get('INPUT', name)) || keys[field];
    }
    const vfs = app.vfs;
    const write = vfs.onWrite;
    vfs.onWrite = null;
    vfs.iniSet('game.ini', 'INPUT', 'DEVICE', String(device));
    vfs.onWrite = write;
    document.documentElement.classList.toggle('race-touch', this.useTouch);
    if (this.touch) this.touch.setVisible(this.useTouch);
  }

  frame(now) {
    const race = this.race;
    if (!race) return;
    if (race.ended) {
      this.endWait(now);
      return;
    }
    requestAnimationFrame((t) => this.frame(t));
    const bench = window.__bench && window.__bench.recording ? window.__bench : null;
    // ?speed=N runs N ticks of game time per tick of real time, for flow checks with the bot.
    const speed = this.speed || 1;
    const elapsed = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000)) * speed;
    this.lastFrame = now;
    this.countFps(now);
    this.updateResults();
    if (!this.suspended && !this.panelOpen) {
      this.acc += elapsed;
      // Falling behind: the original slows game time at a dt of 0.1 s, and so does this.
      const steps = Math.min(MAX_TICKS_PER_FRAME * speed, Math.floor(this.acc / TICK_SECONDS));
      if (this.gamepad) this.gamepad.pollRace(this.input, race.pause ? race.pause.kind : 0, this.resultScreen);
      // A network race has no pause: the others drive on. Esc and its quit prompt stay.
      if (this.mp) {
        this.input.vk[0x50] = 0;
        this.input.dik[0x19] = 0;
      }
      // A pause or quit dialog stays on the frame of its key's tick, so that one must be kept.
      const dialogKey = this.input.vk[0x50] || this.input.vk[0x1B];
      for (let k = 0; k < steps; k++) {
        // Only the last tick's frame is drawn and the one before blends into it. Earlier
        // ticks still run the render path, because effects update there, but copy nothing.
        this.renderer.captureLevel = dialogKey || k === steps - 1 ? 2 : k === steps - 2 ? 1 : 0;
        this.acc -= TICK_SECONDS;
        if (this.bot) this.bot.tick();
        if (this.input.device !== 1 && !race.pause) this.input.updateJoystick(TICK_SECONDS);
        const t0 = bench ? performance.now() : 0;
        let alive;
        try {
          alive = race.tick(TICK_SECONDS);
        } catch (e) {
          // A fault in the recompiled code or the host: end the race, keep the page alive.
          console.error('Race stopped:', e);
          this.app.say('Race gestopt door een fout: ' + e.message, NOTE_MS);
          race.ended = true;
          alive = false;
        }
        if (!alive) {
          this.acc = 0;
          break;
        }
        if (this.repeatable) this.traceTick(race);
        if (this.mp) this.mp.session.afterTick();
        if (bench) bench.tick.push(performance.now() - t0);
        this.input.endTick();
      }
      if (this.acc > TICK_SECONDS) this.acc = this.acc % TICK_SECONDS;
    }
    const t1 = bench ? performance.now() : 0;
    // Under a dialog the picture stays on its key's tick: 0x0044ca80 waits and draws nothing.
    this.renderer.present(race.pause || race.ended ? 1 : Math.min(1, this.acc / TICK_SECONDS));
    if (this.mp && this.netOverlay) this.netOverlay.frame(now);
    if (bench) bench.present.push(performance.now() - t1);
  }

  /**
   * 0x0043ac80 leaves only when Esc, Enter and Space are all up, so none of them reaches the menu
   * held. A spin here would hang the page: GameInput.keyDown lets it through, and this waits.
   */
  endWait(now) {
    const { input } = this;
    input.endTick();
    this.endWaitStart = this.endWaitStart || now;
    if ((input.vk[0x1B] || input.vk[0x0D] || input.vk[0x20]) && now - this.endWaitStart < RELEASE_WAIT_MS) {
      requestAnimationFrame((t) => this.frame(t));
      this.renderer.present(1);
      return;
    }
    this.finish();
  }

  /** The driving controls do nothing on these screens and would cover their text: gameplay-systems.md section 8. */
  updateResults() {
    const results = RESULT_OVERLAYS.has(this.race.overlayState);
    if (results === this.resultScreen) return;
    this.resultScreen = results;
    document.documentElement.classList.toggle('race-results', results);
    if (results && this.touch) this.touch.releaseAll();
    this.updateDialogKeys();
  }

  /** On-screen answers, where a dialog or result screen waits for keys the device does not have. */
  updateDialogKeys() {
    const kind = this.pauseKind;
    const results = this.resultScreen && !kind;
    const box = document.getElementById('dialog-keys');
    box.hidden = !(kind || results) || !(this.useTouch || this.dialogByPointer);
    // A finger on Nee when the dialog ends must not leave N down.
    if (box.hidden) for (const b of box.querySelectorAll('button')) this.touch.releaseControl(b);
    document.getElementById('dlg-yes').hidden = kind !== 2;
    document.getElementById('dlg-no').hidden = kind !== 2;
    document.getElementById('dlg-go').hidden = kind !== 1;
    document.getElementById('dlg-results').hidden = !results;
  }

  /** 0x0044c990 scans VK 0 to 255, so a mouse button ends a pause. input.md H1, H6: a tap as well. */
  canvasPress(e) {
    const { race } = this;
    if (!race || !race.pause || race.pause.kind !== 1 || this.panelOpen) return;
    this.canvasVk = [1, 4, 2, 5, 6][e.button] || 1;
    this.input.pressHost(this.canvasVk);
  }

  canvasRelease() {
    if (this.canvasVk && this.input) this.input.releaseHost(this.canvasVk);
    this.canvasVk = 0;
  }

  /** WM_SETCURSOR answers SetCursor(NULL) in spel.dat, FUN_004cd6b0. The gear needs a pointer, so it comes back when moved. */
  showPointer() {
    const canvas = this.app.canvasRace;
    canvas.classList.remove('no-pointer');
    clearTimeout(this.pointerTimer);
    this.pointerTimer = setTimeout(() => canvas.classList.add('no-pointer'), POINTER_SHOWN_MS);
  }

  settingChanged(key) {
    if (!this.race) return;
    if (key === 'resolution' || key === 'renderScale') {
      this.layout();
    } else if (key === 'touch') {
      this.touchSettingChanged();
    } else if (key === 'showFps') {
      document.getElementById('fps').hidden = !this.app.settings.get('showFps');
    }
    if (this.panel.isOpen) this.panel.refresh(this.effectiveSize);
  }

  touchSettingChanged() {
    const on = useTouch(this.app.settings);
    // The wheel feeds the virtual joystick, which a keyboard race does not have: 0x0046ee10.
    if (on && this.input.device === 1) {
      this.app.say('Aanraakbediening werkt vanaf de volgende race', 4000);
      return;
    }
    this.useTouch = on;
    document.documentElement.classList.toggle('race-touch', on);
    this.touch.setVisible(on);
    this.updateDialogKeys();
    this.updateStop();
    this.layout();
  }

  /** The on-screen Stop for mouse users: Esc in full screen need not reach the page, input.md H8. */
  updateStop() {
    document.getElementById('race-stop').hidden = !(this.race && !this.useTouch && fullscreenElement());
  }

  /** The player left full screen, and that Esc may never have reached the page: the prompt opens anyway. */
  leftFullscreen() {
    const { race } = this;
    if (!race || race.ended || race.pause || this.resultScreen || this.panelOpen || this.suspended || document.hidden) return;
    this.input.pulseVk(0x1B);
  }

  /**
   * Once a second of game time, a checksum of every object that has a physics body: the object
   * record, its 3D object with the world matrix, the player, the racers, traffic and police.
   * docs/validation.md, repeatable sequence.
   */
  traceTick(race) {
    this.tickCount = (this.tickCount || 0) + 1;
    if (this.tickCount % 60) return;
    const { m } = race;
    const v = m.view;
    const cars = m.u32[0x715e50 >> 2];
    const objects = m.u32[0x73b0d0 >> 2];
    let h = 0x811C9DC5;
    let bodies = 0;
    for (let k = 0; k < OBJECT_SLOTS; k++) {
      const car = cars + k * 0xF0;
      if (!v.getUint32(car + 0x10, true)) continue;
      bodies++;
      for (let p = car >> 2, end = p + (0xF0 >> 2); p < end; p++) h = Math.imul(h ^ m.u32[p], 0x01000193);
      const obj = objects + v.getInt32(car + 0x24, true) * 0xA9;
      for (let a = obj + 0x10; a < obj + 0x60; a += 4) h = Math.imul(h ^ v.getUint32(a, true), 0x01000193);
    }
    const s = this.bot ? this.bot.carState() : null;
    const trace = window.__trace || (window.__trace = []);
    trace.push({ tick: this.tickCount, cars: (h >>> 0).toString(16), bodies, chunk: s && s.chunk, pos: s && s.pos, speed: s && s.speed });
  }

  countFps(now) {
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (now - (this.fpsStart || 0) >= 500) {
      const fps = (this.fpsFrames * 1000) / (now - (this.fpsStart || now - 500));
      this.fpsFrames = 0;
      this.fpsStart = now;
      if (this.app.settings.get('showFps')) {
        const r = this.renderer.stats;
        const e = this.effectiveSize;
        document.getElementById('fps').textContent = `${fps.toFixed(0)} FPS  ${e.width}×${e.height}  ${r.batches} batches`;
      }
    }
  }

  visibility() {
    this.setFocus(!document.hidden);
  }

  /** The race keeps the sound stopped: while the panel is open, or without focus. The one test for all who could resume it. */
  holdsSound() {
    return Boolean(this.race && (this.panelOpen || this.suspended));
  }

  /** Lost focus: stop the clock and the sound, release all keys. See docs/original-behavior.md. */
  setFocus(active) {
    if (!this.race) return;
    if (!active) {
      this.suspended = true;
      if (this.touch) this.touch.releaseAll();
      if (this.input) this.input.clear();
      if (this.audio) this.audio.suspend();
    } else {
      this.suspended = false;
      this.lastFrame = performance.now();
      this.acc = 0;
      if (this.audio && !this.holdsSound()) this.audio.resume();
    }
  }
}
