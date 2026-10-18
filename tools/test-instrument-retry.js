'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
async function main(){
 let receiver,target,seq=0,boardReads=0;
 const timers=new Map(),sent=[],picks=[],used=[],errors=[];
 const A={giftCounts:()=>0,readPick:(_,opts)=>new Promise(resolve=>picks.push({opts,resolve})),
  usePick:(read,fresh)=>{used.push({read,fresh});return true;},readFrame:async()=>{boardReads++;return {ok:true};},useReading(){},ask:()=>true};
 const el={hidden:true,addEventListener(){},classList:{toggle(){}}};
 const sandbox={window:{TartarusCapture:{agreed:()=>true},TartarusAnalyzer:A,addEventListener(){}},document:{hasFocus:()=>false,getElementById:()=>el},
  BroadcastChannel:class{constructor(){receiver=this;}postMessage(m){if(m.type==='here')target=m.id;sent.push(m);}},
  createImageBitmap:async()=>({close(){}}),Date,setInterval(){},setTimeout(fn,ms){assert.equal(ms,400);timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),console:{...console,error:e=>errors.push(String(e))}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/auto.js'),'utf8'),sandbox);
 const tick=()=>new Promise(setImmediate),frame=(id,patch={})=>receiver.onmessage({data:{type:'frame',to:target,from:'follow',id,kind:'instruments',fresh:true,blob:{},...patch}});
 const ok={ok:true,pick:true,unsure:0,byName:3,cards:[{conf:1},{conf:1},{conf:1}]};
 frame(1);await tick();picks.at(-1).resolve({ok:false,reason:'opening frame'});await tick();
 assert.equal(boardReads,0,'failed known instrument screen must retry before a board fallback');assert.equal(used.length,0);assert.equal(timers.size,1);
 const [id,fn]=timers.entries().next().value;timers.delete(id);fn();
 const request=sent.filter(m=>m.type==='capture').at(-1);assert.equal(request.kind,'instruments');assert.equal(request.forFrame,1);assert.equal(request.retryAttempt,1);
 frame(2,{retryAttempt:1});await tick();picks.at(-1).resolve(ok);await tick();assert.equal(used.length,1);assert.equal(used[0].fresh,true);assert.equal(timers.size,0);
 frame(3,{kind:'board'});await tick();
 frame(4,{fresh:false});await tick();picks.at(-1).resolve(ok);await tick();assert.equal(used.at(-1).fresh,false,'mid-run instrument reward must retain the run');
 frame(5);await tick();picks.at(-1).resolve({...ok,unsure:1});await tick();assert.equal(timers.size,1,'uncertain opening read also retries');
 frame(6,{kind:'board'});await tick();assert.equal(timers.size,0,'board transition cancels popup retry');
 const before=used.length;frame(7);await tick();const old=picks.at(-1);
 frame(8,{kind:'board'});await tick();old.resolve(ok);await tick();assert.equal(old.opts.isCurrent(),false);assert.equal(used.length,before,'late OCR cannot reset a newer board');
 frame(9,{retryAttempt:4});await tick();picks.at(-1).resolve(ok);await tick();assert.equal(timers.size,0);
 const count=boardReads;frame(10,{kind:'manual'});await tick();const manual=picks.at(-1);
 frame(11,{kind:'board'});await tick();manual.resolve({ok:false,skipped:true});await tick();
 assert.equal(boardReads,count+1,'superseded manual picker must not start a new board read');
 assert.deepEqual(errors,[]);console.log('PASS instrument recovery, fresh/mid-run state, uncertainty, cancellation and late-read ownership');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
