import assert from 'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';
import{readPositions,readPlanes,readObjects,readTga}from'../../source/dev/track-model.js';
const read=p=>{const b=readFileSync('public/assets/boxmeer/'+p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const points=readPositions(read('boxmeer.pmp')),model=readPlanes(read('boxmeer.rmp')),buildings=JSON.parse(readFileSync('public/assets/boxmeer/buildings.json'));
assert.equal(points.length,model.chunks);assert(points.length>=200 && points.length<=400,'Unexpected race length');
const planes=new Map(model.passes.flat().map(p=>[[p.chunk,p.pass,p.plane].join(':'),p]));
const sub=(a,b)=>a.map((x,k)=>x-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
function hit(o,d,[a,b,c]){const e1=sub(b,a),e2=sub(c,a),p=cross(d,e2),det=dot(e1,p);if(Math.abs(det)<1e-8)return false;const t=sub(o,a),u=dot(t,p)/det,q=cross(t,e1),v=dot(d,q)/det;return u>=-1e-5&&v>=-1e-5&&u+v<=1.00001&&dot(e2,q)/det>1e-5}
let rays=0;
for(const b of buildings){
 const faces=b.faces.map(ref=>{const p=planes.get(ref.join(':'));assert(p,'stale plane reference');return p});
 const triangles=faces.flatMap(p=>[0,3].map(i=>p.indices.slice(i,i+3).map(k=>p.vertices[k])));
 for(const t of triangles){const n=cross(sub(t[1],t[0]),sub(t[2],t[0]));assert(Math.hypot(...n)>1e-5);const middle=t[0].map((x,k)=>(x+t[1][k]+t[2][k])/3);assert(dot(n,sub(middle,b.center))>0,`reversed face in chunk ${b.chunk}`)}
 for(const pitch of [0,25,55,80,90])for(let yaw=0;yaw<360;yaw+=15){const a=yaw*Math.PI/180,p=pitch*Math.PI/180,d=[Math.cos(a)*Math.cos(p),Math.sin(p),Math.sin(a)*Math.cos(p)];rays++;assert(triangles.some(t=>hit(b.center,d,t)),`open shell in chunk ${b.chunk}`)}
}
for(const name of ['bm_weg.tga','bm_land.tga','bm_gevel.tga','bm_bouw.tga']){const t=readTga(read(name));assert.equal(t.width,t.height)}
const d=new DataView(read('boxmeer.dmp'));assert.equal(d.getInt32(0,true),points.length*2);
for(let i=0;i<points.length;i++)for(let lane=0;lane<2;lane++){const at=4+(i*2+lane)*36;assert.equal(d.getInt32(at+20,true),((i+(lane?-1:1)+points.length)%points.length)*2+lane)}
const objects=readObjects(read('boxmeer.omp'));assert(objects.length>=7);
if(objects.some(o=>o.name==='BM_CONE_ANIM'))assert(objects.filter(o=>o.name==='BM_CONE_ANIM').every(o=>o.type===2));
const result={chunks:points.length,planes:model.count,buildings:buildings.length,closureRays:rays,missingWalls:0,reversedFaces:0,taggedScenery:model.passes.flat().filter(p=>p.twoSided).length};
writeFileSync('evidence/boxmeer/geometry.json',JSON.stringify(result,null,2));console.log(result);
