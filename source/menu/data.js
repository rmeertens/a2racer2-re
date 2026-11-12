// The data module of menu.exe: what TData held, with TStatic (static.ini), TMenuIni (menu.ini),
// TGameIni (the race result in game.ini), the rank list and the current player (SaveGame<N>.RCR).
// Addresses are menu.exe. Specification: docs/research/menu-forms.md section 3, startup-flow.md
// sections 3, 4 and 6, game-progression.md. One GameData lives as long as the page; where the
// original started a new menu.exe per race, flow.js calls beginMenuRun().
//
// Public API. Forms keep no state of their own and use this as this.rt.data (d below):
//
// Text and tables
//   d.menuString(n)               menu.ini [MENUSTRINGS] n, '' if absent
//   d.menuFormat(n, ...args)      the same through Format: d.menuFormat(9, name) = 'Welkom Kat!'
//   d.ordinalNumber(n)            [OrdinalNumbers] n, '1e'. d.ordinalWord(n): [OrdinalWords]
//   d.formatTime(ms)              '2:57:13', FUN_00481090
//   d.qualifyCaption(track)       '3e Plaats' or 'Ontsnappen' at the current difficulty, 0x499f80
//   d.controlKeys                 [CONTROLKEYS] in order: [{ vk, name }]. d.keyName(vk): name or ''
//   d.isControlKey(vk)            may this key be bound, FormKeyDown 0x491e64
//   d.static.chars[n]             { index, name, indexInGame, story, winRaceText, lockedText,
//                                   speed, accell, brakes, handling }, n = static char number
//   d.static.tracks[n]            { index, name, type, story, winText, loseText, qualifyText,
//                                   indexInGame, nrLaps, british, qualifyPosition[3], chaseTime[3], isChase }
//   d.static.tuneUps[i]           { index, name, price, dSpeed, dAccell, dBrakes, dHandling, text }, 0..4
//   d.static.tour                 { trackIx[], charIx[], defaultChar, trackCount, charCount,
//   d.static.quickRace              trackAt(pos), charAt(pos), positionOfTrack(track) }; quickRace also has
//                                   lockedCharIx, downloadCharIx, downloadCharAvailable, lockedCharText
//   d.static.firstPlaceBonus, turboOilAmount, checkpointTime[3], downloadUrl, defaultSettings
//   d.static.charByGameIndex(car) character with that indexInGame, or null
//   d.menuIni                     { prevState, currentPlayer, timeFormat, introAvi, highscores[n] = { time, name } }
//
// Run state
//   d.raceMode                    0 none, 1 Quick Race, 2 Tour (TData+0xA8). Forms set it where the original did
//   d.resultFlags                 bits d.RR.CHASE, QUALIFY, WINRACE, WINTRACK, BESTLAP (TData+0xD0)
//   d.playerPos                   0-based finish rank (TData+0xA4)
//   d.rankList[i]                 { charIx, time } sorted by time, player included, FillRankResults
//   d.gameIni                     { money, finished, outOfTime, totalLoss, trackTime, turboAmount, lapTimes[],
//                                   racers[4] = { charIx, time }, playerAborted }. null on a first run
//
// The current player, d.player (never null on a screen)
//   .name  .tourStarted  .trackToDrive (static track number)  .settings  .settings.controls
//   .tour { charIx, trackIx, results[] }     .qr { charIx, trackIx, harryUnlocked }
//   .result        CharResult of the current Tour character, 0x48d458
//   .euro          .result.euro, also settable
//   .tourChar .qrChar .tourTrack .qrTrack .trackDriven    static objects, 0x48c22c 0x48c20c 0x48c624 0x48c604 0x49ed24
//   .settings: difficulty resolution fxVolume musicVolume voicesVolume fxOn musicOn voicesOn startInfoOn
//     alphaBlending bilinear waitVbl mipmapping gamma textureMem driverIndex renderFocus; clone(), assign(other)
//   .settings.controls: up down left right extra1 extra2 extra3 (VK codes) controlType (0 keyboard, 1 joystick,
//     2 gamepad, 3 wheel) joySensitivity wheelSensitivity. Standaard: assign(d.static.defaultSettings.controls)
//   CharResult: .euro (never below 0) .trackReached .turbo (0..100) .tuneUps[5]
//     .hasTuneUp(i) .isFinished .speedBonus .accellBonus .brakesBonus .handlingBonus
//
// Rules the screens call
//   d.canBuyTuneUp(i)             Kopen enabled, 0x499600
//   d.buyTuneUp(i)                'bought' (play PEEP), 'noMoney' (show TfrmNoMoney) or null (nothing to buy). 0x4991f4
//   d.maxTourTrack                last Tour position the Track screen may select, 0x49a464
//   d.initialTourTrack            the one it starts on, 0x49a168
//   d.quickTrackAvailable(pos)    FUN_0049c78c. d.quickCharAvailable(pos): FUN_0049ca08
//   d.takeUnlock()                0x49c6a0: true once when D.T. Harry was just won (then select lockedCharIx,
//                                 voice 'unlock', modal TfrmUnlock)
//   d.selectQuickTrack(pos)       0x49c198: sets qr.trackIx and trackToDrive
//   d.availableTextureMemory      game.ini AVAILABLE_TEXTURE_MEMORY, FUN_00480c9c
//
// Players
//   d.otherPlayers()              [{ number, name, tourChar }] sorted, without the current one, BuildFileList 0x493338
//   d.loadPlayer(n)  d.savePlayer()  d.createPlayer(name)  d.deletePlayer(n)
//   d.beginPlayerDialog()         InitDlg 0x49354c. d.endPlayerDialog(modalResult): ExitDlg 0x493658, 2 restores all
//   d.saveProgress()              port only: saves player and menu.ini now, because a closed tab has no DataDestroy
//
// Sound and exit
//   d.applySoundSettings()        the player's volumes to rt.sound, the original's attenuation curve
//   d.previewMusicVolume(v)       live music volume for the Options slider, 0x482830
//   d.notApplicable(text)         a short note in the menu's dialog style; resolves when closed
//   d.doExit()                    DoExit 0x47ff64 and DataDestroy: RaceMode != 0 starts the race, RaceMode 0 quits
//   d.flow                        startUp(rt, {firstTime}), afterRace(rt), closeRequested(rt) (Einde),
//                                 startInfoThenRace(rt) (Verder on Garage and QuickRace: false if Annuleren),
//                                 askPlayerName(rt) (AddNewPlayer's loop: { result, name }),
//                                 helpRequested(rt, form) (the Help button of a screen or dialog),
//                                 unexpectedError(rt, error) (what window error and unhandledrejection report)
//
// Dialogs with a text box get { name } in args and must store their text back into this.args.name before they close.
// Test route ?form=TfrmX: mode=1 or 2 (default 2) sets raceMode and prevState, flags=<n> sets resultFlags.
import { encodeLatin1 } from '../host/vfs.js';
import { vianenTrack } from '../host/vianen.js';
import { boxmeerTrack } from '../host/boxmeer.js';
import { startUp, afterRace, closeRequested, askPlayerName, startInfoThenRace, showNote, helpRequested, unexpectedError } from './flow.js';

