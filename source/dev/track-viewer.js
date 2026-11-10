import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PASS_NAMES, TEXTURES, SURVEY_VIEWS, readPositions, readPlanes, readTga, readObjects, readSceneryMesh, routeFrame } from './track-model.js';

const $ = id => document.getElementById(id);
// D3D uses a left-handed world. Reflect X for Three's right-handed camera, and keep
// saved cameras in the original game coordinates so existing links remain valid.
const vec = a => new THREE.Vector3(-a[0], a[1], a[2]);
const gameArray = v => [-v.x, v.y, v.z];
const storageKey = 'a2racer4:vianen:cameras:v1';
const state = { position: 10, playing: false, ready: false, surveyToken: 0 };
let scene, renderer, camera, controls, points, meshes, planTransform, routeDistances;
let saved = [];
try { saved = JSON.parse(localStorage.getItem(storageKey) || '[]').filter(validCamera); } catch { /* storage is optional */ }
function validCamera(c) {
  return c && typeof c.name === 'string' && [c.eye, c.target].every(a => Array.isArray(a) && a.length === 3 && a.every(x => Number.isFinite(x) && Math.abs(x) < 1e7)) && Number.isFinite(c.position);
}
const landmarks = [
  ['Start / Voorstraat', 10], ['Stadhuis', 18], ['Lekpoort approach', 26], ['Lekpoort passage', 28],
  ['Dike', 35], ['Arched bridge', 44], ['East moat', 65], ['Drawbridge', 77], ['South moat', 90], ['Grote Kerk', 103],
];
const references = [
  ['Voorstraat: wide street and varied house fronts', 'https://commons.wikimedia.org/wiki/File:Voorstraat_Vianen.jpg'],
  ['Lekpoort: passage and neighbouring houses', 'https://www.bezoeklekenlinge.nl/nl/locaties/1496584115/lekpoort'],
  ['Stadhuis: front, square and adjoining buildings', 'https://www.visitutrechtregion.com/nl/locaties/4279647297/stadhuis-vianen'],
];
for (const [text, href] of references) {
  const li = document.createElement('li'), a = document.createElement('a');
  a.textContent = text; a.href = href; a.target = '_blank'; a.rel = 'noopener'; li.append(a); $('reference-links').append(li);
}
for (const [label, chunk] of landmarks) $('landmark').add(new Option(`${label} · ${chunk}`, chunk));
$('landmark').value = '10';

