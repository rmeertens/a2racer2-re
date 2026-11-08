// The Vianen etappe, an addition of the port: a first sketch of a track through Vianen's old town,
// made by tools/vianen/build-track.py. It is etappe 10, a slot the original reserves but never
// fills: raser.ini [MAPS] has rows 10 and 11 without files. So it needs, next to its own track files
// and textures: etappe10.ini and e10_anim.ini, here copies of Amsterdam's (the objects it places
// come from there), opponent.ini values for etappe 10 (Amsterdam's), and its [MAPS] row. Records
// are kept under track 10. The files live in memory only and nothing of another etappe changes.
import { IniFile, encodeLatin1, latin1 } from './vfs.js';

export const VIANEN = { key: 'vianen', name: 'Vianen', type: 'Stadsrace', slot: 10, laps: 2, like: 0 };
const TRACK = ['rmp', 'pmp', 'dmp', 'cmp', 'omp', 'pth'];
const TEXTURES = ['vn_weg.tga', 'vn_gras.tga', 'vn_gevel.tga'];
const BASE = 'assets/vianen/';

/** All files the etappe needs, by name. */
export function vianenFiles() {
  return [...TRACK.map((ext) => `vianen.${ext}`), ...TEXTURES];
}

/** Amsterdam's files it copies: they load per race, so in a browser they may not be there yet. */
function likeFiles() {
  return [`etappe${VIANEN.like}.ini`, `e${String(VIANEN.like).padStart(2, '0')}_anim.ini`];
}

