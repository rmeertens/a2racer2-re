// Per-material effects for the authored Vianen props. Keep the native bodies and
// hit-state lifecycle; only cardboard uses the paper emitter. No global handler patch.
import { VIANEN_AWNINGS } from './vianen-market.js';
export const VIANEN_IMPACT_SOUNDS = ['card','wood','rubber','metal'].map(material => ({
  name: `VN_HIT_${material.toUpperCase()}`, file: `vn_${material}.wav`,
}));

export const VIANEN_IMPACTS = {
  VN_BOX_ANIM:   { material:'card',   handler:0x454770, paper:true },
  VN_CRATE_ANIM: { material:'wood',   handler:0x455b60, paper:false },
  VN_SIGN_ANIM:  { material:'wood',   handler:0x455b60, paper:false },
  VN_CONE_ANIM:  { material:'rubber', handler:0x454990, paper:false },
  VN_PAAL_ANIM:  { material:'wood',   handler:0x455b60, paper:false },
  VN_BIKE_ANIM:  { material:'metal',  handler:0x455b60, paper:false },
  VN_LAMP_ANIM:  { material:'metal',  handler:0x455b60, paper:false },
  VN_BENCH_ANIM: { material:'wood',   handler:0x455b60, paper:false },
  VN_STALL_ANIM: { material:'wood',   handler:0x455b60, paper:false },
  VN_CANOPY_ANIM:{ material:'metal',  handler:0x455b60, paper:false, mounted:true },
  VN_MKTPOLE_ANIM:{material:'metal',  handler:0x455b60, paper:false },
  ...Object.fromEntries(VIANEN_AWNINGS.map(name=>[name,{material:'metal',handler:0x455b60,paper:false,mounted:true}])),
};

export function installVianenImpacts(m, vfs) {
  if (Number(vfs.iniGet('game.ini','ETAPPE','ETAPPE')) !== 10 || !vfs.exists('vn_fun.tga')) return [];
  const bytes=vfs.read('etappe10.omp');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const props=[];
  for(let i=0;i<data.getInt32(0,true);i++) {
    const at=4+i*68;
    const name=String.fromCharCode(...bytes.subarray(at+32,at+64)).split('\0')[0];
    if(VIANEN_IMPACTS[name]) props.push({name,position:[8,12,16].map(k=>data.getFloat32(at+k,true))});
  }
  const base=m.u32[0x715e50>>2], objects=m.u32[0x73b0d0>>2];
  const sounds=new Map(VIANEN_IMPACT_SOUNDS.map(({name})=>{
    const address=m.lowAlloc(name.length+1);
    m.writeCStr(address,name);
    return [name,address];
  }));
  const configured=[];
  for(let i=0;i<512;i++) {
    const car=base+i*0xf0, handler=m.u32[(car+0x6c)>>2];
    if(![0x454770,0x454990,0x455b60].includes(handler)) continue;
    const object=objects+m.i32[(car+0x24)>>2]*0xa9;
    const position=[0,4,8].map(k=>m.view.getFloat32(object+0x50+k,true));
    const prop=props.find(p=>Math.hypot(...position.map((x,k)=>x-p.position[k]))<.05);
    if(!prop) continue;
    const profile=VIANEN_IMPACTS[prop.name], sound=`VN_HIT_${profile.material.toUpperCase()}`;
    // All three native handlers have the same hit/revival state machine. The
    // sign handler plays the attached sound without ejecting paper. Mass,
    // collision callback, friction and rebound stay as initialised from OMP.
    m.u32[(car+0x6c)>>2]=profile.handler;
    m.call(0x450b00,[i,sounds.get(sound)]);
    configured.push({index:i,name:prop.name,position:prop.position,sound,...profile});
  }
  return configured;
}
