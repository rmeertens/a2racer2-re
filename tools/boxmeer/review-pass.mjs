import{chromium}from'playwright';import{readFileSync,mkdirSync,writeFileSync}from'node:fs';
const step=process.argv[2]||'03',dir=`evidence/boxmeer/rework/pass-${step}`;mkdirSync(dir,{recursive:true});
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json'));
const b=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1200,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:4181/track-viewer.html?map=boxmeer');await p.waitForFunction(()=>window.__trackViewer?.ready);
for(const [name,station,yaw]of [['town',10,0],['country',Math.floor(info.chunks*.45),0],['floralaan',info.neighbourhood.entranceChunk-3,0]]){
 await p.locator('#station').fill(String(station));await p.locator('#station').dispatchEvent('input');await p.locator('#yaw').fill(String(yaw));await p.locator('#yaw').dispatchEvent('input');await p.locator('#viewport').screenshot({path:`${dir}/${name}.png`});
}
for(const mark of info.landmarks.filter(m=>['De Meidoorn','Kasteel Boxmeer','Sint-Petrusbasiliek'].includes(m.name))){
 await p.locator('#station').fill(String(mark.chunk-3));await p.locator('#station').dispatchEvent('input');
 await p.evaluate(m=>{const v=window.__trackViewer;if(m.camera){v.camera.position.set(-m.camera.eye[0],m.camera.eye[1],m.camera.eye[2]);v.controls.target.set(-m.camera.target[0],m.camera.target[1],m.camera.target[2])}else{v.camera.position.y=35;v.controls.target.set(-m.position[0],100,m.position[2])}v.controls.update()},mark);
 await p.locator('#viewport').screenshot({path:`${dir}/${mark.name}.png`});
}
writeFileSync(`${dir}/visual.json`,JSON.stringify({pass:info.polishPass,errors},null,2));await b.close();if(errors.length)throw new Error(errors.join('\n'));console.log({pass:info.polishPass,errors});
