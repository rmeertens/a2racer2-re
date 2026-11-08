// The race files a network race changes, and how they are put back. The original has no
// multiplayer: here every other human drives one of the race's AI racer slots, whose AI is
// switched off (source/net/puppets.js). The slots are what the original allows, up to six
// (intel.ini says "max 6", and the racer table at 0x5973c0 holds six). The files below are
// changed in memory only, never saved, and restored after the race.
import { IniFile, encodeLatin1, latin1 } from '../host/vfs.js';

/** The most racer slots spel.dat has: 0x5973c0 holds six rows of 0x58 bytes. */
export const MAX_RACER_SLOTS = 6;

const CAR_CFG_LEAGUES = ['league0', 'league1', 'league2'];
/** RefName of the eighth player's car row in car_cfg.ini. */
export const EXTRA_CAR_NAME = 'MP_EXTRA';

function text(vfs, name) {
  const data = vfs.read(name);
  return data ? latin1(data) : '';
}

/**
 * The car index of each racer slot, as FUN_0042de60 picks them: counting up from 0 and skipping
 * the player's car.
 */
export function slotCars(localCar, count) {
  const out = [];
  for (let c = 0; out.length < count; c++) if (c !== localCar) out.push(c);
  return out;
}

/** opponent.ini has racers 0 to 3 and gaps up to 4-5: the AI is off for these slots, so copies do. */
function opponentIni(source, count) {
  let out = source;
  for (let r = 4; r < count; r++) {
    for (let level = 0; level < 3; level++) {
      if (out.includes(`[Racer ${r} Level ${level}]`)) continue;
      const head = `[Racer 3 Level ${level}]`;
      const start = out.indexOf(head);
      if (start < 0) continue;
      const end = out.indexOf('\n[', start + head.length);
      const body = out.slice(start + head.length, end < 0 ? out.length : end + 1).replace(/^;.*$/gm, '');
      out += `\r\n[Racer ${r} Level ${level}]${body}`;
    }
  }
  const ini = new IniFile(out);
  for (let level = 0; level < 3; level++) {
    for (let r = 5; r < count; r++) {
      const key = `DISTANCE${r}${r + 1}`;
      if (ini.get(`Level ${level}`, key) === null) ini.set(`Level ${level}`, key, '10');
    }
  }
  return ini.serialize();
}

function append(ini, section, name) {
  const names = ini.keys(section).map((k) => ini.get(section, k));
  if (names.includes(name)) return;
  const count = Number(ini.get(section, 'COUNT'));
  ini.set(section, String(count), name);
  ini.set(section, 'COUNT', String(count + 1));
}

/**
 * The HUD file has five finish rows (STRING_FINISH_POS_1..5, read for NrOpponents + 1 cars in
 * FUN_00493a40) and one portrait element per character (PLAYER_k, game.ini [Portraits] maps a
 * car to one). Each slot gets its own element with its human's face, so two humans may pick the
 * same car.
 */
function overlayIni(source, cars, faces) {
  const ini = new IniFile(source);
  for (let k = 6; k <= cars; k++) {
    const name = `STRING_FINISH_POS_${k}`;
    append(ini, 'STRINGS', name);
    if (!ini.sections().includes(name)) {
      for (const [key, value] of [['Parent', 'Screen'], ['Position', '0,0'], ['RGBA', '118,250,0,255'], ['Length', '14'], ['Font', 'FONT1'], ['Type', 'PROPORTIONAL'], ['Visible', 'false'], ['Alignment', 'left']]) ini.set(name, key, value);
    }
  }
  for (const [slotCar, face] of faces) {
    const name = `MP_PLAYER_${slotCar}`;
    append(ini, 'ELEMENTS', name);
    for (const [key, value] of [['Parent', 'Portraits'], ['RGBA', '255,255,255,200'], ['Anim', `PLAYER_${face}_PORTRAIT`], ['Position', '25,25,10'], ['Visible', 'false']]) ini.set(name, key, value);
  }
  return ini.serialize();
}

