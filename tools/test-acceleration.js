#!/usr/bin/env node
'use strict';
// Portable semantic gate: current JS is the oracle, not native's own predictions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const T=require('../js/engine.js'),S=require('../js/solver.js'),B=require('../js/rust-backend.js');
const root=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
function diff(a,b,p=''){if(a===b)return [];if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p+'.'+k)).slice(0,12);return [{path:p,expected:a,actual:b}];}
function same(kind,a,b,context){const differences=diff(a,b);if(differences.length){if(process.env.TARTARUS_QA_DIR){fs.mkdirSync(process.env.TARTARUS_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TARTARUS_QA_DIR,'core-parity-failure.json'),JSON.stringify({kind,differences,context,expected:a,actual:b},null,2));}throw Error(kind+': '+JSON.stringify(differences));}}
function norm(s){s=copy(s);delete s.log;delete s.result;if(s.chaining){delete s.chaining.at;delete s.chaining.bites;}return s;}
function raw(rows){return rows.map(r=>({action:r.action,vals:r.vals.map(x=>Number.isNaN(x)?null:x),best:r.best,policy:r.policy,...(r.earlyVals?{earlyVals:r.earlyVals.map(x=>Number.isNaN(x)?null:x)}:{})}));}
(async()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'native/tartarus/data.json'))),require('./snapshot-acceleration-data.js')(),'Native constants track current JS owners');
 const meta=JSON.parse(fs.readFileSync(path.join(root,'js/acceleration-manifest.json')));
 for(const kind of ['solver','pixels']){assert.ok(meta[kind],kind+' manifest missing');const m=meta[kind],sha=x=>crypto.createHash('sha256').update(x).digest('hex');assert.equal(sha(fs.readFileSync(path.join(root,'js',m.file))),m.sha256);for(const [file,wanted]of Object.entries(m.sources))assert.equal(sha(fs.readFileSync(path.join(root,'js',file))),wanted,'Reference version drift '+file);assert.ok(Object.keys(m.nativeSources||{}).length,'Native source seal missing');for(const [file,wanted]of Object.entries(m.nativeSources))assert.equal(sha(fs.readFileSync(path.join(root,file))),wanted,'Native source changed without rebuild '+file);}
 const {instance}=await WebAssembly.instantiate(fs.readFileSync(path.join(root,'js',meta.solver.file)),{env:{now:()=>performance.now()}}),core=B.create(instance);
 assert.equal(core.request({op:'info'}).solver,true);
 let moves=0,runs=0,alternate=0,mc=0;const snapshots=[];
 const fixtures=[...Object.keys(T.SCENARIOS).map(scenario=>({scenario})),...T.TOOL_IDS.map(tool=>({tool})),...Object.keys(T.START_EVENTS).map(startEvent=>({startEvent})),{tools:['maiden','scapegoat','trap','shackles']},{params:{rewards:false}},{params:{chainStop:false,doubleEatTier:3}},{params:{swapNewBeast:true,swapsPerDay:2},tools:['maiden','ravenous']}];
 for(let i=0;i<fixtures.length;i++){
  const f=fixtures[i],st=T.newGame({...f,seed:'OWN-POLICY-'+i,params:{startTools:0,rewards:true,...f.params}});for(const t of f.tools||[f.tool].filter(Boolean)){st.pending=[];assert.ok(T.addTool(st,t).ok);}const rng=S.rng32(i+19),native=core.request({op:'trajectory',state:st,seed:i+19});
  for(let step=0;step<native.steps.length;step++){const row=native.steps[step],before=copy(st),action=S.decide(st,null,rng);same('policy action',action,row.action,{fixture:f,i,step,state:before});const expected=S.apply(st,action);assert.equal(row.ok,expected.ok);same('trajectory state',norm(st),norm(row.state),{fixture:f,i,step,state:before,action});if(step%19===0&&snapshots.length<(i+1)*2)snapshots.push(before);moves++;}
  assert.ok(st.phase==='ended'||st.vault.length>=10,'Native trajectory stopped early');runs++;
 }
 const special=[];function board(){const s=T.newGame({seed:'OWN-CARDS',params:{startTools:0,rewards:true}});Object.assign(s,{phase:'manage',position:2,day:7,pending:[],event:null});for(let n=1;n<=8;n++)T.editCell(s,n,{kind:'open',beast:T.BEASTS[n%4],tier:n%3});return s;}
 for(const kind of T.EVENT_IDS){const s=board();s.phase='event';s.event={kind,cell:2};special.push(s);}
 for(const patch of [{noDevour:true},{noSwap:true},{swap:1,devourAfterSwap:true},{noDevour:true,noSwap:true,noHunt:true},{mealOnly:[3]},{officeOnly:'bestow'}]){const s=board();Object.assign(s.used,patch);special.push(s);}
 const specialOffice=board();Object.assign(specialOffice,{phase:'office',position:0});special.push(specialOffice);
 const forcedOffice=copy(specialOffice);forcedOffice.used.officeOnly='bestow';special.push(forcedOffice);
 const paused=board();paused.position=1;T.editCell(paused,1,{kind:'open',beast:'mammoth',tier:1});T.editCell(paused,2,{kind:'open',beast:'lion',tier:1});T.editCell(paused,3,{kind:'open',beast:'wolf',tier:1});paused.used.devour=1;paused.used.pausedChain={eater:paused.cells[1].inmate.id};special.push(paused);
 const chain=copy(paused);chain.used.pausedChain=null;chain.chaining={eater:chain.cells[1].inmate.id,at:0,bites:[]};special.push(chain);
 const capped=board();capped.vault=Array.from({length:10},(_,i)=>({id:1000+i,beast:'rat',day:6}));special.push(capped);
 for(const st of special){same('special candidates',S.candidates(st).map(x=>x.action),core.request({op:'candidates',state:st}).actions,{state:st});for(const action of S.candidates(st).map(x=>x.action)){const js=copy(st),r=S.apply(js,action),native=core.request({op:'apply',state:st,action});assert.equal(native.ok,r.ok);same('special transition',norm(js),norm(native.state),{state:st,action});alternate++;}}
 for(const [i,st]of [...snapshots.filter((_,i)=>i%9===0),...special].entries())for(const earlyVaultDays of [0,3]){const options={rollouts:12,seed:7919+i,stream:i%3,earlyVaultDays};const job=S.solve(st,options);let r;do{r=job.step(60);}while(!r.done);const native=core.request({op:'solve',state:st,...options});same('raw Monte Carlo',raw(job.rows),raw(native.rows),{state:st,options});assert.equal(native.rounds,r.rounds);mc++;}
 // Public adapter and incremental transport, including the local early horizon.
 const state=snapshots.find(st=>S.candidates(st).length>1);for(const earlyVaultDays of [0,3]){const options={rollouts:32,seed:8731,stream:1,earlyVaultDays},js=S.solve(state,options),native=B.solve(core,state,options);let a,b;do{a=js.step(60);}while(!a.done);do{b=native.step(1);}while(!b.done);same('adapter samples',raw(js.rows),raw(native.rows),{state,options});same('adapter summary',a,b,{state,options});}
 console.log(`PASS own Rust/WASM: ${runs} complete policies, ${moves} actions/states, ${alternate} special alternatives, ${mc} raw MC/early-horizon positions and incremental adapter parity.`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