export const RR = { CHASE: 0x01, QUALIFY: 0x02, WINRACE: 0x04, WINTRACK: 0x08, BESTLAP: 0x20 };

const TRACK_EXTENSIONS = ['.cmp', '.dmp', '.ini', '.omp', '.pmp', '.pth', '.rmp'];
const SAVE_NAME = /^savegame(\d)\.rcr$/;

/** Name of a save, FUN_00481178. */
const saveFile = (n) => `SaveGame${n}.RCR`;

/** Delphi Format, for the %s, %d and %.2d in the game's strings. */
export function delphiFormat(format, ...args) {
  let k = 0;
  return String(format).replace(/%(?:\.(\d+))?([sd%])/g, (all, digits, kind) => {
    if (kind === '%') return '%';
    const v = args[k++];
    return kind === 's' ? String(v) : String(Math.trunc(v)).padStart(Number(digits || 0), '0');
  });
}

/** FUN_00480f04, Options 0..100 to the raser.ini percentage. Truncates: 0x402ad4 is _TRUNC. */
export function raserVolume(v) {
  const r = 100 - Math.trunc(Math.pow(10, (2 * (100 - v)) / 100));
  return Math.min(100, Math.max(1, r));
}

/** FUN_00480fcc, Options 0..100 to IDirectSoundBuffer::SetVolume hundredths of a dB. */
export function directSoundVolume(v) {
  const span = Math.log10(4000) - 2;
  const att = -Math.trunc(Math.pow(10, 2 + ((100 - v) / 100) * span));
  return Math.min(-100, Math.max(-4000, att));
}

/** The percentage MenuSound.setVolumes needs to reach that attenuation. */
const soundPercent = (v) => 100 * Math.pow(10, directSoundVolume(v) / 2000);

/** TList.Sort 0x410598, the VCL QuickSort: not stable, so equal times keep the original's order. */
function vclQuickSort(list, compare, left = 0, right = list.length - 1) {
  if (right < left) return;
  let l = left;
  let i;
  do {
    i = l;
    let j = right;
    const pivot = list[(l + right) >>> 1];
    do {
      while (compare(list[i], pivot) < 0) i++;
      while (compare(list[j], pivot) > 0) j--;
      if (i <= j) {
        [list[i], list[j]] = [list[j], list[i]];
        i++;
        j--;
      }
    } while (i <= j);
    if (l < j) vclQuickSort(list, compare, l, j);
    l = i;
  } while (i < right);
}

/** TIniFile reads over a parsed INI: ReadInteger takes a 0x prefix, else StrToIntDef. */
class IniReader {
  constructor(ini) {
    this.ini = ini;
  }

  has(section, key) {
    return this.ini.get(section, key) !== null;
  }

  str(section, key, def = '') {
    const v = this.ini.get(section, key);
    return v === null ? def : v;
  }

  int(section, key, def = 0) {
    const v = this.ini.get(section, key);
    if (v === null) return def;
    const t = v.trim().replace(/^0[xX]/, '$');
    if (/^[+-]?\d+$/.test(t)) return Number(t);
    if (/^\$[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(1), 16);
    return def;
  }

  bool(section, key, def = false) {
    return this.int(section, key, def ? 1 : 0) !== 0;
  }

  /** A comma list of numbers, as TStringList.CommaText and StrToInt read it. */
  ints(section, key) {
    const v = this.ini.get(section, key);
    return v === null || v === '' ? [] : v.split(',').map((s) => Number(s.trim()) || 0);
  }
}

/** TIniFile writes. WriteBool writes 0 or 1 (0x4583a8). The file reaches the VFS once, at close. */
class IniWriter {
  constructor(vfs, path) {
    this.vfs = vfs;
    this.path = path;
    this.ini = vfs.parsedIni(path);
  }

  writeString(section, key, value) {
    this.ini.set(section, key, String(value));
  }

  writeInteger(section, key, value) {
    this.writeString(section, key, Math.trunc(value));
  }

  writeBool(section, key, value) {
    this.writeString(section, key, value ? 1 : 0);
  }

  close() {
    this.vfs.write(this.path, encodeLatin1(this.ini.serialize()));
  }
}

// --- static.ini ---------------------------------------------------------------------------

/** TCharacter, loader 0x4606d0. */
function readCharacter(ini, index) {
  const s = 'char' + index;
  return {
    index,
    name: ini.str(s, 'Name'),
    indexInGame: ini.int(s, 'IndexInGame', 0),
    winRaceText: ini.str(s, 'winracetext', '...'),
    lockedText: ini.str(s, 'LockedText', '...'),
    story: ini.str(s, 'Story', '...'),
    speed: ini.int(s, 'Speed', 0),
    brakes: ini.int(s, 'Brakes', 0),
    accell: ini.int(s, 'Accell', 0),
    handling: ini.int(s, 'Handling', 0),
  };
}

/** TTrack, loader 0x461c8c. isChase is 0x461c84. */
function readTrack(ini, index) {
  const s = 'track' + index;
  const three = (key) => {
    const v = ini.ints(s, key);
    return [v[0] || 0, v[1] || 0, v[2] || 0];
  };
  const chaseTime = three('chasetime');
  return {
    index,
    name: ini.str(s, 'name', '...'),
    story: ini.str(s, 'story', '...'),
    type: ini.str(s, 'type', '...'),
    nrLaps: ini.int(s, 'nrlaps', 2),
    british: ini.bool(s, 'british', false),
    winText: ini.str(s, 'wintext', '...'),
    qualifyText: ini.str(s, 'QualifyText', '...'),
    loseText: ini.str(s, 'losetext', '...'),
    indexInGame: ini.int(s, 'indexingame', 0),
    qualifyPosition: three('qualifyposition'),
    chaseTime,
    isChase: chaseTime[0] > 0,
  };
}

/** TTuneUp, loader 0x462154: SPECS<i>=name, price, dspeed, dacc, dbrakes, dhandl. */
function readTuneUp(ini, index) {
  const specs = ini.str('TUNEUPS', 'specs' + index).split(',');
  const num = (k) => Number(specs[k]) || 0;
  return {
    index,
    name: (specs[0] || '').trim(),
    price: num(1),
    dSpeed: num(2),
    dAccell: num(3),
    dBrakes: num(4),
    dHandling: num(5),
    text: ini.str('TUNEUPS', 'text' + index, '...'),
  };
}

/** Controls TSettings+0xC. Defaults of FUN_004a6b3c. */
class Controls {
  constructor() {
    this.up = 1;
    this.down = 1;
    this.left = 1;
    this.right = 1;
    this.extra1 = 1;
    this.extra2 = 1;
    this.extra3 = 1;
    this.controlType = 0;
    this.joySensitivity = 1;
    this.wheelSensitivity = 1;
  }

