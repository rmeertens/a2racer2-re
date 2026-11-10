#!/usr/bin/env node
// Hit an actual Vianen post using the original vehicle/prop physics, then drive past its old base.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Vfs } from '../../source/host/vfs.js';
import { Race } from '../../source/host/race.js';
import { pinRace } from '../../source/host/race-setup.js';
import { GameInput } from '../../source/input/keyboard.js';
import { NetRace } from '../../source/net/puppets.js';
import { Bot } from '../../source/dev/bot.js';
import { installVianen, vianenFiles } from '../../source/host/vianen.js';
import { VIANEN_IMPACTS, VIANEN_IMPACT_SOUNDS } from '../../source/host/vianen-impacts.js';
import { createHash } from 'node:crypto';
import { readObjects, readPositions, readPlanes, readSceneryMesh, routeFrame } from '../../source/dev/track-model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const propOption = process.argv.indexOf('--prop');
const fun = propOption < 0 ? null : {
  box: ['VN_BOX_ANIM','vn_doos.d3d',22,7.12,70],
  crate: ['VN_CRATE_ANIM','vn_kist.d3d',22,7.38,70],
  cone: ['VN_CONE_ANIM','vn_kegel.d3d',2,7.87,64],
  sign: ['VN_SIGN_ANIM','vn_bord.d3d',22,7.68,72],
  bench: ['VN_BENCH_ANIM','vn_bank.d3d',3,14.35,118],
  stall: ['VN_STALL_ANIM','vn_markt.d3d',3,14.5,157],
  awning: ['VN_AWN48_ANIM','vn_luifel48.d3d',22,65.5,74.75],
  marketpole: ['VN_MKTPOLE_ANIM','vn_marktpaal.d3d',22,14.22,146],
}[process.argv[propOption + 1]];
if (propOption >= 0) assert(fun, 'Use --prop box, crate, cone, sign, bench, stall, awning or marketpole');
const stall=fun?.[0]==='VN_STALL_ANIM', awning=fun?.[0]==='VN_AWN48_ANIM', marketPole=fun?.[0]==='VN_MKTPOLE_ANIM';
const bridge = process.argv.includes('--bridge');
const bikes = process.argv.includes('--bikes');
const lanterns = process.argv.includes('--lanterns') || bridge;
const propName = fun ? fun[0] : bikes ? 'VN_BIKE_ANIM' : lanterns ? 'VN_LAMP_ANIM' : 'VN_PAAL_ANIM';
const modelFile = fun ? fun[1] : bikes ? 'vn_fiets.d3d' : lanterns ? 'vn_lamp.d3d' : 'vn_paal.d3d';
const nativeType = fun ? fun[2] : lanterns ? 3 : 22;
const profile = VIANEN_IMPACTS[propName];
const handler = profile.handler;
const read = name => {
  const b = readFileSync(root + 'public/assets/vianen/' + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const objects = readObjects(read('vianen.omp')).filter(o => o.name === propName);
const metadata = JSON.parse(readFileSync(root + 'public/assets/vianen/vianen.json'));
assert.equal(objects.length, fun ? (metadata.smashableProps[propName] ?? metadata.detailObjects[propName]) : bikes ? metadata.movableBikes : lanterns ? metadata.movableLanterns : 96);
assert(objects.length > 0);
assert(objects.every(o => o.type === nativeType), 'Use the intended native movable-object behaviour');
const packed=readPlanes(read('vianen.rmp'));
if(stall||awning) {
 assert.equal(packed.passes[1].filter(p=>p.uv.every(([u,v])=>u>.75&&u<1&&v>.75&&v<1)).length,0,'No baked canopy colliders may remain');
 assert.equal(packed.passes[3].filter(p=>p.uv.every(([u,v])=>u>704/1024&&u<832/1024&&v>.75&&v<1)).length,0,'No baked market tabletops may remain');
}
const baked = packed.passes.flat().filter(p => !fun && p.twoSided && (bikes ?
  p.uv.every(([u,v]) => u > 4.75 && u < 5 && v > 0.25 && v < 0.375) : lanterns ?
  p.uv.every(([u,v]) => (u > 4.8125 && u < 4.875 && v < 0.25) ||
    (u > 4.5 && u < 4.625 && v > 0.25 && v < 0.5)) :
  p.uv.every(([u,v]) => u > 4.75 && u < 4.8125 && v < 0.25) &&
  Math.max(...p.uv.map(t => t[1])) - Math.min(...p.uv.map(t => t[1])) > 0.24));
assert.equal(baked.length, 0, 'Do not leave an immovable collision wall at a post');
const mesh = readSceneryMesh(read(modelFile)), edges = new Map();
if (bikes) {
  const span = k => Math.max(...mesh.vertices.map(p => p[k])) - Math.min(...mesh.vertices.map(p => p[k]));
  assert(span(2) >= 5.5, 'Bike handlebars must have actual width, not a flat collision face');
  assert(span(0) > 16 && span(0) < 20 && span(1) > 10, 'Keep bicycle proportions');
}
const pointKey = p => JSON.stringify(p.map(x => Math.round(x * 1e5) / 1e5));
for (let i = 0; i < mesh.indices.length; i += 3) {
  const triangle = mesh.indices.slice(i,i+3).map(v => pointKey(mesh.vertices[v]));
  assert.equal(new Set(triangle).size, 3, 'No degenerate prop triangles');
  for (let k = 0; k < 3; k++) {
    const key = [triangle[k], triangle[(k+1)%3]].sort().join('|');
    edges.set(key, (edges.get(key) || 0) + 1);
  }
}
assert([...edges.values()].every(n => n === 2), 'All post sides and caps must form a closed mesh');
const points = readPositions(read('vianen.pmp'));
const station = fun ? fun[3] : bikes ? 14.62 : bridge ? 76.5 : lanterns ? 12 : 12.75;
const frame = routeFrame(points, station);
const offset = fun ? -fun[4] : bikes ? 94 : bridge ? 61 : lanterns ? 90 : 57;
if (lanterns) {
  for (const o of objects.filter(o => [76,78].includes(o.chunk))) {
    const f = routeFrame(points, o.chunk + (o.chunk === 76 ? 0.5 : 0.6));
    const off = Math.abs(o.position.reduce((sum,x,k) => sum + (x-f.center[k])*f.right[k], 0));
    assert(off + 1.1 < 64, 'The full bridge lantern base must stand on its deck');
  }
}
const target = objects.filter(o => o.chunk === Math.floor(station)).sort((a,b) =>
  Math.hypot(...a.position.map((x,k) => x - frame.center[k] - offset * frame.right[k])) -
  Math.hypot(...b.position.map((x,k) => x - frame.center[k] - offset * frame.right[k])))[0];
assert(target);
const vfs = new Vfs();
for (const name of readdirSync(root + 'public/assets/game/')) {
  const path = root + 'public/assets/game/' + name;
  if (statSync(path).isFile()) vfs.addLazy(name, statSync(path).size, () => readFileSync(path));
}
pinRace(vfs, { etappe: 10, car: 0, laps: 1 });
vfs.iniSet('game.ini', 'OPTIONS', 'OPPONENTS', '0');
installVianen(vfs, new Map(vianenFiles().map(n => [n, new Uint8Array(read(n))])));
const missing = new Set();
vfs.onMissing = name => { missing.add(name); return null; };
const dt = 1 / 60;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sampleNames = new Map(VIANEN_IMPACT_SOUNDS.map(s => [digest(new Uint8Array(read(s.file)).subarray(44)),s.name]));
let checkingImpact = false;
const effectHits = [], impactSounds = [];
const audio = new Proxy({ play(buffer,loop) {
  if(checkingImpact && !loop) impactSounds.push(sampleNames.get(digest(race.m.u8.subarray(buffer.ptr,buffer.ptr+buffer.size))) || 'other');
}}, { get:(object,key)=>object[key] || (()=>false) });
const host = { vfs, render: new Proxy({}, { get: () => () => {} }), audio,
  screen: { width: 640, height: 480 }, tickSeconds: dt, clockStart: 1,
  fixedDate: 971434016000, onFlip() {}, onMessageBox(c,t) { throw new Error(t); }, onStdout() {} };
const meta = JSON.parse(readFileSync(root + 'public/game/spel.meta.json'));
const race = new Race(meta, host);
await race.instantiate(new WebAssembly.Module(readFileSync(root + 'public/game/spel.wasm')));
const input = new GameInput(race.m); host.input = input;
race.boot();
assert.equal(race.vianenImpacts.filter(p=>p.name===propName).length,objects.length);
assert(race.vianenImpacts.every(p=>race.m.i32[(race.m.u32[0x715e50>>2]+p.index*0xf0+0x30)>>2]>=0), 'Every material sound must resolve in the native registry');
const tick = () => { assert(race.tick(dt)); input.endTick(); };
for (let i = 0; i < 420; i++) tick();
if(awning) {
 assert.equal(race.vianenMounts.mounts.length,35);
 assert(race.vianenMounts.mounts.every(p=>!p.released),'All unhit awnings must remain mounted through countdown');
}
const net = Object.create(NetRace.prototype); net.race = race; net.scratch = race.m.lowAlloc(128);
const bot = new Bot(race, input), player = bot.carState().index;
const posts = [];
for (let i = 0; i < 512; i++) {
  if (race.m.u32[(net.car(i) + 0x6c) >> 2] === handler &&
      objects.some(o => Math.hypot(...net.read(i).p.map((x,k) => x - o.position[k])) < 0.5)) posts.push(i);
}
assert.equal(posts.length, objects.length, 'Every authored post must have its native handler');
assert(posts.every(p => net.read(p).rows[4] > 0.98), 'Unhit scenery must remain upright');
const post = posts.sort((a,b) => Math.hypot(...net.read(a).p.map((x,k) => x - target.position[k])) -
  Math.hypot(...net.read(b).p.map((x,k) => x - target.position[k])))[0];
const before = net.read(post);
// Observe only this target's actual native hit handler, excluding neighbouring
// props and generic car-body impacts. Compare the PCM submitted to DirectSound.
const effectThunk = race.m.makeThunk('test!materialImpact',0,(esp,ecx,edx,eax)=>{
  const hit = race.m.i32[(net.car(post)+0x2c)>>2] === 1;
  const paperBefore = race.m.u32[0x70999c>>2], soundsBefore = impactSounds.length;
  checkingImpact = hit;
  try { return race.m.__call(handler,esp,eax,ecx,edx); }
  finally {
    checkingImpact = false;
    if(hit) effectHits.push({paperEmitters:race.m.u32[0x70999c>>2]-paperBefore,sounds:impactSounds.slice(soundsBefore)});
  }
});
race.m.u32[(net.car(post)+0x6c)>>2]=effectThunk;
if (bikes) {
  const along = before.rows.slice(0,3).reduce((sum,x,k) => sum + x * frame.forward[k], 0);
  assert(along > 0.98, 'The native bike must park parallel to the street, matching the viewer');
}
assert(before.rows[4] > 0.98, 'Post should stand upright before impact');
// Approach across the road, away from the neighbouring posts. A longitudinal
// setup between posts can overlap the car's rear body before the test even starts.
const side = Math.sign(target.position.reduce((sum,x,k) => sum + (x-frame.center[k])*frame.right[k],0));
const approach = (stall||marketPole) ? frame.forward : frame.right.map(x => x*side);
const start = target.position.map((x,k) => x - (lanterns || bikes || fun ? 65 : 40) * approach[k] - ((awning?8:marketPole?7:0)*side*frame.right[k]) + (k === 1 ? 5 : 0));
const rows = [approach[2],0,-approach[0], 0,1,0, ...approach];
net.beam(player, start, rows, [0,0,0], [0,0,0]);
for (const field of [0x34,0x38]) race.m.i32[(net.car(player) + field) >> 2] = target.chunk;
for (let i = 0; i < 90; i++) tick();
assert(net.read(post).rows[4] > 0.98, 'Arranging the car must not hit the post');
// A shop canopy is above an ordinary car: arrange a brief airborne contact,
// as from the track's jumps, rather than inventing an invisible ground-level wall.
const launch=awning?start.map((x,k)=>k===1?target.position[1]-5:x+approach[k]*30):bot.carState().pos;
net.beam(player, launch, rows, approach.map(x => x * (awning?18:10)), [0,0,0]);
const samples = []; let minUp = 1, moved = 0, hitState = 0;
for (let i = 0; i < 300; i++) {
  input.dik[0xc8] = 0x80; tick();
  const state = net.read(post);
  hitState = Math.max(hitState,race.m.i32[(net.car(post)+0x2c)>>2]);
  minUp = Math.min(minUp, state.rows[4]);
  moved = Math.max(moved, Math.hypot(...state.p.map((x,k) => x - before.p[k])));
  if (i % 10 === 0) samples.push({ time: i / 60, post: state, car: bot.carState() });
}
const car = bot.carState();
const passed = car.pos.reduce((sum,x,k) => sum + (x - target.position[k]) * approach[k], 0);
// Park the test car clear before checking the resting pose. It may still be
// pushing/re-tipping a displaced post at the end of the drive-through probe.
input.dik[0xc8] = 0;
net.beam(player,start,rows,[0,0,0],[0,0,0]);
for(let i=0;i<180;i++) tick();
const mount=awning?race.vianenMounts.mounts.find(p=>p.index===post):stall?race.vianenMounts.mounts.find(p=>p.triggers.includes(net.car(post))):null;
const mountY=mount?new DataView(mount.pose.buffer,mount.pose.byteOffset).getFloat32(52,true):null;
const mountResult=mount?{mountReleased:mount.released,mountDropWorldUnits:mountY-net.read(mount.index).p[1]}:{};
const frameCapacity=race.m.u32[0x73b124>>2],frameFlags=race.m.u32[0x73b130>>2];
const nativeFramePool={capacity:frameCapacity,used:race.m.u8.subarray(frameFlags,frameFlags+frameCapacity).filter(x=>x!==0).length};
assert(nativeFramePool.used<nativeFramePool.capacity,'Keep headroom in the native animation frame pool');
const summary = { ...mountResult, nativeFramePool, propName, posts: posts.length, nativeType, hitState, material:profile.material, effectHits, bakedColliders: baked.length, minUp, movedWorldUnits: moved,
  settledUp:net.read(post).rows[4], carPastBaseWorldUnits: passed, carSpeed: car.speed, missing: [...missing].filter(n => !n.endsWith('.wav')) };
console.log(JSON.stringify(summary, null, 2));
const at = process.argv.indexOf('--json');
if (at >= 0) writeFileSync(process.argv[at+1], JSON.stringify({ summary, before, samples }, null, 2));
assert(moved > 5 && (fun || minUp < 0.5), 'The car must knock the object away');
if (fun) assert(hitState > 0, 'The native hit-effect handler must run');
assert(effectHits.length > 0,'The selected target must run an impact effect');
for(const hit of effectHits) {
  assert.deepEqual(hit.sounds,[`VN_HIT_${profile.material.toUpperCase()}`],'Each contact must play its own material sound exactly once');
  assert.equal(hit.paperEmitters,profile.paper?1:0,'Only a cardboard carton should spray paper');
}
if (!bridge && !fun) assert(net.read(post).rows[4] < 0.5, 'The street post must remain fallen');
assert(Math.hypot(...net.read(post).p.map((x,k) => x - before.p[k])) > 5,
  'The hit object must stay displaced instead of returning to its original base');
// Bridge railings deliberately remain solid directly beyond the lantern base.
if (!bridge && !awning) assert(passed > 20, 'The car must drive through the former post location');
assert.equal(summary.missing.length, 0);

if(awning) {
 assert(mount.released,'Actual native contact must release the wall mount');
 assert(net.read(post).p[1]<before.p[1]-10,'The released canopy must fall down');
}

if(stall) {
 assert.equal(mount.triggers.length,3,'A market canopy must link to its own counter and two poles');
 assert(mount.released,'Hitting a stall must collapse its canopy');
 assert(summary.mountDropWorldUnits>10,'The market canopy must fall separately from the counter');
}

if(marketPole) assert(minUp<.5,'The thin market support must topple when hit');
