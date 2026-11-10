// Shared readers for the authored Vianen track, used by the race renderer and viewer.
// Keep the actual RMP planes and their source IDs;
// the viewer must reveal bad geometry rather than silently repairing or replacing it.
export const PASS_NAMES = ['Road', 'Ground & roofs', 'Facades', 'Details & walls'];
export const TEXTURES = ['vn_weg.tga', 'vn_land.tga', 'vn_gevel.tga', 'vn_bouw.tga'];
const LIMITS = [16, 24, 12, 12];

export const SURVEY_VIEWS = [
  ...[0, 45, 90, 135, 180, -135, -90, -45].map(yaw => ({
    name: `Street ${yaw}°`, yaw, height: 2, offset: 0, pitch: 0,
  })),
  ...[45, 135, -135, -45].map(yaw => ({
    name: `Elevated ${yaw}°`, yaw, height: 16, offset: 0, pitch: -25,
  })),
  ...[-1, 1].flatMap(side => [
    { name: `${side < 0 ? 'Left' : 'Right'} rear walls`, yaw: -side * 90, height: 9, offset: side * 38, pitch: -10 },
    { name: `${side < 0 ? 'Left' : 'Right'} roofline`, yaw: -side * 90, height: 25, offset: side * 38, pitch: -30 },
  ]),
];

export function readPositions(buffer) {
  const d = new DataView(buffer);
  const n = d.getInt32(0, true);
  if (n < 3 || n > 10000) throw new Error('Invalid PMP chunk count');
  let offset = 4;
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push([0, 4, 8].map(k => d.getFloat32(offset + k, true)));
    offset += 20; // position and two triggers
    for (let list = 0; list < 3; list++) {
      const count = d.getInt32(offset, true);
      if (count < 0 || count > 10000) throw new Error('Invalid PMP list');
      offset += 4 + count * 4;
    }
  }
  if (offset !== buffer.byteLength || points.flat().some(x => !Number.isFinite(x))) throw new Error('Invalid PMP data');
  return points;
}

export function readPlanes(buffer) {
  const d = new DataView(buffer);
  const count = d.getInt32(4, true), chunks = d.getInt32(8, true);
  if (d.getInt32(0, true) !== -1 || chunks < 3 || chunks > 10000) throw new Error('Invalid RMP header');
  let offset = 12;
  const passes = [[], [], [], []];
  for (let chunk = 0; chunk < chunks; chunk++) {
    for (let pass = 0; pass < 4; pass++) {
      const size = d.getInt32(offset, true);
      offset += 4;
      if (size < 0 || size > LIMITS[pass]) throw new Error(`RMP list exceeds engine limit at chunk ${chunk}`);
      for (let plane = 0; plane < size; plane++) {
        const vertices = [], uv = [], colors = [], indices = [];
        for (let v = 0; v < 4; v++) {
          const p = offset + v * 24;
          vertices.push([0, 4, 8].map(k => d.getFloat32(p + k, true)));
          uv.push([d.getFloat32(p + 12, true), d.getFloat32(p + 16, true)]);
          colors.push([0, 1, 2].map(k => d.getUint8(p + 20 + k)));
        }
        for (let k = 0; k < 6; k++) indices.push(d.getInt32(offset + 96 + k * 4, true));
        if (indices.some(i => i < 0 || i > 3) || [...vertices.flat(), ...uv.flat()].some(x => !Number.isFinite(x))) throw new Error('Invalid RMP plane');
        const twoSided = uv.every(([u]) => u >= 4 && u < 5);
        passes[pass].push({ chunk, pass, plane, vertices, uv, colors, indices, twoSided });
        offset += 120;
      }
    }
  }
  if (offset !== buffer.byteLength || passes.flat().length !== count) throw new Error('RMP length or plane count mismatch');
  return { chunks, count, passes };
}