  static fromIni(ini) {
    const c = new Controls();
    const s = 'DEFAULTSETTINGS';
    c.up = ini.int(s, 'UP', 1);
    c.down = ini.int(s, 'Down', 1);
    c.left = ini.int(s, 'Left', 1);
    c.right = ini.int(s, 'Right', 1);
    c.extra1 = ini.int(s, 'Extra1', 1);
    c.extra2 = ini.int(s, 'Extra2', 1);
    c.extra3 = ini.int(s, 'Extra3', 1);
    c.controlType = ini.int(s, 'ControlType', 0) & 0xFF;
    c.joySensitivity = ini.int(s, 'JoySensitivity', 1);
    c.wheelSensitivity = ini.int(s, 'WheelSensitivity', 1);
    return c;
  }

  clone() {
    return Object.assign(new Controls(), this);
  }

  /** TControls.Assign 0x4a688c, all ten fields: Standaard of TfrmKeySettings resets the sensitivities too. */
  assign(other) {
    Object.assign(this, other);
  }

  /** [INPUT] DEVICE, FUN_004a6a38. */
  get inputDevice() {
    return [1, 3, 2, 4][this.controlType] ?? 1;
  }

  /** [INPUT] SENSITIVITY, FUN_004a6a70. */
  get sensitivity() {
    return this.controlType === 3 ? this.wheelSensitivity : this.joySensitivity;
  }
}

/** TSettings. Defaults of FUN_004a6de4. */
class Settings {
  constructor() {
    this.difficulty = 1;
    this.resolution = 1;
    this.fxVolume = 100;
    this.musicVolume = 100;
    this.voicesVolume = 100;
    this.fxOn = true;
    this.musicOn = true;
    this.voicesOn = true;
    this.startInfoOn = true;
    this.alphaBlending = true;
    this.bilinear = true;
    this.waitVbl = false;
    this.mipmapping = false;
    this.gamma = 0;
    this.textureMem = 1;
    this.driverIndex = 0;
    this.renderFocus = 0;
    // Not in the save: TfrmDisplaySettings set these for the next race only.
    this.guid = null;
    this.guidChanged = false;
    this.controls = new Controls();
  }

  static fromIni(ini) {
    const t = new Settings();
    const s = 'DEFAULTSETTINGS';
    t.difficulty = ini.int(s, 'DIFFICULTY', 1) & 0xFF;
    t.resolution = ini.int(s, 'RESOLUTION', 1);
    t.musicVolume = ini.int(s, 'MUSICVOLUME', 100);
    t.fxVolume = ini.int(s, 'FXVOLUME', 100);
    t.voicesVolume = ini.int(s, 'VOICESVOLUME', 100);
    t.musicOn = ini.bool(s, 'MUSICON', true);
    t.fxOn = ini.bool(s, 'FXON', true);
    t.voicesOn = ini.bool(s, 'VOICESON', true);
    t.startInfoOn = ini.bool(s, 'SHOWSTARTINFO', true);
    t.alphaBlending = ini.bool(s, 'AlphaBlending', true);
    t.bilinear = ini.bool(s, 'BiliniarFiltering', true);
    t.waitVbl = ini.bool(s, 'WaitVbl', false);
    t.mipmapping = ini.bool(s, 'Mipmapping', false);
    t.gamma = ini.int(s, 'Gamma', 0);
    t.renderFocus = ini.int(s, 'RenderFocus', 0);
    t.driverIndex = ini.int(s, 'DriverIndex', 0);
    t.controls = Controls.fromIni(ini);
    return t;
  }

  clone() {
    return new Settings().assign(this);
  }

  assign(other) {
    Object.assign(this, other);
    this.controls = other.controls.clone();
    return this;
  }

  /** [GFX OPTIONS] CUSTOM_TEXTURE_MEMORY, FUN_004a7160. */
  get textureMemoryBytes() {
    return [0x200000, 0x800000, 0x1000000][this.textureMem] ?? 0x800000;
  }
}

/** [QUICKRACE] and [TOURRACE], TRace. Loader FUN_0046284c. */
class RaceList {
  constructor(ini, section, tracks, chars) {
    this.tracks = tracks;
    this.chars = chars;
    this.defaultChar = ini.int(section, 'defaultchar', 0);
    this.trackIx = ini.ints(section, 'trackix');
    this.charIx = ini.ints(section, 'charix');
  }

  get trackCount() {
    return this.trackIx.length;
  }

  get charCount() {
    return this.charIx.length;
  }

  trackAt(pos) {
    return this.tracks[this.trackIx[pos]];
  }

  charAt(pos) {
    return this.chars[this.charIx[pos]];
  }

  /** GetRaceIndex 0x462620; -1 where the original raises. */
  positionOfTrack(track) {
    return this.trackIx.indexOf(track.index);
  }
}

/** TStatic.LoadFromIniFile 0x48e148. Text stays Latin-1 as in the file: no 0x80..0x9F bytes occur in it. */
function readStatic(vfs) {
  const ini = new IniReader(vfs.parsedIni('static.ini'));
  const chars = [];
  const tracks = [];
  const trackCount = ini.int('GENERAL', 'trackcount', 0);
  for (let n = 0; n < trackCount; n++) tracks.push(readTrack(ini, n));
  const charCount = ini.int('GENERAL', 'charcount', 0);
  for (let n = 0; n < charCount; n++) chars.push(readCharacter(ini, n));
  const quickRace = new RaceList(ini, 'QUICKRACE', tracks, chars);
  // Port: Vianen as the last Quick Race track, source/host/vianen.js. Not in the Tour.
  const vianen = vianenTrack(tracks.length);
  tracks.push(vianen);
  quickRace.trackIx.push(vianen.index);
  const boxmeer = boxmeerTrack(tracks.length);
  tracks.push(boxmeer);
  quickRace.trackIx.push(boxmeer.index);
  quickRace.downloadSection = ini.str('QUICKRACE', 'DOWNLOADSECTION', 'DOWNLOADCAR');
  quickRace.downloadCharIx = ini.int('QUICKRACE', 'DOWNLOADCHARIX', 0);
  quickRace.lockedCharText = ini.str('QUICKRACE', 'LOCKEDCHARTEXT', 'locked!');
  quickRace.lockedCharIx = ini.int('QUICKRACE', 'LOCKEDCHARIX', 0);
  // FUN_0048e8f0: L0_ANIM.INI [DOWNLOADCAR] Count. Disc 1.01 has no such section, the car update adds it.
  quickRace.downloadCharAvailable = new IniReader(vfs.parsedIni('L0_ANIM.INI')).int(quickRace.downloadSection, 'Count', 0) > 0;
  return {
    chars,
    tracks,
    quickRace,
    tour: new RaceList(ini, 'TOURRACE', tracks, chars),
    tuneUps: [0, 1, 2, 3, 4].map((i) => readTuneUp(ini, i)),
    downloadUrl: ini.str('GENERAL', 'DownLoadURL', 'http//:www.davilex.nl'),
    firstPlaceBonus: ini.int('GAMEVALUES', 'FirstPlaceBonus', 2500),
    turboOilAmount: ini.int('GAMEVALUES', 'TurboOilAmount', 10),
    checkpointTime: [0, 1, 2].map((d) => ini.int('CheckPointTime', 'difficulty' + d, 110)),
    defaultSettings: Settings.fromIni(ini),
    /** GetCharacterByGameIndex 0x48e510. */
    charByGameIndex(car) {
      return chars.find((c) => c.indexInGame === car) || null;
    },
  };
}

// --- the save file ------------------------------------------------------------------------

// Stream order of TSettings 0x4a63f4 and its TControls 0x4a6cf4. Enums are written as int32.
const SETTINGS_INTS = ['difficulty', 'resolution', 'fxVolume', 'musicVolume', 'voicesVolume'];
const SETTINGS_BOOLS = ['fxOn', 'musicOn', 'voicesOn', 'startInfoOn', 'alphaBlending', 'bilinear', 'waitVbl', 'mipmapping'];
const SETTINGS_INTS_2 = ['gamma', 'textureMem', 'driverIndex', 'renderFocus'];
const CONTROLS_INTS = ['up', 'down', 'left', 'right', 'extra1', 'extra2', 'extra3', 'controlType', 'joySensitivity', 'wheelSensitivity'];

/** Reads little-endian fields. A short file throws, as TStream.ReadBuffer raises. */
class SaveReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  int() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bool() {
    return this.view.getUint8(this.pos++) !== 0;
  }

