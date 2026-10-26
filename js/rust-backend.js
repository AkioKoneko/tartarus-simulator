/* Optional own rules/strategy port. The page retains ranking and UI ownership. */
(function(root){
 'use strict';
 function create(instance){
  const wasm=instance.exports,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  if(wasm.core_contract?.()!==1)throw Error('Unsupported calculation contract');
  const core={request(input){const bytes=encoder.encode(JSON.stringify(input)),pointer=wasm.alloc(bytes.length);if(!pointer)throw Error('Calculation allocation failed');try{new Uint8Array(wasm.memory.buffer,pointer,bytes.length).set(bytes);const size=wasm.request(pointer,bytes.length),offset=wasm.response();if(!Number.isInteger(size)||size<0||size>32*1024*1024||offset+size>wasm.memory.buffer.byteLength)throw Error('Invalid calculation response');const out=JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer,offset,size)));if(out.error)throw Error(out.error);return out;}finally{wasm.dealloc(pointer,bytes.length);}},memoryBytes:()=>wasm.memory.buffer.byteLength};
  if(core.request({op:'info'}).contract!=='tartarus-accel-v1')throw Error('Calculation core mismatch');return core;
 }
 function solve(core,state,options){
  const S=root.TartarusSolver,list=S.candidates(state),init=core.request({op:'init',state,...options});
  if(init.rows.length!==list.length||init.rows.some((row,i)=>!S.sameAction(row.action,list[i].action)))throw Error('Native candidates differ from reference');
  const rows=init.rows.map((row,i)=>({...list[i],kind:list[i].kind||null,vals:[],...(options.earlyVaultDays>0?{earlyVals:[]}:{}),best:0,policy:row.policy}));let cancelled=false;
  return {backend:'rust-wasm',rows,cancel(){if(!cancelled){cancelled=true;core.request({op:'cancel'});}},step(ms){if(cancelled)throw Error('Cancelled calculation');const r=core.request({op:'step',ms});if(r.rows.length!==rows.length)throw Error('Native row count changed');r.rows.forEach((row,i)=>{if(!Array.isArray(row.vals))throw Error('Native samples missing');rows[i].vals.push(...row.vals.map(v=>v===null?NaN:v));rows[i].best=row.best;if(rows[i].earlyVals){if(!Array.isArray(row.earlyVals)||row.earlyVals.length!==row.vals.length)throw Error('Native early horizon missing');rows[i].earlyVals.push(...row.earlyVals.map(v=>v===null?NaN:v));}});return S.summarize(rows,r.rounds,options.rollouts,r.goal);}};
 }
 async function load(){return create((await root.TartarusAcceleration.load('solver')).instance);}
 const api={create,solve,load};if(typeof module==='object'&&module.exports)module.exports=api;root.TartarusRustBackend=api;
})(typeof self!=='undefined'?self:globalThis);
