'use strict';
// Actual adapter snapshot -> actual main advice handler -> actual hint policy
// and geometry, without advancing any timer or periodic window update.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'desktop/main.js'),'utf8');
let now=1000,visible=false,bounds={x:0,y:0,width:1280,height:720};
const delivered=[],handlers={};
const main={Date:{now:()=>now},wins:{hints:{isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false;},showInactive:()=>{visible=true;},getBounds:()=>bounds,setBounds:b=>{bounds=b;}}},lastAdvice:null,
  win32:{foreground:()=>42,minimized:()=>false,frame:()=>({x:0,y:0,width:1280,height:720})},game:{running:true,hwnd:42},settings:{overlayOn:true},agreed:true,riot:false,runOver:false,
  screen:{screenToDipRect:(_,b)=>b},send:(name,channel,data)=>delivered.push({name,channel,data}),note(){},pushShell(){},
  require:id=>require(path.join(root,'desktop',id)),ipcMain:{on:(name,fn)=>{handlers[name]=fn;}},fromPage:()=>true,small:()=>true,adviceFlagKey:a=>a&&a.move};
const a=source.indexOf('let hintsInvalidAt ='),b=source.indexOf('let lastFollow =',a),c=source.indexOf("ipcMain.on('site:advice'"),d=source.indexOf('// The overlay\'s buttons.',c);
assert(a>=0&&b>a&&c>=0&&d>c);vm.createContext(main);vm.runInContext(source.slice(a,b)+'\n'+source.slice(c,d),main);
let rec=null,frame=1,observer,onMessage;
const microtasks=[],timers=[],sent=[],records=[];
const nodes={
  'az-results':{hidden:false,classList:{contains:()=>false}},
  'az-res-move':{textContent:'Working it out…'},
  'az-res-list':{children:[]},
};
const hints=()=>({valid:!!rec,frameId:frame,capturedAt:900+frame,width:1280,height:720,targets:[{x:200+frame,y:200,radius:40,label:rec?.label||''}]});
const adapter={window:{TartarusDesktop:{advice:s=>{sent.push(s);handlers['site:advice']({},s);},record:e=>records.push(e),onCommand(){}},
  TartarusAnalyzer:{recommendation:()=>rec,localAssist:()=>({hints:hints()})}},
  document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:()=>null},
  MutationObserver:class{constructor(fn){observer=fn;}observe(){}},BroadcastChannel:class{addEventListener(_,fn){onMessage=fn;}},
  queueMicrotask:fn=>microtasks.push(fn),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},setInterval(){},clearTimeout(){},Date:{now:()=>now}};
vm.runInNewContext(fs.readFileSync(path.join(root,'desktop/lib/analyzer-adapter.js'),'utf8'),adapter);
const flush=()=>{while(microtasks.length)microtasks.shift()();};flush();
assert.equal(sent.at(-1).working,true);assert.equal(visible,false);
// Complete the existing DOM render, then deliver its mutation batch.
rec={label:'Go to cell 03',action:{type:'walk',to:3}};nodes['az-res-move'].textContent=rec.label;
const count=sent.length;observer();observer();observer();assert.equal(microtasks.length,1);flush();
assert.equal(sent.length,count+1,'One completed snapshot for a batch of DOM changes');
assert.equal(sent.at(-1).move,rec.label);assert.equal(visible,true,'Target is shown in the same advice handler without a timer');
const text=delivered.findLastIndex(x=>x.name==='overlay'&&x.channel==='advice');
assert.equal(delivered[text+1].name,'hints');assert.equal(delivered[text+1].data.targets[0].label,rec.label);
observer();flush();assert.equal(sent.length,count+1,'Unchanged DOM produces no duplicate advice');
// A new frame blocks the old advice immediately, even before its reader result.
onMessage({data:{type:'frame',id:2,kind:'board'}});flush();assert.equal(visible,false);
rec=null;nodes['az-res-move'].textContent='Working it out…';observer();flush();assert.equal(sent.at(-1).working,true);
frame=2;rec={label:'Consume cell 08',action:{type:'devour',to:8}};nodes['az-res-move'].textContent=rec.label;
onMessage({data:{type:'read',id:2,read:{ok:true,_readerId:2,day:3}}});observer();flush();
assert.equal(visible,true);assert.equal(sent.at(-1).recordedFrameId,2);assert.equal(delivered.at(-1).data.targets[0].label,rec.label);
// Clicking invalidates a ready target and the same old capture cannot revive it.
vm.runInContext('invalidateHints()',main);assert.equal(visible,false);handlers['site:advice']({},sent.at(-1));assert.equal(visible,false);
// A fresh later capture may display immediately, preserving the original guard.
now=1100;frame=201;observer();flush();assert.equal(visible,true);
assert.ok(timers.length>0,'Recording/OCR timers remain independent; none had to run');
console.log('PASS actual adapter/main/policy/geometry immediate advice+targets, mutation coalescing, read/working suppression and click freshness');
