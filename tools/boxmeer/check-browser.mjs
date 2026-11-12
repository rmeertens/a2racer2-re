import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const base=process.env.BOXMEER_URL || 'http://127.0.0.1:4181';
const options={headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']};
if(process.env.BROWSER_EXECUTABLE) options.executablePath=process.env.BROWSER_EXECUTABLE;
const browser=await chromium.launch(options),page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
mkdirSync('evidence/boxmeer/views',{recursive:true});
await page.goto(`${base}/track-viewer.html?map=boxmeer`);await page.waitForFunction(()=>window.__trackViewer?.ready);
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json'));
for(const [name,station,yaw,height] of [['start',10,0,2],['dike',160,0,2],...info.landmarks.flatMap(p=>[[p.name,p.chunk-2,30,2],[p.name+'-rear',p.chunk,180,18]])]){
 await page.locator('#station').fill(String(station));await page.locator('#station').dispatchEvent('input');
 for(const [key,value]of [['yaw',yaw],['height',height]]){await page.locator('#'+key).fill(String(value));await page.locator('#'+key).dispatchEvent('input')}
 await page.screenshot({path:`evidence/boxmeer/views/${name}.png`});
}
await page.locator('#whole-map').click();await page.screenshot({path:'evidence/boxmeer/whole-map.png'});
await page.goto(`${base}/?race=1&etappe=boxmeer&bot=1&bench=1&speed=4`);
await page.waitForFunction(()=>window.__race?.m && window.__renderer?.vianenGeometry,{timeout:60000});
await page.waitForFunction(()=>window.__bot?.state?.chunk>20,{timeout:60000});
await page.screenshot({path:'evidence/boxmeer/race.png'});
const live=await page.evaluate(()=>{const v=window.__app.vfs;return{slot:v.iniGet('game.ini','ETAPPE','ETAPPE'),car:v.iniGet('game.ini','PLAYER','CAR'),laps:v.iniGet('game.ini','OPTIONS','NRLAPS'),upgrades:['MOTOR','BANDEN','ABS','VERSNELLINGSBAK'].map(k=>v.iniGet('game.ini','PLAYER',k)),chunk:window.__bot.state.chunk,geometryPools:window.__renderer.vianenGeometry.cache.size,frames:window.__race.m.i32[0x715f04>>2]}});
if(live.slot!=='11'||live.car!=='3'||live.laps!=='1'||live.geometryPools!==4||live.upgrades.some(x=>x!=='1'))errors.push('Wrong Boxmeer preview settings or incomplete geometry pools');
writeFileSync('evidence/boxmeer/browser.json',JSON.stringify({live,errors},null,2));
console.log({live,errors});await browser.close();if(errors.length)process.exitCode=1;
