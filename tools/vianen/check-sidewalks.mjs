// Focused Vianen physics regression: cross a curb, then drive along both pavements.
// Uses the original game's vehicle teleport only to arrange repeatable starting poses.
// node tools/vianen/check-sidewalks.mjs [--json result.json] [--rmp old.rmp --measure-only]
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Vfs} from '../../source/host/vfs.js';
import {Race} from '../../source/host/race.js';
import {pinRace} from '../../source/host/race-setup.js';
import {GameInput} from '../../source/input/keyboard.js';
import {NetRace} from '../../source/net/puppets.js';
import {Bot} from '../../source/dev/bot.js';
import {installVianen,vianenFiles} from '../../source/host/vianen.js';
import {readPositions,readPlanes,routeFrame} from '../../source/dev/track-model.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?null:process.argv[i+1];};
const results=[];
// Check every edge, including graded bridge/dike sections, in the packed game geometry.
if (!process.argv.includes('--measure-only')) {
  const bytes = readFileSync(root+'public/assets/vianen/vianen.rmp');
  const track = readPlanes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
  const kerbs = track.passes[1].filter(p => p.uv.every(([u,v]) => u>0 && u<0.5 && v>0 && v<0.027));
  assert.equal(kerbs.length, track.chunks*2);
  for (const p of kerbs) {
    for (const [a,b] of [[p.vertices[0],p.vertices[3]],[p.vertices[1],p.vertices[2]]]) {
      assert(Math.abs(b[1]-a[1]-1)<1e-4, 'Kerb must rise 10 cm at both ends');
      assert(Math.abs(Math.hypot(b[0]-a[0],b[2]-a[2])-6)<1e-3, 'Kerb must bevel over 60 cm');
    }
  }
  console.log(`${kerbs.length} continuous bevels checked, including bridges and the dike`);
}
const pmp=readFileSync(root+'public/assets/vianen/vianen.pmp');const points=readPositions(pmp.buffer.slice(pmp.byteOffset,pmp.byteOffset+pmp.byteLength));
const wasm=new WebAssembly.Module(readFileSync(root+'public/game/spel.wasm')),meta=JSON.parse(readFileSync(root+'public/game/spel.meta.json'));
async function probe(position,offset,angle,speed=10,seconds=2) {
 const vfs=new Vfs();for(const n of readdirSync(root+'public/assets/game/')){let p=root+'public/assets/game/'+n;if(statSync(p).isFile())vfs.addLazy(n,statSync(p).size,()=>readFileSync(p));}
 pinRace(vfs,{etappe:10,car:0,laps:1});vfs.iniSet('game.ini','OPTIONS','OPPONENTS','0');
 const files=new Map(vianenFiles().map(n=>[n,new Uint8Array(readFileSync(root+'public/assets/vianen/'+n))]));
 // Isolate the ground mesh from intentional movable-furniture impacts, which
 // are tested with the full OMP by check-bollards.mjs.
 const omp=files.get('vianen.omp'), view=new DataView(omp.buffer,omp.byteOffset,omp.byteLength), keep=[];
 for(let i=0;i<view.getInt32(0,true);i++){
   const record=omp.slice(4+i*68,4+(i+1)*68);
   const name=String.fromCharCode(...record.slice(32,64)).split('\0')[0];
   if(!['VN_PAAL_ANIM','VN_LAMP_ANIM','VN_BIKE_ANIM','VN_BOX_ANIM','VN_CRATE_ANIM','VN_CONE_ANIM','VN_SIGN_ANIM'].includes(name)) keep.push(record);
 }
 const groundOnly=new Uint8Array(4+keep.length*68);new DataView(groundOnly.buffer).setInt32(0,keep.length,true);
 keep.forEach((record,i)=>groundOnly.set(record,4+i*68));files.set('vianen.omp',groundOnly);
 if(option('rmp')) files.set('vianen.rmp',new Uint8Array(readFileSync(option('rmp'))));
 installVianen(vfs,files);
 const dt=1/60,host={vfs,render:new Proxy({},{get:()=>()=>{}}),audio:null,screen:{width:640,height:480},tickSeconds:dt,clockStart:1,fixedDate:971434016000,onFlip(){},onMessageBox(){},onStdout(){}};
 const race=new Race(meta,host);await race.instantiate(wasm);const input=new GameInput(race.m);host.input=input;race.boot();for(let n=0;n<420;n++){race.tick(dt);input.endTick();}
 const net=Object.create(NetRace.prototype);net.race=race;net.scratch=race.m.lowAlloc(128);const bot=new Bot(race,input);const o=bot.carState().index;
 const f=routeFrame(points,position),a=angle*Math.PI/180,forward=f.forward.map((x,k)=>x*Math.cos(a)+f.right[k]*Math.sin(a)),right=[forward[2],0,-forward[0]],rows=[...right,0,1,0,...forward];
 const start=f.center.map((x,k)=>x+f.right[k]*offset+(k===1?5:0));net.beam(o,start,rows,[0,0,0],[0,0,0]);
 const car=net.car(o);race.m.i32[(car+0x34)>>2]=Math.floor(position);race.m.i32[(car+0x38)>>2]=Math.floor(position);race.m.i32[(car+0x3c)>>2]=Math.floor(position)*2;
 for(let n=0;n<90;n++){race.tick(dt);input.endTick();}
 const initial=bot.carState().pos;net.beam(o,initial,rows,forward.map(x=>x*speed),[0,0,0]);
 let maxY=-Infinity,maxVy=-Infinity;let samples=[];
 for(let n=0;n<seconds*60;n++){input.dik[0xc8]=0x80;race.tick(dt);input.endTick();let s=bot.carState();let core=net.core(net.phys(o));let vy=-race.m.f32[(core+0xa8)>>2];maxVy=Math.max(maxVy,vy);maxY=Math.max(maxY,s.pos[1]-f.center[1]);if(n%10===0)samples.push({t:n/60,p:s.pos,vy,speed:s.speed});}
 const rise=maxY-(initial[1]-f.center[1]);
 const result={position,offset,angle,speed,maxY,maxVy,rise,initial,end:bot.carState().pos,samples};
 results.push(result);
 console.log(`station ${position}, offset ${offset}, angle ${angle}: rise ${(rise/10).toFixed(3)} m, peak upward speed ${maxVy.toFixed(2)} m/s`);
 // A 10 cm curb plus 2 cm of suspension motion; obstacle impacts are a separate test.
 if(!process.argv.includes('--measure-only')) assert(rise < (angle ? 2.0 : 1.2), 'Unexpected sidewalk launch: '+JSON.stringify({position,offset,rise}));
}
for(const s of [[7.45,30,65,10,1.4],[7.45,-30,-65,10,1.4],[7.1,70,0,12,3],[7.1,-70,0,12,3],[12.1,70,0,12,3],[12.1,-70,0,12,3]])await probe(...s);

if(option('json'))writeFileSync(option('json'),JSON.stringify({units:'positions/rise in 0.1 m world units, velocities in m/s',results},null,2)+'\n');