  /** ShortString: a length byte, then a fixed room for the characters. */
  shortString(room) {
    const n = Math.min(this.view.getUint8(this.pos), room - 1);
    let s = '';
    for (let k = 1; k <= n; k++) s += String.fromCharCode(this.view.getUint8(this.pos + k));
    this.pos += room;
    return s;
  }
}

class SaveWriter {
  constructor() {
    this.out = [];
  }

  int(v) {
    const n = Math.trunc(v) | 0;
    this.out.push(n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF);
  }

  bool(v) {
    this.out.push(v ? 1 : 0);
  }

  shortString(s, room) {
    const b = encodeLatin1(String(s).slice(0, room - 1));
    this.out.push(b.length, ...b);
    for (let k = b.length + 1; k < room; k++) this.out.push(0);
  }

  bytes() {
    return Uint8Array.from(this.out);
  }
}

/** TCharResult: one Tour character's career. Stream order 0x48da18: next track, money, turbo, 5 flags. */
class CharResult {
  constructor(statics) {
    this.statics = statics;
    this.points = 0;
    this.trackReached = 0;
    this.turboAmount = 0;
    this.tuneUps = [false, false, false, false, false];
  }

  /** FPoints +8. Setter 0x48dca4 stops at 0; the menu has no upper limit. */
  get euro() {
    return this.points;
  }

  set euro(v) {
    this.points = Math.max(0, v);
  }

  /** +0x10. Setter 0x48dcb4 keeps 0..100. */
  get turbo() {
    return this.turboAmount;
  }

  set turbo(v) {
    this.turboAmount = Math.min(100, Math.max(0, v));
  }

  hasTuneUp(i) {
    return this.tuneUps[i];
  }

  /** 0x48dc38. */
  clearTuneUps() {
    this.tuneUps.fill(false);
  }

  /** Sum of a delta over bought tune-ups: 0x48d8c8, 0x48d90c, 0x48d950, 0x48d994. */
  bonus(field) {
    return this.statics.tuneUps.reduce((sum, t, i) => (this.tuneUps[i] ? sum + t[field] : sum), 0);
  }

  get speedBonus() {
    return this.bonus('dSpeed');
  }

  get accellBonus() {
    return this.bonus('dAccell');
  }

  get brakesBonus() {
    return this.bonus('dBrakes');
  }

  get handlingBonus() {
    return this.bonus('dHandling');
  }

  /** Buy a tune-up without checks: 0x48d9d8. */
  applyTuneUp(i) {
    this.tuneUps[i] = true;
    this.euro -= this.statics.tuneUps[i].price;
  }

  /** Turbo oil: 0x48dc4c. Flag 4 stays clear: the amount is the only turbo state. */
  applyTurboOil() {
    this.turbo += this.statics.turboOilAmount;
    this.euro -= this.statics.tuneUps[4].price;
  }

  /** 0x48dcdc: every Tour track done. */
  get isFinished() {
    return this.statics.tour.trackCount <= this.trackReached;
  }

  /** 0x48dd00. */
  advance() {
    if (this.statics.tour.trackCount > this.trackReached) this.trackReached++;
  }

  read(r) {
    this.trackReached = r.int();
    this.points = r.int();
    this.turboAmount = r.int();
    for (let i = 0; i < 5; i++) this.tuneUps[i] = r.bool();
  }

  write(w) {
    w.int(this.trackReached);
    w.int(this.points);
    w.int(this.turboAmount);
    for (let i = 0; i < 5; i++) w.bool(this.tuneUps[i]);
  }
}

/** TPlayer, the save object SaveGame+8..+0x1C. Stream order 0x48ad68. Layout: startup-flow.md section 6. */
class Player {
  constructor(statics) {
    this.statics = statics;
    this.name = '';
    this.settings = new Settings();
    this.tour = { charIx: 0, trackIx: 0, results: statics.tour.charIx.map(() => new CharResult(statics)) };
    this.qr = { charIx: 0, trackIx: 0, harryUnlocked: false };
    this.trackToDrive = 0;
    this.tourStarted = false;
  }

  /** CreateNewPlayer 0x48c24c. */
  static createNew(statics, name) {
    const p = new Player(statics);
    p.name = name;
    p.tour.charIx = statics.tour.defaultChar;
    p.qr.charIx = statics.quickRace.defaultChar;
    p.settings.assign(statics.defaultSettings);
    p.tourStarted = false;
    return p;
  }

  static fromBytes(statics, bytes) {
    const r = new SaveReader(bytes);
    const p = new Player(statics);
    p.name = r.shortString(33);
    r.int(); // Tour character copy in the header, read by BuildFileList only
    const s = p.settings;
    for (const k of SETTINGS_INTS) s[k] = r.int();
    for (const k of SETTINGS_BOOLS) s[k] = r.bool();
    for (const k of SETTINGS_INTS_2) s[k] = r.int();
    for (const k of CONTROLS_INTS) s.controls[k] = r.int();
    p.tour.charIx = r.int();
    p.tour.trackIx = r.int();
    for (const result of p.tour.results) result.read(r);
    p.qr.charIx = r.int();
    p.qr.trackIx = r.int();
    p.qr.harryUnlocked = r.bool();
    p.trackToDrive = r.int();
    if (!p.tour.results[p.tour.charIx] || !statics.quickRace.charAt(p.qr.charIx) || !statics.tracks[p.trackToDrive]) {
      throw new RangeError('index out of range in save');
    }
    return p;
  }

