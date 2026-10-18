'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function main(){
 let receiver,target,seq=0,asks=0,reads=0;
 const timers=new Map(),messages=[],errors=[];
 let geometry=false;
 const element={hidden:true,addEventListener(){},classList:{toggle(){}}};
 const A={giftCounts:g=>g.rainbows-g.taken,useTreasure(){asks++;return true;},
  async readTreasure(){reads++;return geometry?{ok:true,treasure:true,targets:{ring:{x:1}}}:{ok:true,treasure:true,geometry:false};},
  async readFrame(){return {ok:true};},useReading(){},ask(){return true;}};
 const sandbox={window:{TartarusCapture:{agreed:()=>true},TartarusAnalyzer:A,addEventListener(){}},
  document:{hasFocus:()=>false,getElementById:()=>element,addEventListener(){}},
  BroadcastChannel:class{constructor(){receiver=this;}postMessage(m){if(m.type==='here')target=m.id;messages.push(m);}},
  createImageBitmap:async()=>({close(){}}),setInterval(){},setTimeout(fn,ms){assert.equal(ms,250);timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),Date,
  console:{...console,error:e=>errors.push(String(e))}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/auto.js'),'utf8'),sandbox);
 const tick=()=>new Promise(setImmediate);
 const frame=(id,patch={})=>receiver.onmessage({data:{type:'frame',to:target,id,from:'follow',kind:'treasure',blob:{},gifts:{rainbows:1,taken:0},...patch}});
 const fire=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
 frame(1);await tick();assert.equal(asks,1);assert.equal(timers.size,1);
 fire();let request=messages.filter(m=>m.type==='capture').at(-1);
 assert.equal(request.kind,'treasure');assert.equal(request.forFrame,1);assert.equal(request.retryAttempt,1);
 frame(2,{retryAttempt:1});await tick();assert.equal(asks,1,'retry must not reapply the gift transition or restart its solver');
 assert.equal(timers.size,1);
 geometry=true;frame(3,{retryAttempt:2});await tick();assert.equal(timers.size,0,'verified captions stop retries');assert.equal(asks,1);
 geometry=false;frame(4);await tick();assert.equal(timers.size,1);
 frame(5,{kind:'board'});await tick();assert.equal(timers.size,0,'new board cancels old-popup retry');
 frame(6,{retryAttempt:4});await tick();assert.equal(timers.size,0,'retry budget is bounded');
 frame(7,{gifts:{rainbows:1,taken:1}});await tick();assert.equal(timers.size,0,'known zero never retries or applies the gift');
 const before=reads;frame(8,{blob:null});await tick();assert.equal(reads,before,'missing image keeps log identity without inventing geometry');assert.equal(timers.size,1);
 assert.deepEqual(errors,[]);
 console.log('PASS early Treasure retries, same-choice reuse, verified success, cancellation, budget and known zero');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
