#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'js/acceleration-manifest.json')));
function loader({badSource,badAsset,badContract}={}) {
  let instances=0;
  const self={crypto:webcrypto,location:{href:'http://localhost/js/scan-worker.js?gate=1',search:'?gate=1'}};
  const context={self,crypto:webcrypto,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,performance,URL,
    WebAssembly:{instantiate:async(...args)=>{instances++;return WebAssembly.instantiate(...args);}},
    fetch:async url=>{const name=new URL(url).pathname.split('/').pop();let bytes;
      if(name==='acceleration-manifest.json'){const m=structuredClone(manifest);if(badContract)m.contract='unsupported';bytes=Buffer.from(JSON.stringify(m));}
      else {bytes=fs.readFileSync(path.join(root,'js',name));if(name===badSource)bytes=Buffer.from('changed reference source');if(name===badAsset)bytes=Buffer.from('corrupt wasm');}
      return new Response(bytes,{status:200});
    }};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/acceleration.js'),'utf8'),context);
  return {api:self.TartarusAcceleration,instances:()=>instances};
}
(async()=>{
  const good=loader(),first=await good.api.load('pixels'),same=await good.api.load('pixels');
  assert.equal(first.instance,same.instance,'One live owner reuses its initialized instance');assert.equal(first.instance.exports.kernel_contract(),1);assert.equal(good.instances(),1);
  assert.equal(good.api.discard('pixels'),true);const next=await good.api.load('pixels');assert.notEqual(first.instance,next.instance,'Discard must remove fulfilled instance from loader cache');assert.equal(good.instances(),2);
  for(const bad of [{badSource:'scan.js'},{badAsset:manifest.pixels.file},{badContract:true}]){const item=loader(bad);await assert.rejects(item.api.load('pixels'));assert.equal(item.instances(),0,'Reject incompatible content before allocating a WASM instance');}
  const unknown=loader();await assert.rejects(unknown.api.load('other'));assert.equal(unknown.instances(),0);
  console.log('PASS acceleration loader: integrity/reference guards, unknown contracts, initialized reuse and faulted-instance discard/reload.');
})().catch(e=>{console.error(e);process.exitCode=1;});
