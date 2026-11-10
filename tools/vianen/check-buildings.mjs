#!/usr/bin/env node
// Inspect the actual packed building faces, not only the builder's intended shapes.
// Regenerate refs: VIANEN_BUILDINGS=evidence/vianen/dike-houses/buildings.json python3 tools/vianen/build-track.py
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPlanes, readTga } from '../../source/dev/track-model.js';
const read = path => { const b=readFileSync(path); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); };
const buildings=JSON.parse(readFileSync('evidence/vianen/dike-houses/buildings.json'));
const { passes }=readPlanes(read('public/assets/vianen/vianen.rmp'));
const planes=new Map(passes.flat().map(p=>[[p.chunk,p.pass,p.plane].join(':'),p]));
const land=readTga(read('public/assets/vianen/vn_land.tga'));
const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0);
const norm=v=>v.map(x=>x/Math.hypot(...v));
function hit(origin,direction,[a,b,c]) {
  const e1=sub(b,a), e2=sub(c,a), p=cross(direction,e2), det=dot(e1,p);
  if(Math.abs(det)<1e-8)return false;
  const t=sub(origin,a), u=dot(t,p)/det, q=cross(t,e1), v=dot(direction,q)/det;
  return u>=-1e-5 && v>=-1e-5 && u+v<=1.00001 && dot(e2,q)/det>1e-5;
}
let rays=0, utility=0;
for(const building of buildings) {
  const faces=building.faces.map(ref=>{const p=planes.get(ref.join(':'));assert(p,'Stale building references: regenerate with VIANEN_BUILDINGS');return p;});
  const center=[0,building.height*.45,0];
  for(const [x,z] of building.footprint){center[0]+=x/building.footprint.length;center[2]+=z/building.footprint.length;}
  const triangles=faces.flatMap(p=>[0,3].map(i=>p.indices.slice(i,i+3).map(k=>p.vertices[k])));
  for(const triangle of triangles) {
    const [a,b,c]=triangle, normal=cross(sub(b,a),sub(c,a));
    assert(Math.hypot(...normal)>1e-5,'Building has a degenerate triangle');
    const middle=a.map((x,k)=>(x+b[k]+c[k])/3);
    assert(dot(normal,sub(middle,center))>0,`${building.osmId}: an exterior face is reversed`);
  }
  const directions=[[0,1,0]];
  for(const pitch of [0,25,55,80])for(let yaw=0;yaw<360;yaw+=15) {
    const a=yaw*Math.PI/180,p=pitch*Math.PI/180;
    directions.push([Math.cos(a)*Math.cos(p),Math.sin(p),Math.sin(a)*Math.cos(p)]);
  }
  // Aim directly at every wall/roof join and roof ridge to catch seam holes.
  for(const face of faces)for(const vertex of face.vertices)if(vertex[1]>=building.height-.01) {
    directions.push(norm(sub(vertex,center)));
  }
  for(const direction of directions) {
    rays++;
    assert(triangles.some(triangle=>hit(center,direction,triangle)),`${building.osmId}: open wall/roof in direction ${direction}`);
  }
  if(building.utility) {
    utility++;
    assert(building.height<=40,'A low outbuilding must not use a multi-storey height');
    assert(faces.every(p=>p.pass===1),'Utility walls and roof should use their own land-atlas materials');
    for(const face of faces)for(const [u,v] of face.uv) {
      const x=Math.max(0,Math.min(land.width-1,Math.floor(u*land.width)));
      const y=Math.max(0,Math.min(land.height-1,Math.floor(v*land.height)));
      assert.equal(land.rgba[(y*land.width+x)*4+3],255,'No transparent atlas cell on an outbuilding');
    }
  }
}
assert.equal(buildings.find(b=>b.osmId===794518665)?.height,24,'The 2.3 x 2.6 m footprint should not become a 9.5 m tower');
assert.equal(buildings.find(b=>b.osmId===277708504)?.height,28,'The tagged garage should remain a single-storey garage');
const summary={buildings:buildings.length,utilityBuildings:utility,rays,missingWallsOrRoofs:0,reversedFaces:0};
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--json'))writeFileSync(process.argv[process.argv.indexOf('--json')+1],JSON.stringify(summary,null,2)+'\n');
