// Keep the native lightweight-body physics; furniture should clatter, cartons spray paper.
import {BOXMEER_STREET_PROPS} from './boxmeer-props.js';
export function installBoxmeerImpacts(m,vfs){
 if(Number(vfs.iniGet('game.ini','ETAPPE','ETAPPE'))!==11||!vfs.exists('bm_street.tga'))return[];
 const names=new Set(BOXMEER_STREET_PROPS.map(p=>p[1])),bytes=vfs.read('etappe11.omp'),d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),props=[];
 for(let i=0;i<d.getInt32(0,true);i++){const at=4+i*68,name=String.fromCharCode(...bytes.subarray(at+32,at+64)).split('\0')[0];if(names.has(name))props.push({name,position:[8,12,16].map(k=>d.getFloat32(at+k,true))})}
 const sound=m.lowAlloc(32);m.writeCStr(sound,'PAAL_HIT_CAR');const base=m.u32[0x715e50>>2],objects=m.u32[0x73b0d0>>2],configured=[];
 for(let i=0;i<512;i++){const car=base+i*0xf0;if(![0x454770,0x454990,0x455b60].includes(m.u32[(car+0x6c)>>2]))continue;const object=objects+m.i32[(car+0x24)>>2]*0xa9,p=[0,4,8].map(k=>m.view.getFloat32(object+0x50+k,true)),prop=props.find(o=>Math.hypot(...p.map((x,k)=>x-o.position[k]))<.05);if(!prop)continue;
  const paper=prop.name==='BM_CARTON_ANIM';m.u32[(car+0x6c)>>2]=paper?0x454770:0x455b60;if(!paper)m.call(0x450b00,[i,sound]);configured.push({index:i,...prop,paper});
 }
 return configured;
}
