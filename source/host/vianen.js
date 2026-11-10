// The Vianen etappe, an addition of the port: a first sketch of a track through Vianen's old town,
// made by tools/vianen/build-track.py. It is etappe 10, a slot the original reserves but never
// fills: raser.ini [MAPS] has rows 10 and 11 without files. So it needs, next to its own track files
// and textures: etappe10.ini and e10_anim.ini, here copies of Amsterdam's (the objects it places
// come from there), opponent.ini values for etappe 10 (Amsterdam's), and its [MAPS] row. Records
// are kept under track 10. The files live in memory only and nothing of another etappe changes.
import { IniFile, encodeLatin1, latin1 } from './vfs.js';
import { VIANEN_IMPACT_SOUNDS } from './vianen-impacts.js';

export const VIANEN = { key: 'vianen', name: 'Vianen', type: 'Stadsrace', slot: 10, laps: 2, like: 0 };
/**
 * Vianen in Quick Race, an addition of the port: a track record after the original's (static.ini
 * has ten), with its menu pictures (tools/vianen/menu-images.py). index is set when it is added.
 */
export function vianenTrack(index) {
  return {
    index,
    vianen: true,
    name: VIANEN.name,
    story: 'Door het oude Vianen: van de Grote Kerk over de brede Voorstraat met zijn linden, langs het Stadhuis, onder de Lekpoort door, over de dijk en de boogbrug, langs de gracht met de ophaalbrug en weer terug.',
    type: VIANEN.type,
    nrLaps: VIANEN.laps,
    british: false,
    winText: 'Je bent de snelste van Vianen!',
    qualifyText: 'Goed gereden door Vianen.',
    loseText: 'Vianen was je te snel af.',
    indexInGame: VIANEN.slot,
    qualifyPosition: [0, 0, 0],
    chaseTime: [0, 0, 0],
    isChase: false,
  };
}

/** Its pictures for the menu's image index (paths from assets/menu/). */
export function vianenMenuImages(index) {
  const out = { [`trname${String(index).padStart(2, '0')}.tga`]: '../vianen/menu/trname10.png' };
  for (let k = 0; k < 6; k++) out[`qtc0${VIANEN.slot}_0${k}.tga`] = `../vianen/menu/qtc010_0${k}.png`;
  return out;
}

const TRACK = ['rmp', 'pmp', 'dmp', 'cmp', 'omp', 'pth'];
const TEXTURES = ['vn_weg.tga', 'vn_land.tga', 'vn_gevel.tga', 'vn_bouw.tga', 'vn_fun.tga', 'vn_detail.tga'];
const PROPS = [
  ['vn_paal.d3d', 'VN_PAAL_ANIM', 'Vianen red-white post'],
  ['vn_lamp.d3d', 'VN_LAMP_ANIM', 'Vianen lantern post'],
  ['vn_fiets.d3d', 'VN_BIKE_ANIM', 'Vianen town bicycle'],
  ['vn_doos.d3d', 'VN_BOX_ANIM', 'Light cardboard carton', 'vn_fun.tga'],
  ['vn_kist.d3d', 'VN_CRATE_ANIM', 'Empty market crate', 'vn_fun.tga'],
  ['vn_kegel.d3d', 'VN_CONE_ANIM', 'Traffic cone', 'vn_fun.tga'],
  ['vn_bord.d3d', 'VN_SIGN_ANIM', 'Market chalkboard', 'vn_fun.tga'],
  ['vn_bank.d3d', 'VN_BENCH_ANIM', 'Wooden street bench', 'vn_fun.tga'],
  ['vn_put.d3d', 'VN_DRAIN_ANIM', 'Drain cover', 'vn_detail.tga'],
  ['vn_deksel.d3d', 'VN_COVER_ANIM', 'Manhole cover', 'vn_detail.tga'],
  ['vn_kruin.d3d', 'VN_CROWN_ANIM', 'Lime canopy layer'],
];
const MODELS = PROPS.map(([model]) => model);
const BASE = 'assets/vianen/';