/** In a browser: fetches the files. */
export async function fetchVianen() {
  const files = new Map();
  const names = [...vianenFiles().map((n) => [n, BASE + n]), ...likeFiles().map((n) => [n, 'assets/game/' + n])];
  await Promise.all(names.map(async ([name, url]) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Vianen: ${name} ${r.status}`);
    files.set(name, new Uint8Array(await r.arrayBuffer()));
  }));
  return files;
}

/** Makes etappe 10 Vianen. files: name to bytes. Can be called again: it changes nothing twice. */
export function installVianen(vfs, files) {
  const { slot, like } = VIANEN;
  const two = String(slot).padStart(2, '0');
  const write = vfs.onWrite;
  vfs.onWrite = null;
  try {
    for (const ext of TRACK) vfs.add(`etappe${slot}.${ext}`, files.get(`vianen.${ext}`));
    for (const name of TEXTURES) vfs.add(name, files.get(name));
    const [ini, anim] = likeFiles();
    // Amsterdam's start fly-by markers lie far from Vianen: switched off (the last value).
    const etappeIni = new IniFile(latin1(files.get(ini) || vfs.read(ini)));
    for (const key of etappeIni.keys('CamMarkers')) {
      if (key.toLowerCase() === 'count') continue;
      const v = etappeIni.get('CamMarkers', key).split(',');
      v[v.length - 1] = ' 0';
      etappeIni.set('CamMarkers', key, v.join(','));
    }
    vfs.add(`etappe${slot}.ini`, encodeLatin1(etappeIni.serialize()));
    vfs.add(`e${two}_anim.ini`, files.get(anim) || vfs.read(anim));
    // ai_racer.cpp reads a value per etappe from each racer's section: Amsterdam's for Vianen.
    const opp = new IniFile(latin1(vfs.read('opponent.ini')));
    for (const sec of opp.sections()) {
      if (/^Racer \d+ Level \d+$/.test(sec) && opp.get(sec, String(slot)) === null) opp.set(sec, String(slot), opp.get(sec, String(like)));
    }
    vfs.add('opponent.ini', encodeLatin1(opp.serialize()));
  } finally {
    vfs.onWrite = write;
  }
  // raser.ini is saved with the player's data, and the race writes it: the row stays, unused elsewhere.
  vfs.iniSet('raser.ini', 'MAPS', String(slot), `1,etappe${slot},vn_weg,vn_gras,vn_gevel,vn_gevel,scrl_lo,scrl_hi,TRACK ${slot},0,10000,60,60,60,0`);
}

// --- Wenen as Vianen ----------------------------------------------------------------------------
// Etappe 3, Wenen, keeps its track and gets Vianen's looks: the name and texts in the menu, its
// pictures, the road and facade textures, and the textures of its landmark objects. Made by
// tools/vianen/reskin-wenen.py into assets/vianen/wenen/. The voice that names the track still
// says Wenen.

export const WENEN = 3;
const RESKIN = 'assets/vianen/wenen/';
const RESKIN_TEXTURES = ['weg', 'gra2', 'vang', 'oper', 'pr2', 'mus2', 'bors', 'mitt'];
const MENU_PICTURES = new Set(['trname03', ...['qtc03', 'ttc03'].flatMap((p) => [0, 1, 2, 3, 4, 5].map((k) => `${p}_0${k}`))]);
let reskinFiles = null;

/** At start, before the menu reads static.ini: track 3's name and texts, and its menu pictures. */
export function renameWenen(vfs, assets) {
  const ini = new IniFile(latin1(vfs.read('static.ini')));
  const section = ini.sections().find((s) => s.toLowerCase() === `track${WENEN}`);
  if (section) {
    for (const key of ['NAME', 'STORY', 'WINTEXT', 'LOSETEXT']) {
      const v = ini.get(section, key);
      if (v) ini.set(section, key, v.replace(/Wenen/g, 'Vianen'));
    }
    const write = vfs.onWrite;
    vfs.onWrite = null;
    vfs.add('static.ini', encodeLatin1(ini.serialize()));
    vfs.onWrite = write;
  }
  if (assets && assets.index) {
    for (const key of Object.keys(assets.index)) {
      const base = key.replace(/\.[a-z0-9]+$/, '');
      if (MENU_PICTURES.has(base)) assets.index[key] = `../vianen/wenen/${base}.png`;
    }
  }
}

/** The wait screen of a track: Vianen's for track 3. */
export function waitScreenBase(etappe) {
  return etappe === WENEN ? RESKIN : 'assets/loading/';
}

/** Before a race on track 3, once its files are loaded: textures in, names pointed at them. Returns restore(). */
export async function reskinWenenRace(vfs) {
  if (!reskinFiles) {
    reskinFiles = new Map();
    await Promise.all(RESKIN_TEXTURES.map(async (t) => {
      const r = await fetch(`${RESKIN}vn3_${t}.tga`);
      if (!r.ok) throw new Error(`Vianen: vn3_${t}.tga ${r.status}`);
      reskinFiles.set(t, new Uint8Array(await r.arrayBuffer()));
    }));
  }
  return applyWenenReskin(vfs, reskinFiles);
}

/** The same with the textures given, by short name ('weg', 'oper', ...). */
export function applyWenenReskin(vfs, files) {
  const write = vfs.onWrite;
  vfs.onWrite = null;
  let original = '';
  try {
    for (const [t, data] of files) {
      // By bare name for raser.ini [MAPS], by the object list's own path for etappe3.ini.
      vfs.add(`vn3_${t}.tga`, data);
      vfs.add(`img/objects/etappes/etappe${WENEN}/textures/vn3_${t}.tga`, data);
    }
    const ini = latin1(vfs.read(`etappe${WENEN}.ini`));
    const pattern = new RegExp(`e03_(${RESKIN_TEXTURES.join('|')})\\.tga`, 'gi');
    vfs.add(`etappe${WENEN}.ini`, encodeLatin1(ini.replace(pattern, (_, t) => `vn3_${t.toLowerCase()}.tga`)));
    const raser = new IniFile(latin1(vfs.read('raser.ini')));
    original = raser.get('MAPS', String(WENEN)) || '';
    const row = original.split(',');
    // Args 2 to 5: road, land, then gra2 and vang.
    row[2] = 'vn3_weg';
    row[4] = 'vn3_gra2';
    row[5] = 'vn3_vang';
    raser.set('MAPS', String(WENEN), row.join(','));
    vfs.add('raser.ini', encodeLatin1(raser.serialize()));
  } finally {
    vfs.onWrite = write;
  }
  // The race writes raser.ini and it is saved: Wenen's own row back afterwards.
  return () => vfs.iniSet('raser.ini', 'MAPS', String(WENEN), original);
}
