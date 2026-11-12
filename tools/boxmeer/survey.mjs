import{chromium}from'playwright';import{readFileSync,mkdirSync,writeFileSync}from'node:fs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1120,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto((process.env.BOXMEER_URL||'http://127.0.0.1:4181')+'/track-viewer.html?map=boxmeer');await page.waitForFunction(()=>window.__trackViewer?.ready);
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json'));
mkdirSync('evidence/boxmeer/survey-final',{recursive:true});
let count=0;
for(let station=0;station<info.chunks;station+=10)for(const yaw of [0,90,180,-90]){
 await page.locator('#station').fill(String(station));await page.locator('#station').dispatchEvent('input');await page.locator('#yaw').fill(String(yaw));await page.locator('#yaw').dispatchEvent('input');
 await page.locator('#viewport').screenshot({path:`evidence/boxmeer/survey-final/${station}-${yaw}.jpg`});count++;
}
for(const mark of info.landmarks){
 await page.locator('#station').fill(String(mark.chunk-3));await page.locator('#station').dispatchEvent('input');
 await page.evaluate(p=>{const v=window.__trackViewer;v.camera.position.y=55;v.controls.target.set(-p[0],100,p[2]);v.controls.update()},mark.position);
 await page.locator('#viewport').screenshot({path:`evidence/boxmeer/${mark.name}-approach.png`});
 await page.evaluate(p=>{const v=window.__trackViewer;v.camera.position.set(-p[0]+400,350,p[2]+450);v.controls.target.set(-p[0],90,p[2]);v.controls.update()},mark.position);
 await page.locator('#viewport').screenshot({path:`evidence/boxmeer/${mark.name}-exterior.png`});
 count+=2;
}
writeFileSync('evidence/boxmeer/survey.json',JSON.stringify({views:count,errors},null,2));console.log({views:count,errors});await browser.close();if(errors.length)process.exitCode=1;
