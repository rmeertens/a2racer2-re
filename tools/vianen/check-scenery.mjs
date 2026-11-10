#!/usr/bin/env node
// Exercise the actual drawIndexed path with authored RMP planes, without needing a GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { D3DRenderer } from '../../source/render/d3d-renderer.js';
import { readPlanes } from '../../source/dev/track-model.js';
import { VianenGeometry } from '../../source/render/vianen-geometry.js';

const bytes = readFileSync(new URL('../../public/assets/vianen/vianen.rmp', import.meta.url));
const track = readPlanes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const props = track.passes.flat().filter(p => p.twoSided);
const geometry = new VianenGeometry(bytes);
assert(props.length > 150, 'Expected the remaining flat trees and furniture to be tagged');

// Exercise the packed world geometry, including posters on graded/curving streets.
// Four old horizontal ad cells now contain one portrait image; only six quads may use it.
const posters = track.passes[3].filter(p => p.uv.every(([u, v]) => u > 832 / 1024 && u < 1 && v > 768 / 1024 && v < 1));
assert.equal(posters.length, 8, 'Expected six shop posters and both faces of the giant billboard');
const large = posters.filter(p => Math.hypot(...p.vertices[3].map((x, k) => x - p.vertices[0][k])) > 100);
assert.equal(large.length, 2, 'The giant billboard needs independently readable front and rear artwork');
for (const p of posters) {
  const edge = p.vertices[1].map((x, k) => x - p.vertices[0][k]);
  const up = p.vertices[3].map((x, k) => x - p.vertices[0][k]);
  assert(Math.abs(Math.hypot(...edge) / Math.hypot(...up) - 3 / 4) < 1e-5,
    'Keep the portrait aspect ratio on the actual wall');
  assert(Math.abs(edge.reduce((sum, x, k) => sum + x * up[k], 0)) < 0.002,
    'Road grades must not shear the portrait');
}
console.log('Six shop posters and a double-faced giant billboard preserve portrait proportions');

function draw(plane, vianen = true, hud = false) {
  const memory = new ArrayBuffer(512), floats = new Float32Array(memory), words = new Uint16Array(memory);
  for (let i = 0; i < 4; i++) {
    floats.set(plane.vertices[i], i * 8);
    floats.set(plane.uv[i], i * 8 + 6);
  }
  words.set(plane.indices, 128);
  const batch = { count: 0 };
  const renderer = Object.assign(Object.create(D3DRenderer.prototype), {
    drawsThisFrame: 0, captureLevel: 2, smoothVianen: vianen, hud, useStatic: false,
    state: [], host: { renderState: { texture: {} } },
    f32: floats, u16: words, indexArray: new Uint32Array(30),
    capturing: { indexCount: 0 }, worldIndex: () => 0, noteView() {},
    copyVerts: () => 7, batch: () => batch,
  });
  renderer.drawIndexed(4, 2, 0, 4, 256, 6);
  assert.equal(batch.count, renderer.capturing.indexCount);
  return [...renderer.indexArray.slice(0, batch.count)].map(i => i - 7);
}

for (const plane of props) {
  const indices = draw(plane);
  assert.equal(indices.length, 12);
  for (let i = 0; i < 6; i += 3) {
    assert.deepEqual(indices.slice(6 + i, 9 + i), [indices[i], indices[i + 2], indices[i + 1]],
      'Each flat-prop triangle must have its opposite winding using the same vertices');
  }
  assert.deepEqual(draw(plane, false), plane.indices, 'Original tracks keep their culling');
  assert.deepEqual(draw(plane, true, true), plane.indices, 'HUD triangles are not duplicated');
  for (const [u, v] of plane.uv) {
    assert(u >= 4 && u < 5 && v >= 0 && v <= 1);
    assert(u - 4 >= 0 && u - 4 < 1, 'Tagged U must wrap to its original atlas region');
  }
}
for (const plane of track.passes.flat().filter(p => !p.twoSided)) {
  assert.deepEqual(draw(plane), plane.indices, 'Solid scenery must keep normal culling');
}
console.log(`${props.length} two-sided props checked; solid surfaces, original tracks and HUD unchanged`);

for (const [pass, planes] of track.passes.entries()) {
  const memory = new ArrayBuffer(planes.length * 4 * 32 + 32);
  const floats = new Float32Array(memory), words = new Uint16Array(memory);
  planes.forEach((plane, p) => plane.vertices.forEach((v, k) => {
    floats.set(v, (p * 4 + k) * 8); floats.set(plane.uv[k], (p * 4 + k) * 8 + 6);
  }));
  const indexPointer = planes.length * 4 * 32;
  words.set(planes[0].indices, indexPointer >> 1);
  const full = geometry.indicesFor(floats, 0, planes.length * 4);
  assert.equal(full?.length, planes.length * 6, `Recognise authored pass ${pass}`);
  const batch = { count: 0 }, renderer = Object.assign(Object.create(D3DRenderer.prototype), {
    vianenGeometry: geometry, drawsThisFrame: 0, captureLevel: 2, smoothVianen: true,
    hud: false, useStatic: false, state: [], host: { renderState: { texture: {} } },
    f32: floats, u16: words, indexArray: new Uint32Array(planes.length * 12),
    capturing: { indexCount: 0 }, worldIndex: () => 0, noteView() {}, copyVerts: () => 0, batch: () => batch,
  });
  // A partial native visibility window must still draw the complete verified authored pool.
  renderer.drawIndexed(4, 2, 0, planes.length * 4, indexPointer, 6);
  assert.deepEqual(renderer.indexArray.slice(0, full.length), Uint32Array.from(full));
  assert.equal(batch.count, full.length + planes.filter(p => p.twoSided).length * 6);
  renderer.indexed = true; renderer.capturing.indexCount = 0; batch.count = 0;
  renderer.drawIndexed(4, 2, 0, planes.length * 4, indexPointer, 6);
  assert.equal(batch.count, planes[0].twoSided ? 12 : 6, 'Keep the software path native visibility');
}
console.log('All four static passes stay complete when native visibility supplies partial indices');

