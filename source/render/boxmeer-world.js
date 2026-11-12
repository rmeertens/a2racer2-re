// Boxmeer-only presentation. Native RMP, driving physics and original tracks stay intact.
import * as THREE from 'three';
import {readPlanes,readPositions,readTga,routeFrame} from '../dev/track-model.js';
const F=new THREE.Matrix4().makeScale(-1,1,1),Z=new THREE.Matrix4().makeScale(1,1,-1);
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const noise=(x,z)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n)};
const center=p=>p.vertices.reduce((s,v)=>s.map((x,k)=>x+v[k]/4),[0,0,0]);
function kind(p,pass){
 if(p.boundary==='tree-trunk')return 'tree-trunk';
 if(p.boundary==='hedge')return 'hedge';
 const u=p.uv.reduce((s,v)=>s+v[0],0)/4-(p.twoSided?4:0),v=p.uv.reduce((s,v)=>s+v[1],0)/4;
 if(p.twoSided&&((pass===3&&u<.25&&v>.25&&v<.5)||(pass===1&&u>.5&&v>.25&&v<.5)))return 'tree';
 if(pass===0){if(u<.5&&v>.5)return 'grass';if(u>.5&&v>.5)return 'water';return u<.5?'brick-road':'asphalt-road'}
 if(pass===1){if(u<.25&&v>.5&&v<.75)return 'grass';if(u>.5&&u<.75&&v<.25)return 'water';if(u>.75&&v>.75)return 'solar'}
 if(pass===3&&u>.25&&u<.5&&v>.25&&v<.5)return 'hedge';
 if(pass===1&&u<.5&&v<.5)return 'pavement';
 return 'solid';
}
function geometry(planes,tile){
 const positions=[],uv=[],colors=[],indices=[],facePlanes=[];
 // Short surface patches keep texture derivatives stable where the camera clips a road quad.
 const sourcePlanes=planes;
 if(tile){planes=[];for(const p of sourcePlanes){const mix=(values,u,v)=>values[0].map((_,k)=>(1-v)*((1-u)*values[0][k]+u*values[1][k])+v*((1-u)*values[3][k]+u*values[2][k]));for(let y=0;y<4;y++)for(let x=0;x<4;x++){const corners=[[x/4,y/4],[(x+1)/4,y/4],[(x+1)/4,(y+1)/4],[x/4,(y+1)/4]];planes.push({...p,vertices:corners.map(([u,v])=>mix(p.vertices,u,v)),colors:corners.map(([u,v])=>mix(p.colors,u,v)),source:p})}}}
 for(const p of planes){const base=positions.length/3;
  positions.push(...p.vertices.flatMap(v=>[-v[0],v[1],v[2]]));
  const a=new THREE.Vector3(...p.vertices[0]),b=new THREE.Vector3(...p.vertices[1]),c=new THREE.Vector3(...p.vertices[2]);
  const n=c.sub(a).cross(b.sub(a)).normalize();if(p.indices[1]===1)n.negate();
  if(tile){for(const v of p.vertices){if(Math.abs(n.y)>.5)uv.push(-v[0]/tile[0],v[2]/tile[1]);else if(Math.abs(n.x)>Math.abs(n.z))uv.push(v[2]/tile[0],v[1]/tile[1]);else uv.push(-v[0]/tile[0],v[1]/tile[1])}}
  else uv.push(...p.uv.flatMap(v=>[v[0]-(p.twoSided?4:0),v[1]]));
  const baked=.62+.38*Math.max(0,n.dot(new THREE.Vector3(.45,.78,-.43)));
  for(const rgb of p.colors)colors.push(...rgb.map(x=>clamp(x/255/baked,0,1.2)));
  facePlanes.push(p.source||p,p.source||p);
  for(let j=0;j<6;j+=3)indices.push(base+p.indices[j],base+p.indices[j+2],base+p.indices[j+1]);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();g.userData.facePlanes=facePlanes;return g;
}
export class BoxmeerWorld {
 constructor(read,renderer){
  this.renderer=renderer;this.read=read;this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0xcbd6cb,.000038);
  this.camera=new THREE.Camera();this.camera.matrixAutoUpdate=false;this.camera.matrixWorldAutoUpdate=false;
  this.resources=[];this.meshes=[];this.passGroups=Array.from({length:4},()=>new THREE.Group());this.passGroups.forEach(g=>this.scene.add(g));this.time={value:0};this.stats={trees:0,plants:0,architecturalDetails:0};
  this.info=JSON.parse(new TextDecoder().decode(read('boxmeer.json')));
  this.points=readPositions(buffer(read('boxmeer.pmp')));
  this.model=readPlanes(buffer(read('boxmeer.rmp')));
  this.buildings=JSON.parse(new TextDecoder().decode(read('buildings.json')));
  for(const b of this.buildings)if(b.boundary)for(const [chunk,pass,plane]of b.faces){const p=this.model.passes[pass].find(p=>p.chunk===chunk&&p.plane===plane);if(p)p.boundary=b.boundary;}
  this.textures=['bm_weg.tga','bm_land.tga','bm_gevel.tga','bm_bouw.tga'].map(n=>this.texture(n));
  this.surfaceTiles={'brick-road':this.crop(this.textures[0],0,0,256,256),'asphalt-road':this.crop(this.textures[0],256,0,194,256),pavement:this.crop(this.textures[1],0,0,256,256),hedge:this.texture('bm_leaves.tga')};
  this.grassTexture=this.crop(this.textures[0],0,256,256,256);
  this.setupLight();this.makeSky();this.makeEnvironment();this.makeTrack();this.makeRoadPaint();this.makeTrees();this.makeArchitecture();this.makePlotDetails();this.makePlants();
  this.lastShadow=new THREE.Vector3(Infinity,0,Infinity);
 }
 texture(name){const {width,height,rgba}=readTga(buffer(this.read(name)));const t=new THREE.DataTexture(rgba,width,height,THREE.RGBAFormat);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;this.resources.push(t);return t}
 crop(source,x,y,w,h){const data=new Uint8Array(w*h*4);for(let row=0;row<h;row++){const start=((y+row)*source.image.width+x)*4;data.set(source.image.data.subarray(start,start+w*4),row*w*4)}const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.needsUpdate=true;this.resources.push(t);return t}
 setupLight(){
  this.scene.add(new THREE.HemisphereLight(0xc4e4ff,0x6e6843,1.65));
  this.sun=new THREE.DirectionalLight(0xffe3b1,3.1);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1536,1536);
  Object.assign(this.sun.shadow.camera,{left:-1400,right:1400,top:1400,bottom:-1400,near:10,far:6000});this.sun.shadow.camera.updateProjectionMatrix();
  this.sun.shadow.bias=-.00018;this.sun.shadow.normalBias=1.2;this.sun.shadow.radius=3;
  this.scene.add(this.sun,this.sun.target);
 }
 makeSky(){
    const t=this.texture('bm_sky.tga');
  const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:true,toneMapped:false,uniforms:{sky:{value:t},sun:{value:new THREE.Vector3(-.7,.8,.4).normalize()}},vertexShader:`varying vec3 dir;void main(){dir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,fragmentShader:`uniform sampler2D sky;uniform vec3 sun;varying vec3 dir;void main(){vec3 d=normalize(dir);float h=max(d.y,0.);vec3 c=mix(vec3(.85,.90,.91),vec3(.32,.61,.82),pow(h,.5));vec2 uv=vec2(atan(d.z,d.x)/6.283185+.5,.12+(1.-h)*.7);vec3 clouds=pow(texture2D(sky,uv).rgb,vec3(.454545));float cloud=smoothstep(.63,.9,dot(clouds,vec3(.3,.45,.25)));c=mix(c,vec3(.95,.94,.86),cloud*.38*smoothstep(0.,.18,h));float s=max(dot(d,sun),0.);c+=vec3(1.,.71,.35)*pow(s,80.)*.17;c=mix(c,vec3(1.,.96,.77),smoothstep(.9996,.9999,s));gl_FragColor=vec4(c,1.);}`});
  this.skyTexture=t;this.sky=new THREE.Mesh(new THREE.SphereGeometry(100000,24,12),material);this.sky.frustumCulled=false;this.sky.renderOrder=-1000;this.scene.add(this.sky);this.resources.push(material,this.sky.geometry);
 }
 makeEnvironment(){
  const faces=Array.from({length:6},(_,i)=>{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,0,64);g.addColorStop(0,i===3?'#9a9d71':'#8ac3e3');g.addColorStop(.65,'#dce3cf');g.addColorStop(1,'#afb390');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);return c});
  const cube=new THREE.CubeTexture(faces);cube.colorSpace=THREE.SRGBColorSpace;cube.needsUpdate=true;this.scene.environment=cube;this.scene.environmentIntensity=.3;this.resources.push(cube);
 }
 material(pass,type){
  const surface=this.surfaceTiles[type],m=new THREE.MeshStandardMaterial({map:surface||this.textures[pass],vertexColors:true,roughness:type==='solar'?.29:surface?.9:.85,metalness:type==='solar'?.45:0,alphaTest:.5,side:THREE.DoubleSide});
  if(type==='grass'){
   m.map=this.grassTexture;m.vertexColors=false;m.color.set(0x66813e);m.roughness=1;
   m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 boxWorld;').replace('#include <project_vertex>','boxWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 boxWorld;\nfloat terrainNoise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}\nfloat terrainSmooth(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(terrainNoise(i),terrainNoise(i+vec2(1,0)),f.x),mix(terrainNoise(i+vec2(0,1)),terrainNoise(i+vec2(1,1)),f.x),f.y);}').replace('#include <color_fragment>','#include <color_fragment>\nfloat fieldVariation=terrainSmooth(boxWorld.xz/650.);float grain=terrainSmooth(boxWorld.xz/3.);diffuseColor.rgb*=.78+fieldVariation*.3+grain*.06;').replace('#include <map_fragment>','#ifdef USE_MAP\n diffuseColor.rgb*=.8+texture2D(map,boxWorld.xz/100.).rgb*.6;\n#endif');};m.customProgramCacheKey=()=> 'boxmeer-meadow-v2';
  }else if(type==='water'){
   m.vertexColors=false;m.map=null;m.color.set(0x518b91);m.roughness=.22;m.metalness=.32;
   m.onBeforeCompile=s=>{s.uniforms.boxTime=this.time;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 boxWorld;').replace('#include <project_vertex>','boxWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 boxWorld;uniform float boxTime;').replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal.x+=sin(boxWorld.x*.045+boxWorld.z*.08+boxTime)*.09;normal.z+=cos(boxWorld.z*.065-boxTime*.7)*.07;normal=normalize(normal);');};m.customProgramCacheKey=()=> 'boxmeer-river-v1';
  }else if(type==='hedge'){m.vertexColors=false;m.color.set(0xc6d4ab);m.roughness=1;}else if(!surface){m.bumpMap=this.textures[pass];m.bumpScale=.22;}
  this.resources.push(m);return m;
 }
 makeTrack(){
  this.treeSeeds=(this.info.nativeTrees||[]).map(t=>({x:-t.position[0],y:t.position[1],z:t.position[2],h:t.height,seed:noise(t.position[0],t.position[2]),birch:t.birch}));this.hedgeSeeds=[];
  for(let pass=0;pass<4;pass++){
   const groups=new Map();
   for(const p of this.model.passes[pass]){const type=kind(p,pass);if(type==='tree-trunk')continue;if(type==='tree'){
    const low=Math.min(...p.vertices.map(v=>v[1])),high=Math.max(...p.vertices.map(v=>v[1]));const c=center(p);
    if(!this.treeSeeds.some(t=>Math.hypot(t.x+c[0],t.z-c[2])<3&&Math.abs(t.y-low)<3))this.treeSeeds.push({x:-c[0],z:c[2],y:low,h:high-low,seed:noise(c[0],c[2]),birch:pass===1});continue;
   }
   if(type==='hedge'){
    const sorted=[...p.vertices].sort((a,b)=>b[1]-a[1]),a=sorted[0],b=sorted[1],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
    for(let d=0;d<length;d+=17){const t=(d+8)/Math.max(1,length),x=-a[0]-(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t,y=a[1]+(b[1]-a[1])*t;
     if(!this.hedgeSeeds.some(p=>Math.hypot(p[0]-x,p[2]-z)<9))this.hedgeSeeds.push([x,y,z]);}
   }
   if(!groups.has(type))groups.set(type,[]);groups.get(type).push(p);
   }
   for(const [type,planes]of groups){const g=geometry(planes,this.surfaceTiles[type]?(type==='asphalt-road'?[60,60]:type==='hedge'?[5,5]:[64,128]):null),m=this.material(pass,type),mesh=new THREE.Mesh(g,m);mesh.castShadow=type==='solid'||type==='solar'||type==='hedge';mesh.receiveShadow=true;mesh.userData.facePlanes=g.userData.facePlanes;this.passGroups[pass].add(mesh);this.meshes.push(mesh);this.resources.push(g);}
  }
 }
 makeRoadPaint(){
  const positions=[],indices=[];let count=0;
  for(let i=0;i<this.points.length;i++){
   if(['Steenstraat','Spoorstraat','Koorstraat','Floralaan','de Tamarisk','de Acacia','De Jasmijn'].includes(this.info.streets[i]))continue;
   const a=this.points[i],b=this.points[(i+1)%this.points.length],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
   for(let d=4;d+20<length;d+=48)for(const side of[-1,1]){
    const base=positions.length/3;
    for(const[t,off]of[[d/length,side*60-.6],[d/length,side*60+.6],[(d+20)/length,side*60+.6],[(d+20)/length,side*60-.6]]){const f=routeFrame(this.points,i+t);positions.push(-(f.center[0]+f.right[0]*off),f.center[1]+.08,f.center[2]+f.right[2]*off)}
    indices.push(base,base+1,base+2,base,base+2,base+3);count++;
   }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const m=new THREE.MeshStandardMaterial({color:0xe9e5d6,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});const mesh=new THREE.Mesh(g,m);mesh.receiveShadow=true;this.passGroups[0].add(mesh);this.resources.push(g,m);this.stats.roadMarkings=count;
 }
 instanced(g,m,transforms,colors){const mesh=new THREE.InstancedMesh(g,m,transforms.length);transforms.forEach((t,i)=>{mesh.setMatrixAt(i,t);if(colors)mesh.setColorAt(i,new THREE.Color(colors[i]))});mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.scene.add(mesh);this.resources.push(g,m);return mesh}
 makeTrees(){
  // Volumetric crowns replace intersecting photo cards and their flat silhouettes.
  const seeds=[...this.treeSeeds];
  for(const edge of this.info.naturalBoundaries?.segments||[])if(edge.tree){const[x,y,z]=edge.tree;for(let k=0;k<2;k++)seeds.push({x:-x+k*13,z:z+k*11,y,h:85+k*25,seed:noise(x,k),birch:k===0})}
  for(let i=120;i<220;i+=5)for(const side of[-1,1]){const p=this.points[i],q=this.points[(i+1)%this.points.length],dx=q[0]-p[0],dz=q[2]-p[2],l=Math.hypot(dx,dz);const off=600+noise(i,side)*450;seeds.push({x:-(p[0]+dz/l*off*side),z:p[2]-dx/l*off*side,y:-1,h:110+noise(side,i)*80,seed:noise(i,side),birch:i%3===0});}
  const trunks=[],crowns=[],trunkColors=[],leafColors=[];const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();
  for(const t of seeds){if(t.h<35)continue;const h=t.h*.9,w=h*(t.birch?.27:.34),trunk=h*.56;
   trunks.push(matrix.compose(position.set(t.x,t.y+trunk/2,t.z),quat,scale.set(h*.025,trunk,h*.025)).clone());trunkColors.push(t.birch?0xb7b9a3:0x7e7256);
   for(let k=0;k<6;k++){const a=k*2.4+t.seed*6.28;const r=k===0?0:w*.55;const y=t.y+h*(k===0?.79:.53+.08*(k%3));const size=w*(.75+noise(k,t.seed)*.35);
    crowns.push(matrix.compose(position.set(t.x+Math.cos(a)*r,y,t.z+Math.sin(a)*r),quat.setFromAxisAngle(new THREE.Vector3(0,1,0),a),scale.set(size,size*(t.birch?1.5:1.05),size)).clone());
    leafColors.push([0xd3dfbd,0xe0e8bf,0xc8d9b1,0xb5cb9b,0xd8e5b8][Math.floor(noise(t.seed,k)*5)]);
   }
  }
  const wood=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});this.instanced(new THREE.CylinderGeometry(.65,1,1,7),wood,trunks,trunkColors);
  const leaves=this.texture('bm_leaves.tga');leaves.repeat.set(12,12);
  const leaf=new THREE.MeshStandardMaterial({map:leaves,bumpMap:leaves,bumpScale:.45,color:0xffffff,roughness:.92,flatShading:false});
  leaf.onBeforeCompile=s=>{s.uniforms.boxTime=this.time;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float boxTime;').replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x+=sin(boxTime*1.2+instanceMatrix[3].x*.011+position.y*1.4)*.025;\n#endif');};
  this.leafMaterial=leaf;leaf.customProgramCacheKey=()=> 'boxmeer-wind-crown-v1';this.instanced(new THREE.IcosahedronGeometry(1,2),leaf,crowns,leafColors);this.stats.trees=trunks.length;
  const caps=this.hedgeSeeds.map(([x,y,z],i)=>matrix.compose(position.set(x,y,z),quat.setFromAxisAngle(new THREE.Vector3(0,1,0),i*2.4),scale.set(10,3.5+noise(i,x)*2,8)).clone());
  const hedge=this.instanced(new THREE.IcosahedronGeometry(1,1),leaf,caps,caps.map((_,i)=>[0xd4dfa6,0xc2d9aa,0xbcd19b][i%3]));hedge.castShadow=false;this.stats.hedgeClumps=caps.length;
 }
 // Reusable small architecture is instanced, so detail does not cost hundreds of draw calls.
 makeArchitecture(){
  const trim=[],chimneys=[],dormers=[],glass=[],awnings=[];const trColors=[],chColors=[],awColors=[];
  const windowGuides=JSON.parse(new TextDecoder().decode(this.read('facade-windows.json')));
  const box=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
  const add=(list,pos,size,yaw=0)=>{list.push(matrix.compose(new THREE.Vector3(...pos),q.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(...size)).clone())};
  this.flowerBoxes=[];
  for(let bi=0;bi<this.buildings.length;bi++){
   const b=this.buildings[bi];if(b.height<42||b.height>100||b.roof<15)continue;
   const frontRef=b.faces.find(r=>r[1]===2);if(!frontRef)continue;
   const front=this.model.passes[2].find(p=>p.chunk===frontRef[0]&&p.plane===frontRef[2]);if(!front)continue;
   const a=front.vertices[0],c=front.vertices[1],w=Math.hypot(c[0]-a[0],c[2]-a[2]);if(w<45||w>150)continue;
   const mid=center(front),nx=mid[0]-b.center[0],nz=mid[2]-b.center[2],len=Math.hypot(nx,nz);if(len<1)continue;
   const normal=[-nx/len,0,nz/len],pos=[-mid[0],Math.min(...front.vertices.map(v=>v[1])),mid[2]],yaw=Math.atan2(normal[0],normal[2]);
   const at=(along,y,out)=>[pos[0]+Math.cos(yaw)*along+normal[0]*out,pos[1]+y,pos[2]-Math.sin(yaw)*along+normal[2]*out];
   add(trim,at(0,b.height,1),[w+2,2,2],yaw);trColors.push(0xd7d5bf);
   // Edge drainpipes make the wall depth readable against the sidewalk.
   add(trim,at(w*.44,b.height/2,1),[.65,b.height,.65],yaw);trColors.push(0x686f66);
   const cell=Math.floor((front.uv[0][0]%1)*4)+Math.floor((front.uv[2][1]%1)*4)*4;
   for(const [x0,y0,x1,y1]of windowGuides[cell]||[]){
    const ww=w*(x1-x0)/256,hh=b.height*(y1-y0)/256,cx=w*((x0+x1)/512-.5),cy=b.height*(1-(y0+y1)/512);
    for(const dx of[-ww/2,ww/2]){add(trim,at(cx+dx,cy,.6),[.7,hh+.8,1.3],yaw);trColors.push(0xe8e5d5)}
    for(const dy of[-hh/2,hh/2]){add(trim,at(cx,cy+dy,.7),[ww,.7,1.5],yaw);trColors.push(0xe8e5d5)}
    add(glass,at(cx,cy,.35),[Math.max(1,ww-1),Math.max(1,hh-1),.08],yaw);
   }
   if(cell<8&&bi%2===0){add(awnings,at(0,27,6),[w*.84,2,14],yaw);awColors.push([0x6d8a78,0xab5a43,0xe3c883,0xf1dfb7][bi%4]);add(trim,at(0,24,12),[w*.84,5,1],yaw);trColors.push(0xe8d9b8);}
   else if(bi%3===0){add(trim,at(0,b.height*.53,2.5),[22,3.5,4],yaw);trColors.push(0x8a6950);this.flowerBoxes.push({position:at(0,b.height*.53+2,3),yaw});}
   if(bi%3===1||bi%6===0){
    const faces=b.faces.map(r=>this.model.passes[r[1]].find(p=>p.chunk===r[0]&&p.plane===r[2])).filter(Boolean);
    const rx=-b.center[0]+normal[0]*6,rz=b.center[2]+normal[2]*6;let ry=-Infinity;
    for(const f of faces)for(let k=0;k<6;k+=3){const [a,c,d]=f.indices.slice(k,k+3).map(v=>f.vertices[v]);const det=(c[2]-d[2])*(a[0]-d[0])+(d[0]-c[0])*(a[2]-d[2]);if(Math.abs(det)<.1)continue;const u=((c[2]-d[2])*(-rx-d[0])+(d[0]-c[0])*(rz-d[2]))/det,v=((d[2]-a[2])*(-rx-d[0])+(a[0]-d[0])*(rz-d[2]))/det;if(u>=0&&v>=0&&u+v<=1)ry=Math.max(ry,u*a[1]+v*c[1]+(1-u-v)*d[1]);}
    if(Number.isFinite(ry)){
     if(bi%3===1){add(chimneys,[rx,ry+6,rz],[6,18,6],yaw);chColors.push(0x9e7156);add(trim,[rx,ry+16,rz],[8,2,8],yaw);trColors.push(0x6a695f)}
     else{add(dormers,[rx,ry,rz],[18,18,14],yaw);add(trim,[rx,ry+10,rz],[20,2,16],yaw);trColors.push(0x5b655f);add(glass,[rx+normal[0]*7.2,ry+3,rz+normal[2]*7.2],[14,8,.15],yaw)}
    }
   }
  }
  const material=(color,roughness=.85)=>new THREE.MeshStandardMaterial({color,roughness});
  this.instanced(box,material(0xffffff),trim,trColors);this.instanced(box.clone(),material(0xffffff),chimneys,chColors);
  this.instanced(box.clone(),material(0xffffff),awnings,awColors);this.stats.architecturalDetails=trim.length+chimneys.length+awnings.length;
  this.instanced(box.clone(),material(0xd8d9c9),dormers);
  const windows=new THREE.MeshPhysicalMaterial({color:0xb8d2d5,roughness:.14,metalness:.3,transparent:true,opacity:.2,depthWrite:false,clearcoat:1});this.instanced(box.clone(),windows,glass).castShadow=false;
  this.stats.architecturalDetails+=dormers.length+glass.length;
 }
 makePlotDetails(){
  // Scenery must hold up from the side streets and behind houses, not only along the racing line.
  const trim=[],glass=[],fences=[],patios=[],sheds=[],roofs=[],shrubs=[],shrubColors=[];
  const box=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
  const add=(list,pos,size,yaw=0)=>list.push(matrix.compose(new THREE.Vector3(...pos),q.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(...size)).clone());
  const segmentDistance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)};
  const roads=this.points.map((p,i)=>({a:[-p[0],p[2]],b:[-this.points[(i+1)%this.points.length][0],this.points[(i+1)%this.points.length][2]],clearance:87}));
  for(const s of[this.info.neighbourhood,...this.info.sideStreets])for(const road of s.roads)for(let i=1;i<road.length;i++)roads.push({a:[-road[i-1][0],road[i-1][1]],b:[-road[i][0],road[i][1]],clearance:46});
  const bounds=this.buildings.map(b=>{const vs=b.faces.flatMap(r=>this.model.passes[r[1]].find(p=>p.chunk===r[0]&&p.plane===r[2])?.vertices||[]);return {b,minX:Math.min(...vs.map(v=>-v[0])),maxX:Math.max(...vs.map(v=>-v[0])),minZ:Math.min(...vs.map(v=>v[2])),maxZ:Math.max(...vs.map(v=>v[2]))}});
  const clear=(x,z,padding,owner)=>!roads.some(r=>segmentDistance(x,z,r.a,r.b)<r.clearance+padding)&&!bounds.some(r=>r.b!==owner&&x>r.minX-padding&&x<r.maxX+padding&&z>r.minZ-padding&&z<r.maxZ+padding);
  let plots=0,sideWindows=0;
  for(const b of this.buildings){
   if(b.height<42||b.height>100||b.roof<15)continue;
   const frontRef=b.faces.find(r=>r[1]===2);if(!frontRef)continue;
   const front=this.model.passes[2].find(p=>p.chunk===frontRef[0]&&p.plane===frontRef[2]);if(!front)continue;
   const mid=center(front),width=Math.hypot(front.vertices[1][0]-front.vertices[0][0],front.vertices[1][2]-front.vertices[0][2]);if(width<45||width>150)continue;
   const dx=mid[0]-b.center[0],dz=mid[2]-b.center[2],depth=Math.hypot(dx,dz)*2;if(depth<25)continue;
   const outward=new THREE.Vector3(-dx,0,dz).normalize(),back=outward.clone().negate(),side=new THREE.Vector3(back.z,0,-back.x),yaw=Math.atan2(back.x,back.z),ground=Math.min(...front.vertices.map(v=>v[1]))-1;
   // Plain gables and rear walls gain restrained windows and eaves on their actual wall planes.
   for(const ref of b.faces.filter(r=>r[1]===3)){
    const wall=this.model.passes[3].find(p=>p.chunk===ref[0]&&p.plane===ref[2]);if(!wall)continue;
    const low=Math.min(...wall.vertices.map(v=>v[1])),high=Math.max(...wall.vertices.map(v=>v[1]));if(high-low<b.height*.85||high>low+b.height+2)continue;
    const c=center(wall),normal=new THREE.Vector3(-c[0]+b.center[0],0,c[2]-b.center[2]).normalize(),angle=Math.atan2(normal.x,normal.z),w=Math.hypot(wall.vertices[1][0]-wall.vertices[0][0],wall.vertices[1][2]-wall.vertices[0][2]);if(w<30||w>180)continue;
    const at=(u,y)=>[-c[0]+Math.cos(angle)*u+normal.x*.7,low+y,c[2]-Math.sin(angle)*u+normal.z*.7];
    add(trim,at(0,b.height-1),[w+1,1.5,2],angle);
    for(const u of(w>75?[-w*.23,w*.23]:[0]))for(const y of(b.height>60?[29,57]:[27])){
     add(trim,at(u,y),[16,20,.8],angle);add(glass,at(u,y),[12.5,16.5,1.05],angle);add(trim,at(u,y),[.6,18,1.2],angle);sideWindows++;
    }
   }
   const backWall=new THREE.Vector3(-b.center[0],ground,b.center[2]).addScaledVector(back,depth*.5);
   const at=(u,d,y=ground)=>[backWall.x+side.x*u+back.x*d,y,backWall.z+side.z*u+back.z*d];
   const extent=42+noise(b.chunk,width)*25,half=width*.44;
   if(![-half,0,half].every(u=>[12,extent].every(d=>{const p=at(u,d);return clear(p[0],p[2],8,b)})))continue;
   plots++;
   add(patios,at(0,14,ground+.25),[width*.78,.5,26],yaw);
   for(const u of[-half,half]){add(fences,at(u,extent/2,ground+12),[1.1,21,extent],yaw);for(let d=6;d<extent;d+=16)add(fences,at(u,d,ground+13),[2,26,2],yaw)}
   // Hedge boundary and planting make plots legible from neighbouring streets.
   for(let u=-half;u<=half;u+=10){add(shrubs,at(u,extent,ground+9),[8.5,9,7],yaw);shrubColors.push(0xc2d49e)}
   if(noise(b.chunk,width)>.45){add(sheds,at(half-13,extent-15,ground+11),[22,22,23],yaw);add(roofs,at(half-13,extent-15,ground+23),[25,2,26],yaw)}
   for(const u of[-half+8,half-8]){add(shrubs,at(u,23,ground+6),[7,6,7],yaw);shrubColors.push(0xd3dba8)}
  }
  const castle=this.info.landmarks.find(m=>m.name==='Kasteel Boxmeer');let landmarkWindows=0;
  for(const b of this.buildings){
    if(!castle||Math.hypot(b.center[0]-castle.position[0],b.center[2]-castle.position[2])>550||b.height<60||b.height>180)continue;
    for(const ref of b.faces.filter(r=>r[1]===3)){
      const wall=this.model.passes[3].find(p=>p.chunk===ref[0]&&p.plane===ref[2]);if(!wall)continue;
      const low=Math.min(...wall.vertices.map(v=>v[1])),high=Math.max(...wall.vertices.map(v=>v[1])),w=Math.hypot(wall.vertices[1][0]-wall.vertices[0][0],wall.vertices[1][2]-wall.vertices[0][2]);
      if(high-low<b.height*.95||high>low+b.height+2||w<65||w>650)continue;
      const c=center(wall),normal=new THREE.Vector3(-c[0]+b.center[0],0,c[2]-b.center[2]).normalize(),angle=Math.atan2(normal.x,normal.z),count=Math.max(1,Math.floor(w/48));
      for(let k=0;k<count;k++)for(let y=28;y<b.height-12;y+=38){const u=((k+.5)/count-.5)*w,p=[-c[0]+Math.cos(angle)*u+normal.x*.7,low+y,c[2]-Math.sin(angle)*u+normal.z*.7];add(trim,p,[16,23,.8],angle);add(glass,p,[13,20,1.05],angle);landmarkWindows++}
    }
  }
  let streetEnds=0;
  const sideRoads=[this.info.neighbourhood,...this.info.sideStreets].flatMap(s=>s.roads);
  const allNodes=sideRoads.flat();
  for(const road of sideRoads)for(const end of[0,road.length-1]){
    const p=road[end],other=road[end===0?1:road.length-2];
    if(allNodes.filter(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<2).length>1)continue;
    if(this.points.some(q=>Math.hypot(q[0]-p[0],q[2]-p[1])<100))continue;
    const dir=new THREE.Vector3(-(p[0]-other[0]),0,p[1]-other[1]).normalize(),side=new THREE.Vector3(dir.z,0,-dir.x),yaw=Math.atan2(dir.x,dir.z);
    // Low boundary planting frames the continuation into open land without blocking the street.
    for(const sign of[-1,1])for(let k=0;k<4;k++){const x=-p[0]+side.x*sign*(39+k*10)+dir.x*6,z=p[1]+side.z*sign*(39+k*10)+dir.z*6;if(!clear(x,z,0,null))continue;add(shrubs,[x,7,z],[8,8,8],yaw);shrubColors.push(0xc2d49e)}
    add(patios,[-p[0]+dir.x*3,-.35,p[1]+dir.z*3],[60,.5,6],yaw);streetEnds++;
  }
  // Woven field edges extend the Maasheggen landscape beyond the roadside hedge ribbon.
  let fieldClumps=0;
  for(let station=125;station<214;station+=15)for(const side of[-1,1]){
   const f=routeFrame(this.points,station);for(let off=390;off<1150;off+=22){const x=-(f.center[0]+f.right[0]*off*side),z=f.center[2]+f.right[2]*off*side;if(!clear(x,z,15,null))continue;add(shrubs,[x,9,z],[13,10+noise(station,off)*3,12],noise(station,off)*3);shrubColors.push([0xc3d2a1,0xb0c58f,0xd0d9ab][Math.floor(noise(off,station)*3)]);fieldClumps++}
  }
  const material=(color,roughness=1)=>new THREE.MeshStandardMaterial({color,roughness});
  this.instanced(box,material(0xd8d7c5),trim);this.instanced(box.clone(),new THREE.MeshStandardMaterial({map:this.crop(this.textures[2],19,35,55,73),roughness:.55}),glass);
  this.instanced(box.clone(),material(0x8c8065),fences);this.instanced(box.clone(),new THREE.MeshStandardMaterial({map:this.surfaceTiles.pavement,color:0xc5c2b2,roughness:1}),patios);
  this.instanced(box.clone(),material(0x85765d),sheds);this.instanced(box.clone(),material(0x52605b),roofs);
  this.instanced(new THREE.IcosahedronGeometry(1,1),this.leafMaterial,shrubs,shrubColors);
  Object.assign(this.stats,{gardenPlots:plots,sideWindows,fieldClumps,streetEnds,landmarkWindows});
 }
 makePlants(){
  let texture;try{texture=this.texture('bm_plants.tga')}catch{return}
  const g=new THREE.PlaneGeometry(1,1);g.translate(0,.5,0);const material=new THREE.MeshStandardMaterial({map:texture,alphaTest:.48,side:THREE.DoubleSide,roughness:1,color:0xffffff});
  const positions=[],cells=[];
  for(let i=118;i<228;i++){
   const p=this.points[i],q=this.points[(i+1)%this.points.length],dx=q[0]-p[0],dz=q[2]-p[2],length=Math.hypot(dx,dz);
   for(const side of[-1,1])for(let j=0;j<8;j++){
    const t=noise(i*7+j,side),off=130+noise(j,i*side)*270;const crest=150,toe=290,blend=clamp((off-crest)/(toe-crest));const ground=(p[1]*(1-t)+q[1]*t+.5)*(1-blend)-blend;
    positions.push([-(p[0]+dx*t+dz/length*off*side),ground,p[2]+dz*t-dx/length*off*side,9+noise(i,j)*9,noise(j,i)*Math.PI]);cells.push(j%5===0?1:0);
   }
  }
  for(const p of this.flowerBoxes){positions.push([...p.position,11,p.yaw]);cells.push(2)}
  const matrices=[],colors=[],m=new THREE.Matrix4(),q=new THREE.Quaternion();
  const renderCells=[];
  for(let i=0;i<positions.length;i++){const [x,y,z,s,yaw]=positions[i];for(const turn of[0,Math.PI/2]){matrices.push(m.compose(new THREE.Vector3(x,y-s*.08,z),q.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw+turn),new THREE.Vector3(s,s,s)).clone());colors.push(0xffffff);renderCells.push(cells[i])}}
  const mesh=this.instanced(g,material,matrices,colors);mesh.castShadow=false;
  const a=new THREE.InstancedBufferAttribute(Float32Array.from(renderCells),1);g.setAttribute('gardenCell',a);
  material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float gardenCell;varying float plantCell;').replace('#include <uv_vertex>','#include <uv_vertex>\nplantCell=gardenCell;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float plantCell;').replace('#include <map_fragment>','#ifdef USE_MAP\nvec2 gardenUV=vec2((vMapUv.x+mod(plantCell,2.))*.5,(1.-vMapUv.y+floor(plantCell/2.))*.5);vec4 sampledDiffuseColor=texture2D(map,gardenUV);diffuseColor*=sampledDiffuseColor;\n#endif');};material.customProgramCacheKey=()=> 'boxmeer-gardens-v1';this.stats.plants=positions.length;
 }
 update(time,camera){
  this.time.value=time;this.sky.position.copy(camera.position);
  const p=camera.position;if(p.distanceTo(this.lastShadow)>35){const x=Math.round(p.x/32)*32,z=Math.round(p.z/32)*32;this.sun.target.position.set(x,0,z);this.sun.position.set(x-1400,1900,z+900);this.sun.target.updateMatrixWorld();this.sun.updateMatrixWorld();this.sun.shadow.needsUpdate=true;this.renderer.shadowMap.needsUpdate=true;this.lastShadow.copy(p)}
 }
 syncCamera(view,proj,clip){
  this.camera.matrixWorldInverse.copy(Z).multiply(view).multiply(F);this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();this.camera.position.setFromMatrixPosition(this.camera.matrixWorld);
  this.camera.projectionMatrix.copy(clip).multiply(proj).multiply(Z);this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
 }
 render(view,proj,clip){this.syncCamera(view,proj,clip);this.update(performance.now()/1000,this.camera);this.renderer.render(this.scene,this.camera);this.stats.drawCalls=this.renderer.info.render.calls;this.stats.triangles=this.renderer.info.render.triangles}
 dispose(){for(const r of new Set(this.resources))r.dispose();this.sun.shadow.map?.dispose()}
}
