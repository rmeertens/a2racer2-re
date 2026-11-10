#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPlanes, readPositions } from '../../source/dev/track-model.js';
const read = name => { const b=readFileSync('public/assets/vianen/'+name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); };
const model=readPlanes(read('vianen.rmp')),points=readPositions(read('vianen.pmp'));
const data=JSON.parse(readFileSync('evidence/vianen/bridge-houses/geometry.json'));
const planes=new Map(model.passes.flat().map(p=>[[p.chunk,p.pass,p.plane].join(':'),p]));
const face=ref=>{const p=planes.get(ref.join(':'));assert(p,'Regenerate VIANEN_BRIDGE_ENDS references');return p;};
const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
let clearance=Infinity,windows=0;
assert.equal(data.wings.length,4);
for(const wing of data.wings) {
  const faces=wing.faces.map(face),vertices=faces.flatMap(p=>p.vertices),edges=new Map();
  const center=[0,1,2].map(k=>vertices.reduce((s,p)=>s+p[k],0)/vertices.length);
  const key=p=>p.map(x=>x.toFixed(3)).join(',');
  for(const p of faces)for(let i=0;i<6;i+=3) {
    const v=p.indices.slice(i,i+3).map(k=>p.vertices[k]),normal=cross(sub(v[1],v[0]),sub(v[2],v[0]));
    assert(Math.hypot(...normal)>1e-5,'No degenerate wing triangles');
    const mid=v[0].map((x,k)=>(x+v[1][k]+v[2][k])/3);
    assert(dot(normal,sub(mid,center))>0,'Wing faces must face outward');
    for(let j=0;j<3;j++){const e=[key(v[j]),key(v[(j+1)%3])].sort().join('|');edges.set(e,(edges.get(e)||0)+1);}
  }
  assert([...edges.values()].every(n=>n===2),'Retaining wings must have closed tops, sides and bottoms');
  assert([0,1].includes(wing.t));
  const grade=points[(wing.chunk+wing.t)%points.length][1];
  assert(Math.abs(Math.max(...vertices.map(p=>p[1]))-grade-18)<.001,'Wing cap must match the 1.8 m railing height');
  for(const p of vertices)for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[2]-a[2];
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/(dx*dx+dz*dz)));
    clearance=Math.min(clearance,Math.hypot(p[0]-a[0]-t*dx,p[2]-a[2]-t*dz)-50);
  }
}
assert(clearance>=10,'Wing walls must remain outside the racing road');
assert.deepEqual(data.houses.map(h=>[h.chunk,h.side,h.t]),[[41,-1,1],[46,-1,0]]);
for(const house of data.houses) {
  const patches=house.faces.map(face).filter(p=>p.pass===2 && Math.max(...p.uv.map(v=>v[0]))-Math.min(...p.uv.map(v=>v[0]))>.001);
  assert.equal(patches.length,house.windows);
  windows+=patches.length;
  for(const p of patches) {
    const width=Math.hypot(...sub(p.vertices[1],p.vertices[0])),height=Math.hypot(...sub(p.vertices[3],p.vertices[0]));
    const du=Math.max(...p.uv.map(v=>v[0]))-Math.min(...p.uv.map(v=>v[0]));
    const dv=Math.max(...p.uv.map(v=>v[1]))-Math.min(...p.uv.map(v=>v[1]));
    // The original drawn facade is 256x512 before square atlas packing.
    assert(Math.abs(width/height-du/dv*.5)<.002,'Keep sash-window source proportions on the end wall');
  }
}
const summary={closedWings:data.wings.length,finishedHouseEnds:data.houses.length,windows,minRoadClearanceMetres:clearance/10};
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--json'))writeFileSync(process.argv[process.argv.indexOf('--json')+1],JSON.stringify(summary,null,2)+'\n');
