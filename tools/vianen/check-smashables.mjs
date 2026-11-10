#!/usr/bin/env node
// Check actual prop footprints against every road segment, including nearby bends.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readObjects, readPositions, readSceneryMesh, readTga, routeFrame } from '../../source/dev/track-model.js';
const root = new URL('../../public/assets/vianen/', import.meta.url);
const read = name => { const b = readFileSync(new URL(name, root)); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); };
const models = { VN_BOX_ANIM:'vn_doos.d3d', VN_CRATE_ANIM:'vn_kist.d3d', VN_CONE_ANIM:'vn_kegel.d3d', VN_SIGN_ANIM:'vn_bord.d3d' };
const expected = { VN_BOX_ANIM:12, VN_CRATE_ANIM:12, VN_CONE_ANIM:18, VN_SIGN_ANIM:6 };
const objects = readObjects(read('vianen.omp')).filter(o => models[o.name]);
const points = readPositions(read('vianen.pmp'));
const distance = (p,a,b) => {
  const dx=b[0]-a[0], dz=b[2]-a[2];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/(dx*dx+dz*dz)));
  return Math.hypot(p[0]-a[0]-t*dx,p[2]-a[2]-t*dz);
};
let minClearance=Infinity;
for (const [name,file] of Object.entries(models)) {
  assert.equal(objects.filter(o=>o.name===name).length,expected[name]);
  const mesh=readSceneryMesh(read(file));
  for (const o of objects.filter(o=>o.name===name)) {
    const angle=o.rotation[1]*Math.PI/180, c=Math.cos(angle),s=Math.sin(angle);
    for (const [x,y,z] of mesh.vertices) {
      const p=[o.position[0]+c*x+s*z,o.position[1]+y,o.position[2]-s*x+c*z];
      const clearance=Math.min(...points.map((a,i)=>distance(p,a,points[(i+1)%points.length])))-50;
      minClearance=Math.min(minClearance,clearance);
      assert(clearance>=8,`${name} in chunk ${o.chunk} intrudes into the road margin: ${clearance}`);
    }
  }
}
const texture=readTga(read('vn_fun.tga'));
assert(texture.rgba.every((v,i)=>i%4!==3||v===255),'Prop materials must have no invisible colour-key holes');
const summary={props:objects.length,counts:expected,minRoadClearanceMetres:minClearance/10};
console.log(JSON.stringify(summary,null,2));
const output=process.argv.indexOf('--json');
if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify(summary,null,2));
const cameras=process.argv.indexOf('--cameras');
if(cameras>=0) {
  const views=Object.keys(models).map(name=>{
    const o=objects.find(o=>o.name===name&&o.chunk===7), f=routeFrame(points,7.5);
    const target=o.position.map((x,k)=>x+(k===1?3:0));
    return {name,position:7.5,target,eye:target.map((x,k)=>x+(k===1?13:0)+f.right[k]*34-f.forward[k]*24)};
  });
  writeFileSync(process.argv[cameras+1],JSON.stringify(views));
}
