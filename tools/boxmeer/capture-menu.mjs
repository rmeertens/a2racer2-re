import{chromium}from'playwright';import{readFileSync,mkdirSync,writeFileSync}from'node:fs';
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json')),dir='source/assets/boxmeer/menu-views';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await browser.newPage({viewport:{width:1400,height:820}});await p.goto('http://127.0.0.1:4181/track-viewer.html?map=boxmeer');await p.waitForFunction(()=>window.__trackViewer?.ready);for(const id of ['view-status','model-note'])await p.locator('#'+id).evaluate(el=>el.style.visibility='hidden');
const poses=[];
for(const [file,name,station]of [['1','town',14],['2','De Meidoorn',info.neighbourhood.entranceChunk],['3','Kasteel Boxmeer',0],['4','Sint-Petrusbasiliek',0],['5','countryside',Math.floor(info.chunks*.48)]]){
 const mark=info.landmarks.find(m=>m.name===name);await p.locator('#station').fill(String(mark?mark.chunk-4:station));await p.locator('#station').dispatchEvent('input');
 await p.locator('#yaw').fill('0');await p.locator('#yaw').dispatchEvent('input');await p.locator('#height').fill('3');await p.locator('#height').dispatchEvent('input');
 if(name==='De Meidoorn')await p.evaluate(road=>{const v=window.__trackViewer;v.camera.position.set(-road[0][0],24,road[0][1]);v.controls.target.set(-road[1][0],25,road[1][1]);v.controls.update()},info.neighbourhood.roads[1]);
 else if(mark)await p.evaluate(m=>{const v=window.__trackViewer;v.camera.position.y=40;v.controls.target.set(-m.position[0],m.name==='Sint-Petrusbasiliek'?160:100,m.position[2]);v.controls.update()},mark);
 await p.locator('#viewport').screenshot({path:`${dir}/${file}.png`});if(file==='2')await p.locator('#viewport').screenshot({path:`${dir}/hero.png`});
 poses.push(await p.evaluate(([file,name])=>({file,name,eye:window.__trackViewer.camera.position.toArray().map((x,k)=>k===0?-x:x),target:window.__trackViewer.controls.target.toArray().map((x,k)=>k===0?-x:x)}),[file,name]));
}
writeFileSync(`${dir}/cameras.json`,JSON.stringify(poses,null,2));await browser.close();console.log('Saved five packed-map previews and loading hero');