async function binary(name) {
  const response = await fetch(`assets/vianen/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
function buildMesh(planes, texture) {
  const positions = [], uvs = [], colors = [], indices = [], facePlanes = [];
  for (const plane of planes) {
    const base = positions.length / 3;
    positions.push(...plane.vertices.flatMap(v => [-v[0], v[1], v[2]]));
    uvs.push(...plane.uv.flatMap(([u, v]) => [plane.twoSided ? u - 4 : u, v])); colors.push(...plane.colors.flat());
    // Reflection changes the triangle winding as well as the camera handedness.
    for (let i = 0; i < 6; i += 3) {
      indices.push(base + plane.indices[i], base + plane.indices[i + 2], base + plane.indices[i + 1]); facePlanes.push(plane);
      if (plane.twoSided) {
        indices.push(base + plane.indices[i], base + plane.indices[i + 1], base + plane.indices[i + 2]); facePlanes.push(plane);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 3, true));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.FrontSide });
  // Match the race renderer's colour-key filtering: recover the opaque colour after filtering
  // black/transparent texels, instead of outlining leaves and branches in magenta or black.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb /= max(sampledDiffuseColor.a, 0.001);\n#endif');
  };
  material.customProgramCacheKey = () => 'vianen-colour-key-v1';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.planes = planes;
  mesh.userData.facePlanes = facePlanes;
  return mesh;
}
function cameraAt(position, yaw = Number($('yaw').value), targetCamera = camera, view = {}) {
  const f = routeFrame(points, position), height = (view.height ?? Number($('height').value)) * 10, offset = (view.offset ?? Number($('offset').value)) * 10;
  const angle = yaw * Math.PI / 180, pitch = (view.pitch ?? Number($('pitch').value)) * Math.PI / 180;
  const eye = f.center.map((v, k) => v + f.right[k] * offset + (k === 1 ? height : 0));
  const target = eye.map((v, k) => v + (f.forward[k] * Math.cos(angle) + f.right[k] * Math.sin(angle)) * 100 + (k === 1 ? Math.tan(pitch) * 100 : 0));
  targetCamera.position.copy(vec(eye)); targetCamera.lookAt(vec(target)); targetCamera.updateMatrixWorld();
  return target;
}
function setPosition(position) {
  state.position = ((position % points.length) + points.length) % points.length;
  $('station').value = state.position;
  controls.target.copy(vec(cameraAt(state.position))); controls.update();
  updateLabels(); updateMap(); updateHash();
}
function updateLabels() {
  $('station-label').textContent = `${Math.floor(state.position)} / ${points.length - 1}`;
  for (const key of ['height', 'offset', 'yaw', 'pitch']) $(key + '-label').textContent = `${$(key).value}${['height', 'offset'].includes(key) ? ' m' : '°'}`;
  for (const button of document.querySelectorAll('[data-yaw]')) button.setAttribute('aria-pressed', String(Number(button.dataset.yaw) === Number($('yaw').value)));
  const p = { x: -camera.position.x, y: camera.position.y, z: camera.position.z };
  $('view-status').textContent = `Station ${state.position.toFixed(1)} · x ${(p.x / 10).toFixed(1)} m · y ${(p.y / 10).toFixed(1)} m · z ${(p.z / 10).toFixed(1)} m`;
}
let hashTimer;
function updateHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const view = { position: state.position, eye: gameArray(camera.position), target: gameArray(controls.target) };
    history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(view)));
  }, 150);
}
function stop() { state.playing = false; $('play').textContent = 'Play route'; }
function fitWholeMap() {
  stop();
  const box = new THREE.Box3().setFromPoints(points.map(vec)), center = box.getCenter(new THREE.Vector3());
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  camera.position.set(center.x + span * 0.15, center.y + span * 1.25, center.z - span * 0.4);
  controls.target.copy(center); controls.update(); updateLabels(); updateHash();
}
function updateMap() {
  const canvas = $('route-map'), ctx = canvas.getContext('2d'), { width: w, height: h } = canvas;
  const xs = points.map(p => p[0]), zs = points.map(p => p[2]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), sx = Math.max(...xs) - x0, sz = Math.max(...zs) - z0;
  const scale = Math.min((w - 55) / sx, (h - 45) / sz), ox = (w - sx * scale) / 2, oy = (h - sz * scale) / 2;
  planTransform = p => [ox + (p[0] - x0) * scale, h - oy - (p[2] - z0) * scale];
  ctx.clearRect(0, 0, w, h); ctx.lineWidth = 5; ctx.strokeStyle = '#748c9e'; ctx.beginPath();
  points.forEach((p, i) => { const [x, y] = planTransform(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath(); ctx.stroke();
  for (let i = 0; i < points.length; i += 4) {
    const [x, y] = planTransform(points[i]); ctx.fillStyle = '#a5b5c1'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = '18px system-ui'; ctx.fillStyle = '#b8c6d1';
  for (const [label, chunk] of [['Gate', 28], ['Bridge', 44], ['Church', 103]]) {
    const [x, y] = planTransform(points[chunk]); ctx.fillText(label, x + 7, y - 8);
  }
  for (const c of saved) {
    const [x, y] = planTransform(routeFrame(points, c.position).center); ctx.fillStyle = '#e4b97f'; ctx.fillRect(x - 4, y - 4, 8, 8);
  }
  const [x, y] = planTransform(routeFrame(points, state.position).center);
  ctx.fillStyle = '#9dd7c1'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { $('selection').textContent = 'Camera saved for this session. Browser storage is unavailable; use Export cameras to keep it.'; }
  drawSaved(); updateMap();
}
function drawSaved() {
  $('saved-cameras').replaceChildren();
  saved.forEach((view, i) => {
    const button = document.createElement('button'); button.textContent = view.name; button.title = 'Open saved camera. Shift-click to remove.';
    button.onclick = event => {
      if (event.shiftKey) { saved.splice(i, 1); persist(); return; }
      restoreCamera(view);
    };
    $('saved-cameras').append(button);
  });
}
function restoreCamera(view) {
  stop(); state.position = ((view.position % points.length) + points.length) % points.length; $('station').value = state.position;
  camera.position.copy(vec(view.eye)); controls.target.copy(vec(view.target)); controls.update(); updateLabels(); updateMap(); updateHash();
}
function bindControls() {
  $('station').max = points.length - 0.01;
  $('station').oninput = () => { stop(); setPosition(Number($('station').value)); };
  $('station').addEventListener('wheel', event => { event.preventDefault(); stop(); setPosition(state.position + Math.sign(event.deltaY) * 0.25); }, { passive: false });
  $('previous').onclick = () => { stop(); setPosition(Math.round(state.position) - 1); };
  $('next').onclick = () => { stop(); setPosition(Math.round(state.position) + 1); };
  $('landmark').onchange = () => { stop(); setPosition(Number($('landmark').value)); };
  $('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause route' : 'Play route'; };
  $('whole-map').onclick = fitWholeMap;
  for (const key of ['height', 'offset', 'yaw', 'pitch']) $(key).oninput = () => setPosition(state.position);
  for (const button of document.querySelectorAll('[data-yaw]')) button.onclick = () => { $('yaw').value = button.dataset.yaw; setPosition(state.position); };
  $('route-map').onclick = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * event.currentTarget.width / rect.width, y = (event.clientY - rect.top) * event.currentTarget.height / rect.height;
    let best = Infinity, station = 0;
    points.forEach((p, i) => { const [a, b] = planTransform(p), dist = Math.hypot(a - x, b - y); if (dist < best) { best = dist; station = i; } });
    stop(); setPosition(station);
  };
  for (const check of document.querySelectorAll('[data-pass]')) check.onchange = () => { meshes[Number(check.dataset.pass)].visible = check.checked; };
  $('backs').onchange = () => meshes.forEach(mesh => { mesh.material.side = $('backs').checked ? THREE.DoubleSide : THREE.FrontSide; mesh.material.needsUpdate = true; });
  $('wireframe').onchange = () => meshes.forEach(mesh => { mesh.material.wireframe = $('wireframe').checked; });
  $('smooth').onchange = () => meshes.forEach(mesh => {
    const texture = mesh.material.map;
    texture.minFilter = $('smooth').checked ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.anisotropy = $('smooth').checked ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    texture.needsUpdate = true;
  });
  $('save-camera').onclick = () => {
    const name = $('camera-name').value.trim() || `Station ${state.position.toFixed(1)}`;
    saved.push({ name: name.slice(0, 100), position: state.position, eye: gameArray(camera.position), target: gameArray(controls.target) }); persist();
    $('camera-name').value = '';
  };
  $('export').onclick = () => download(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }), 'vianen-cameras.json');
  $('import').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 1e6) throw new Error('Camera file is too large');
      const views = JSON.parse(await file.text());
      if (!Array.isArray(views) || views.length > 500 || !views.every(validCamera)) throw new Error('Expected a list of cameras with name, position, eye and target');
      saved.push(...views); persist(); $('selection').textContent = `Imported ${views.length} cameras.`;
    } catch (e) { $('selection').textContent = e.message; }
    event.target.value = '';
  };
  $('screenshot').onclick = () => {
    renderer.render(scene, camera);
    renderer.domElement.toBlob(blob => { if (blob) download(blob, `vianen-station-${state.position.toFixed(1)}.png`); });
  };
  $('survey').onclick = buildSurvey;
  for (const id of ['survey-direction', 'survey-start', 'survey-end']) $(id).addEventListener('input', updateSurveyButton);
  updateSurveyButton();
  $('close-survey').onclick = () => { state.surveyToken++; $('survey-panel').hidden = true; $('survey').disabled = false; updateSurveyButton(); };
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffff77, depthTest: false }));
  outline.renderOrder = 10; scene.add(outline);
  renderer.domElement.addEventListener('pointerdown', event => {
    $('viewport').focus({ preventScroll: true });
    if (!event.shiftKey) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes.filter(m => m.visible))[0];
    if (!hit) return;
    if (hit.object.userData.movable) {
      const prop = hit.object.userData.movable, object = prop.objects[hit.instanceId];
      outline.visible = false;
      $('selection').textContent = `${prop.label} · source chunk ${object.chunk} · ${prop.animation} · vianen.omp / ${prop.model}`;
      return;
    }
    const plane = hit.object.userData.facePlanes[hit.faceIndex];
    outline.visible = true;
    outline.geometry.dispose(); outline.geometry = new THREE.BufferGeometry().setFromPoints(plane.vertices.map(vec));
    $('selection').textContent = `${PASS_NAMES[plane.pass]} · source chunk ${plane.chunk} · plane ${plane.plane} · vianen.rmp`;
  });
  controls.addEventListener('start', stop);
  controls.addEventListener('change', () => { updateLabels(); updateHash(); });
}
function surveyPlan() {
  const mode = $('survey-direction').value;
  const views = mode === 'coverage' ? SURVEY_VIEWS : mode === 'street' ? SURVEY_VIEWS.slice(0, 8) : [{ name: `${mode}°`, yaw: Number(mode), height: Number($('height').value), offset: Number($('offset').value), pitch: Number($('pitch').value) }];
  const first = Math.max(0, Math.min(points.length - 1, Math.floor(Number($('survey-start').value) || 0)));
  const last = Math.max(first, Math.min(points.length - 1, Math.floor(Number($('survey-end').value) || 0)));
  return { views, first, last, total: (last - first + 1) * views.length };
}
function updateSurveyButton() {
  if (!$('survey').disabled) $('survey').textContent = `Build ${surveyPlan().total} camera views`;
}
async function buildSurvey() {
  stop(); const token = ++state.surveyToken, { views, first, last, total } = surveyPlan(); let completed = 0;
  $('survey-panel').hidden = false; $('survey-grid').replaceChildren(); $('survey').disabled = true;
  const surveyCamera = new THREE.PerspectiveCamera(camera.fov, 16 / 9, camera.near, camera.far);
  const target = new THREE.WebGLRenderTarget(320, 180), pixels = new Uint8Array(320 * 180 * 4);
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(320, 180);
  try {
    for (let i = first; i <= last && token === state.surveyToken; i++) for (const view of views) {
      if (token !== state.surveyToken) break;
      cameraAt(i, view.yaw, surveyCamera, view);
      renderer.setRenderTarget(target); renderer.render(scene, surveyCamera); renderer.readRenderTargetPixels(target, 0, 0, 320, 180, pixels); renderer.setRenderTarget(null);
      for (let y = 0; y < 180; y++) image.data.set(pixels.subarray((179 - y) * 1280, (180 - y) * 1280), y * 1280);
      ctx.putImageData(image, 0, 0);
      const button = document.createElement('button'), img = document.createElement('img'), label = document.createElement('span');
      button.className = 'survey-card'; img.src = canvas.toDataURL('image/jpeg', 0.85); img.alt = `Station ${i}, ${view.name}`;
      label.textContent = `Station ${i} · ${view.name} · ${view.height} m high`;
      button.append(img, label); button.onclick = () => {
        state.surveyToken++;
        for (const key of ['yaw', 'height', 'offset', 'pitch']) $(key).value = view[key];
        setPosition(i); $('survey-panel').hidden = true;
      };
      completed++;
      $('survey-grid').append(button); $('survey-title').textContent = `Route survey · ${completed} / ${total}`;
      $('survey').textContent = `Rendering ${completed} / ${total}…`;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  } catch (e) { $('survey-title').textContent = `Survey failed: ${e.message}`; }
  finally { renderer.setRenderTarget(null); target.dispose(); $('survey').disabled = false; updateSurveyButton(); }
}
const keys = new Set();
addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(key)) { keys.add(key); stop(); event.preventDefault(); }
  if (event.key === 'ArrowRight' && state.ready) { stop(); setPosition(state.position + 1); event.preventDefault(); }
  if (event.key === 'ArrowLeft' && state.ready) { stop(); setPosition(state.position - 1); event.preventDefault(); }
});
addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); stop(); } });
let previousTime = 0;
function frame(time) {
  const dt = Math.min(0.05, (time - previousTime) / 1000); previousTime = time;
  if (state.playing) setPosition(state.position + dt * 0.5);
  if (keys.size) {
    const forward = camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize(), delta = new THREE.Vector3();
    delta.addScaledVector(forward, Number(keys.has('w')) - Number(keys.has('s')));
    delta.addScaledVector(right, Number(keys.has('d')) - Number(keys.has('a')));
    delta.y += Number(keys.has('e')) - Number(keys.has('q'));
    delta.multiplyScalar(dt * (keys.has('shift') ? 500 : 100)); camera.position.add(delta); controls.target.add(delta); updateLabels(); updateHash();
  }
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
}
async function start() {
  const scenery = [
    ['VN_PAAL_ANIM', 'vn_paal.d3d', 'Movable post', 1],
    ['VN_LAMP_ANIM', 'vn_lamp.d3d', 'Breakable lantern', 1],
    ['VN_BIKE_ANIM', 'vn_fiets.d3d', 'Movable bicycle', 1],
    ['VN_BOX_ANIM', 'vn_doos.d3d', 'Cardboard carton', 4],
    ['VN_CRATE_ANIM', 'vn_kist.d3d', 'Market crate', 4],
    ['VN_CONE_ANIM', 'vn_kegel.d3d', 'Traffic cone', 4],
    ['VN_SIGN_ANIM', 'vn_bord.d3d', 'Market chalkboard', 4],
    ['VN_BENCH_ANIM', 'vn_bank.d3d', 'Wooden street bench', 4],
    ['VN_DRAIN_ANIM', 'vn_put.d3d', 'Drain cover (no collider)', 5],
    ['VN_COVER_ANIM', 'vn_deksel.d3d', 'Manhole cover (no collider)', 5],
    ['VN_CROWN_ANIM', 'vn_kruin.d3d', 'Crossed lime canopy', 1],
  ];
  const names = ['vianen.pmp', 'vianen.rmp', ...TEXTURES, 'vianen.omp', 'vn_fun.tga', 'vn_detail.tga', ...scenery.map(p => p[1])];
  const buffers = new Map(await Promise.all(names.map(async name => [name, await binary(name)])));
  points = readPositions(buffers.get('vianen.pmp')); const model = readPlanes(buffers.get('vianen.rmp'));
  routeDistances = [0];
  for (let i = 1; i < points.length; i++) routeDistances.push(routeDistances[i - 1] + vec(points[i]).distanceTo(vec(points[i - 1])));
  if (model.chunks !== points.length) throw new Error('Track geometry and positions have different chunk counts');
  const textures = [...TEXTURES, 'vn_fun.tga', 'vn_detail.tga'].map(name => {
    const buffer = buffers.get(name);
    const { rgba, width, height } = readTga(buffer), texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
    return texture;
  });
  scene = new THREE.Scene(); scene.background = new THREE.Color().setRGB(0.56, 0.65, 0.73);
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  // Preserve the track's baked RGB vertex lighting. No new lights or colour grading hide defects.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  $('viewport').append(renderer.domElement);
  textures.forEach(texture => { texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); });
  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 30000);
  controls = new OrbitControls(camera, renderer.domElement); controls.minDistance = 1; controls.maxDistance = 25000;
  meshes = model.passes.map((planes, pass) => buildMesh(planes, textures[pass])); meshes.forEach(mesh => scene.add(mesh));
  const objects = readObjects(buffers.get('vianen.omp'));
  for (const [animation, model, label, textureIndex] of scenery) {
    const props = objects.filter(o => o.name === animation);
    const prop = readSceneryMesh(buffers.get(model)), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(prop.vertices.flatMap(p => [-p[0], p[1], p[2]]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(prop.uv.flat(), 2));
    const indices = [];
    for (let i = 0; i < prop.indices.length; i += 3) indices.push(prop.indices[i], prop.indices[i + 2], prop.indices[i + 1]);
    geometry.setIndex(indices);
    const material = meshes[1].material.clone(); material.vertexColors = false;
    material.map = textures[textureIndex];
    const instances = new THREE.InstancedMesh(geometry, material, props.length), matrix = new THREE.Matrix4();
    props.forEach((o, i) => {
      matrix.makeRotationY(-o.rotation[1] * Math.PI / 180); matrix.setPosition(vec(o.position)); instances.setMatrixAt(i, matrix);
    });
    instances.instanceMatrix.needsUpdate = true; instances.computeBoundingSphere();
    instances.userData.movable = { objects: props, animation, model, label };
    meshes[1].add(instances);
  }
  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = $('viewport'); renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }).observe($('viewport'));
  bindControls(); drawSaved(); state.ready = true;
  try {
    const view = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (validCamera({ ...view, name: '' })) restoreCamera(view); else setPosition(10);
  } catch { setPosition(10); }
  // Read-only diagnostics for screenshot checks; all camera controls remain ordinary UI actions.
  window.__trackViewer = { get ready() { return state.ready; }, get station() { return state.position; }, chunks: points.length, planes: model.count, camera, controls, meshes };
  requestAnimationFrame(frame);
}
start().catch(error => { $('view-status').textContent = `Could not load viewer: ${error.message}`; $('view-status').classList.add('error'); console.error(error); });
