#!/usr/bin/env node
// Check the finishing details in packed assets and the actual native object table.
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,statSync,writeFileSync } from 'node:fs';
import { Vfs } from '../../source/host/vfs.js';
import { Race } from '../../source/host/race.js';
import { pinRace } from '../../source/host/race-setup.js';
import { GameInput } from '../../source/input/keyboard.js';
import { installVianen,vianenFiles } from '../../source/host/vianen.js';
import { readObjects,readPlanes,readPositions } from '../../source/dev/track-model.js';
const read=name=>{const b=readFileSync('public/assets/vianen/'+name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const objects=readObjects(read('vianen.omp')),track=readPlanes(read('vianen.rmp')),points=readPositions(read('vianen.pmp'));
const expected={VN_CROWN_ANIM:48,VN_DRAIN_ANIM:16,VN_COVER_ANIM:8,VN_BENCH_ANIM:4};
for(const[name,count]of Object.entries(expected))assert.equal(objects.filter(o=>o.name===name).length,count);
const staticObjects=objects.filter(o=>['VN_CROWN_ANIM','VN_DRAIN_ANIM','VN_COVER_ANIM'].includes(o.name));
assert(staticObjects.every(o=>o.type===0),'Decorative layers must not introduce collision geometry');
for(const o of objects.filter(o=>['VN_DRAIN_ANIM','VN_COVER_ANIM'].includes(o.name))) {
  assert(Math.abs(points[o.chunk][1]-points[(o.chunk+1)%points.length][1])<.001,'Only put flat covers on flat ground');
  const expectedY=points[o.chunk][1]+(o.name==='VN_DRAIN_ANIM'?1.035:.035);
  assert(Math.abs(o.position[1]-expectedY)<.001,'Covers must sit flush on the road or pavement');
}
let shadedBanks=0;
for(const p of track.passes.flat()) {
  if(Math.min(...p.vertices.map(v=>v[1]))< -5 && new Set(p.colors.map(c=>c.join(','))).size>1) {
    shadedBanks++;
    for(let a=0;a<4;a++)for(let b=0;b<4;b++)if(p.vertices[a][1]<p.vertices[b][1]-.01) {
      assert(p.colors[a].reduce((s,c)=>s+c,0)<=p.colors[b].reduce((s,c)=>s+c,0),'Bank colour must darken toward the water');
    }
  }
}
assert(shadedBanks>100,'Wet-bank vertex shading must be present in packed RMP data');
const vfs=new Vfs();
for(const name of readdirSync('public/assets/game')) {
  const path='public/assets/game/'+name;
  if(statSync(path).isFile())vfs.addLazy(name,statSync(path).size,()=>readFileSync(path));
}
pinRace(vfs,{etappe:10,car:0,laps:1});
vfs.iniSet('game.ini','OPTIONS','OPPONENTS','0');
installVianen(vfs,new Map(vianenFiles().map(n=>[n,new Uint8Array(read(n))])));
const missing=[];vfs.onMissing=n=>{missing.push(n);return null;};
const host={vfs,render:new Proxy({},{get:()=>()=>{}}),audio:null,screen:{width:640,height:480},tickSeconds:1/60,clockStart:1,fixedDate:971434016000,onFlip(){},onMessageBox(c,t){throw Error(t);},onStdout(){}};
const race=new Race(JSON.parse(readFileSync('public/game/spel.meta.json')),host);
await race.instantiate(new WebAssembly.Module(readFileSync('public/game/spel.wasm')));
host.input=new GameInput(race.m);race.boot();
const m=race.m,base=m.u32[0x715e50>>2],scene=m.u32[0x73b0d0>>2];
let nonColliding=0;
for(const o of staticObjects) {
  const matches=[];
  for(let i=0;i<512;i++) {
    const car=base+i*0xf0,index=m.i32[(car+0x24)>>2];if(index<0)continue;
    const p=[0,4,8].map(k=>m.view.getFloat32(scene+index*0xa9+0x50+k,true));
    if(Math.hypot(...p.map((x,k)=>x-o.position[k]))<.01)matches.push(car);
  }
  assert.equal(matches.length,1,`Native object placement: ${o.name}`);
  // FUN_004a9130 sets +0x18 and installs the body pointer at +0x10.
  assert.equal(m.u32[(matches[0]+0x10)>>2],0,`${o.name} must have a null native physics body`);
  assert.equal(m.u32[(matches[0]+0x18)>>2],0,`${o.name} must not be physics-enabled`);
  assert.equal(m.u32[(matches[0]+0x6c)>>2],0,`${o.name} must have no collision handler`);
  nonColliding++;
}
assert.equal(race.vianenImpacts.filter(o=>o.name==='VN_BENCH_ANIM'&&o.material==='wood').length,4);
// These optional original announcer variants are absent in the source archive.
const optionalVoices=new Set(['cco00_05.wav','cpa00_05.wav','cbp00_00.wav']);
assert.deepEqual(missing.filter(n=>!optionalVoices.has(n)),[],'Every new model, texture and sample must load');
for(const o of race.vianenImpacts.filter(o=>o.name==='VN_BENCH_ANIM')) {
  assert.notEqual(m.u32[(base+o.index*0xf0+0x10)>>2],0,'Benches must have native physics bodies');
  assert.equal(m.u32[(base+o.index*0xf0+0x18)>>2],1,'Benches must be physics-enabled');
  assert(m.i32[(base+o.index*0xf0+0x30)>>2]>=0,'Bench wood sample must resolve');
}
const summary={objects:expected,nativeObjectsWithoutPhysics:nonColliding,shadedBankFaces:shadedBanks,missingAssets:missing.filter(n=>!optionalVoices.has(n)),unavailableOriginalVoiceVariants:missing.filter(n=>optionalVoices.has(n))};
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--json'))writeFileSync(process.argv[process.argv.indexOf('--json')+1],JSON.stringify(summary,null,2)+'\n');
