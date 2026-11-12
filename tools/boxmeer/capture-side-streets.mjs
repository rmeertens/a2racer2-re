import {chromium} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json')),dir='evidence/boxmeer/side-streets';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 await page.goto('http://127.0.0.1:4181/track-viewer.html?map=boxmeer');await page.waitForFunction(()=>window.__trackViewer?.ready);
 for(const s of info.sideStreets){
  const mark=info.landmarks.find(m=>m.name===s.name);await page.locator('#station').fill(String(mark.chunk));await page.locator('#station').dispatchEvent('input');
  await page.evaluate(m=>{const v=window.__trackViewer;v.camera.position.set(-m.camera.eye[0],m.camera.eye[1],m.camera.eye[2]);v.controls.target.set(-m.camera.target[0],m.camera.target[1],m.camera.target[2]);v.controls.update()},mark);
  await page.screenshot({path:`${dir}/${s.name}.png`});
 }
 const points=info.sideStreets.flatMap(s=>s.roads.flat());const center=points.reduce((s,p)=>s.map((x,k)=>x+p[k]/points.length),[0,0]);
 await page.evaluate(c=>{const v=window.__trackViewer;v.camera.position.set(-c[0],1900,c[1]-1100);v.controls.target.set(-c[0],0,c[1]);v.controls.update()},center);
 await page.screenshot({path:`${dir}/neighbourhood.png`});
 writeFileSync(`${dir}/visual.json`,JSON.stringify({streets:info.sideStreets.map(s=>s.name),entrances:info.sideStreets.flatMap(s=>s.entrances).length,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close()}