/** All files the etappe needs, by name. */
export function vianenFiles() {
  return [...TRACK.map((ext) => `vianen.${ext}`), ...TEXTURES, ...MODELS, ...VIANEN_IMPACT_SOUNDS.map(s => s.file)];
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

/**
 * Object handlers run within 2 * VISIBLECHUNKS chunks of the player (0x0044cbb9, FUN_004a9870). On
 * a lap shorter than 4 * VISIBLECHUNKS, FUN_004af5a0 wraps that window wrongly and leaves the
 * player's own car out: its handler stops (no wheels, no steering, no progress, a reset far back).
 * The original's laps are about 360 chunks; Vianen's need VISIBLECHUNKS below a quarter of its chunks.
 */
export function vianenVisibleChunks(chunks) {
  return Math.max(8, Math.min(25, Math.floor((chunks - 1) / 4)));
}

/**
 * Makes etappe 10 Vianen. files: name to bytes. Can be called again: it changes nothing twice.
 * Returns restore(), for after the race: the view distance back, since game.ini is saved.
 */
export function installVianen(vfs, files) {
  const { slot, like } = VIANEN;
  const two = String(slot).padStart(2, '0');
  const write = vfs.onWrite;
  vfs.onWrite = null;
  try {
    for (const ext of TRACK) vfs.add(`etappe${slot}.${ext}`, files.get(`vianen.${ext}`));
    for (const name of TEXTURES) vfs.add(name, files.get(name));
    for (const name of MODELS) vfs.add(name, files.get(name));
    for (const { file } of VIANEN_IMPACT_SOUNDS) vfs.add(file, files.get(file));
    // Append material samples to this race's in-memory registry; never persist them.
    const soundIni = new IniFile(latin1(vfs.read('sound.ini')));
    let soundCount = Number(soundIni.get('SndTypes','COUNT'));
    for (const { name, file } of VIANEN_IMPACT_SOUNDS) {
      if (soundIni.keys('SndTypes').some(k => soundIni.get('SndTypes',k).split(',')[0] === name)) continue;
      soundIni.set('SndTypes',String(soundCount++),`${name},${file},1,75,90,10,GENERAL`);
    }
    soundIni.set('SndTypes','COUNT',String(soundCount));
    vfs.add('sound.ini',encodeLatin1(soundIni.serialize()));
    const [ini, anim] = likeFiles();
    // Amsterdam's start fly-by markers lie far from Vianen: switched off (the last value).
    const etappeIni = new IniFile(latin1(files.get(ini) || vfs.read(ini)));
    for (const key of etappeIni.keys('CamMarkers')) {
      if (key.toLowerCase() === 'count') continue;
      const v = etappeIni.get('CamMarkers', key).split(',');
      v[v.length - 1] = ' 0';
      etappeIni.set('CamMarkers', key, v.join(','));
    }
    const animIni = new IniFile(latin1(files.get(anim) || vfs.read(anim)));
    const objects = Number(etappeIni.get('objects', 'count'));
    const animations = Number(animIni.get('config', 'count'));
    PROPS.forEach(([model, animation, label, texture = 'vn_land.tga'], i) => {
      etappeIni.set('objects', String(objects + i), `${model},${texture},${label},0,${animation},0,${900 + i},0,-1`);
      animIni.set('config', String(animations + i), animation);
      animIni.set(animation, '0', `${model},${texture}`);
      animIni.set(animation, 'count', '1');
    });
    etappeIni.set('objects', 'count', String(objects + PROPS.length));
    animIni.set('config', 'count', String(animations + PROPS.length));
    vfs.add(`etappe${slot}.ini`, encodeLatin1(etappeIni.serialize()));
    vfs.add(`e${two}_anim.ini`, encodeLatin1(animIni.serialize()));
    // ai_racer.cpp reads a value per etappe from each racer's section: Amsterdam's for Vianen.
    const opp = new IniFile(latin1(vfs.read('opponent.ini')));
    for (const sec of opp.sections()) {
      if (/^Racer \d+ Level \d+$/.test(sec) && opp.get(sec, String(slot)) === null) opp.set(sec, String(slot), opp.get(sec, String(like)));
    }
    vfs.add('opponent.ini', encodeLatin1(opp.serialize()));
  } finally {
    vfs.onWrite = write;
  }
  // Its textures need more than the lowest texture memory setting (2 MB, CTextureDetailManager.cpp
  // stops the race when short): at least the middle one for this race, not saved.
  const mem = Number(vfs.iniGet('game.ini', 'GFX OPTIONS', 'CUSTOM_TEXTURE_MEMORY')) || 0;
  if (mem < 0x800000) {
    vfs.onWrite = null;
    try {
      vfs.iniSet('game.ini', 'GFX OPTIONS', 'CUSTOM_TEXTURE_MEMORY', String(0x800000));
    } finally {
      vfs.onWrite = write;
    }
  }
  // raser.ini is saved with the player's data, and the race writes it: the row stays, unused elsewhere.
  vfs.iniSet('raser.ini', 'MAPS', String(slot), `1,etappe${slot},vn_weg,vn_land,vn_gevel,vn_bouw,scrl_lo,scrl_hi,TRACK ${slot},0,10000,60,60,60,0`);
  const visible = vfs.iniGet('game.ini', 'OPTIONS', 'VISIBLECHUNKS');
  const pmp = files.get('vianen.pmp');
  const most = vianenVisibleChunks(new DataView(pmp.buffer, pmp.byteOffset, 4).getInt32(0, true));
  if (!(Number(visible) > 0 && Number(visible) <= most)) {
    vfs.onWrite = null;
    try {
      vfs.iniSet('game.ini', 'OPTIONS', 'VISIBLECHUNKS', String(most));
    } finally {
      vfs.onWrite = write;
    }
  }
  return () => {
    if (visible !== null && vfs.iniGet('game.ini', 'OPTIONS', 'VISIBLECHUNKS') !== visible) vfs.iniSet('game.ini', 'OPTIONS', 'VISIBLECHUNKS', visible);
  };
}

/** The wait screen of a track: Vianen's own for etappe 10, made by tools/vianen/build-track.py. */
export function waitScreenBase() {
  return 'assets/loading/';
}
