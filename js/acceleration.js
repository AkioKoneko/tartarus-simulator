/* Version/source guarded optional assets. JS remains the reference backend. */
(function(root){
 'use strict';
 const pending=new Map();
 async function digest(bytes){const value=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');}
 async function load(kind){
  if(pending.has(kind))return pending.get(kind);
  const job=(async()=>{
   if(!['solver','pixels'].includes(kind))throw Error('Unknown acceleration kind');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
   const base=new URL('./',root.location.href),query=root.location.search||'';
   const get=async file=>{const r=await fetch(new URL(file+query,base),{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('Acceleration asset HTTP '+r.status);return r;};
   try{
    const manifest=await(await get('acceleration-manifest.json')).json(),meta=manifest[kind];
    if(manifest.contract!=='tartarus-accel-v1'||!meta||!/^[-\w]+\.wasm$/.test(meta.file)||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('Acceleration manifest incompatible');
    const sources=Object.entries(meta.sources||{});if(!sources.length)throw Error('Acceleration reference sources absent');
    await Promise.all(sources.map(async([name,expected])=>{if(!/^[-\w]+\.js$/.test(name)||!/^[a-f0-9]{64}$/.test(expected))throw Error('Bad reference source');if(await digest(await(await get(name)).arrayBuffer())!==expected)throw Error('Reference changed: '+name);}));
    const bytes=await(await get(meta.file)).arrayBuffer();if(await digest(bytes)!==meta.sha256)throw Error('Acceleration asset hash mismatch');
    const {instance}=await WebAssembly.instantiate(bytes,{env:{now:()=>performance.now()}});
    return {instance,meta};
   }finally{clearTimeout(timer);}
  })();pending.set(kind,job);return job;
 }
 const api={load,digest,discard:kind=>pending.delete(kind)};if(typeof module==='object'&&module.exports)module.exports=api;root.TartarusAcceleration=api;
})(typeof self!=='undefined'?self:globalThis);
