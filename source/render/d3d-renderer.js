// Draws the game's Direct3D 5 calls with Three.js.
//
// Game code runs its original render path during a tick. Each call lands here and is
// captured into a frame: vertex and index streams plus a list of batches. Presenting is
// separate from capturing, so the browser can draw at its own rate: world matrices, the
// view and moving vertices are blended between the last two ticks. Draws that cannot be
// paired across ticks show the latest one: blends().
//
// Batching: textures live in array textures (one per size) selected per vertex, and world
// matrices live in a data texture selected per vertex. So a texture or object change does
// not need its own draw call: only blend and depth state changes do.
import * as THREE from 'three';
import { modeGrid } from '../settings.js';
import { VianenGeometry } from './vianen-geometry.js';
import { BoxmeerWorld } from './boxmeer-world.js';

const DYNAMIC_VERTS = 120000;
const STATIC_VERTS = 240000;
const MAX_VERTS = DYNAMIC_VERTS + STATIC_VERTS;
const STATIC_MIN = 512;
const MAX_INDICES = 600000;
// World matrices per tick. Each mud or water particle has its own, and a dense spray takes
// well over 1,000 of them before the HUD draws its 87: those then shared the last row and
// the HUD vanished. 12 bits of aInfo.
const MAX_MATRICES = 4096;
const MAX_DYNAMIC_FLOATS = 200000;
const NO_TEXTURE = 0xFFFF;
const MAX_ARRAYS = 6;
// A tick moving a matrix further than this is a teleport, not motion: no blending.
const TELEPORT_DIST2 = 30 * 30;
// A matrix turning further than this in one tick, such as a wheel at speed, keeps the latest tick's
// rotation and blends its position only: blended element by element, two poses 60 degrees apart
// give a wheel shrunk to 87% and skewed halfway between ticks. cos(20 degrees).
const SPIN_COS = Math.cos(20 * Math.PI / 180);
const TICK_MS = 1000 / 60;      // TICK_SECONDS in race-runner.js
// Vertex arrays in game memory. gfx_wolk and gfx_bwlk sort their 70 slots every frame, so one
// address holds another puff each tick: FUN_00446fe0, FUN_0043de00. Flag: FUN_0043fff0.
const SMOKE_VERTS = [0x6f5090, 0x6fa298];
const BWLK_VERTS = [0x6c4208, 0x6c9410];
const FLAG_VERTS = [0x6c9468, 0x6cbee8];
// What the flag sheet reaches in clip space at the far end of its wave, z 6, with the default
// projection: half sizes 5 and 3.75 (FUN_0043fff0), 67.5 degrees (FUN_0044c200).
const FLAG_REACH_X = (5 / 6) / Math.tan((33.75 * Math.PI) / 180);
const FLAG_REACH_Y = (3.75 / 6) / Math.tan((33.75 * Math.PI) / 180);

const RS = {
  ZENABLE: 7, ZWRITEENABLE: 14, SRCBLEND: 19, DESTBLEND: 20, TEXTUREMAPBLEND: 21,
  ALPHABLENDENABLE: 27, FOGENABLE: 28, FOGCOLOR: 34, COLORKEYENABLE: 41, ZBIAS: 47,
  TEXTUREMAG: 17, TEXTUREMIN: 18,
};
const BLEND = {
  1: THREE.ZeroFactor, 2: THREE.OneFactor, 3: THREE.SrcColorFactor, 4: THREE.OneMinusSrcColorFactor,
  5: THREE.SrcAlphaFactor, 6: THREE.OneMinusSrcAlphaFactor, 7: THREE.DstAlphaFactor,
  8: THREE.OneMinusDstAlphaFactor, 9: THREE.DstColorFactor, 10: THREE.OneMinusDstColorFactor,
  11: THREE.SrcAlphaSaturateFactor,
};

const VERT = `
precision highp float;
precision highp int;
in uvec4 aPos;
in uvec2 aColor;
in uvec2 aUV;
in uint aInfo;
uniform highp sampler2D uMatrices;
uniform mat4 uViewProj;
uniform mat4 uClipMap;
uniform mat4 uScreenMap;
out vec4 vColor;
out float vFog;
out vec2 vUV;
out vec3 vBoxmeerPosition;
out float vBoxmeerWorld;
flat out uint vTex;
flat out uint vLayer;
const float BYTE = 1.0 / 255.0;
void main() {
  uint matrix = aInfo & 0xFFFu;
  bool screen = (aInfo & 0x1000u) != 0u;
  uint tex = aInfo >> 16;
  vTex = tex == 0xFFFFu ? 7u : tex >> 12;
  vLayer = tex & 0xFFFu;
  vec4 p = vec4(uintBitsToFloat(aPos.x), uintBitsToFloat(aPos.y), uintBitsToFloat(aPos.z), 1.0);
  if (screen) {
    vBoxmeerWorld=0.;vBoxmeerPosition=vec3(0.);
    // D3DTLVERTEX: x and y in pixels of the game's 640x480 mode.
    gl_Position = uScreenMap * p;
  } else {
    int row = int(matrix);
    mat4 world = mat4(
      texelFetch(uMatrices, ivec2(0, row), 0), texelFetch(uMatrices, ivec2(1, row), 0),
      texelFetch(uMatrices, ivec2(2, row), 0), texelFetch(uMatrices, ivec2(3, row), 0));
    gl_Position = uClipMap * uViewProj * world * p;
    vBoxmeerWorld=1.;vBoxmeerPosition=(world*p).xyz;
  }
  uint c = aColor.x;
  vColor = vec4(float((c >> 16) & 255u), float((c >> 8) & 255u), float(c & 255u), float(c >> 24)) * BYTE;
  vFog = float(aColor.y >> 24) * BYTE;
  vUV = vec2(uintBitsToFloat(aUV.x), uintBitsToFloat(aUV.y));
}`;

