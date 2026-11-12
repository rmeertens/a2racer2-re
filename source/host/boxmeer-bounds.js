// Keep Boxmeer's main circuit and mapped side streets playable, without endless terrain excursions.
import {NetRace} from '../net/puppets.js';
import {readPositions} from '../dev/track-model.js';
const clamp=x=>Math.max(0,Math.min(1,x));
export function createBoxmeerBounds(race){
 const vfs=race.host.vfs;
 if(Number(vfs.iniGet('game.ini','ETAPPE','ETAPPE'))!==11||!vfs.exists('boxmeer.json'))return null;
 return new BoxmeerBounds(race);
}
export class BoxmeerBounds{
 constructor(race){
  this.race=race;const vfs=race.host.vfs,bytes=vfs.read('etappe11.pmp');
  this.points=readPositions(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const info=JSON.parse(new TextDecoder().decode(vfs.read('boxmeer.json')));this.segments=[];
  this.points.forEach((p,i)=>this.segments.push({a:p,b:this.points[(i+1)%this.points.length],radius:240,safeRadius:70,chunk:i,main:true}));
  for(const street of[info.neighbourhood,...info.sideStreets])for(const road of street.roads)for(let i=1;i<road.length;i++)this.segments.push({a:[road[i-1][0],0,road[i-1][1]],b:[road[i][0],0,road[i][1]],radius:110,safeRadius:27,chunk:street.entrances?.[0]?.chunk??street.entranceChunk,main:false});
  this.net=Object.create(NetRace.prototype);this.net.race=race;this.net.scratch=race.m.lowAlloc(128);
  this.outsideSeconds=0;this.recoveries=0;this.lastSafe=null;
 }
 locate(p,safe=false){
  let best=null;
  for(const s of this.segments){const dx=s.b[0]-s.a[0],dz=s.b[2]-s.a[2],length=Math.hypot(dx,dz),t=clamp(((p[0]-s.a[0])*dx+(p[2]-s.a[2])*dz)/(length*length||1)),q=[s.a[0]+dx*t,s.a[1]+(s.b[1]-s.a[1])*t,s.a[2]+dz*t],distance=Math.hypot(p[0]-q[0],p[2]-q[2]),excess=distance-s.radius;
   if(!best||(safe?distance-s.safeRadius:excess)<(safe?best.distance-best.safeRadius:best.excess))best={...s,q,distance,excess,forward:[dx/(length||1),0,dz/(length||1)]};
  }
  return best;
 }
 update(dt){
  const m=this.race.m;
  if(m.i32[0x6fba98>>2]||m.i32[0x6fb8a0>>2]!==0){return}
  const player=m.i32[0x6fba58>>2],state=this.net.read(player),near=this.locate(state.p),finite=state.p.every(Number.isFinite);
  if(!this.lastSafe){const chunk=((state.route[0]%this.points.length)+this.points.length)%this.points.length,p=this.points[chunk],next=this.points[(chunk+1)%this.points.length],length=Math.hypot(next[0]-p[0],next[2]-p[2]);this.remember(state,{q:p,forward:[(next[0]-p[0])/length,0,(next[2]-p[2])/length],main:true})}
  const vertical=near&&(state.p[1]<near.q[1]-100||state.p[1]>near.q[1]+250);
  const safe=finite?this.locate(state.p,true):null;
  if(safe&&safe.distance<=safe.safeRadius&&!vertical){this.remember(state,safe)}
  const outside=!finite||!near||near.excess>0||vertical;
  this.outsideSeconds=outside?this.outsideSeconds+dt:0;
  if(!finite||!near||vertical||near.excess>30||this.outsideSeconds>=.75)this.recover(player);
 }
 remember(state,near){
  const m=this.race.m,forward=[...near.forward];if(!near.main&&state.rows.slice(6,9).reduce((s,x,k)=>s+x*forward[k],0)<0)forward.forEach((x,k)=>forward[k]=-x);
  this.lastSafe={p:[near.q[0],near.q[1]+5,near.q[2]],rows:[forward[2],0,-forward[0],0,1,0,...forward],route:[...state.route],driven:m.i32[0x6fbab4>>2],lap:m.i32[0x6fb8f8>>2],chunk:m.i32[0x6fba7c>>2]};
 }
 recover(player){
  const m=this.race.m,s=this.lastSafe;this.net.beam(player,s.p,s.rows,[0,0,0],[0,0,0]);
  const car=this.net.car(player);[0x34,0x38,0x3c,0x50].forEach((off,k)=>m.i32[(car+off)>>2]=s.route[k]);
  m.i32[0x6fbab4>>2]=s.driven;m.i32[0x6fb8f8>>2]=s.lap;m.i32[0x6fba7c>>2]=s.chunk;
  this.outsideSeconds=0;this.recoveries++;
 }
}
