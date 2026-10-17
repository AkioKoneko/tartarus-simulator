'use strict';
const assert = require('node:assert/strict');
const A = require('../js/local-assist'), T = require('../js/engine'), S = require('../js/solver');
function state() {
  const st = T.newGame({ seed: 'PORTABLE-TEST', params: { startTools: 0, rewards: false, eventWalkChance: 0 } });
  st.pending = []; st.tools = []; st.objective = { id: 'other', progress: 0 }; st.milestone = true;
  for (const c of st.cells) Object.assign(c, { sealed: c.n !== T.OFFICE, inmate: null, hidden: null, event: null, nest: null });
  return st;
}
function consume(startEvent = 'cagefight') {
  const st = state(); st.phase = 'manage'; st.position = 1; st.startEvent = startEvent;
  for (const [n, beast, tier] of [[1, 'wolf', 1], [2, 'rat', 0], [3, 'rat', 0], [4, 'rat', 0]]) Object.assign(st.cells[n], { sealed: false, inmate: { id: n + 100, beast, tier } });
  return st;
}
const bite = { label: 'Consume rat in cell 03', action: { type: 'devour', to: 2 } };
const office = { label: 'Go to Interrogation Room', action: { type: 'patrol', cell: T.OFFICE } };
const noSimulation = { clone() { throw Error('Unexpected simulation'); } };
const normal = A.buildPlan(consume('none'), bite, T, noSimulation);
assert.equal(normal.steps[0].label, bite.label);
assert(normal.steps.slice(1).every(s => s.certainty === 'conditional'));
for (const id of ['saw', 'whip', 'collar', 'revenge', 'cage', 'unknown']) {
  const st = consume(); st.tools = [id];
  assert(!A.buildPlan(st, bite, T, noSimulation).steps.some(s => s.certainty === 'confirmed'));
}
const st = consume(), original = JSON.stringify(st), plan = A.buildPlan(st, bite, T, S);
assert(plan.steps.length > 3 && plan.steps.length <= 6);
assert(plan.steps.slice(1).every(s => s.certainty === 'confirmed'));
assert.equal(plan.steps.at(-1).action.type, 'end'); assert.equal(JSON.stringify(st), original);
const pending = consume(); pending.pending = [{ kind: 'gift', options: ['wine'] }];
assert.equal(A.buildPlan(pending, bite, T, noSimulation).steps.length, 1);
const hidden = consume(); hidden.cells[2].sealed = true;
assert.equal(A.buildPlan(hidden, bite, T, noSimulation).steps.length, 1);
function travel() { const x = state(); x.phase = 'patrol'; x.position = 15; x.destinations = [T.OFFICE]; return x; }
assert.equal(A.buildPlan(travel(), office, T, S).steps[1].certainty, 'planned');
for(const chance of [T.DEFAULT_PARAMS.eventWalkChance,100,undefined,NaN]) {
 const x=travel();x.params.eventWalkChance=chance;
 const p=A.buildPlan(x,office,T,noSimulation);
 assert.equal(p.steps[1].certainty,'recheck');assert(!p.headline);
}
for(const occupancy of ['open','event','nest']) {
 const x=travel();x.params.eventWalkChance=9;
 for(const c of x.cells)if(c.n!==T.OFFICE) {
  if(occupancy==='open')c.sealed=false;
  else if(occupancy==='event')c.event='chain';
  else c.nest={due:99};
 }
 assert.equal(A.buildPlan(x,office,T,S).steps[1].certainty,'planned',`no event slot: ${occupancy}`);
 if(occupancy==='open') {
  delete x.cells[3].sealed;
  assert.equal(A.buildPlan(x,office,T,noSimulation).steps[1].certainty,'recheck','unknown occupancy never proves no spawn space');
 }
}
const legacy=consume();legacy.mode='challenge';
assert.equal(A.buildPlan(legacy,bite,T,noSimulation).steps.length,1,'removed modes never run a speculative simulation');
const randomFinish=consume();randomFinish.params.eventActionChance=100;
let finishSeen=false;
const finite={clone:S.clone,apply(x,a){assert.notEqual(a.type,'end','never simulate a new morning');const r=S.apply(x,a);if(!x.chaining){finishSeen=true;assert(x.cells.some(c=>c.event),'real engine spawned an event');}return r;},instant(x){assert(x.chaining,'never choose from one random post-chain board');return S.instant(x);},candidates:S.candidates};
const prefix=A.buildPlan(randomFinish,bite,T,finite);
assert(finishSeen);assert.equal(prefix.steps.filter(s=>s.action && s.action.type==='chain').length,2);
assert.equal(prefix.steps.at(-1).action.type,'end');assert.match(prefix.note,/random Prison Incident/);
const finalRec={label:'End the day',action:{type:'end'}};
assert.equal(A.buildPlan(randomFinish,finalRec,T,noSimulation).steps.length,1,'current End is never applied as a prediction of tomorrow');
const ambiguous={...finite,candidates:()=>[{label:'End',action:{type:'end'}},{label:'Replace',action:{type:'swap'}}]};
assert(!A.buildPlan(randomFinish,bite,T,ambiguous).steps.some(s=>s.action && s.action.type==='end'),'no next pick from one sampled random final state');
const cancelled=A.buildPlan(randomFinish,bite,T,{...finite,instant:()=>({label:'Cancel',action:{type:'stopchain'}})});
assert.equal(cancelled.steps.at(-1).action.type,'stopchain');assert.match(cancelled.note,/Cancel.*random Prison Incident/);
for (const extra of [{ tools: ['unknown'] }, { tools: ['shortchain'] }, { startEvent: 'tyranny' }, { chain: true }]) assert.equal(A.buildPlan(Object.assign(travel(), extra), office, T, noSimulation).steps[1].certainty, 'recheck');
function reading(picker = true) {
  return { allowChain: true, result: { ok: true, cells: st.cells.map(c => ({ n: c.n, kind: c.inmate ? 'inmate' : 'locked', beast: c.inmate && c.inmate.beast, x: 200 + c.n * 130, y: 400, k: 1 })), ...(picker ? { chain: { targets: [2, 3, 4] } } : { decision: { consume: true, targets: { consume: { x: 300, y: 700, width: 100, height: 24 } } } }) } };
}
const management = A.buildTargets(st, bite, reading(false), plan);
assert.equal(management[0].shape, 'underline');
assert.deepEqual(management.slice(1).map(t => t.chainStep), [1, 2, 3]);
assert(management.slice(1).every(t => t.chainState === 'planned'));
assert.equal(A.buildTargets(st, bite, reading(), plan)[0].chainState, 'current');
const uncertain = reading(); uncertain.allowChain = false;
assert.equal(A.buildTargets(st, bite, uncertain, plan).length, 1);
const missing = reading(); missing.result.cells.find(c => c.n === 3).x = NaN;
assert.equal(A.buildTargets(st, bite, missing, plan).length, 1);
const unavailable = reading(); unavailable.result.chain.targets = [3];
assert.deepEqual(A.buildTargets(st, bite, unavailable, plan), []);
const noButton = reading(false); delete noButton.result.decision.targets;
assert.deepEqual(A.buildTargets(st, bite, noButton, plan), []);
assert.equal(JSON.stringify(st), original);
console.log('PASS safe plans, immutability, uncertainty and observed targets');
