// What A2Racer4.exe did: alternates the menu and the race, on one page instead of two
// processes. Each race gets a fresh recompiled instance, as the original started spel.dat
// anew. Flow: docs/research/startup-flow.md section 1.
import { Vfs } from './host/vfs.js';
import { Persist } from './host/persist.js';
import { RaceRunner } from './race-runner.js';
import { GameFiles } from './host/game-files.js';
import { pinRace } from './host/race-setup.js';
import { MenuAssets, MenuRuntime } from './menu/framework.js';
import { MenuSound } from './menu/sound.js';
import { GameData } from './menu/data.js';
import { Settings, fullscreenElement } from './settings.js';
import { GamepadInput } from './input/gamepad.js';
import * as forms from './menu/forms/index.js';
import { LobbyUI } from './net/lobby-ui.js';
import { NetRace } from './net/puppets.js';
import { prepareRaceFiles } from './net/race-files.js';
import { VIANEN, fetchVianen, installVianen } from './host/vianen.js';

// Esc for the quit prompt. T, N and W are default turbo chords a browser would take: input.md H8.
const LOCKED_KEYS = ['Escape', 'KeyT', 'KeyN', 'KeyW'];

export class App {
  constructor() {
    this.canvasRace = document.getElementById('game');
    this.canvasMenu = document.getElementById('menu');
    this.overlay = document.getElementById('overlay');
    this.status = document.getElementById('status');
    this.params = new URLSearchParams(location.search);
    this.audioContext = null;
  }