  /** SaveToStream 0x48ae64. */
  toBytes() {
    const w = new SaveWriter();
    w.shortString(this.name, 33);
    w.int(this.tour.charIx);
    const s = this.settings;
    for (const k of SETTINGS_INTS) w.int(s[k]);
    for (const k of SETTINGS_BOOLS) w.bool(s[k]);
    for (const k of SETTINGS_INTS_2) w.int(s[k]);
    for (const k of CONTROLS_INTS) w.int(s.controls[k]);
    w.int(this.tour.charIx);
    w.int(this.tour.trackIx);
    for (const result of this.tour.results) result.write(w);
    w.int(this.qr.charIx);
    w.int(this.qr.trackIx);
    w.bool(this.qr.harryUnlocked);
    w.int(this.trackToDrive);
    return w.bytes();
  }

  /** 0x48d458. */
  get result() {
    return this.tour.results[this.tour.charIx];
  }

  get euro() {
    return this.result.euro;
  }

  set euro(v) {
    this.result.euro = v;
  }

  /** 0x48c22c. */
  get tourChar() {
    return this.statics.tour.charAt(this.tour.charIx);
  }

  /** 0x48c20c. */
  get qrChar() {
    return this.statics.quickRace.charAt(this.qr.charIx);
  }

  /** 0x48c624. */
  get tourTrack() {
    return this.statics.tour.trackAt(this.tour.trackIx);
  }

  /** 0x48c604. */
  get qrTrack() {
    return this.statics.quickRace.trackAt(this.qr.trackIx);
  }

  /** 0x49ed24: the track of the race just driven or about to be. */
  get trackDriven() {
    return this.statics.tracks[this.trackToDrive];
  }

  /** 0x48c644: did any Tour character reach this track? */
  reachedInTour(track) {
    const pos = this.statics.tour.positionOfTrack(track);
    return pos >= 0 && this.tour.results.some((r) => r.trackReached >= pos);
  }
}

// --- the data module ----------------------------------------------------------------------

export class GameData {
  constructor(vfs, { files } = {}) {
    this.vfs = vfs;
    this.files = files || null;
    this.app = null;
    this.RR = RR;
    this.flow = { startUp, afterRace, closeRequested, askPlayerName, startInfoThenRace, helpRequested, unexpectedError };
    this.static = null;
    this.menuIni = null;
    this.controlKeys = [];
    this.player = null;
    this.gameIni = null;
    this.rankList = [];
    this.raceMode = 0;
    this.resultFlags = 0;
    this.playerPos = 0;
    this.allowExit = false;
    this.playerDialogBackup = null;
    this.testRoute = false;
  }

  /** The parts of TData.DataCreate 0x47efb8 that survive the whole page. */
  async load() {
    // A deleted save stays in IndexedDB as an empty file: Persist has no delete.
    for (const path of this.vfs.list()) {
      if (SAVE_NAME.test(path) && this.vfs.stat(path).size === 0) this.vfs.remove(path);
    }
    this.static = readStatic(this.vfs);
    this.readMenuIni();
    this.readControlKeys();
    const params = globalThis.location ? new URLSearchParams(globalThis.location.search) : null;
    if (params && params.has('form')) this.prepareFormTest(params);
    else this.watchPageClose();
  }

