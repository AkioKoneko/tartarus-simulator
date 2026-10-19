'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/analyze.js'),'utf8');
const start=source.indexOf('  function runTools('),end=source.indexOf('\n  function scanToModel(',start);
const T=require('../js/engine');
const box={T,TOOL_SURE:0.9};vm.createContext(box);vm.runInContext(source.slice(start,end),box);
const base=()=>({ended:false,tools:[],runStart:true,toolsLocked:false,step:'choice',choice:{kind:'tool',options:['forged','ravenous','crown']},pendingToolOffer:{options:['forged','ravenous','crown'],before:[]}});
function run(read,b=base(),slots=read.length){const m={...JSON.parse(JSON.stringify(b)),observedToolSlots:slots},notes=[];const tools=box.runTools(read,b,m,notes,[]);return {m,notes,tools:JSON.parse(JSON.stringify(tools))};}
const ambiguous={id:null,sim:null,unknown:true,conf:0.84,alts:[{sim:'ravenous',score:0.908}]};
let r=run([ambiguous]);assert.deepEqual(r.tools,[]);assert(r.m.toolsToConfirm);assert(!r.m.toolsLocked);assert.notEqual(r.m.pendingToolOffer,null,'do not resolve an uncertain offer');
r=run([{...ambiguous,sim:'crown',unknown:false,conf:0.89}]);assert.deepEqual(r.tools,[]);assert(r.m.toolsToConfirm);
r=run([{id:'crown-panel',sim:'crown',unknown:false,conf:1}]);assert.deepEqual(r.tools.map(t=>t.sim),['crown']);assert.equal(r.m.pendingToolOffer,null);assert.equal(r.m.toolsToConfirm,'');
r=run([{id:'keys',sim:'keys',unknown:false,conf:1}]);assert.deepEqual(r.tools,[],'an unoffered high-confidence ID must not become the selection');
const held={...base(),tools:['crown'],toolsLocked:true,pendingToolOffer:{options:['keys','shackles'],before:['crown']},choice:{kind:'tool',options:['keys','shackles']}};
r=run([{sim:'keys',conf:1},{...ambiguous}],held);assert.deepEqual(r.tools.map(t=>t.sim),['crown'],'a misread old slot must not impersonate the new selection');assert(r.m.toolsToConfirm);
r=run([{...ambiguous},{sim:'keys',unknown:false,conf:1}],held);assert.deepEqual(r.tools.map(t=>t.sim),['crown','keys']);assert.equal(r.m.pendingToolOffer,null);
const confirmed={...held,pendingToolOffer:null,choice:{kind:'tool',options:[]},toolsSeen:1};
r=run([],confirmed,0);assert.deepEqual(r.tools.map(t=>t.sim),['crown'],'an obscured panel must not erase held instruments');
console.log('tool selection: ambiguous runner-up, low confidence, unoffered/wrong slot, reliable selection and held preservation passed');