  getAudioContext = () => {
    if (!this.audioContext) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AC) this.audioContext = new AC();
    }
    return this.audioContext;
  };

  /** Everything audible except the movies goes through this: the port's master Volume. */
  getMasterOutput = () => {
    const c = this.getAudioContext();
    if (!c) return null;
    if (!this.masterGain) {
      this.masterGain = c.createGain();
      this.masterGain.gain.value = this.settings.get('volume') / 100;
      this.masterGain.connect(c.destination);
    }
    return this.masterGain;
  };

  /** The status line. With ms, a note that goes away by itself. */
  say(text, ms = 0) {
    this.status.textContent = text;
    clearTimeout(this.sayTimer);
    if (ms) {
      this.sayTimer = setTimeout(() => {
        this.status.textContent = '';
      }, ms);
    }
  }

  async start() {
    this.settings = new Settings();
    this.vfs = new Vfs();
    this.say('Laden...');
    this.persist = new Persist();
    await this.persist.open();
    this.files = new GameFiles(this.vfs);
    await this.files.loadBase((a, b) => this.say(`Laden ${a}/${b}`));
    await this.persist.restoreInto(this.vfs);
    this.vfs.onWrite = (path, data) => this.persist.save(path, data);
    const assets = new MenuAssets();
    await assets.init();
    const sound = new MenuSound(this.getAudioContext, this.getMasterOutput);
    this.data = new GameData(this.vfs, { files: this.files });
    await this.data.load();
    this.menu = new MenuRuntime({ canvas: this.canvasMenu, overlay: this.overlay, assets, data: this.data, sound });
    this.menu.forms = await (await fetch('assets/menu/forms.json')).json();
    this.data.app = this;
    this.runner = new RaceRunner(this);
    this.menuPad = new GamepadInput(() => this.settings.get('deadzone'));
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => {
      this.layout();
      if (this.runner.touch) this.runner.touch.releaseAll();
    });
    const unlock = () => {
      const c = this.getAudioContext();
      if (c && c.state === 'suspended' && !this.runner.holdsSound()) c.resume();
      this.applyFullscreen();
    };
    this.settings.listeners.add((key, value) => {
      if (key === 'fullscreen') this.applyFullscreen();
      else if (key === 'volume' && this.masterGain) this.masterGain.gain.value = value / 100;
    });
    // iOS Safari counts only the end of a touch as a gesture.
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock);
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => this.fullscreenChanged());
    // The race handles its own sound on focus loss. In the menu: silence while the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (this.mode !== 'menu') return;
      const c = this.audioContext;
      if (c) {
        if (document.hidden) c.suspend();
        else c.resume();
      }
      // The intro's sound comes from its video element, which is not in that context.
      const video = this.menu.video && this.menu.video.el;
      if (document.hidden) {
        this.videoHeld = Boolean(video && !video.paused);
        if (this.videoHeld) video.pause();
      } else if (this.videoHeld) {
        this.videoHeld = false;
        if (video) video.play().catch(() => {});
      }
    });
    this.layout();
    this.say('');
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.mode === 'mp') this.menu.render();
      if (this.mode === 'menu') {
        this.menu.render();
        this.menuPad.pollMenu((code, down) => {
          this.menu.lastInputPad = true;
          this.menu.key(code, down);
        });
      }
    };
    requestAnimationFrame(loop);
    await this.route();
  }

  async route() {
    const formName = this.params.get('form');
    if (formName) {
      this.showMenu();
      const F = forms[formName];
      if (!F) {
        this.say('Unknown form ' + formName);
        return;
      }
      if (forms.isDialog && forms.isDialog(F)) {
        if (forms.TfrmMainScreen) await this.menu.goTo(forms.TfrmMainScreen);
        await this.menu.showModal(F, {});
      } else {
        await this.menu.goTo(F, {});
      }
      return;
    }
    if (this.params.has('race')) {
      const vianen = this.params.get('etappe') === VIANEN.key;
      pinRace(this.vfs, {
        etappe: vianen ? VIANEN.slot : Number(this.params.get('etappe')) || 0,
        car: Number(this.params.get('car')) || 0,
        resolution: this.params.has('resolution') ? Number(this.params.get('resolution')) : null,
        chunks: this.params.has('chunks') ? Number(this.params.get('chunks')) : null,
      });
      if (vianen) await this.withVianen(() => this.startRace());
      else await this.startRace();
      return;
    }
    this.showMenu();
    await this.data.flow.startUp(this.menu, { firstTime: true });
  }

  /** Called by the menu's DoExit with a race configured in game.ini and raser.ini. */
  async startRace() {
    this.showRace();
    await this.runner.run();
    // A key still held auto-repeats into the menu: 0x0043ac80 left that to a new process.
    this.menu.ignoreRepeat = true;
    this.showMenu();
    if (!this.params.has('race')) await this.data.flow.afterRace(this.menu);
  }

  /** Port: the network races' screens over the main menu. source/net/, docs/multiplayer.md. */
  openMultiplayer() {
    if (!this.lobby) this.lobby = new LobbyUI(this, document.getElementById('mp'));
    this.mode = 'mp';
    this.lobby.show();
    // The menu draws once more behind the screens, then takes no input.
    this.menu.dirty = true;
    this.menu.render();
    this.menu.active = false;
  }

  closeMultiplayer() {
    this.mode = 'menu';
    this.menu.active = true;
    this.menuPad.resync();
  }

  /**
   * One network race: the menu's Quick Race files with the room's etappe, laps and difficulty,
   * the files for the other humans' cars (source/net/race-files.js), then the race, then the room.
   */
  async startNetRace(setup) {
    const session = this.lobby.session;
    const me = setup.players.find((p) => p.id === session.you);
    if (!me) return;
    const data = this.data;
    const vianen = setup.etappe === VIANEN.key;
    const track = vianen ? null : data.static.tracks.find((t) => t.indexInGame === setup.etappe);
    const mode = data.raceMode;
    data.raceMode = 1;
    data.writeToInis();
    data.raceMode = mode;
    const set = (section, key, value) => this.vfs.iniSet('game.ini', section, key, String(value));
    set('ETAPPE', 'ETAPPE', vianen ? VIANEN.slot : setup.etappe);
    set('ETAPPE', 'BRITISH', track && track.british ? 1 : 0);
    set('OPTIONS', 'NRLAPS', setup.laps);
    set('LEAGUE', 'LEAGUE', setup.difficulty ?? 1);
    set('PLAYER', 'CAR', me.car);
    set('PLAYER', 'DAMAGE', 0);
    const net = new NetRace({ me: me.id, players: setup.players }, session.clock);
    const files = prepareRaceFiles(this.vfs, { localCar: me.car, remoteCars: net.remoteCars });
    this.showRace();
    try {
      const run = () => this.runner.run({ net, session, seed: setup.seed, cars: [...new Set(setup.players.map((p) => p.car))] });
      if (vianen) await this.withVianen(run);
      else await run();
    } finally {
      files.restore();
      session.raceEnded();
    }
    this.menu.ignoreRepeat = true;
    this.showMenu();
    if (forms.TfrmMainScreen) await this.menu.goTo(forms.TfrmMainScreen);
    this.openMultiplayer();
  }

  /** Runs fn with etappe 10 made Vianen: source/host/vianen.js. */
  async withVianen(fn) {
    let restore = () => {};
    try {
      if (!this.vianenFiles) this.vianenFiles = await fetchVianen();
      restore = installVianen(this.vfs, this.vianenFiles);
    } catch (e) {
      console.error(e);
      this.say('Vianen kon niet laden: ' + e.message, 10000);
      return undefined;
    }
    try {
      return await fn();
    } finally {
      restore();
    }
  }

  /** The quit path: EXITCODE 255. The launcher would close; here the first screen returns. */
  async exitGame() {
    this.menu.hideAll();
    this.menu.sound.stopAll();
    await this.data.flow.startUp(this.menu, { firstTime: true });
  }

  /**
   * The original always ran full screen, M:0x4a4d20 and S:0x4c55c0. Browsers allow the switch only
   * during a gesture, so the first one enters it, with the setting on. An iPhone has no such call.
   */
  applyFullscreen() {
    const root = document.documentElement;
    const on = this.settings.get('fullscreen');
    const inside = fullscreenElement();
    if (on && !inside && !this.fullscreenPending && document.fullscreenEnabled !== false) {
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!request) return;
      this.fullscreenPending = true;
      Promise.resolve(request.call(root)).catch(() => {}).finally(() => {
        this.fullscreenPending = false;
      });
    } else if (!on && inside) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    }
  }

  fullscreenChanged() {
    const keyboard = navigator.keyboard;
    if (fullscreenElement()) {
      if (keyboard && keyboard.lock) keyboard.lock(LOCKED_KEYS).catch(() => {});
    } else if (this.settings.get('fullscreen')) {
      // The player left it: out until the setting is switched on again. In a race that was
      // probably Esc, which the browser may have kept for itself.
      this.settings.set('fullscreen', false);
      if (this.mode === 'race') this.runner.leftFullscreen();
    }
    this.runner.updateStop();
  }

  showMenu() {
    this.mode = 'menu';
    this.canvasRace.style.display = 'none';
    this.canvasMenu.style.display = 'block';
    this.menu.active = true;
    // A pad button held since the race counts only after its release.
    this.menuPad.resync();
    this.layout();
  }

  showRace() {
    this.mode = 'race';
    this.menu.active = false;
    this.menu.hideAll();
    this.canvasMenu.style.display = 'none';
    this.canvasRace.style.display = 'block';
    this.layout();
  }

  layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.mode === 'menu' || this.mode === 'mp') {
      this.canvasMenu.width = w;
      this.canvasMenu.height = h;
      this.menu.relayout();
    } else if (this.runner) {
      this.runner.layout();
    }
  }
}
