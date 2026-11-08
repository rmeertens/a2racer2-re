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