// Optional integration check: the original executable must preserve the authored UV tag
// through its visible-chunk selection and actually submit these sprites in either view.
if (process.argv.includes('--runtime')) {
  const { readdirSync, statSync } = await import('node:fs');
  const { Vfs } = await import('../../source/host/vfs.js');
  const { Race } = await import('../../source/host/race.js');
  const { pinRace } = await import('../../source/host/race-setup.js');
  const { GameInput } = await import('../../source/input/keyboard.js');
  const { Bot } = await import('../../source/dev/bot.js');
  const { installVianen, vianenFiles } = await import('../../source/host/vianen.js');
  const vfs = new Vfs(), gameDir = new URL('../../public/assets/game/', import.meta.url);
  for (const name of readdirSync(gameDir)) {
    const path = new URL(name, gameDir);
    if (statSync(path).isFile()) vfs.addLazy(name, statSync(path).size, () => readFileSync(path));
  }
  pinRace(vfs, { etappe: 10, car: 0, laps: 1 });
  vfs.iniSet('game.ini', 'OPTIONS', 'OPPONENTS', '0');
  installVianen(vfs, new Map(vianenFiles().map(name => [name,
    new Uint8Array(readFileSync(new URL('../../public/assets/vianen/' + name, import.meta.url)))])));
  let race, taggedIndexed = 0, taggedPrimitive = 0, view;
  const inspect = (vtype, verts, count) => {
    if (vtype !== 2) return 0;
    const floats = race.m.f32;
    let tagged = 0;
    for (let i = 0; i < count; i++) {
      const u = floats[(verts >> 2) + i * 8 + 6];
      if (u >= 4 && u < 5) tagged++;
    }
    return tagged;
  };
  const pools = new Set(); let partialPools = 0;
  const capture = {
    setTransform(type, ptr) { if (type === 2) view = race.m.f32.slice(ptr >> 2, (ptr >> 2) + 16); },
    drawIndexed(prim, vtype, verts, count, indices, nindices) {
      if (vtype !== 2) return;
      const full = geometry.indicesFor(race.m.f32, verts, count);
      if (full) { pools.add(count); if (nindices < full.length) partialPools++; }
      for (let k = 0; k < nindices; k++) {
        const i = race.m.u16[(indices >> 1) + k];
        const u = race.m.f32[(verts >> 2) + i * 8 + 6];
        if (u >= 4 && u < 5) taggedIndexed++;
      }
    },
    drawPrimitive(prim, vtype, verts, count) { taggedPrimitive += inspect(vtype, verts, count); },
  };
  const host = { vfs, render: new Proxy(capture, { get: (t, k) => t[k] || (() => {}) }),
    audio: null, screen: { width: 640, height: 480 }, tickSeconds: 1 / 60, clockStart: 1,
    fixedDate: 971434016000, onFlip() {}, onMessageBox(c, t) { throw new Error(c + ': ' + t); }, onStdout() {},
  };
  const meta = JSON.parse(readFileSync(new URL('../../public/game/spel.meta.json', import.meta.url)));
  race = new Race(meta, host);
  await race.instantiate(new WebAssembly.Module(readFileSync(new URL('../../public/game/spel.wasm', import.meta.url))));
  const input = new GameInput(race.m); host.input = input; race.boot();
  const car = new Bot(race, input);
  const step = ticks => {
    taggedIndexed = 0; taggedPrimitive = 0;
    for (let t = 0; t < ticks; t++) { assert(race.tick(1 / 60)); input.endTick(); }
    assert(taggedIndexed > 0, 'Engine must submit the tagged flat scenery through drawIndexed');
    assert.equal(taggedPrimitive, 0, 'No flat scenery may bypass the fixed indexed draw path');
    return taggedIndexed;
  };
  const forward = step(480);
  const forwardView = view;
  input.pressHost(0x33, 0x04);
  const rear = step(60);
  const viewDot = [2, 6, 10].reduce((sum, i) => sum + forwardView[i] * view[i], 0);
  assert(viewDot < -0.9, 'Rear-view input must actually turn the camera around');
  input.pressHost(0x28, 0xD0);
  const reverse = step(120);
  assert(car.carState().speed < -1, 'Car must actually be moving in reverse for this check');
  assert.equal(pools.size, 4, 'All four real game track pools must match the authored geometry');
  assert(partialPools > 0, 'Exercise the native partial visibility windows');
  console.log(`Live game: forward ${forward}, rear view ${rear}, reverse gear ${reverse} tagged vertices; reverse speed ${car.carState().speed.toFixed(1)}`);
  console.log(`Matched all 4 live pools; replaced ${partialPools} partial track windows`);
}
