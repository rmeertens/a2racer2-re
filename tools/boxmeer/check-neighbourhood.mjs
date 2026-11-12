import assert from 'node:assert/strict';
import{readFileSync,readdirSync,statSync,writeFileSync}from'node:fs';
import{Vfs}from'../../source/host/vfs.js';import{Race}from'../../source/host/race.js';import{pinRace}from'../../source/host/race-setup.js';import{GameInput}from'../../source/input/keyboard.js';import{NetRace}from'../../source/net/puppets.js';import{Bot}from'../../source/dev/bot.js';import{installBoxmeer,boxmeerFiles}from'../../source/host/boxmeer.js';
const info=JSON.parse(readFileSync('public/assets/boxmeer/boxmeer.json')),meta=JSON.parse(readFileSync('public/game/spel.meta.json')),wasm=new WebAssembly.Module(readFileSync('public/game/spel.wasm'));
const branch=info.neighbourhood;assert(branch.houses>=6);assert.equal(branch.carports,branch.houses);assert.equal(branch.solarRoofs,branch.houses);assert(info.landmarks.some(p=>p.name==='Floralaan'));assert(info.landmarks.some(p=>p.name==='De Meidoorn'&&p.camera));
const results=[];
const tests=[['entrance',branch.roads.at(-1),null,branch.entranceChunk],['north arm',branch.roads[0],1.2,branch.entranceChunk],['south arm',branch.roads[1],1.8,branch.entranceChunk],...(info.sideStreets||[]).flatMap(s=>s.entrances.map((e,i)=>[`${s.name} entrance ${i+1}`,e.probe,null,e.chunk]))];
for(const [label,segment,seconds,chunk]of tests){
 const vfs=new Vfs();for(const name of readdirSync('public/assets/game')){let p='public/assets/game/'+name;if(statSync(p).isFile())vfs.addLazy(name,statSync(p).size,()=>readFileSync(p))}
 pinRace(vfs,{etappe:11,car:0,laps:1});vfs.iniSet('game.ini','OPTIONS','OPPONENTS','0');installBoxmeer(vfs,new Map(boxmeerFiles().map(n=>[n,new Uint8Array(readFileSync('public/assets/boxmeer/'+n))])));
 const dt=1/60,host={vfs,render:new Proxy({},{get:()=>()=>{}}),audio:null,screen:{width:640,height:480},tickSeconds:dt,clockStart:1,fixedDate:971434016000,onFlip(){},onMessageBox(){},onStdout(){}};
 const race=new Race(meta,host);await race.instantiate(wasm);const input=new GameInput(race.m);host.input=input;race.boot();for(let n=0;n<420;n++){race.tick(dt);input.endTick()}
 const net=Object.create(NetRace.prototype);net.race=race;net.scratch=race.m.lowAlloc(128);const bot=new Bot(race,input),carIndex=bot.carState().index;
 const a=segment[0],b=segment[1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),forward=[(b[0]-a[0])/length,0,(b[1]-a[1])/length],right=[forward[2],0,-forward[0]],rows=[...right,0,1,0,...forward];
 const start=[a[0]+forward[0]*20,5,a[1]+forward[2]*20];net.beam(carIndex,start,rows,[0,0,0],[0,0,0]);const car=net.car(carIndex);for(const offset of[0x34,0x38])race.m.i32[(car+offset)>>2]=chunk;race.m.i32[(car+0x3c)>>2]=chunk*2;
 for(let n=0;n<90;n++){race.tick(dt);input.endTick()}
 const initial=bot.carState().pos;net.beam(carIndex,initial,rows,forward.map(x=>x*6),[0,0,0]);let peak=initial[1],lowest=initial[1];
 for(let n=0;n<(seconds??((length-20)/50+.35))*60;n++){input.dik[0xc8]=0x80;race.tick(dt);input.endTick();const s=bot.carState();peak=Math.max(peak,s.pos[1]);lowest=Math.min(lowest,s.pos[1])}
 const end=bot.carState().pos,travel=(end[0]-initial[0])*forward[0]+(end[2]-initial[2])*forward[2],rise=(peak-initial[1])/10;
 assert(travel>(seconds===null?length-20:30),`${label}: failed to cross the entrance or travel along the street`);assert(rise<.2,`${label}: unexpected ground launch`);assert(lowest>-5,`${label}: fell below the street`);assert.equal(race.boxmeerBounds?.recoveries||0,0,`${label}: bounds must leave the street entrance playable`);results.push({label,boundsRecoveries:race.boxmeerBounds?.recoveries||0,travelMetres:travel/10,riseMetres:rise,initial,end});
}
writeFileSync('evidence/boxmeer/neighbourhood-physics.json',JSON.stringify({houses:branch.houses,results},null,2));console.log(results);
