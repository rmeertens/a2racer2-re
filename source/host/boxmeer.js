// Boxmeer uses the other reserved native slot; original tracks and Vianen keep their identities.
import { IniFile, latin1, encodeLatin1 } from './vfs.js';
import { BOXMEER_STREET_PROPS } from './boxmeer-props.js';
import { installVianen } from './vianen.js';
export const BOXMEER = { key: 'boxmeer', name: 'Boxmeer', slot: 11, like: 0, laps: 1,
  prefix: 'bm', textures: ['bm_weg.tga', 'bm_land.tga', 'bm_gevel.tga', 'bm_bouw.tga'], props: [...BOXMEER_STREET_PROPS,['bm_cone.d3d','BM_CONE_ANIM','Movable traffic cone','bm_bouw.tga'],...['floralaan','maasheggen','centrum','finish'].map(name=>[`bm_gate_${name}.d3d`,`BM_GATE_${name.toUpperCase()}`,`${name} race gate`,'bm_route.tga'])], sounds: [] };
export function boxmeerFiles() { return ['rmp','pmp','dmp','cmp','omp','pth'].map(ext=>`boxmeer.${ext}`).concat(BOXMEER.textures,BOXMEER.props.map(p=>p[0]),['bm_street.tga','bm_sky.tga','bm_route.tga','bm_plants.tga','bm_leaves.tga','facade-windows.json','boxmeer.json','buildings.json']); }
export async function fetchBoxmeer() {
  const paths = boxmeerFiles().map(name=>[name,`assets/boxmeer/${name}`]);
  paths.push(...['etappe0.ini','e00_anim.ini'].map(name=>[name,`assets/game/${name}`]));
  return new Map(await Promise.all(paths.map(async ([name,url])=>{
    const r=await fetch(url); if(!r.ok) throw new Error(`Boxmeer: ${name} ${r.status}`);
    return [name,new Uint8Array(await r.arrayBuffer())];
  })));
}
export function installBoxmeer(vfs,files) {
  const restore=installVianen(vfs,files,BOXMEER);
  // The new map uses true-colour artwork; its palette-only PCX variants do not exist.
  // Change this race's virtual device only, then restore the player's other-track setting.
  const previousResolution=vfs.iniGet('raser.ini','PROGRAM','RESOLUTION');
  const highColour=previousResolution==='0'||previousResolution==='1';
  if(highColour){const write=vfs.onWrite;vfs.onWrite=null;try{vfs.iniSet('raser.ini','PROGRAM','RESOLUTION','3')}finally{vfs.onWrite=write}}
  vfs.add('bm_sky.tga',files.get('bm_sky.tga'));
  vfs.add('bm_route.tga',files.get('bm_route.tga'));
  vfs.add('bm_street.tga',files.get('bm_street.tga'));
  for(const name of ['bm_plants.tga','bm_leaves.tga','facade-windows.json','boxmeer.json','buildings.json'])vfs.add(name,files.get(name));
  const anim=new IniFile(latin1(vfs.read('e11_anim.ini')));
  anim.set('sky','0','skybox00.d3d,bm_sky.tga');
  vfs.add('e11_anim.ini',encodeLatin1(anim.serialize()));
  return ()=>{try{restore()}finally{if(highColour)vfs.iniSet('raser.ini','PROGRAM','RESOLUTION',previousResolution)}};
}
export function boxmeerTrack(index) { return { index, boxmeer:true, name:'Boxmeer',
  story:'Van de Spoorstraat door de woonstraten, over de Hoogendijk langs de gevlochten Maasheggen, langs Kasteel Boxmeer en terug naar de Sint-Petrusbasiliek en de Steenstraat.',
  type:'Stads- en dijkrace', nrLaps:1, british:false, winText:'Jij bent de snelste van Boxmeer!',
  qualifyText:'Goed gereden door Boxmeer.', loseText:'De Maasheggen waren je te snel af.',
  indexInGame:11, qualifyPosition:[0,0,0], chaseTime:[0,0,0], isChase:false }; }
export function boxmeerMenuImages(index) {
  const out={ [`trname${String(index).padStart(2,'0')}.tga`]:'../boxmeer/menu/trname11.png' };
  for(let k=0;k<6;k++) out[`qtc011_0${k}.tga`]=`../boxmeer/menu/qtc011_0${k}.png`;
  return out;
}