const FRAG = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uTex0;
uniform sampler2DArray uTex1;
uniform sampler2DArray uTex2;
uniform sampler2DArray uTex3;
uniform sampler2DArray uTex4;
uniform sampler2DArray uTex5;
uniform int uMapBlend;
uniform int uFog;
uniform int uNearest;
uniform vec3 uFogColor;
uniform int uBoxmeer;
uniform vec3 uBoxmeerCamera;
in vec4 vColor;
in float vFog;
in vec2 vUV;
in vec3 vBoxmeerPosition;
in float vBoxmeerWorld;
flat in uint vTex;
flat in uint vLayer;
out vec4 outColor;
// Filter is draw state in the game, not texture state: FUN_004bc200. The arrays stay linear and
// a draw with the filter off reads its texel directly, wrapping as the sampler would.
vec4 sampleTex(sampler2DArray s) {
  if (uNearest == 0) return texture(s, vec3(vUV, float(vLayer)));
  ivec2 size = textureSize(s, 0).xy;
  return texelFetch(s, ivec3(min(ivec2(fract(vUV) * vec2(size)), size - 1), int(vLayer)), 0);
}
void main() {
  vec4 c = vColor;
  if (vTex != 7u) {
    vec4 t;
    if (vTex == 0u) t = sampleTex(uTex0);
    else if (vTex == 1u) t = sampleTex(uTex1);
    else if (vTex == 2u) t = sampleTex(uTex2);
    else if (vTex == 3u) t = sampleTex(uTex3);
    else if (vTex == 4u) t = sampleTex(uTex4);
    else t = sampleTex(uTex5);
    // Colour-keyed texels are black with alpha 0, so dividing by the filtered alpha
    // recovers the real colour without dark edges.
    if (t.a < 0.5) discard;
    t.rgb /= t.a;
    if (uMapBlend == 2) c = vec4(t.rgb * vColor.rgb, vColor.a);
    else if (uMapBlend == 4) c = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
    else c = vec4(t.rgb, 1.0);
  }
  if (uFog != 0) c.rgb = mix(uFogColor, c.rgb, vFog);
  if(uBoxmeer!=0&&vBoxmeerWorld>.5){
    vec3 n=normalize(cross(dFdx(vBoxmeerPosition),dFdy(vBoxmeerPosition)));
    float light=.88+.2*max(dot(n,normalize(vec3(1.4,1.9,.9))),0.);
    c.rgb=mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,.93)*light;
    float distanceToEye=length(vBoxmeerPosition-uBoxmeerCamera);
    float haze=1.-exp(-pow(distanceToEye*.000038,2.));
    c.rgb=mix(c.rgb,vec3(.80,.84,.78),min(haze,.7));
  }
  outColor = c;
}`;

// The 8-bit path, RESOLUTION 0 and 1: every draw is D3DTBLEND_COPY on a Ramp device, so a texel's
// palette index goes to the target as it is. Vertex colour, blending, fog and filters play no part.
// The world is drawn as indices and through the palette afterwards, so the palette acts on the
// whole picture at once, as on the real screen. docs/research/render-8bit.md.
const PAGE_KEY = 254;
// In GLES a flat varying comes from a triangle's last vertex: drawPrimitive puts Direct3D's first there.
const VERT_INDEXED = VERT
  .replace('out vec4 vColor;', 'out vec4 vColor;\nflat out float vFlatAlpha;')
  .replace('  vFog = ', '  vFlatAlpha = float(c >> 24);\n  vFog = ');
const FRAG_INDEXED = `
precision highp float;
precision highp int;
uniform highp sampler2D uPage;
uniform highp sampler2D uColors;
uniform int uDirect;
uniform vec4 uStipple;    // mode pixels per target pixel, and where the mode's first pixel lies
uniform float uTargetHeight;
in vec4 vColor;
flat in float vFlatAlpha;
in vec2 vUV;
flat in uint vTex;
out vec4 outColor;
// Measured on the Ramp device, not in its documents: docs/research/render-8bit.md.
const int STIPPLE[16] = int[16](0, 12, 3, 15, 8, 4, 11, 7, 2, 14, 1, 13, 10, 6, 9, 5);
void main() {
  float index;
  if (vTex != 7u) {
    ivec2 size = textureSize(uPage, 0);
    index = floor(texelFetch(uPage, min(ivec2(fract(vUV) * vec2(size)), size - 1), 0).r * 255.0 + 0.5);
    if (index == ${PAGE_KEY}.0) discard;
  } else {
    // No texture, state 1 = 0. The blue byte picks a step of the material's ramp, 16 palette entries
    // from the top down, which the driver took while they were free. The game's palette then
    // replaced their colours. Vertex alpha screens the triangle, by its first vertex.
    index = 255.0 - floor(vColor.b * 15.0 + 0.001);
    ivec2 p = ivec2(floor(gl_FragCoord.x * uStipple.x), floor((uTargetHeight - gl_FragCoord.y) * uStipple.y)) - ivec2(uStipple.zw);
    if (float(STIPPLE[(p.y & 3) * 4 + (p.x & 3)]) * 16.0 >= vFlatAlpha) discard;
  }
  if (uDirect != 0) outColor = vec4(texelFetch(uColors, ivec2(int(index), 0), 0).rgb, 1.0);
  else outColor = vec4(index / 255.0, 0.0, 0.0, 1.0);
}`;
// The sky: FUN_004455e0 copies rows of the panorama to the target before the scene. Wider views
// read further along it, as the wrap at srcW would. Taller views mirror it upward from its first row.
const SKY_VERT = 'in vec3 position; out vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const SKY_FRAG = `
precision highp float;
precision highp int;
uniform highp sampler2D uSky;
uniform vec2 uReach;      // xr, yr
uniform vec2 uMode;       // W, H
uniform float uClipY;
uniform float uStart;
uniform float uRows;
uniform float uSourceWidth;
in vec2 vNdc;
out vec4 outColor;
void main() {
  float x = floor((vNdc.x * uReach.x + 1.0) * uMode.x * 0.5);
  float y = floor((uClipY - vNdc.y * uReach.y) / (2.0 * uClipY) * uMode.y);
  if (y >= uRows) discard;
  float row = y < 0.0 ? mod(-y - 1.0, uRows) : y;
  outColor = vec4(texelFetch(uSky, ivec2(int(mod(x + uStart, uSourceWidth)), int(row)), 0).r, 0.0, 0.0, 1.0);
}`;
const COLOR_FRAG = `
precision highp float;
precision highp int;
uniform highp sampler2D uIndex;
uniform highp sampler2D uColors;
out vec4 outColor;
void main() {
  int index = int(texelFetch(uIndex, ivec2(gl_FragCoord.xy), 0).r * 255.0 + 0.5);
  outColor = vec4(texelFetch(uColors, ivec2(index, 0), 0).rgb, 1.0);
}`;
// Each source pixel stays a sharp block, with one screen pixel of blend at its edge, so a scale
// that is not a whole number shows no uneven pixels.
const SCREEN_FRAG = `
precision highp float;
uniform sampler2D uWorld;
uniform sampler2D uHud;
uniform vec2 uWorldSize;
uniform vec2 uHudSize;
uniform vec2 uOutSize;
in vec2 vUV;
out vec4 c;
vec2 sharp(vec2 size) {
  vec2 texel = vUV * size;
  vec2 scale = max(uOutSize / size, vec2(1.0));
  vec2 range = 0.5 - 0.5 / scale;
  vec2 d = fract(texel) - 0.5;
  return (floor(texel) + (d - clamp(d, -range, range)) * scale + 0.5) / size;
}
void main() {
  vec4 hud = texture(uHud, sharp(uHudSize));
  c = vec4(hud.rgb + texture(uWorld, sharp(uWorldSize)).rgb * (1.0 - hud.a), 1.0);
}`;

/** One coordinate of the eye of a view matrix, from the row of memory it is the dot product with. */
const eyeAxis = (v, o) => -(v[12] * v[o] + v[13] * v[o + 1] + v[14] * v[o + 2]);

/** Cosine of the angle of the rotation between two matrices' 3x3 parts, rows normalised for scale. */
function turnCos(a, q, b, o) {
  let trace = 0;
  for (let r = 0; r < 12; r += 4) {
    const la = Math.hypot(a[q + r], a[q + r + 1], a[q + r + 2]);
    const lb = Math.hypot(b[o + r], b[o + r + 1], b[o + r + 2]);
    if (!la || !lb) return 1;
    trace += (a[q + r] * b[o + r] + a[q + r + 1] * b[o + r + 1] + a[q + r + 2] * b[o + r + 2]) / (la * lb);
  }
  return (trace - 1) / 2;
}

class Frame {
  constructor() {
    this.matrices = new Float32Array(MAX_MATRICES * 16);
    this.matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    this.matKeys = new Map();     // draw key -> palette row
    this.meshRows = new Map();    // mesh -> palette rows of its draws, in draw order
    this.prevRow = new Int32Array(MAX_MATRICES);
    this.dynFloats = new Float32Array(MAX_DYNAMIC_FLOATS);
    this.dynamic = new Map();     // draw key -> { offset, count, base }
    this.dynPair = new Map();     // draw key -> its entry in the tick before, by pairMovingVerts
    this.shadowPose = new Float32Array(16);   // the player's car, when its shadow was built
    this.shadowParts = [];        // { offset, count, base } of the player's shadow polygons
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.reset();
  }

  reset() {
    this.vertCount = 0;
    this.indexCount = 0;
    this.batches = [];
    this.matrixCount = 1;
    this.lastKey = -1;
    this.lastBatch = null;
    this.matKeys.clear();
    this.meshRows.clear();
    this.dynamic.clear();
    this.dynPair.clear();
    this.dynUsed = 0;
    this.hasShadowPose = false;
    this.shadowParts.length = 0;
    this.hasView = false;
    this.full = false;
    this.sky = null;
    this.boxmeerTrackSeen = false;
  }
}

export class D3DRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.useStatic = options.staticTrack !== false;
    // An opaque canvas. three.js asks for a drawing buffer with alpha whatever it is told, and the
    // game's draws leave alpha below 1 in places; a compositor that blends the page by it, such as
    // Chromium on native Wayland, then shows the road and the sky black and tints the rest.
    const attributes = {
      alpha: false, antialias: options.antialias === true, depth: true, stencil: false,
      premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: options.preserve === true,
    };
    this.three = new THREE.WebGLRenderer({ canvas, context: canvas.getContext('webgl2', attributes) || undefined, ...attributes });
    this.three.autoClear = false;
    this.three.sortObjects = false;
    this.three.setPixelRatio(1);
    this.three.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.three.toneMapping = THREE.NoToneMapping;
    this.camera = new THREE.Camera();
    this.boxmeerCamera={value:new THREE.Vector3()};this.boxmeerSkyTextures=new Set();
    this.sceneWorld = new THREE.Scene();
    this.sceneWorld.matrixWorldAutoUpdate = false;
    this.sceneHud = new THREE.Scene();
    this.sceneHud.matrixWorldAutoUpdate = false;
    this.m = null;
    this.state = new Int32Array(64);
    this.lightState = new Float64Array(16);
    this.materials = new Map();
    this.meshesWorld = [];
    this.meshesHud = [];
    this.stats = { verts: 0, indices: 0, batches: 0, matrices: 0, ticksCaptured: 0 };
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.viewProjSceneA = new THREE.Matrix4();
    this.sceneVP = new THREE.Matrix4();
    this.clipMap = new THREE.Matrix4();
    this.screenMap = new THREE.Matrix4();
    this.hudClipMap = new THREE.Matrix4();
    this.hudScreenMap = new THREE.Matrix4();
    this.tmpV = new THREE.Matrix4();
    this.shadowMove = new THREE.Matrix4();
    this.shadowInverse = new THREE.Matrix4();
    this.inPlayerShadow = false;
    this.tmpP = new THREE.Matrix4();
    this.hud = false;
    this.noBlend = false;
    this.screenFill = null;
    this.captureLevel = 2;
    this.drawsThisFrame = 0;
    this.viewW = 640;
    this.viewH = 480;
    this.area = { x: 0, y: 0, w: 640, h: 480 };
    this.xr = 1;
    this.yr = 0.75;
    this.effective = { width: 640, height: 480 };
    this.renderTarget = null;
    this.setupGeometry();
    this.setupTextures();
    this.frameB = new Frame();    // being captured or most recent
    this.frameA = new Frame();    // the tick before
    this.capturing = new Frame();
    this.stateCapture();
    this.blitSetup();
    this.occ = new Map();
    this.staticMap = new Map();
    this.staticTop = MAX_VERTS;
    this.staticDirty = [];
    this.indexed = false;
    this.clipY = 0.75;
    this.modeW = 640;
    this.modeH = 480;
    this.grid = null;
    this.colorQueue = [];
    this.colorVersion = 0;
    this.colorVersionSeen = 0;
    this.colorsShown = false;
  }

  stateCapture() {
    const s = this.state;
    s[RS.ZENABLE] = 1;
    s[RS.ZWRITEENABLE] = 1;
    s[RS.SRCBLEND] = 2;
    s[RS.DESTBLEND] = 1;
    s[RS.TEXTUREMAPBLEND] = 1;
    s[RS.ALPHABLENDENABLE] = 0;
    s[RS.COLORKEYENABLE] = 1;
    s[RS.FOGENABLE] = 0;
    s[RS.ZBIAS] = 0;
    s[RS.FOGCOLOR] = 0xFFFFFF;
  }

  /** A new race process: nothing carries over except GPU objects that get reused. */
  resetForRace() {
    this.boxmeerWorld?.dispose();this.boxmeerWorld=null;
    this.boxmeerSkyTextures=new Set();
    this.boxmeerCamera={value:new THREE.Vector3()};
    this.three.shadowMap.enabled=false;this.three.shadowMap.autoUpdate=true;
    this.three.outputColorSpace=THREE.LinearSRGBColorSpace;this.three.toneMapping=THREE.NoToneMapping;
    this.frameA.reset();
    this.frameB.reset();
    this.capturing.reset();
    this.havePresented = false;
    this.pendingUpload = false;
    for (const a of this.arrays) {
      a.next = 0;
      a.free.length = 0;
    }
    this.state.fill(0);
    this.stateCapture();
    this.worldDirty = true;
    this.viewProjDirty = true;
    this.hud = false;
    this.noBlend = false;
    this.screenFill = null;
    this.captureLevel = 2;
    this.lastFull = null;
    this.staticMap.clear();
    this.staticTop = MAX_VERTS;
    this.staticDirty.length = 0;
    this.indexed = false;
    this.vp = null;
    this.pageSurface = null;
    this.pageGeneration = -1;
    this.skySurface = null;
    this.colorQueue.length = 0;
    this.colorVersionSeen = this.colorVersion;
    this.colorsShown = false;
  }

  attach(m, host) {
    this.m = m;
    this.host = host;
    // Vianen's new, densely detailed atlases need minification filtering. The original tracks
    // retain their draw-state sampling; switching races also restores the array parameters.
    const authoredSlot = Number(host.vfs.iniGet('game.ini', 'ETAPPE', 'ETAPPE'));
    this.smoothVianen = authoredSlot === 10 || authoredSlot === 11;
    this.vianenGeometry = this.smoothVianen ? new VianenGeometry(host.vfs.read(`etappe${authoredSlot}.rmp`)) : null;
    const boxmeerResolution=Number(host.vfs.iniGet('raser.ini','PROGRAM','RESOLUTION'));
    if(authoredSlot===11 && boxmeerResolution>=2 && !new URLSearchParams(location.search).has('classicboxmeer')){
      this.three.outputColorSpace=THREE.SRGBColorSpace;this.three.toneMapping=THREE.ACESFilmicToneMapping;this.three.toneMappingExposure=1.05;
      this.three.shadowMap.enabled=true;this.three.shadowMap.type=THREE.PCFSoftShadowMap;this.three.shadowMap.autoUpdate=false;
      this.boxmeerWorld=new BoxmeerWorld(name=>host.vfs.read(name.replace(/^boxmeer\.(rmp|pmp)$/,'etappe11.$1')),this.three);
    }
    for (const a of this.arrays) this.filterTrackArray(a);
    this.u32 = m.u32;
    this.u16 = m.u16;
    this.f32 = m.f32;
    this.occ.clear();
    // FUN_0045dce0 draws all particles: one mesh per live particle (FUN_0045ec30), so an
    // occurrence number names another particle after one dies. The pass already has a guard
    // hook, see GUARDED in tools/recomp/replacements.py: mark the draws made inside it.
    const hook = m.thunkId('hook!guard_0045dce0');
    const guarded = m.thunks[hook];
    m.thunks[hook] = (esp, ecx, edx, eax) => {
      this.noBlend = true;
      try {
        return guarded(esp, ecx, edx, eax);
      } finally {
        this.noBlend = false;
      }
    };
  }

  setupGeometry() {
    const verts = new Uint32Array(MAX_VERTS * 8);
    const info = new Uint32Array(MAX_VERTS);
    const indices = new Uint32Array(MAX_INDICES);
    this.vertArray = verts;
    this.vertFloats = new Float32Array(verts.buffer);
    this.infoArray = info;
    this.indexArray = indices;
    this.vertBuffer = new THREE.InterleavedBuffer(verts, 8);
    this.vertBuffer.setUsage(THREE.DynamicDrawUsage);
    this.infoAttr = new THREE.BufferAttribute(info, 1);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    this.indexAttr = new THREE.BufferAttribute(indices, 1);
    this.indexAttr.setUsage(THREE.DynamicDrawUsage);
    this.attrPos = new THREE.InterleavedBufferAttribute(this.vertBuffer, 4, 0);
    this.attrColor = new THREE.InterleavedBufferAttribute(this.vertBuffer, 2, 4);
    this.attrUV = new THREE.InterleavedBufferAttribute(this.vertBuffer, 2, 6);
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.palette = new Float32Array(MAX_MATRICES * 16);
    this.matrixTexture = new THREE.DataTexture(this.palette, 4, MAX_MATRICES, THREE.RGBAFormat, THREE.FloatType);
    this.matrixTexture.minFilter = THREE.NearestFilter;
    this.matrixTexture.magFilter = THREE.NearestFilter;
    this.matrixTexture.generateMipmaps = false;
  }

  makeGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('aPos', this.attrPos);
    g.setAttribute('aColor', this.attrColor);
    g.setAttribute('aUV', this.attrUV);
    g.setAttribute('aInfo', this.infoAttr);
    g.setIndex(this.indexAttr);
    g.boundingSphere = this.boundingSphere;
    return g;
  }

  /** Largest texture and render target this GPU takes. */
  get maxTextureSize() {
    return this.three.capabilities.maxTextureSize;
  }

  // --- textures -----------------------------------------------------------------------
  setupTextures() {
    this.arrays = [];
    const empty = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    empty.needsUpdate = true;
    this.uniformsShared = {
      uMatrices: { value: this.matrixTexture },
      uTex0: { value: empty }, uTex1: { value: empty }, uTex2: { value: empty },
      uTex3: { value: empty }, uTex4: { value: empty }, uTex5: { value: empty },
    };
  }

  arrayFor(w, h) {
    let a = this.arrays.find((x) => x.w === w && x.h === h);
    if (a) return a;
    if (this.arrays.length >= MAX_ARRAYS) {
      return this.arrays.reduce((best, x) => (Math.abs(x.w * x.h - w * h) < Math.abs(best.w * best.h - w * h) ? x : best));
    }
    // Enough layers for the game's own texture budget of up to 16 MB at 16 bits per texel.
    const layers = Math.max(8, Math.min(128, Math.ceil((16 << 20) / (w * h * 2))));
    const data = new Uint8Array(w * h * 4 * layers);
    const tex = new THREE.DataArrayTexture(data, w, h, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    a = { w, h, tex, data, layers, next: 0, free: [], index: this.arrays.length };
    this.filterTrackArray(a);
    this.arrays.push(a);
    this.uniformsShared['uTex' + a.index].value = tex;
    return a;
  }

  filterTrackArray(a) {
    const smooth = this.smoothVianen && a.w >= 512 && a.h >= 512;
    a.tex.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    a.tex.generateMipmaps = smooth;
    a.tex.anisotropy = smooth ? Math.min(4, this.three.capabilities.getMaxAnisotropy()) : 1;
    a.tex.needsUpdate = true;
  }

  freeTexture(surface) {
    if (surface.ownsLayer && surface.textureId >= 0) {
      const a = this.arrays[surface.textureId >> 12];
      if (a) a.free.push(surface.textureId & 0xFFF);
    }
    surface.ownsLayer = false;
    surface.textureId = -1;
  }

  /**
   * IDirect3DTexture2::Load. One layer per system-memory surface: cached objects share one
   * video surface and swap pixels per object between draws (render-textures.md), so a Load
   * repoints the video surface in draw order, and pixels upload only when they changed.
   */
  loadTexture(dst, src) {
    if (!src.ownsLayer || src.uploadedGeneration !== src.generation) {
      const a = this.arrayFor(src.width, src.height);
      if (!src.ownsLayer) {
        let layer = a.free.length ? a.free.pop() : a.next < a.layers ? a.next++ : -1;
        if (layer < 0) layer = a.layers - 1;
        src.textureId = (a.index << 12) | layer;
        src.ownsLayer = true;
      }
      this.uploadPixels(a, src.textureId & 0xFFF, src);
      src.uploadedGeneration = src.generation;
    }
    dst.textureId = src.textureId;
  }

  uploadPixels(a, layer, src) {
    const m = this.m;
    const ptr = src.memory();
    const out = a.data;
    // In memory the game's key colour is always 0: docs/research/render-textures.md. It sets
    // the key on the surface only after loading, so a texel of 0 counts as keyed either way.
    const key = src.colorKey === -1 ? 0 : src.colorKey & 0xFFFF;
    const keyed = true;
    const base = layer * a.w * a.h * 4;
    const w = Math.min(src.width, a.w);
    const h = Math.min(src.height, a.h);
    const is4444 = src.format.a === 0xF000;
    const u16 = m.u16;
    for (let y = 0; y < h; y++) {
      let s = (ptr + y * src.pitch) >> 1;
      let d = base + y * a.w * 4;
      for (let x = 0; x < w; x++, s++, d += 4) {
        const c = u16[s];
        if (is4444) {
          out[d] = ((c >> 8) & 15) * 17;
          out[d + 1] = ((c >> 4) & 15) * 17;
          out[d + 2] = (c & 15) * 17;
          out[d + 3] = ((c >> 12) & 15) * 17;
        } else if (keyed && c === key) {
          out[d] = 0;
          out[d + 1] = 0;
          out[d + 2] = 0;
          out[d + 3] = 0;
        } else {
          out[d] = ((c >> 11) * 527 + 23) >> 6;
          out[d + 1] = (((c >> 5) & 63) * 259 + 33) >> 6;
          out[d + 2] = ((c & 31) * 527 + 23) >> 6;
          out[d + 3] = 255;
        }
      }
    }
    a.tex.addLayerUpdate(layer);
    a.tex.needsUpdate = true;
    const sky=this.boxmeerWorld?.skyTexture?.image;
    if(sky&&src.width===sky.width&&src.height===sky.height){
      let difference=0;
      for(const [x,y]of [[8,8],[sky.width-9,8],[8,sky.height-9],[sky.width-9,sky.height-9],[sky.width>>1,sky.height>>1]]){
        const p=(y*sky.width+x)*4,q=base+(y*a.w+x)*4;
        for(let k=0;k<3;k++)difference+=Math.abs(out[q+k]-sky.data[p+k]);
      }
      if(difference/15<9)this.boxmeerSkyTextures.add((a.index<<12)|layer);
    }
  }

  // --- state ------------------------------------------------------------------------------
  setRenderState(state, value) {
    this.state[state] = value;
    // The page, the one texture of the 8-bit path: state 1 stays on it for track and meshes.
    if (state === 1 && this.indexed && value) this.pageSurface = this.host.renderState.texture;
  }

  setLightState(state, value) {
    this.lightState[state] = value;
  }

  setBackground() {}

  setViewport(vp) {
    this.vp = vp;
    this.updateClipMap();
  }

  setTransform(type, p) {
    const f32 = this.f32;
    if (type === 1) {
      this.worldPtr = p;
      this.worldDirty = true;
    } else if (type === 2) {
      // A fixed camera for screenshots (tools/vianen/shots.mjs --views): a 16-value D3D view matrix.
      this.view.set(globalThis.__viewOverride || f32.subarray(p >> 2, (p >> 2) + 16));
      this.viewProjDirty = true;
    } else if (type === 3) {
      this.proj.set(f32.subarray(p >> 2, (p >> 2) + 16));
      this.viewProjDirty = true;
    }
  }

  // --- capture --------------------------------------------------------------------------------
  /** Whether a draw can be paired with its place in the tick before. If not, it shows the latest tick. */
  blends(verts) {
    return !this.hud && !this.noBlend
      && !(verts >= SMOKE_VERTS[0] && verts < SMOKE_VERTS[1])
      && !(verts >= BWLK_VERTS[0] && verts < BWLK_VERTS[1]);
  }

  /**
   * The flag sheet waves between z 4 and 6 (FUN_0043fe20) with the camera as world (FUN_0043ff60),
   * and at 4:3 its edges stay off screen. On a wider or taller view it grows until they do there
   * too, even at z 6. Rows 0 and 1 are the sheet's x and y: squares stay square, z stays.
   */
  scaleFlag(matrices, o) {
    const s = Math.max(1, this.xr / FLAG_REACH_X, this.yr / FLAG_REACH_Y);
    for (let j = 0; j < 8; j++) matrices[o + j] *= s;
  }

  worldIndex(verts) {
    const f = this.capturing;
    if (this.worldDirty) {
      this.worldDirty = false;
      let k = f.matrixCount;
      if (k >= MAX_MATRICES) k = MAX_MATRICES - 1;
      else f.matrixCount = k + 1;
      const p = this.worldPtr >> 2;
      f.matrices.set(this.f32.subarray(p, p + 16), k * 16);
      this.currentWorld = k;
      if (verts >= FLAG_VERTS[0] && verts < FLAG_VERTS[1]) this.scaleFlag(f.matrices, k * 16);
      if (this.blends(verts)) {
        const occ = this.occ.get(verts) || 0;
        this.occ.set(verts, occ + 1);
        f.matKeys.set(verts * 64 + occ, k);
        let rows = f.meshRows.get(verts);
        if (!rows) f.meshRows.set(verts, rows = []);
        rows.push(k);
      }
    }
    return this.currentWorld;
  }

  noteView() {
    const f = this.capturing;
    if (!this.hud && !f.hasView) {
      f.hasView = true;
      f.view.set(this.view);
      f.proj.set(this.proj);
    }
  }

  pipelineKey(texture) {
    const s = this.state;
    const blend = s[RS.ALPHABLENDENABLE] ? 1 : 0;
    let k = blend;
    if (blend) k |= (s[RS.SRCBLEND] << 1) | (s[RS.DESTBLEND] << 5);
    k |= (s[RS.ZENABLE] ? 1 : 0) << 9;
    k |= (s[RS.ZWRITEENABLE] ? 1 : 0) << 10;
    k |= (s[RS.ZBIAS] & 3) << 11;
    k |= (s[RS.FOGENABLE] ? 1 : 0) << 13;
    k |= (texture ? s[RS.TEXTUREMAPBLEND] & 7 : 0) << 14;
    k |= (this.hud ? 1 : 0) << 17;
    // D3DFILTER_NEAREST, or D3DFILTER_MIPNEAREST with mipmapping on: FUN_004bc200.
    const mag = s[RS.TEXTUREMAG];
    const smoothWorld = this.smoothVianen && !this.hud && !this.indexed;
    k |= (texture && !smoothWorld && (mag === 1 || mag === 3) ? 1 : 0) << 18;
    k |= (this.indexed ? 1 : 0) << 19;
    return k;
  }

  batch(texture) {
    const f = this.capturing;
    const key = this.pipelineKey(texture);
    const hud = this.hud;
    if (hud && this.viewProjDirty) {
      this.viewProjDirty = false;
      this.tmpP.fromArray(this.proj);
      this.tmpV.fromArray(this.view);
      this.hudVP = new THREE.Matrix4().multiplyMatrices(this.tmpP, this.tmpV);
    }
    if (!hud) this.viewProjDirty = false;
    const b = f.lastBatch;
    const vp = hud ? this.hudVP : null;
    if (b && f.lastKey === key && b.vp === vp && b.fogColor === this.state[RS.FOGCOLOR]) return b;
    const nb = { key, start: f.indexCount, count: 0, vp, fogColor: this.state[RS.FOGCOLOR], hud };
    f.batches.push(nb);
    f.lastBatch = nb;
    f.lastKey = key;
    return nb;
  }

  texInfo(t) {
    if (this.indexed) return t ? 0 : NO_TEXTURE;
    return t && t.textureId >= 0 ? t.textureId : NO_TEXTURE;
  }

  /** Positions of this draw, for blending with the next tick. */
  noteMoving(verts, count) {
    const f = this.capturing;
    const occ = this.occ.get(-verts) || 0;
    this.occ.set(-verts, occ + 1);
    if (f.dynUsed + count * 3 <= MAX_DYNAMIC_FLOATS) {
      const fp = verts >> 2;
      const dyn = f.dynFloats;
      const src = this.f32;
      let o = f.dynUsed;
      for (let k = 0, s = fp; k < count; k++, s += 8, o += 3) {
        dyn[o] = src[s];
        dyn[o + 1] = src[s + 1];
        dyn[o + 2] = src[s + 2];
      }
      f.dynamic.set(verts * 64 + occ, { offset: f.dynUsed, count, base: f.vertCount });
      f.dynUsed = o;
    }
  }

  /**
   * The player's shadow (FUN_00443770) is cut against the ground into new polygons on the heap every
   * tick, so its draws cannot be paired with the tick before. It is moved with its car instead.
   */
  beginPlayerShadow(pose) {
    const f = this.capturing;
    f.shadowPose.set(pose);
    f.hasShadowPose = true;
    this.inPlayerShadow = true;
  }

  endPlayerShadow() {
    this.inPlayerShadow = false;
  }

  noteShadow(verts, count) {
    const f = this.capturing;
    if (f.dynUsed + count * 3 > MAX_DYNAMIC_FLOATS) return;
    const dyn = f.dynFloats;
    const src = this.f32;
    let o = f.dynUsed;
    for (let k = 0, s = verts >> 2; k < count; k++, s += 8, o += 3) {
      dyn[o] = src[s];
      dyn[o + 1] = src[s + 1];
      dyn[o + 2] = src[s + 2];
    }
    f.shadowParts.push({ offset: f.dynUsed, count, base: f.vertCount });
    f.dynUsed = o;
  }

  /** Non-indexed draws carry moving vertices: skid marks, the player's shadow, the flag. */
  drawPrimitive(prim, vtype, verts, count) {
    if (count <= 0) return;
    this.drawsThisFrame++;
    if (this.captureLevel === 0) return;
    const f = this.capturing;
    const world = vtype === 3 ? 0 : this.worldIndex(verts);
    this.noteView();
    if(this.boxmeerWorld && !this.hud && (!f.boxmeerTrackSeen||this.boxmeerSkyTextures.has(this.texInfo(this.host.renderState.texture))))return;
    if (vtype !== 3 && this.blends(verts)) {
      if (this.inPlayerShadow) this.noteShadow(verts, count);
      else this.noteMoving(verts, count);
    }
    if (this.captureLevel === 1) return;
    const texture = this.host.renderState.texture;
    const base = this.copyVerts(vtype, verts, count, world, texture);
    if (base < 0) return;
    const out = this.indexArray;
    const b = this.batch(texture);
    let n = f.indexCount;
    if (n + count * 3 >= MAX_INDICES) return;
    if (prim === 4) {
      for (let k = 0; k < count; k++) out[n++] = base + k;
    } else if (prim === 5 && this.indexed) {
      // The same winding, turned so that each triangle ends on its first vertex: FRAG_INDEXED.
      for (let k = 2; k < count; k++) {
        const odd = k & 1;
        out[n++] = base + k - odd;
        out[n++] = base + k - 1 + odd;
        out[n++] = base + k - 2;
      }
    } else if (prim === 6 && this.indexed) {
      for (let k = 2; k < count; k++) {
        out[n++] = base + k - 1;
        out[n++] = base + k;
        out[n++] = base;
      }
    } else if (prim === 5) {
      for (let k = 2; k < count; k++) {
        const odd = k & 1;
        out[n++] = base + k - 2 + odd;
        out[n++] = base + k - 1 - odd;
        out[n++] = base + k;
      }
    } else if (prim === 6) {
      for (let k = 2; k < count; k++) {
        out[n++] = base;
        out[n++] = base + k - 1;
        out[n++] = base + k;
      }
    } else {
      return;   // lines and points: debug drawing only
    }
    b.count += n - f.indexCount;
    f.indexCount = n;
  }

  drawIndexed(prim, vtype, verts, nverts, indices, nindices) {
    if (prim !== 4) return;
    const complete = !this.hud && !this.indexed && vtype === 2 && this.vianenGeometry?.indicesFor(this.f32, verts, nverts);
    if (complete) nindices = complete.length;
    if (nindices <= 0) return;
    this.drawsThisFrame++;
    if (this.captureLevel === 0) return;
    const world = this.worldIndex(verts);
    this.noteView();
    if(this.boxmeerWorld && !this.hud){
      if(complete){this.capturing.boxmeerTrackSeen=true;return;}
      if(!this.capturing.boxmeerTrackSeen||this.boxmeerSkyTextures.has(this.texInfo(this.host.renderState.texture)))return;
      // Keep the native start handler, but omit the overhead start-airship artwork.
      // This flat start area has no other elevated models; particles use TL vertices.
      if(vtype===2&&this.m.i32[0x6fbab4>>2]<7&&this.f32[(this.worldPtr>>2)+13]>65)return;
    }
    // Blob shadows: one 4-vertex mesh rewritten per car, drawn with ZBIAS 1 (FUN_00443ef0).
    if (nverts === 4 && this.state[RS.ZBIAS] && this.blends(verts)) this.noteMoving(verts, 4);
    if (this.captureLevel === 1) return;
    const f = this.capturing;
    const texture = this.host.renderState.texture;
    let base = -1;
    // Track vertices never change after loading (render-frame.md): upload them once.
    if (this.useStatic && vtype === 2 && nverts >= STATIC_MIN && !this.hud) base = this.staticVerts(verts, nverts, texture, world);
    if (base < 0) base = this.copyVerts(vtype, verts, nverts, world, texture);
    if (base < 0) return;
    const b = this.batch(texture);
    const out = this.indexArray;
    const src = complete || this.u16;
    let n = f.indexCount;
    if (n + nindices >= MAX_INDICES) return;
    const p = complete ? 0 : indices >> 1;
    for (let k = 0; k < nindices; k++) out[n++] = base + src[p + k];
    // Authored Vianen flat props carry U + 4, which repeats to the same atlas texel.
    // Supply their reverse winding to the GPU, keeping the original RMP/collision plane count
    // and normal back-face culling for buildings, the HUD and original tracks.
    if (this.smoothVianen && !this.hud && vtype === 2) {
      const vertex = verts >> 2, floats = this.f32;
      const tagged = i => { const u = floats[vertex + i * 8 + 6]; return u >= 4 && u < 5; };
      for (let k = 0; k + 2 < nindices && n + 3 < MAX_INDICES; k += 3) {
        const a = src[p + k], c = src[p + k + 1], d = src[p + k + 2];
        if (tagged(a) && tagged(c) && tagged(d)) {
          out[n++] = base + a; out[n++] = base + d; out[n++] = base + c;
        }
      }
    }
    b.count += n - f.indexCount;
    f.indexCount = n;
  }

  /** A place in the never-rewritten part of the vertex buffer, or -1 if this draw needs copying. */
  staticVerts(verts, count, texture, world) {
    const f = this.capturing;
    const m = f.matrices;
    const o = world * 16;
    // Only draws with an identity world: the row number is frame-local, so row 0 stands in.
    if (m[o] !== 1 || m[o + 5] !== 1 || m[o + 10] !== 1 || m[o + 15] !== 1 || m[o + 1] !== 0 || m[o + 2] !== 0 || m[o + 12] !== 0 || m[o + 13] !== 0 || m[o + 14] !== 0) return -1;
    const info = this.texInfo(texture) << 16;
    const key = verts * 65536 + (info >>> 16);
    let base = this.staticMap.get(key);
    if (base !== undefined) return base;
    if (this.staticTop - count < DYNAMIC_VERTS) return -1;
    this.staticTop -= count;
    base = this.staticTop;
    const p = verts >> 2;
    this.vertArray.set(this.u32.subarray(p, p + count * 8), base * 8);
    this.infoArray.fill(info, base, base + count);
    this.staticMap.set(key, base);
    this.staticDirty.push(base, count);
    return base;
  }

  copyVerts(vtype, verts, count, world, texture) {
    const f = this.capturing;
    const base = f.vertCount;
    if (base + count > DYNAMIC_VERTS) return -1;
    const info = (this.texInfo(texture) << 16) | world | (vtype === 3 ? 0x1000 : 0);
    const u32 = this.u32;
    const p = verts >> 2;
    if (vtype === 1) {
      // D3DVERTEX: no vertex colour. The game creates no lights, so it would come out as the
      // material's ambient and emissive terms; see docs/original-behavior.md.
      const dst = this.vertArray;
      for (let k = 0, s = p, d = base * 8; k < count; k++, s += 8, d += 8) {
        dst[d] = u32[s];
        dst[d + 1] = u32[s + 1];
        dst[d + 2] = u32[s + 2];
        dst[d + 3] = 0;
        dst[d + 4] = 0xFFFFFFFF;
        dst[d + 5] = 0xFF000000;
        dst[d + 6] = u32[s + 6];
        dst[d + 7] = u32[s + 7];
      }
    } else {
      this.vertArray.set(u32.subarray(p, p + count * 8), base * 8);
    }
    this.infoArray.fill(info, base, base + count);
    f.vertCount = base + count;
    return base;
  }

  // --- frame flow -----------------------------------------------------------------------------
  beginScene() {}

  endScene() {}

  clear() {}

  /**
   * Blt with COLORFILL on the screen. In a race that is the flitser's white frame, after the scene
   * and before the flip (FUN_0043b130). The others are colour 0 and clear the screen at start-up
   * and exit (FUN_004c4fa0, FUN_00448160). Here the canvas is swapped at those moments, and the last
   * frame stays up while RaceRunner.endWait waits for keys.
   */
  fillScreen(dst, rect, color) {
    if (!color) return;
    // RGB 565, expanded as in uploadPixels.
    const r = (((color >> 11) & 31) * 527 + 23) >> 6;
    const g = (((color >> 5) & 63) * 259 + 33) >> 6;
    const b = ((color & 31) * 527 + 23) >> 6;
    const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
    this.screenFill = { color: c, flips: 0, shownAt: 0 };
  }

  /**
   * Blt to a screen. Between screens it is the present, FUN_004c8b90: one target here. Any other
   * source is the sky, FUN_004455e0: one or two rectangles that wrap at the panorama's width, and
   * the first holds where it starts. FUN_004456e0.
   */
  blitToScreen(dst, dr, src, sr) {
    if (!this.indexed || src.isPrimary || src.backBuffer || src === this.host.bufferScreen) return;
    if (dr.l === 0) this.capturing.sky = { surface: src, start: sr.l, rows: dr.b };
  }

  /** IDirectDrawPalette::SetEntries. The 1024 bytes of the palette object, 4 per entry. */
  setPalette(entries) {
    if (!this.colors) this.setupIndexed();
    this.colorsNext.set(entries);
    this.colorVersion++;
  }

  /** The game flipped: this tick's capture is complete. */
  endFrame() {
    if (this.screenFill) this.screenFill.flips++;
    // Each palette a flip showed gets a present of its own: the flitser's lasts one flip.
    if (this.colorVersion !== this.colorVersionSeen) {
      this.colorVersionSeen = this.colorVersion;
      this.colorQueue.push(this.colorsNext.slice());
    }
    // The game flips twice with nothing drawn before its pause and quit dialogs, which stay
    // on screen over the last real frame: FUN_0044cb80, docs/research/input.md.
    if (!this.drawsThisFrame) return;
    this.drawsThisFrame = 0;
    const f = this.capturing;
    f.full = this.captureLevel === 2;
    this.stats.ticksCaptured++;
    if (this.captureLevel >= 1) {
      // The new frame's rows blend from the previous frame's rows of the same draw.
      const a = this.frameB;
      const rows = f.prevRow;
      rows.fill(-1, 0, f.matrixCount);
      for (const [key, row] of f.matKeys) {
        const r = a.matKeys.get(key);
        if (r !== undefined) rows[row] = r;
      }
      this.pairMoving(f, a);
      this.pairMovingVerts(f, a);
      const old = this.frameA;
      this.frameA = this.frameB;
      this.frameB = f;
      this.capturing = old;
    }
    if (f.full) {
      this.lastFull = f;
      this.pendingUpload = true;
      this.vertCountFull = f.vertCount;
      this.indexCountFull = f.indexCount;
      this.batchesFull = f.batches;
    }
    this.capturing.reset();
    this.occ.clear();
    this.worldDirty = true;
  }

  // --- presenting ---------------------------------------------------------------------------
  materialFor(key) {
    let mat = this.materials.get(key);
    if (mat) return mat;
    const blend = key & 1;
    const hud = (key >> 17) & 1;
    if ((key >> 19) & 1) {
      mat = this.indexedMaterial(key, hud);
      this.materials.set(key, mat);
      return mat;
    }
    mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMatrices: this.uniformsShared.uMatrices,
        uViewProj: { value: this.sceneVP },
        uClipMap: { value: hud ? this.hudClipMap : this.clipMap },
        uScreenMap: { value: hud ? this.hudScreenMap : this.screenMap },
        uFogColor: { value: new THREE.Color() },
        uBoxmeer:{value:0},uBoxmeerCamera:this.boxmeerCamera,
        uFog: { value: (key >> 13) & 1 },
        uMapBlend: { value: (key >> 14) & 7 },
        uNearest: { value: (key >> 18) & 1 },
        uTex0: this.uniformsShared.uTex0, uTex1: this.uniformsShared.uTex1, uTex2: this.uniformsShared.uTex2,
        uTex3: this.uniformsShared.uTex3, uTex4: this.uniformsShared.uTex4, uTex5: this.uniformsShared.uTex5,
      },
      side: THREE.BackSide,
      depthTest: ((key >> 9) & 1) === 1,
      depthWrite: ((key >> 10) & 1) === 1,
      toneMapped: false,
    });
    // Blending alone, not transparent: Three.js would draw those in a second list, and the batches
    // must keep the game's order. The shadows come before the objects: FUN_0044da30.
    if (blend) {
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = BLEND[(key >> 1) & 15] || THREE.OneFactor;
      mat.blendDst = BLEND[(key >> 5) & 15] || THREE.ZeroFactor;
    } else {
      mat.blending = THREE.NoBlending;
    }
    const bias = (key >> 11) & 3;
    if (bias) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -bias;
      mat.polygonOffsetUnits = -bias * 2;
    }
    this.materials.set(key, mat);
    return mat;
  }

  /**
   * Maps the game's clip volume (x -1..1, y -clipY..clipY, 0.75 at 640x480) to pixels. The view
   * keeps the original's vertical framing on wider screens and horizontal framing on taller
   * ones: docs/intentional-differences.md. Row vectors in memory, so GLSL sees them transposed.
   * 320x200 fills a 4:3 screen as on a monitor of the period, so its y is stretched.
   */
  updateClipMap() {
    const aspect = this.area.w / this.area.h;
    const clipY = this.vp ? this.vp.clipY : 0.75;
    const modeW = this.vp ? this.vp.width : 640;
    const modeH = this.vp ? this.vp.height : 480;
    const xr = aspect >= 4 / 3 ? 0.75 * aspect : 1;
    const yr = aspect >= 4 / 3 ? clipY : (clipY * (4 / 3)) / aspect;
    this.xr = xr;
    this.yr = yr;
    this.clipY = clipY;
    this.modeW = modeW;
    this.modeH = modeH;
    // A Direct3D 5 pixel's centre is at its integer coordinate, half a pixel of the mode away from
    // WebGL's. Measured against the Ramp device; on the path with a 3D card it is not drawn at the mode's size.
    const grid = this.indexed ? this.modeGrid() : null;
    const shiftX = grid ? 1 / grid.width : 0;
    const shiftY = grid ? -1 / grid.height : 0;
    const fit = (m, screen) => {
      m.set(
        1 / xr, 0, 0, shiftX,
        0, 1 / yr, 0, shiftY,
        0, 0, 2, -1,
        0, 0, 0, 1,
      );
      // D3DTLVERTEX: pixels of the mode, y down, mapped through the same fit.
      screen.set(
        (2 / modeW) / xr, 0, 0, -1 / xr,
        0, ((-2 * clipY) / modeH) / yr, 0, clipY / yr,
        0, 0, 2, -1,
        0, 0, 0, 1,
      );
    };
    fit(this.clipMap, this.screenMap);
    fit(this.hudClipMap, this.hudScreenMap);
  }

  /**
   * canvasW, canvasH: the drawing buffer, native. area: the part of it the 3D view fills.
   * effective: the size the 3D view renders at, from the resolution and render scale settings.
   */
  setRenderSize(canvasW, canvasH, area = null, effective = null) {
    this.viewW = canvasW;
    this.viewH = canvasH;
    this.area = area || { x: 0, y: 0, w: canvasW, h: canvasH };
    this.effective = effective || { width: this.area.w, height: this.area.h };
    this.three.setSize(canvasW, canvasH, false);
    if (this.indexed) {
      this.updateClipMap();
      this.indexedTargets();
      return;
    }
    const direct = this.effective.width === this.area.w && this.effective.height === this.area.h;
    if (direct) {
      if (this.renderTarget) {
        this.renderTarget.dispose();
        this.renderTarget = null;
      }
    } else if (!this.renderTarget || this.renderTarget.width !== this.effective.width || this.renderTarget.height !== this.effective.height) {
      if (this.renderTarget) this.renderTarget.dispose();
      this.renderTarget = new THREE.WebGLRenderTarget(this.effective.width, this.effective.height, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
        colorSpace: THREE.LinearSRGBColorSpace,
      });
      this.blitQuad.material.uniforms.map.value = this.renderTarget.texture;
    }
    this.updateClipMap();
  }

  blitSetup() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { map: { value: null } },
      vertexShader: 'in vec3 position; out vec2 vUV; void main() { vUV = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; uniform sampler2D map; in vec2 vUV; out vec4 c; void main() { c = texture(map, vUV); }',
      depthTest: false,
      depthWrite: false,
    });
    this.blitQuad = new THREE.Mesh(geo, mat);
    this.blitQuad.frustumCulled = false;
    this.blitScene = new THREE.Scene();
    this.blitScene.add(this.blitQuad);
  }

  // --- the 8-bit path --------------------------------------------------------------------------
  /** The device was created. Called once per race, after the mode is known. */
  setIndexed(on) {
    this.indexed = on;
    if (on && !this.colors) this.setupIndexed();
    if (!on) this.releaseIndexed();
  }

  /** A race with the 3D card after an 8-bit one: its page and targets are no use. */
  releaseIndexed() {
    for (const target of [this.worldIndex8, this.worldColor8, this.hud8]) if (target) target.dispose();
    this.worldIndex8 = null;
    this.worldColor8 = null;
    this.hud8 = null;
    if (this.pageTexture && this.pageTexture.image.width > 1) {
      this.pageTexture.dispose();
      this.pageTexture = this.redTexture(1, 1);
      for (const mat of this.materials.values()) if (mat.uniforms.uPage) mat.uniforms.uPage.value = this.pageTexture;
    }
  }

  /** The size of Automatisch here. */
  modeGrid(area = this.area) {
    return modeGrid(this.modeW, this.modeH, area.w / area.h);
  }

  setupIndexed() {
    const red = (w, h) => {
      const t = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
      t.internalFormat = 'R8';
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.unpackAlignment = 1;
      t.colorSpace = THREE.NoColorSpace;
      return t;
    };
    this.redTexture = red;
    this.colorsNext = new Uint8Array(1024);
    this.colors = new THREE.DataTexture(new Uint8Array(1024), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.colors.minFilter = THREE.NearestFilter;
    this.colors.magFilter = THREE.NearestFilter;
    this.colors.generateMipmaps = false;
    this.colors.colorSpace = THREE.NoColorSpace;
    this.pageTexture = red(1, 1);
    this.skyTexture = red(1, 1);
    this.stippleWorld = new THREE.Vector4(1, 1, 0, 0);
    this.stippleHud = new THREE.Vector4(1, 1, 0, 0);
    this.worldHeight = { value: 480 };
    this.hudHeight = { value: 480 };
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const pass = (uniforms, vertexShader, fragmentShader) => {
      const mesh = new THREE.Mesh(triangle, new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, uniforms, vertexShader, fragmentShader,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      }));
      mesh.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(mesh);
      return { scene, uniforms };
    };
    this.skyPass = pass({
      uSky: { value: this.skyTexture }, uReach: { value: new THREE.Vector2() }, uMode: { value: new THREE.Vector2() },
      uClipY: { value: 0.75 }, uStart: { value: 0 }, uRows: { value: 0 }, uSourceWidth: { value: 1 },
    }, SKY_VERT, SKY_FRAG);
    this.colorPass = pass({ uIndex: { value: null }, uColors: { value: this.colors } }, SKY_VERT, COLOR_FRAG);
    const uv = 'in vec3 position; out vec2 vUV; void main() { vUV = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.screenPass = pass({
      uWorld: { value: null }, uHud: { value: null }, uWorldSize: { value: new THREE.Vector2() },
      uHudSize: { value: new THREE.Vector2() }, uOutSize: { value: new THREE.Vector2() },
    }, uv, SCREEN_FRAG);
  }

  indexedMaterial(key, hud) {
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT_INDEXED,
      fragmentShader: FRAG_INDEXED,
      uniforms: {
        uMatrices: this.uniformsShared.uMatrices,
        uViewProj: { value: this.sceneVP },
        uClipMap: { value: hud ? this.hudClipMap : this.clipMap },
        uScreenMap: { value: hud ? this.hudScreenMap : this.screenMap },
        uFogColor: { value: new THREE.Color() },
        uPage: { value: this.pageTexture },
        uColors: { value: this.colors },
        uDirect: { value: hud },
        uStipple: { value: hud ? this.stippleHud : this.stippleWorld },
        uTargetHeight: hud ? this.hudHeight : this.worldHeight,
      },
      side: THREE.BackSide,
      depthTest: ((key >> 9) & 1) === 1,
      depthWrite: ((key >> 10) & 1) === 1,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    const bias = (key >> 11) & 3;
    if (bias) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -bias;
      mat.polygonOffsetUnits = -bias * 2;
    }
    return mat;
  }

  /** The world as indices and in colour at the effective size; the HUD in colour on the mode's grid. */
  indexedTargets() {
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    const { width, height } = this.effective;
    this.grid = this.modeGrid();
    const color = (w, h, depthBuffer) => new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer, stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const same = (t, w, h) => t && t.width === w && t.height === h;
    if (!same(this.worldIndex8, width, height)) {
      if (this.worldIndex8) this.worldIndex8.dispose();
      if (this.worldColor8) this.worldColor8.dispose();
      this.worldIndex8 = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RedFormat, type: THREE.UnsignedByteType, internalFormat: 'R8',
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false,
      });
      this.worldColor8 = color(width, height, false);
      this.worldIndex8Fresh = true;
    }
    if (!same(this.hud8, this.grid.width, this.grid.height)) {
      if (this.hud8) this.hud8.dispose();
      this.hud8 = color(this.grid.width, this.grid.height, true);
    }
    const originX = (this.grid.width - this.modeW) / 2;
    const originY = (this.grid.height - this.modeH) / 2;
    this.stippleWorld.set(this.grid.width / width, this.grid.height / height, originX, originY);
    this.stippleHud.set(1, 1, originX, originY);
    this.worldHeight.value = height;
    this.hudHeight.value = this.grid.height;
    const u = this.screenPass.uniforms;
    u.uWorld.value = this.worldColor8.texture;
    u.uHud.value = this.hud8.texture;
    u.uWorldSize.value.set(width, height);
    u.uHudSize.value.set(this.grid.width, this.grid.height);
    u.uOutSize.value.set(this.area.w, this.area.h);
    this.colorPass.uniforms.uIndex.value = this.worldIndex8.texture;
  }

  /** A surface's bytes into a red texture, when they changed. Pitch is the texture's width. */
  syncSurface(surface, texture, uniform) {
    if (surface.syncedTexture === texture && surface.syncedGeneration === surface.generation) return texture;
    const ptr = surface.memory();
    const bytes = this.m.u8.subarray(ptr, ptr + surface.pitch * surface.height);
    let t = texture;
    if (t.image.width !== surface.pitch || t.image.height !== surface.height) {
      t.dispose();
      t = this.redTexture(surface.pitch, surface.height);
      uniform(t);
    }
    t.image.data.set(bytes);
    t.needsUpdate = true;
    surface.syncedTexture = t;
    surface.syncedGeneration = surface.generation;
    return t;
  }

  /** One palette from the queue per present, the newest at the start. */
  nextColors() {
    if (!this.colorQueue.length) return;
    const next = this.colorsShown ? this.colorQueue.shift() : this.colorQueue[this.colorQueue.length - 1];
    if (!this.colorsShown) this.colorQueue.length = 0;
    this.colorsShown = true;
    this.colors.image.data.set(next);
    this.colors.needsUpdate = true;
  }

  presentIndexed(f) {
    const { three, area } = this;
    if (!this.worldIndex8) this.indexedTargets();
    this.nextColors();
    if (this.pageSurface) {
      this.pageTexture = this.syncSurface(this.pageSurface, this.pageTexture, (t) => {
        for (const mat of this.materials.values()) if (mat.uniforms.uPage) mat.uniforms.uPage.value = t;
      });
    }
    // The colour stays from frame to frame: only Z is cleared, FUN_004c0840.
    three.setRenderTarget(this.worldIndex8);
    if (this.worldIndex8Fresh) {
      this.worldIndex8Fresh = false;
      three.setClearColor(0x000000, 1);
      three.clear(true, true, false);
    } else {
      three.clear(false, true, false);
    }
    if (f.sky) {
      const u = this.skyPass.uniforms;
      this.skyTexture = this.syncSurface(f.sky.surface, this.skyTexture, (t) => {
        u.uSky.value = t;
      });
      u.uReach.value.set(this.xr, this.yr);
      u.uMode.value.set(this.modeW, this.modeH);
      u.uClipY.value = this.clipY;
      u.uStart.value = f.sky.start;
      u.uRows.value = f.sky.rows;
      u.uSourceWidth.value = f.sky.surface.width;
      three.render(this.skyPass.scene, this.camera);
    }
    three.render(this.sceneWorld, this.camera);
    three.setRenderTarget(this.worldColor8);
    three.render(this.colorPass.scene, this.camera);
    three.setRenderTarget(this.hud8);
    three.setClearColor(0x000000, 0);
    three.clear(true, true, false);
    three.render(this.sceneHud, this.camera);
    three.setRenderTarget(null);
    three.setViewport(0, 0, this.viewW, this.viewH);
    three.setScissorTest(false);
    three.setClearColor(0x000000, 1);
    three.clear(true, true, false);
    three.setViewport(area.x, this.viewH - area.y - area.h, area.w, area.h);
    three.render(this.screenPass.scene, this.camera);
  }

  /**
   * The n-th draw of a mesh is not always the same object from one tick to the next. Cars of one
   * model, and all car lights, share a mesh, and when one of them enters or leaves the view, or the
   * game sorts its alpha-blended queue differently, the order shifts. Paired by order, a light or a
   * car was then blended with another one, or taken for a teleport and drawn a tick ahead of the rest:
   * the tail lights flickered against their car. A mesh drawn more than once whose draws moved pairs
   * each draw with the nearest draw of the tick before instead, closest pairs first. Scenery that
   * stands still keeps the pairing by order.
   */
  pairMoving(f, a) {
    const rows = f.prevRow;
    const bm = f.matrices;
    const am = a.matrices;
    const d2 = (o, q) => {
      const dx = bm[o + 12] - am[q + 12];
      const dy = bm[o + 13] - am[q + 13];
      const dz = bm[o + 14] - am[q + 14];
      return dx * dx + dy * dy + dz * dz;
    };
    for (const [verts, listB] of f.meshRows) {
      const listA = a.meshRows.get(verts);
      if (!listA || (listB.length < 2 && listA.length < 2)) continue;
      let moved = listA.length !== listB.length;
      for (let i = 0; !moved && i < listB.length; i++) moved = d2(listB[i] * 16, listA[i] * 16) > 1e-6;
      if (!moved || listA.length * listB.length > 40000) continue;
      const pairs = [];
      for (let i = 0; i < listB.length; i++) {
        for (let j = 0; j < listA.length; j++) {
          const d = d2(listB[i] * 16, listA[j] * 16);
          if (d <= TELEPORT_DIST2) pairs.push(d, i, j);
        }
      }
      const order = [];
      for (let n = 0; n < pairs.length; n += 3) order.push(n);
      order.sort((x, y) => pairs[x] - pairs[y]);
      for (const row of listB) rows[row] = -1;
      const usedA = new Uint8Array(listA.length);
      const usedB = new Uint8Array(listB.length);
      for (const n of order) {
        const i = pairs[n + 1];
        const j = pairs[n + 2];
        if (usedB[i] || usedA[j]) continue;
        usedB[i] = 1;
        usedA[j] = 1;
        rows[listB[i]] = listA[j];
      }
    }
  }


  /**
   * The same for moving vertices: the blob shadows of the other cars are one 4-vertex mesh rewritten
   * per car (FUN_00443ef0), so by draw order a shadow was paired with another car's and drawn a tick
   * ahead of its car. Draws of one mesh with the same vertex count pair by the nearest centre.
   */
  pairMovingVerts(f, a) {
    const groupsB = new Map();
    const groupsA = new Map();
    for (const [key, e] of f.dynamic) {
      const v = Math.floor(key / 64);
      let g = groupsB.get(v);
      if (!g) groupsB.set(v, g = []);
      g.push(key);
    }
    for (const [key, e] of a.dynamic) {
      const v = Math.floor(key / 64);
      let g = groupsA.get(v);
      if (!g) groupsA.set(v, g = []);
      g.push(e);
    }
    const centre = (floats, e) => {
      let x = 0, y = 0, z = 0;
      for (let k = 0, o = e.offset; k < e.count; k++, o += 3) {
        x += floats[o];
        y += floats[o + 1];
        z += floats[o + 2];
      }
      return [x / e.count, y / e.count, z / e.count];
    };
    for (const [v, keys] of groupsB) {
      const listA = groupsA.get(v);
      if (!listA) continue;
      if (keys.length === 1 && listA.length === 1) {
        f.dynPair.set(keys[0], listA[0]);
        continue;
      }
      if (keys.length * listA.length > 40000) {
        for (const key of keys) {
          const p = a.dynamic.get(key);
          if (p) f.dynPair.set(key, p);
        }
        continue;
      }
      const cb = keys.map((key) => centre(f.dynFloats, f.dynamic.get(key)));
      const ca = listA.map((e) => centre(a.dynFloats, e));
      const pairs = [];
      for (let i = 0; i < keys.length; i++) {
        const count = f.dynamic.get(keys[i]).count;
        for (let j = 0; j < listA.length; j++) {
          if (listA[j].count !== count) continue;
          const dx = cb[i][0] - ca[j][0];
          const dy = cb[i][1] - ca[j][1];
          const dz = cb[i][2] - ca[j][2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d <= TELEPORT_DIST2) pairs.push(d, i, j);
        }
      }
      const order = [];
      for (let n = 0; n < pairs.length; n += 3) order.push(n);
      order.sort((x, y) => pairs[x] - pairs[y]);
      const usedA = new Uint8Array(listA.length);
      const usedB = new Uint8Array(keys.length);
      for (const n of order) {
        const i = pairs[n + 1];
        const j = pairs[n + 2];
        if (usedB[i] || usedA[j]) continue;
        usedB[i] = 1;
        usedA[j] = 1;
        f.dynPair.set(keys[i], listA[j]);
      }
    }
  }

  /** Writes the palette blended between the last two ticks. Scene matrix rows only. */
  blendPalette(alpha) {
    const b = this.frameB;
    const a = this.frameA;
    const pal = this.palette;
    const bm = b.matrices;
    const am = a.matrices;
    const rows = b.prevRow;
    const n = b.matrixCount;
    for (let k = 0; k < n; k++) {
      const r = rows[k];
      const o = k * 16;
      if (r < 0 || alpha >= 1) {
        for (let j = 0; j < 16; j++) pal[o + j] = bm[o + j];
        continue;
      }
      const q = r * 16;
      const dx = bm[o + 12] - am[q + 12];
      const dy = bm[o + 13] - am[q + 13];
      const dz = bm[o + 14] - am[q + 14];
      if (dx * dx + dy * dy + dz * dz > TELEPORT_DIST2) {
        for (let j = 0; j < 16; j++) pal[o + j] = bm[o + j];
        continue;
      }
      if (turnCos(am, q, bm, o) < SPIN_COS) {
        for (let j = 0; j < 16; j++) pal[o + j] = bm[o + j];
        pal[o + 12] = am[q + 12] + dx * alpha;
        pal[o + 13] = am[q + 13] + dy * alpha;
        pal[o + 14] = am[q + 14] + dz * alpha;
        continue;
      }
      for (let j = 0; j < 16; j++) pal[o + j] = am[q + j] + (bm[o + j] - am[q + j]) * alpha;
    }
    this.matrixTexture.needsUpdate = true;
    // Moving vertices. At alpha 1 too: an earlier present of this tick may have left them blended.
    if (b.dynamic.size && a.dynamic.size) {
      const floats = this.vertFloats;
      const bd = b.dynFloats;
      const ad = a.dynFloats;
      for (const [key, d] of b.dynamic) {
        const p = b.dynPair.get(key);
        if (!p || p.count !== d.count) continue;
        let bo = d.offset;
        let ao = p.offset;
        let v = d.base * 8;
        // The same key on another car: blob shadows count by occurrence.
        const mx = bd[bo] - ad[ao];
        const my = bd[bo + 1] - ad[ao + 1];
        const mz = bd[bo + 2] - ad[ao + 2];
        if (mx * mx + my * my + mz * mz > TELEPORT_DIST2) continue;
        for (let k = 0; k < d.count; k++, bo += 3, ao += 3, v += 8) {
          floats[v] = ad[ao] + (bd[bo] - ad[ao]) * alpha;
          floats[v + 1] = ad[ao + 1] + (bd[bo + 1] - ad[ao + 1]) * alpha;
          floats[v + 2] = ad[ao + 2] + (bd[bo + 2] - ad[ao + 2]) * alpha;
        }
      }
      this.dynamicDirty = true;
    }
    // The player's shadow, carried by its car from the latest tick to the blended pose: the car's
    // matrix blends row by row like any world matrix, so the shadow stays where it was under it.
    if (b.shadowParts.length) {
      let t = null;
      if (alpha < 1 && b.hasShadowPose && a.hasShadowPose) {
        const pb = b.shadowPose;
        const pa = a.shadowPose;
        const dx = pb[12] - pa[12];
        const dy = pb[13] - pa[13];
        const dz = pb[14] - pa[14];
        if (dx * dx + dy * dy + dz * dz <= TELEPORT_DIST2) {
          const e = this.shadowMove.elements;
          for (let j = 0; j < 16; j++) e[j] = pa[j] + (pb[j] - pa[j]) * alpha;
          this.shadowInverse.fromArray(pb).invert();
          t = this.shadowMove.multiply(this.shadowInverse).elements;
        }
      }
      const floats = this.vertFloats;
      const bd = b.dynFloats;
      for (const part of b.shadowParts) {
        let o = part.offset;
        let v = part.base * 8;
        for (let k = 0; k < part.count; k++, o += 3, v += 8) {
          const x = bd[o];
          const y = bd[o + 1];
          const z = bd[o + 2];
          if (t) {
            floats[v] = t[0] * x + t[4] * y + t[8] * z + t[12];
            floats[v + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
            floats[v + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
          } else {
            floats[v] = x;
            floats[v + 1] = y;
            floats[v + 2] = z;
          }
        }
      }
      this.dynamicDirty = true;
    }
    // The camera.
    if (b.hasView && a.hasView && alpha < 1) {
      const va = a.view;
      const vb = b.view;
      const tmp = this.tmpV.elements;
      for (let j = 0; j < 16; j++) tmp[j] = va[j] + (vb[j] - va[j]) * alpha;
      // Compare the eyes: row 3 holds -dot(axis, eye) (FUN_004b3a60), so far from the world's
      // origin it moves with every turn of the camera.
      const dx = eyeAxis(va, 0) - eyeAxis(vb, 0);
      const dy = eyeAxis(va, 4) - eyeAxis(vb, 4);
      const dz = eyeAxis(va, 8) - eyeAxis(vb, 8);
      if (dx * dx + dy * dy + dz * dz > TELEPORT_DIST2) this.tmpV.fromArray(vb);
    } else if (b.hasView) {
      this.tmpV.fromArray(b.view);
    }
    this.tmpP.fromArray(b.proj);
    if(this.boxmeerWorld){const factor=1+Math.min(1,Math.max(0,this.m.i32[0x6fba64>>2])/150)*.07;this.tmpP.elements[0]/=factor;this.tmpP.elements[5]/=factor;}
    this.sceneVP.multiplyMatrices(this.tmpP, this.tmpV);
  }

  uploadStreams() {
    const v = this.vertBuffer;
    v.clearUpdateRanges();
    v.addUpdateRange(0, this.vertCountFull * 8);
    const a = this.infoAttr;
    a.clearUpdateRanges();
    a.addUpdateRange(0, this.vertCountFull);
    const sd = this.staticDirty;
    for (let k = 0; k < sd.length; k += 2) {
      v.addUpdateRange(sd[k] * 8, sd[k + 1] * 8);
      a.addUpdateRange(sd[k], sd[k + 1]);
    }
    sd.length = 0;
    v.needsUpdate = true;
    a.needsUpdate = true;
    const i = this.indexAttr;
    i.clearUpdateRanges();
    i.addUpdateRange(0, this.indexCountFull);
    i.needsUpdate = true;
  }

  syncMeshes(scene, meshes, list) {
    while (meshes.length < list.length) {
      const mesh = new THREE.Mesh(this.makeGeometry());
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
      scene.add(mesh);
    }
    for (let k = 0; k < meshes.length; k++) {
      const mesh = meshes[k];
      if (k >= list.length) {
        mesh.visible = false;
        continue;
      }
      const b = list[k];
      mesh.visible = true;
      const mat = this.materialFor(b.key);
      if (b.vp) mat.uniforms.uViewProj.value = b.vp;
      const fc = b.fogColor;
      mat.uniforms.uFogColor.value.setRGB(((fc >> 16) & 255) / 255, ((fc >> 8) & 255) / 255, (fc & 255) / 255, THREE.LinearSRGBColorSpace);
      mesh.material = mat;
      if(mat.uniforms.uBoxmeer){mat.uniforms.uBoxmeer.value=this.boxmeerWorld&&!b.hud?1:0;mat.uniforms.uBoxmeerCamera=this.boxmeerCamera;}
      mesh.geometry.setDrawRange(b.start, b.count);
    }
  }

  /**
   * The fill replaces the frame of its tick. That tick can pass without a present, or stay on
   * screen for several: the fill shows at least once, until the next tick has flipped or, when
   * ticks have stopped for a panel or lost focus, for one tick's time.
   */
  drawScreenFill() {
    const fill = this.screenFill;
    const now = performance.now();
    if (fill.shownAt && (fill.flips > 1 || now - fill.shownAt >= TICK_MS)) {
      this.screenFill = null;
      return;
    }
    if (!fill.shownAt) fill.shownAt = now;
    const { three, area } = this;
    three.setScissor(area.x, this.viewH - area.y - area.h, area.w, area.h);
    three.setScissorTest(true);
    three.setClearColor(fill.color, 1);
    three.clear(true, false, false);
    three.setScissorTest(false);
  }

  /** Draws the latest captured frame, blended alpha of the way from the tick before. */
  present(alpha = 1) {
    if (!this.lastFull) return;
    const three = this.three;
    const f = this.lastFull;
    this.blendPalette(alpha);
    if (this.pendingUpload) {
      this.pendingUpload = false;
      this.uploadStreams();
    } else if (this.dynamicDirty) {
      // Same tick shown again with a new blend: only the moved vertices changed.
      const v = this.vertBuffer;
      v.clearUpdateRanges();
      v.addUpdateRange(0, this.vertCountFull * 8);
      v.needsUpdate = true;
    }
    this.dynamicDirty = false;
    const world = [];
    const hud = [];
    for (const b of f.batches) (b.hud ? hud : world).push(b);
    this.syncMeshes(this.sceneWorld, this.meshesWorld, world);
    this.syncMeshes(this.sceneHud, this.meshesHud, hud);
    if (this.indexed) {
      this.presentIndexed(f);
      this.stats.verts = f.vertCount;
      this.stats.indices = f.indexCount;
      this.stats.batches = f.batches.length;
      this.stats.matrices = f.matrixCount;
      this.stats.calls = three.info.render.calls;
      return;
    }
    const area = this.area;
    three.setClearColor(0x000000, 1);
    if (this.renderTarget) {
      three.setRenderTarget(this.renderTarget);
      three.clear(true, true, false);
      if(this.boxmeerWorld)this.boxmeerWorld.render(this.tmpV,this.tmpP,this.clipMap);
      if(this.boxmeerWorld){const p=this.boxmeerWorld.camera.position;this.boxmeerCamera.value.set(-p.x,p.y,p.z);}
      three.render(this.sceneWorld, this.camera);
      three.setRenderTarget(null);
      three.setViewport(0, 0, this.viewW, this.viewH);
      three.setScissorTest(false);
      three.clear(true, true, false);
      three.setViewport(area.x, this.viewH - area.y - area.h, area.w, area.h);
      three.render(this.blitScene, this.camera);
    } else {
      three.setViewport(0, 0, this.viewW, this.viewH);
      three.setScissorTest(false);
      three.clear(true, true, false);
      three.setViewport(area.x, this.viewH - area.y - area.h, area.w, area.h);
      if(this.boxmeerWorld)this.boxmeerWorld.render(this.tmpV,this.tmpP,this.clipMap);
      if(this.boxmeerWorld){const p=this.boxmeerWorld.camera.position;this.boxmeerCamera.value.set(-p.x,p.y,p.z);}
      three.render(this.sceneWorld, this.camera);
    }
    three.setViewport(area.x, this.viewH - area.y - area.h, area.w, area.h);
    three.clearDepth();
    three.render(this.sceneHud, this.camera);
    if (this.screenFill) this.drawScreenFill();
    this.stats.verts = f.vertCount;
    this.stats.indices = f.indexCount;
    this.stats.batches = f.batches.length;
    this.stats.matrices = f.matrixCount;
    this.stats.calls = three.info.render.calls;
  }
}