/**
 * car_cfg.ini looks racers up by RefName (FUN_00424660 on "RACER_%d"), so a slot's row takes
 * the rest of the row of the car its human chose. The portraits follow in game.ini.
 */
function carCfgIni(source, slots, wanted, extraCar) {
  const ini = new IniFile(source);
  for (const league of CAR_CFG_LEAGUES) {
    const rows = new Map();
    for (const key of ini.keys(league)) {
      if (key.toLowerCase() === 'count') continue;
      rows.set(Number(key), ini.get(league, key));
    }
    slots.forEach((slotCar, k) => {
      const from = rows.get(wanted[k]);
      const own = rows.get(slotCar);
      if (from === undefined || own === undefined) return;
      const fields = from.split(',');
      fields[0] = own.split(',')[0];
      ini.set(league, String(slotCar), fields.join(','));
    });
    // The eighth player's car, made outside the racer table: a row of its own, unchanged.
    const extra = extraCar === null || extraCar === undefined ? undefined : rows.get(extraCar);
    if (extra !== undefined) {
      const count = Number(ini.get(league, 'Count'));
      const fields = extra.split(',');
      fields[0] = EXTRA_CAR_NAME;
      ini.set(league, String(count), fields.join(','));
      ini.set(league, 'Count', String(count + 1));
    }
  }
  return ini.serialize();
}

/**
 * Prepares the files for a network race. remoteCars: the car each other human chose, in grid
 * order: the first MAX_RACER_SLOTS take the racer slots, a seventh the extra car. Returns the slot
 * car indices and a restore function.
 */
export function prepareRaceFiles(vfs, { localCar, remoteCars }) {
  const count = Math.min(MAX_RACER_SLOTS, remoteCars.length);
  const extraCar = remoteCars.length > MAX_RACER_SLOTS ? remoteCars[MAX_RACER_SLOTS] : null;
  const slots = slotCars(localCar, count);
  const saved = new Map();
  const replace = (name, content) => {
    if (!saved.has(name)) saved.set(name, vfs.read(name));
    vfs.add(name, encodeLatin1(content));
  };
  const write = vfs.onWrite;
  vfs.onWrite = null;
  const portraits = new Map();
  try {
    replace('intel.ini', (() => {
      const ini = new IniFile(text(vfs, 'intel.ini'));
      ini.set('GENERAL', 'NrOpponents', String(count));
      return ini.serialize();
    })());
    replace('opponent.ini', opponentIni(text(vfs, 'opponent.ini'), count));
    // The HUD file the player's car loads: 0x6fba5c 0..7 picks overlayN.ini, else overlay5.
    const overlay = `overlay${localCar >= 0 && localCar <= 7 ? localCar : 5}.ini`;
    replace(overlay, overlayIni(text(vfs, overlay), count + 1, slots.map((slotCar, k) => [slotCar, remoteCars[k]])));
    replace('car_cfg.ini', carCfgIni(text(vfs, 'car_cfg.ini'), slots, remoteCars, extraCar));
    slots.forEach((slotCar) => {
      const key = String(slotCar);
      portraits.set(key, vfs.iniGet('game.ini', 'Portraits', key));
      vfs.iniSet('game.ini', 'Portraits', key, `MP_PLAYER_${slotCar}`);
    });
    vfs.iniSet('game.ini', 'OPTIONS', 'OPPONENTS', '1');
  } finally {
    vfs.onWrite = write;
  }
  const restore = () => {
    const w = vfs.onWrite;
    vfs.onWrite = null;
    for (const [name, data] of saved) if (data) vfs.add(name, data);
    vfs.onWrite = w;
    // game.ini is saved with the player's data: put the portraits back for good.
    for (const [key, value] of portraits) vfs.iniSet('game.ini', 'Portraits', key, value ?? `PLAYER_${key}`);
  };
  return { slots, restore };
}
