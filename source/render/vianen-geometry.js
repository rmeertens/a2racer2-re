import { readPlanes } from '../dev/track-model.js';

// The authored town is small enough to draw in full. The original chunk index windows split
// large buildings/terrain across visibility boundaries. Reuse the game's existing static
// vertex pools, but submit the complete authored index list for each verified Vianen pass.
export class VianenGeometry {
  constructor(bytes) {
    const model = readPlanes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    this.passes = model.passes.map(planes => ({
      count: planes.length * 4,
      indices: Uint16Array.from(planes.flatMap((p, i) => p.indices.map(v => i * 4 + v))),
      samples: [...new Set([0, Math.floor(planes.length / 2), planes.length - 1])].flatMap(i =>
        planes[i].vertices.map((p, v) => ({ index: i * 4 + v, values: [...p, ...planes[i].uv[v]] }))),
    }));
    this.cache = new Map();
  }

  indicesFor(floats, pointer, count) {
    const key = `${pointer}:${count}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const start = pointer >> 2;
    const pass = this.passes.find(p => p.count === count && p.samples.every(sample => {
      const base = start + sample.index * 8;
      return sample.values.every((value, k) => floats[base + (k < 3 ? k : k + 3)] === value);
    }));
    // Object buffers are rewritten/reused. Cache only a positively identified static pool.
    if (pass) this.cache.set(key, pass.indices);
    return pass?.indices;
  }
}