export function readTga(buffer) {
  const d = new DataView(buffer);
  const width = d.getUint16(12, true), height = d.getUint16(14, true), bpp = d.getUint8(16);
  if (d.getUint8(1) !== 0 || d.getUint8(2) !== 2 || ![24, 32].includes(bpp) || !width || !height) throw new Error('Expected uncompressed RGB TGA');
  const originTop = !!(d.getUint8(17) & 32), originRight = !!(d.getUint8(17) & 16);
  const bytes = bpp / 8, start = 18 + d.getUint8(0);
  if (start + width * height * bytes > buffer.byteLength) throw new Error('Truncated TGA');
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = start + (y * width + x) * bytes;
    const dest = ((originTop ? y : height - y - 1) * width + (originRight ? width - x - 1 : x)) * 4;
    const b = d.getUint8(src), g = d.getUint8(src + 1), r = d.getUint8(src + 2);
    // Mipmaps filter transparent neighbours too. The key must carry black RGB, otherwise thin
    // branches acquire a magenta fringe. The viewer shader unpremultiplies after sampling.
    const keyed = r === 255 && g === 0 && b === 127;
    rgba.set(keyed ? [0, 0, 0, 0] : [r, g, b, bytes === 4 ? d.getUint8(src + 3) : 255], dest);
  }
  return { width, height, rgba };
}

// Native movable scenery, previewed at its authored (unhit) pose in the silent viewer.
export function readObjects(buffer) {
  const d = new DataView(buffer), count = d.getInt32(0, true);
  if (count < 0 || count > 10000 || buffer.byteLength !== 4 + count * 68) throw new Error('Invalid OMP objects');
  return Array.from({ length: count }, (_, i) => {
    const at = 4 + i * 68;
    return { chunk: d.getInt32(at, true), type: d.getInt32(at + 4, true),
      position: [8, 12, 16].map(k => d.getFloat32(at + k, true)),
      rotation: [20, 24, 28].map(k => d.getFloat32(at + k, true)),
      name: String.fromCharCode(...new Uint8Array(buffer, at + 32, 32)).split('\0')[0] };
  });
}

export function readSceneryMesh(buffer) {
  const d = new DataView(buffer), count = d.getInt32(0, true), triangles = d.getInt32(4, true);
  if (count <= 0 || count > 65535 || triangles <= 0 || buffer.byteLength !== 8 + count * 33 + triangles * 9) {
    throw new Error('Expected a legacy D3D scenery mesh');
  }
  const vertices = [], uv = [], indices = [];
  for (let i = 0; i < count; i++) {
    const at = 8 + i * 33;
    vertices.push([0, 4, 8].map(k => d.getFloat32(at + k, true)));
    uv.push([d.getFloat32(at + 24, true), d.getFloat32(at + 28, true)]);
  }
  for (let i = 0; i < triangles; i++) for (let j = 0; j < 3; j++) {
    const index = d.getUint16(8 + count * 33 + i * 9 + j * 2, true);
    if (index >= count) throw new Error('Invalid D3D scenery index');
    indices.push(index);
  }
  return { vertices, uv, indices };
}

export function routeFrame(points, position) {
  const n = points.length, p = ((position % n) + n) % n, i = Math.floor(p), t = p - i;
  const a = points[i], b = points[(i + 1) % n];
  const center = a.map((x, k) => x + (b[k] - x) * t);
  const tangent = at => {
    const before = points[(at - 1 + n) % n], after = points[(at + 1) % n];
    const x = after[0] - before[0], z = after[2] - before[2], length = Math.hypot(x, z);
    return [x / length, 0, z / length];
  };
  const ta = tangent(i), tb = tangent((i + 1) % n);
  const x = ta[0] + (tb[0] - ta[0]) * t, z = ta[2] + (tb[2] - ta[2]) * t, length = Math.hypot(x, z);
  return { center, forward: [x / length, 0, z / length], right: [z / length, 0, -x / length] };
}
