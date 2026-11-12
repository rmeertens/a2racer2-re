// Live graphics/HUD checks and isolation checks for the Boxmeer-only presentation.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const dir='evidence/boxmeer/redesign';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:[`--use-angle=${process.env.BOXMEER_GPU||'swiftshader'}`,'--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const results=[];
async function pageFor(path){
 const p=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 await p.goto((process.env.BOXMEER_URL||'http://127.0.0.1:4181')+path);return{p,errors};
}
try{
 const {p,errors}=await pageFor('/?race=1&etappe=boxmeer&bot=1&bench=1&speed=4');
 await p.waitForFunction(()=>window.__bot?.state?.chunk>20&&window.__renderer.lastFull,null,{timeout:90000});
 await p.evaluate(()=>{window.__app.runner.suspended=true;window.__renderer.present(1)});
 const live=await p.evaluate(()=>{const r=window.__renderer,m=window.__race.m;return{boundsActive:!!window.__race.boxmeerBounds,stats:r.boxmeerWorld.stats,pools:r.vianenGeometry.cache.size,nativeHudMeshes:r.sceneHud.children.filter(o=>o.visible).length,customHud:!!document.querySelector('.boxmeer-race-hud'),theme:document.documentElement.classList.contains('boxmeer-modern'),nativeSpeed:m.i32[0x6fba64>>2],skyTextures:r.boxmeerSkyTextures.size}});
 assert(live.boundsActive);assert(live.stats.trees>200&&live.stats.plants>1500&&live.stats.architecturalDetails>2000);assert.equal(live.pools,4);assert(live.nativeHudMeshes>0&&!live.customHud&&!live.theme);assert(live.skyTextures>0);
 const primary={name:'Boxmeer',live,errors};results.push(primary);await p.screenshot({path:`${dir}/race.png`});
 await p.evaluate(()=>window.__app.runner.suspended=false);await p.keyboard.down('p');await p.waitForFunction(()=>Boolean(window.__race.pause),null,{timeout:15000});await p.keyboard.up('p');
 await p.screenshot({path:`${dir}/pause.png`});
 await p.waitForTimeout(350);await p.keyboard.down('p');await p.waitForFunction(()=>window.__race.pause?.stage===2,null,{timeout:15000});await p.keyboard.up('p');await p.waitForFunction(()=>!window.__race.pause,null,{timeout:15000});
 await p.evaluate(()=>{window.__app.runner.speed=16});await p.waitForFunction(()=>Boolean(window.__race.m.i32[0x6fba98>>2]),null,{timeout:120000});
 const finished=await p.evaluate(()=>({finished:Boolean(window.__race.m.i32[0x6fba98>>2]),nativeHudMeshes:window.__renderer.sceneHud.children.filter(o=>o.visible).length}));assert(finished.finished);assert(finished.nativeHudMeshes>0);await p.screenshot({path:`${dir}/finish.png`});
 const reset=await p.evaluate(()=>{const r=window.__renderer;r.resetForRace();return{world:r.boxmeerWorld,hud:r.boxmeerHud,shadow:r.three.shadowMap.enabled,toneMapping:r.three.toneMapping,colorSpace:r.three.outputColorSpace,root:!!document.querySelector('.boxmeer-race-hud'),theme:document.documentElement.classList.contains('boxmeer-modern')}});
 assert.equal(reset.world,null);assert(!reset.hud);assert(!reset.shadow&&!reset.root&&!reset.theme);assert.equal(reset.toneMapping,0);assert.equal(reset.colorSpace,'srgb-linear');
 Object.assign(primary,{finished,reset});assert.deepEqual(errors,[]);await p.close();
 for(const [name,path,indexed]of [['Vianen','/?race=1&etappe=vianen&bench=1',false],['Amsterdam','/?race=1&etappe=0&bench=1',false],['Amsterdam 8-bit','/?race=1&etappe=0&resolution=0&bench=1',true]]){
  const{p,errors}=await pageFor(path);await p.waitForFunction(()=>window.__renderer?.lastFull,null,{timeout:90000});
  const live=await p.evaluate(()=>{const r=window.__renderer;return{bounds:!!window.__race.boxmeerBounds,modern:!!r.boxmeerWorld,hud:!!r.boxmeerHud,shadow:r.three.shadowMap.enabled,toneMapping:r.three.toneMapping,colorSpace:r.three.outputColorSpace,indexed:r.indexed,theme:document.documentElement.classList.contains('boxmeer-modern')}});
  assert(!live.bounds&&!live.modern&&!live.hud&&!live.shadow&&!live.theme);assert.equal(live.toneMapping,0);assert.equal(live.colorSpace,'srgb-linear');assert.equal(live.indexed,indexed);await p.screenshot({path:`${dir}/${name.toLowerCase().replaceAll(' ','-')}.png`});results.push({name,live,errors});assert.deepEqual(errors,[]);await p.close();
 }
 const{p:viewer,errors:viewerErrors}=await pageFor('/track-viewer.html?map=boxmeer');await viewer.waitForFunction(()=>window.__trackViewer?.ready,null,{timeout:90000});
 const cameras=JSON.parse(readFileSync('public/assets/boxmeer/exploratory-views.json'));
 assert.equal(await viewer.locator('#explore-view').count(),0);
 await viewer.goto((process.env.BOXMEER_URL||'http://127.0.0.1:4181')+'/track-viewer.html?map=boxmeer&explore=49');await viewer.waitForFunction(()=>window.__trackViewer?.ready);
 const eye=await viewer.evaluate(()=>window.__trackViewer.camera.position.toArray());assert(eye.every((x,k)=>Math.abs(x-(k===0?-cameras[49].eye[k]:cameras[49].eye[k]))<.001));
 assert.equal(await viewer.locator('audio,video').count(),0);
 const contextStats=await viewer.evaluate(()=>window.__trackViewer.modern.stats);assert(contextStats.gardenPlots>200&&contextStats.sideWindows>1000&&contextStats.fieldClumps>300);
 const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json'));
 for(const [name,station,mark]of [['town',14,null],['country',Math.floor(info.chunks*.46),null],...['De Meidoorn','Hoogendijk','Kasteel Boxmeer'].map(name=>[name,0,info.landmarks.find(m=>m.name===name)])]){
  await viewer.locator('#station').fill(String(mark?mark.chunk:station));await viewer.locator('#station').dispatchEvent('input');await viewer.locator('#height').fill('2.5');await viewer.locator('#height').dispatchEvent('input');
  if(mark)await viewer.evaluate(m=>{const v=window.__trackViewer;if(m.camera){v.camera.position.set(-m.camera.eye[0],m.camera.eye[1],m.camera.eye[2]);v.controls.target.set(-m.camera.target[0],m.camera.target[1],m.camera.target[2]);v.controls.update()}},mark);
  await viewer.screenshot({path:`${dir}/${name}.png`});
 }
 await viewer.locator('#wireframe').check();await viewer.locator('#wireframe').uncheck();await viewer.locator('#smooth').uncheck();await viewer.locator('#smooth').check();assert.deepEqual(viewerErrors,[]);results.push({name:'Boxmeer viewer',stats:await viewer.evaluate(()=>window.__trackViewer.modern.stats),errors:viewerErrors});await viewer.close();
}catch(e){results.push({failure:e.stack});throw e}finally{writeFileSync(`${dir}/presentation-check.json`,JSON.stringify(results,null,2));await browser.close()}
console.log(results.map(r=>({name:r.name,errors:r.errors?.length})));
