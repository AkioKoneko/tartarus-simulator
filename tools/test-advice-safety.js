'use strict';
// Exercise the real decision guards without exporting Analyzer internals or
// creating a browser/debug API. The solver packet and observations are controlled.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/analyze.js'),'utf8');
function declaration(name) {
  const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  }',start);
  assert(start>=0 && end>start,`Missing guard ${name}`);
  return source.slice(start,end+4);
}
const model={step:'manage',warden:1,tools:['maiden','scapegoat'],cells:[{kind:'office'},{kind:'inmate',beast:'mammoth',tier:3},{kind:'inmate',beast:'rat',tier:1}]};
const st={position:1,cells:[{n:0},{n:1,inmate:{tier:3}},{n:2,inmate:{tier:4}},{n:3,inmate:{tier:1}}]};
const end={action:{type:'end'},label:'End the day'};
const sandbox={model,solver:{st,result:{options:[end]}},T:{SUPREME:4,CELL_COUNT:3,startOptions:()=>[{cell:2}]},fresh:()=>true,settled:()=>true,riskChoice:null,modelKey:()=>JSON.stringify(model)};
vm.createContext(sandbox);vm.runInContext(declaration('replacementRisk'),sandbox);
const swap={action:{type:'swap'},label:'Replace'};
assert.equal(sandbox.replacementRisk(swap).selected,'pending');
sandbox.riskChoice={key:sandbox.modelKey(),mode:'preserve'};
assert.equal(sandbox.replacementRisk(swap).selected,'preserve');
sandbox.riskChoice={key:'older board',mode:'simulate'};
assert.equal(sandbox.replacementRisk(swap).selected,'pending');
for(const tools of [[],['maiden'],['scapegoat']]) {
  model.tools=tools;assert.equal(sandbox.replacementRisk(swap),null);
}
model.tools=['maiden','scapegoat'];
assert.equal(sandbox.replacementRisk({action:{type:'devour'}}),null);
const other=st.cells.pop();assert.equal(sandbox.replacementRisk(swap),null);st.cells.push(other);
sandbox.solver.result={options:[]};assert.equal(sandbox.replacementRisk(swap),null);
sandbox.solver.result={options:[end]};sandbox.fresh=()=>false;assert.equal(sandbox.replacementRisk(swap),null);
sandbox.fresh=()=>true;
const rec={action:{type:'devour',to:2},label:'Consume rat in cell 03'};
const image={};const raw=model.cells.map((c,n)=>({n,...c,conf:1}));
const result={ok:true,cells:raw,warden:{cell:1},chain:{targets:[2]}};
const rd={checks:new Set(),model:JSON.parse(JSON.stringify(model))};
Object.assign(sandbox,{reader:{result,id:1,completedId:1,image,completedImage:image},reading:false,flags:new Set(),recommendation:()=>rec,normalize:x=>x,buildState:()=>({st,problems:[]}),pendingForReuse:()=>false});
vm.runInContext(declaration('firstPickerRecommendation'),sandbox);
assert(sandbox.firstPickerRecommendation(rd),'Unchanged first picker may reuse measured advice');
raw[2].frame={tier:4,bins:[0,10,80,0,300],samples:1000};raw[2].tier=2;
assert.equal(sandbox.firstPickerRecommendation(rd),null,'New blue/purple evidence invalidates inherited model equality');
raw[2].frame={tier:2,conf:0.9};
assert.equal(sandbox.firstPickerRecommendation(rd),null,'Direct reliable rarity also invalidates reuse');
raw[2].frame={tier:4,bins:[0,1,2,0,300],samples:1000};
assert(sandbox.firstPickerRecommendation(rd),'Fangs alone do not establish a new tier');
raw[2].beast='wolf';assert.equal(sandbox.firstPickerRecommendation(rd),null);
raw[2].beast='rat';result.chain.targets=[];assert.equal(sandbox.firstPickerRecommendation(rd),null);
result.chain.targets=[2];model._simulated=true;assert.equal(sandbox.firstPickerRecommendation(rd),null);
console.log('PASS scoped instrument warning and observed first-picker reuse guards');