  /** The original saved on exit only. A closed tab never reaches DataDestroy. */
  watchPageClose() {
    const save = () => {
      if (this.player) this.saveProgress();
    };
    globalThis.addEventListener?.('pagehide', save);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (globalThis.document.hidden) save();
    });
  }

  /** The ?form= route reaches screens without StartUp: give them a player and a race result. */
  prepareFormTest(params) {
    this.testRoute = true;
    const mode = Number(params.get('mode') ?? 2);
    this.raceMode = mode;
    this.menuIni.prevState = mode;
    this.resultFlags = Number(params.get('flags') ?? 0);
    const n = this.menuIni.currentPlayer;
    if (n >= 0 && this.vfs.exists(saveFile(n))) {
      this.player = Player.fromBytes(this.static, this.vfs.read(saveFile(n)));
    } else {
      // Edgar in both modes: the shipped game.ini has cars 1 to 4 as his opponents.
      this.player = Player.createNew(this.static, 'Speler');
      this.player.tour.charIx = 0;
      this.player.qr.charIx = 0;
    }
    this.player.tourStarted = true;
    this.gameIni = this.readGameIni();
    this.fillRankResults();
  }

  /**
   * What each start of menu.exe began with: the previous run's memory is gone and menu.ini is
   * read again. /FIRSTTIME forces FPrevious to 0 (0x48ef4b) and skips game.ini.
   */
  beginMenuRun(firstTime) {
    this.readMenuIni();
    this.menuIni.firstTime = firstTime;
    if (firstTime) this.menuIni.prevState = 0;
    this.allowExit = false;
    this.raceMode = 0;
    this.resultFlags = 0;
    this.playerPos = 0;
    this.rankList = [];
    this.player = null;
    this.playerDialogBackup = null;
    this.testRoute = false;
    this.gameIni = firstTime ? null : this.readGameIni();
  }

  /** Quit without DoExit: Application.Terminate. DataDestroy forces RaceMode 0. */
  async terminate() {
    this.allowExit = false;
    await this.leaveMenu();
  }

  /** DoExit 0x47ff64: Application.Terminate with AllowExit, so RaceMode decides what follows. */
  async doExit() {
    this.allowExit = true;
    await this.leaveMenu();
  }

  /** The process ends here: DataDestroy, then what the launcher did with EXITCODE 40 or 255. */
  async leaveMenu() {
    this.dataDestroy();
    this.sound?.stopAll();
    if (!this.app) return;
    if (this.raceMode !== 0) await this.app.startRace();
    else await this.app.exitGame();
  }

  /** TData.DataDestroy 0x47f4ac: game.ini and raser.ini only for a race, then the save, then menu.ini. */
  dataDestroy() {
    if (!this.allowExit) this.raceMode = 0;
    else if (this.raceMode !== 0) this.writeToInis();
    if (this.player) this.savePlayer();
    this.saveMenuIni();
  }

  // --- menu.ini ---------------------------------------------------------------------------

  /** TMenuIni.DoLoadFromFile 0x48edec. Default 0 for both, as the code has it. */
  readMenuIni() {
    const ini = new IniReader(this.vfs.parsedIni('menu.ini'));
    const highscores = [];
    for (let i = 0; i < this.static.tracks.length; i++) {
      highscores.push({ time: ini.int('HIGHSCORES', String(i), 0), name: ini.str('HIGHSCORES', 'name' + i, '<no name>') });
    }
    this.menuIni = {
      firstTime: false,
      currentPlayer: ini.int('GENERAL', 'CURRENTPLAYER', 0),
      prevState: ini.int('GENERAL', 'PREVSTATE', 0),
      timeFormat: ini.str('FORMAT', 'TIME', ''),
      introAvi: ini.str('GENERAL', 'INTROAVI', ''),
      highscores,
    };
  }

  /** TMenuIni.DoSaveToFile 0x48f168. EXITCODE was the launcher's only input. */
  saveMenuIni() {
    const w = new IniWriter(this.vfs, 'menu.ini');
    w.writeInteger('GENERAL', 'CURRENTPLAYER', this.menuIni.currentPlayer);
    w.writeInteger('GENERAL', 'PREVSTATE', this.raceMode);
    w.writeInteger('GENERAL', 'EXITCODE', this.raceMode !== 0 ? 40 : 255);
    this.menuIni.highscores.forEach((h, i) => {
      w.writeInteger('HIGHSCORES', String(i), h.time);
      w.writeString('HIGHSCORES', 'name' + i, h.name);
    });
    w.close();
  }

  /** Global string table 0x487270. Keys are 1-based. */
  menuString(n) {
    return this.vfs.parsedIni('menu.ini').get('MenuStrings', String(n)) ?? '';
  }

  menuFormat(n, ...args) {
    return delphiFormat(this.menuString(n), ...args);
  }

  ordinalNumber(n) {
    return this.vfs.parsedIni('menu.ini').get('OrdinalNumbers', String(n)) ?? '';
  }

  ordinalWord(n) {
    return this.vfs.parsedIni('menu.ini').get('OrdinalWords', String(n)) ?? '';
  }

  /** FUN_00481090. */
  formatTime(ms) {
    const minutes = Math.trunc(ms / 60000);
    const seconds = Math.trunc(ms / 1000) % 60;
    const hundredths = Math.trunc(ms / 10) % 100;
    return delphiFormat(this.menuIni.timeFormat, minutes, seconds, hundredths);
  }

  /** FUN_00491fa4: [CONTROLKEYS] <i>=VK,Name for i below count. Entry 0 is 'no key'. */
  readControlKeys() {
    const ini = new IniReader(this.vfs.parsedIni('menu.ini'));
    const count = ini.int('CONTROLKEYS', 'count', 0);
    this.controlKeys = [];
    for (let i = 0; i < count; i++) {
      const v = ini.str('CONTROLKEYS', String(i));
      const comma = v.indexOf(',');
      this.controlKeys.push({ vk: Number(v.slice(0, comma)) || 0, name: v.slice(comma + 1) });
    }
  }

  keyName(vk) {
    return this.controlKeys.find((k) => k.vk === vk)?.name ?? '';
  }

  isControlKey(vk) {
    return vk !== 0 && this.controlKeys.some((k) => k.vk === vk);
  }

  /** 0x499f80, the Track screen's requirement. */
  qualifyCaption(track) {
    if (track.isChase) return this.menuString(8);
    const position = track.qualifyPosition[this.player.settings.difficulty];
    return this.menuFormat(14, this.ordinalNumber(position + 1));
  }

  // --- players ----------------------------------------------------------------------------

  /** FUN_0047f840: throws when the file is absent or short, as the original raises. */
  loadPlayer(n) {
    const name = saveFile(n);
    const bytes = this.vfs.exists(name) ? this.vfs.read(name) : null;
    if (!bytes) throw new Error('Unable to load: ' + name);
    let player;
    try {
      player = Player.fromBytes(this.static, bytes);
    } catch (e) {
      throw new Error('Unable to load: ' + name + ' (' + e.message + ')');
    }
    // TPlayer.LoadFromFile 0x48af60.
    player.tourStarted = true;
    this.readInstalledResolution(player);
    this.player = player;
    this.menuIni.currentPlayer = n;
    this.applySoundSettings();
  }

  /** FUN_0047fa5c. Only the ?form= route gets here without a number. */
  savePlayer() {
    if (this.menuIni.currentPlayer < 0) this.menuIni.currentPlayer = this.lowestFreeSave();
    this.vfs.write(saveFile(this.menuIni.currentPlayer), this.player.toBytes());
  }

  lowestFreeSave() {
    let n = 0;
    while (this.vfs.exists(saveFile(n))) n++;
    return n;
  }

  /** FUN_0047fbd4: lowest free number, saved at once, becomes current. */
  createPlayer(name) {
    const player = Player.createNew(this.static, name);
    player.settings.textureMem = this.readTextureMemorySetting();
    this.readInstalledResolution(player);
    this.player = player;
    this.menuIni.currentPlayer = this.lowestFreeSave();
    this.savePlayer();
    this.applySoundSettings({ music: false });
  }

  /** FUN_0047fdc8. The empty file is a tombstone for IndexedDB, see load(). */
  deletePlayer(n) {
    this.removeSave(saveFile(n));
  }

  removeSave(name) {
    this.vfs.write(name, new Uint8Array(0));
    this.vfs.remove(name);
  }

  saveNames() {
    return this.vfs.list().filter((p) => SAVE_NAME.test(p));
  }

  /** BuildFileList 0x493338 with CreateAndReadHeader 0x492dd8: everyone but the current player. */
  otherPlayers() {
    const list = [];
    for (const path of this.saveNames()) {
      const number = Number(SAVE_NAME.exec(path)[1]);
      if (number === this.menuIni.currentPlayer) continue;
      try {
        const r = new SaveReader(this.vfs.read(path));
        const name = r.shortString(33);
        list.push({ number, name, tourChar: this.static.tour.charAt(r.int()) });
      } catch (e) {
        console.warn('Unable to load: ' + path, e);
      }
    }
    return list.sort((a, b) => a.number - b.number);
  }

  /** InitDlg 0x49354c: save, then every save to .BAK. The port keeps that copy in memory. */
  beginPlayerDialog() {
    this.savePlayer();
    const files = new Map(this.saveNames().map((path) => [path, this.vfs.read(path).slice()]));
    this.playerDialogBackup = { current: this.menuIni.currentPlayer, files };
  }

  /** ExitDlg 0x493658 with RestoreBackups 0x493ac8: result 2 puts all files back. */
  endPlayerDialog(modalResult) {
    const backup = this.playerDialogBackup;
    this.playerDialogBackup = null;
    if (modalResult !== 2 || !backup) return;
    for (const path of this.saveNames()) this.removeSave(path);
    for (const [path, bytes] of backup.files) this.vfs.write(path, bytes);
    this.loadPlayer(backup.current);
  }

  /** ReadInstalledResolution 0x48c07c. */
  readInstalledResolution(player) {
    player.settings.resolution = new IniReader(this.vfs.parsedIni('raser.ini')).int('PROGRAM', 'RESOLUTION', 3);
  }

  /** ReadTextureMemory 0x480dd4. */
  readTextureMemorySetting() {
    const bytes = new IniReader(this.vfs.parsedIni('game.ini')).int('GFX OPTIONS', 'CUSTOM_TEXTURE_MEMORY', 0);
    if (bytes === 0x200000) return 0;
    if (bytes === 0x1000000) return 2;
    return 1;
  }

  /** ReadAvailableTextureMemory 0x480c9c. */
  get availableTextureMemory() {
    return new IniReader(this.vfs.parsedIni('game.ini')).int('GFX OPTIONS', 'AVAILABLE_TEXTURE_MEMORY', 0);
  }

  /** Port only: the moments the original had no reason to save, because its process could not vanish. */
  saveProgress() {
    if (this.testRoute) return;
    if (this.player) this.savePlayer();
    if (this.menuIni) this.saveMenuIni();
  }

  // --- what the screens ask ---------------------------------------------------------------

  /** TTrack availability 0x461a4c. Track files load per race, so the file list counts as well as the VFS. */
  trackFilesExist(track) {
    // Port: Vianen's files load when its race starts (App.withVianen).
    if (track.vianen || track.boxmeer) return true;
    return TRACK_EXTENSIONS.every((ext) => this.fileExists('etappe' + track.indexInGame + ext));
  }

  fileExists(name) {
    if (this.vfs.exists(name)) return true;
    const lower = name.toLowerCase();
    return !!this.files?.list?.some((f) => f.name.toLowerCase() === lower);
  }

  /** FUN_0049c78c. */
  quickTrackAvailable(pos) {
    const track = this.static.quickRace.trackAt(pos);
    let available = this.trackFilesExist(track);
    if (track.isChase && !this.player.reachedInTour(track)) available = false;
    return available;
  }

  /** FUN_0049ca08. */
  quickCharAvailable(pos) {
    const q = this.static.quickRace;
    if (pos === q.downloadCharIx) return q.downloadCharAvailable;
    if (pos === q.lockedCharIx) return this.player.qr.harryUnlocked;
    return true;
  }

  /** 0x49c198. */
  selectQuickTrack(pos) {
    this.player.qr.trackIx = pos;
    this.player.trackToDrive = this.static.quickRace.trackIx[pos];
  }

  /** 0x49c6a0: true once, when the Tour was just won. The form then selects him and shows TfrmUnlock. */
  takeUnlock() {
    if (!(this.resultFlags & RR.WINRACE) || this.player.qr.harryUnlocked) return false;
    this.player.qr.harryUnlocked = true;
    this.saveProgress();
    return true;
  }

  /** 0x49a464. */
  get maxTourTrack() {
    const r = this.player.result;
    return r.isFinished ? this.static.tour.trackCount - 1 : r.trackReached;
  }

  /** 0x49a168. */
  get initialTourTrack() {
    const r = this.player.result;
    return r.isFinished ? this.player.tour.trackIx : r.trackReached;
  }

  /** 0x499600: money plays no part, so a poor player gets the dialog. */
  canBuyTuneUp(i) {
    const r = this.player.result;
    return i === 4 ? r.turbo < 100 : !r.hasTuneUp(i);
  }

  /** 0x4991f4. Turbo oil looks at the money first, the others at the flag first. */
  buyTuneUp(i) {
    const r = this.player.result;
    const affordable = r.euro >= this.static.tuneUps[i].price;
    if (i === 4) {
      if (!affordable) return 'noMoney';
      if (r.turbo >= 100) return null;
      r.applyTurboOil();
    } else {
      if (r.hasTuneUp(i)) return null;
      if (!affordable) return 'noMoney';
      r.applyTuneUp(i);
    }
    this.saveProgress();
    return 'bought';
  }

  // --- game.ini and raser.ini -------------------------------------------------------------

  /** WriteToInis 0x48c3f0. Keys and comments that are not written stay in the files. */
  writeToInis() {
    const game = new IniWriter(this.vfs, 'game.ini');
    this.writeControlStuff(game);
    this.writeGeneralStuff(game);
    if (this.raceMode === 1) this.writeQuickRaceStuff(game);
    else if (this.raceMode === 2) this.writeTourStuff(game);
    game.close();
    const raser = new IniWriter(this.vfs, 'raser.ini');
    this.writeRaserStuff(raser);
    raser.close();
  }

  /** WriteControlStuffToIni 0x48b350. */
  writeControlStuff(w) {
    const c = this.player.settings.controls;
    w.writeInteger('INPUT', 'DEVICE', c.inputDevice);
    w.writeInteger('INPUT', 'LEFT', c.left);
    w.writeInteger('INPUT', 'RIGHT', c.right);
    w.writeInteger('INPUT', 'UP', c.up);
    w.writeInteger('INPUT', 'DOWN', c.down);
    w.writeInteger('INPUT', 'EXTRA1', c.extra1);
    w.writeInteger('INPUT', 'EXTRA2', c.extra2);
    w.writeInteger('INPUT', 'EXTRA3', c.extra3);
    w.writeInteger('INPUT', 'SENSITIVITY', c.sensitivity);
  }

  /** WriteGeneralStuffToIni 0x48bcf0. */
  writeGeneralStuff(w) {
    const track = this.player.trackDriven;
    const s = this.player.settings;
    w.writeInteger('ETAPPE', 'ETAPPE', track.indexInGame);
    w.writeInteger('OPTIONS', 'NRLAPS', track.nrLaps);
    w.writeBool('OPTIONS', 'OPPONENTS', !track.isChase);
    w.writeBool('ETAPPE', 'BRITISH', track.british);
    w.writeInteger('LEAGUE', 'LEAGUE', s.difficulty);
    w.writeInteger('PLAYER', 'DAMAGE', 0);
    if (track.isChase) w.writeInteger('PLAYER', 'CHECKPOINT_SPEED', this.static.checkpointTime[s.difficulty]);
    w.writeInteger('GFX OPTIONS', 'gamma', s.gamma);
    w.writeBool('GFX OPTIONS', 'alpha_blending', s.alphaBlending);
    w.writeInteger('GFX OPTIONS', 'CUSTOM_TEXTURE_MEMORY', s.textureMemoryBytes);
    w.writeBool('OPTIONS', 'waitvbl', s.waitVbl);
    w.writeInteger('OPTIONS', 'filter', s.bilinear ? 2 : 0);
  }

  /** WriteQRStuffToIni 0x48b5bc: a Quick Race car has everything and no career. */
  writeQuickRaceStuff(w) {
    w.writeInteger('PLAYER', 'MONEY', 0);
    w.writeInteger('PLAYER', 'CAR', this.player.qrChar.indexInGame);
    w.writeInteger('PLAYER', 'TURBO_AMOUNT', 100);
    w.writeBool('PLAYER', 'MOTOR', true);
    w.writeBool('PLAYER', 'BANDEN', true);
    w.writeBool('PLAYER', 'ABS', true);
    w.writeBool('PLAYER', 'VERSNELLINGSBAK', true);
    w.writeInteger('PLAYER', 'POSITION', 4);
  }

  /** WriteVRStuffToIni 0x48b7c8. */
  writeTourStuff(w) {
    const r = this.player.result;
    w.writeInteger('PLAYER', 'MONEY', r.euro);
    w.writeInteger('PLAYER', 'CAR', this.player.tourChar.indexInGame);
    w.writeBool('PLAYER', 'MOTOR', r.hasTuneUp(0));
    w.writeBool('PLAYER', 'BANDEN', r.hasTuneUp(1));
    w.writeBool('PLAYER', 'ABS', r.hasTuneUp(2));
    w.writeBool('PLAYER', 'VERSNELLINGSBAK', r.hasTuneUp(3));
    w.writeInteger('PLAYER', 'TURBO_AMOUNT', r.turbo);
    w.writeInteger('PLAYER', 'POSITION', 4);
  }

  /** FUN_0048ba20, in the code gap after the game.ini half. */
  writeRaserStuff(w) {
    const s = this.player.settings;
    w.writeInteger('PROGRAM', 'RESOLUTION', s.resolution);
    w.writeInteger('SOUND', 'MUSICVOLUME', s.musicOn ? raserVolume(s.musicVolume) : 0);
    w.writeInteger('SOUND', 'SFXVOLUME', s.fxOn ? raserVolume(s.fxVolume) : 0);
    w.writeInteger('SOUND', 'POLICEVOLUME', s.voicesOn ? raserVolume(s.voicesVolume) : 0);
    w.writeInteger('directx', 'index', s.driverIndex);
    if (s.guidChanged && s.guid) w.writeString('directx', 'guid', s.guid);
    w.writeInteger('program', 'resolution', s.resolution);
    w.writeInteger('program', 'focus', s.renderFocus);
  }

  /** TGameIni.DoLoadFromFile 0x48a300. The list of laps skips keys that do not exist; stale ones stay. */
  readGameIni() {
    const ini = new IniReader(this.vfs.parsedIni('game.ini'));
    const g = {
      money: ini.int('PLAYER', 'MONEY', 0),
      turboAmount: ini.int('PLAYER', 'TURBO_AMOUNT', 0),
      finished: ini.bool('PLAYER', 'FINISHED', false),
      outOfTime: ini.bool('PLAYER', 'Out_Of_Time', false),
      totalLoss: ini.bool('PLAYER', 'Total_Loss', false),
      trackTime: ini.int('PLAYER', 'TRACKTIME', 0),
      lapTimes: [],
      racers: [],
      /** 0x48a6ac: none of the three flags, so the player quit, or was arrested. */
      get playerAborted() {
        return !this.finished && !this.outOfTime && !this.totalLoss;
      },
    };
    for (let i = 1; i <= 5; i++) {
      if (ini.has('PLAYER', `LAP_${i}_TIME`)) g.lapTimes.push(ini.int('PLAYER', `LAP_${i}_TIME`, 0));
    }
    for (let i = 0; i < 4; i++) {
      // Field 0: car, field 1: finish slot, field 2: time.
      const f = ini.str('RACERS', String(i)).split(',');
      const c = this.static.charByGameIndex(Number(f[0]));
      if (!c) console.warn('charby index not found', f[0]);
      g.racers.push({ charIx: c ? c.index : -1, time: Number(f[2]) || 0 });
    }
    return g;
  }

  // --- race results -----------------------------------------------------------------------

  /** FillRankResults 0x48003c. */
  fillRankResults() {
    const g = this.gameIni;
    let playerChar = 0;
    if (this.menuIni.prevState === 1) playerChar = this.player.qrChar.index;
    else if (this.menuIni.prevState === 2) playerChar = this.player.tourChar.index;
    this.rankList = [];
    for (const racer of g.racers) {
      if (racer.charIx === playerChar) console.warn('double racers : ', playerChar);
      this.rankList.push({ charIx: racer.charIx, time: racer.time });
    }
    this.rankList.push({ charIx: playerChar, time: g.trackTime });
    vclQuickSort(this.rankList, (a, b) => a.time - b.time);
    this.playerPos = this.rankList.findIndex((r) => r.charIx === playerChar);
  }

  /**
   * CheckIfBestLap 0x49ed60. One best lap per track, global, in menu.ini: a later lower lap
   * overwrites. askName(prefill) is the name dialog; the original loops until it has a name.
   */
  async checkIfBestLap(askName) {
    const track = this.player.trackDriven;
    const highscore = this.menuIni.highscores[this.player.trackToDrive];
    for (let lap = 0; lap < track.nrLaps; lap++) {
      const time = this.gameIni.lapTimes[lap];
      if (time !== undefined && time < highscore.time) {
        this.resultFlags |= RR.BESTLAP;
        highscore.time = time;
      }
    }
    if (!(this.resultFlags & RR.BESTLAP)) return;
    let name = this.player.name.slice(0, 12);
    do {
      name = await askName(name);
    } while (!name);
    highscore.name = name;
  }

  /** FillRaceResultsQR 0x4a54dc. The first test reads the Tour track (0x48c624), as the original does. */
  async fillRaceResultsQR(askName) {
    if (this.player.tourTrack.isChase) this.resultFlags |= RR.CHASE;
    if (!this.gameIni.finished) return;
    if (!this.player.qrTrack.isChase) this.fillRankResults();
    await this.checkIfBestLap(askName);
  }

  /** FillRaceResultsTour 0x4a5624. Money and turbo change only when the race was finished. */
  async fillRaceResultsTour(askName) {
    const track = this.player.tourTrack;
    if (track.isChase) this.resultFlags |= RR.CHASE;
    if (!this.gameIni.finished) return;
    const r = this.player.result;
    r.clearTuneUps();
    r.euro = this.gameIni.money;
    r.turbo = this.gameIni.turboAmount;
    if (track.isChase) {
      await this.checkIfBestLap(askName);
      this.checkChaseQualify();
      return;
    }
    this.fillRankResults();
    await this.checkIfBestLap(askName);
    if (this.playerPos === 0) this.processFirstPosition();
    else if (this.playerPos <= track.qualifyPosition[this.player.settings.difficulty]) this.processQualify();
  }

  /** CheckChaseQualify 0x49eef0: no replay guard, so a replayed chase still moves the career on. */
  checkChaseQualify() {
    const p = this.player;
    this.resultFlags |= RR.QUALIFY;
    p.result.advance();
    if (this.static.tour.trackCount - 1 === p.tour.trackIx) this.resultFlags |= RR.WINRACE;
  }

  /** Process1stPosition 0x49f010: the bonus comes with every win, replays too. */
  processFirstPosition() {
    const p = this.player;
    if (p.result.trackReached === p.tour.trackIx) p.result.advance();
    this.resultFlags |= RR.WINTRACK;
    p.result.euro += this.static.firstPlaceBonus;
  }

  /** ProcessQualify 0x49f100. */
  processQualify() {
    const p = this.player;
    this.resultFlags |= RR.QUALIFY;
    if (p.result.trackReached === p.tour.trackIx) p.result.advance();
  }

  // --- sound and notes --------------------------------------------------------------------

  get sound() {
    return this.app?.menu?.sound ?? null;
  }

  /**
   * FX and voices read the current settings at play time (0x480428, 0x4807a8), static defaults
   * without a player. Music changes only when asked: 0x48af60 sets it, creating a player does not.
   */
  applySoundSettings({ music = true } = {}) {
    const sound = this.sound;
    if (!sound) return;
    const s = this.player ? this.player.settings : this.static.defaultSettings;
    sound.setVolumes({ fx: soundPercent(s.fxVolume), voice: soundPercent(s.voicesVolume) });
    if (music) sound.setVolumes({ music: soundPercent(s.musicVolume) });
  }

  /** SetMusicVolume 0x482830. */
  previewMusicVolume(v) {
    this.sound?.setVolumes({ music: soundPercent(v) });
  }

  /** For options that cannot apply in a browser. */
  notApplicable(text) {
    const rt = this.app?.menu;
    if (!rt) {
      console.info(text);
      return Promise.resolve();
    }
    return showNote(rt, text);
  }
}
