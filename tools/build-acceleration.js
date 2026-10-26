#!/usr/bin/env node
'use strict';
// Explicit build/seal step, never an automatic runtime download or installation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),target=process.env.CARGO_TARGET_DIR||path.join(root,'native/.build');
const onlyPixels=process.argv.includes('--pixels'),accept=process.argv.includes('--accept-reference');
const kinds=onlyPixels?['pixels']:['solver','pixels'];
if (!onlyPixels) {const data=JSON.parse(fs.readFileSync(path.join(root,'native/tartarus/data.json')));if(JSON.stringify(data)!==JSON.stringify(require('./snapshot-acceleration-data.js')()))throw Error('Native constants differ from the JS reference. Review and regenerate before building.');}
const spec={solver:{crate:'tartarus',artifact:'tartarus_core.wasm',file:'calculation-core.wasm',sources:['engine.js','solver.js','tool-combos.js']},pixels:{crate:'scan-kernels',artifact:'tartarus_scan_kernels.wasm',file:'pixel-kernels.wasm',sources:['scan.js']}};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),manifestFile=path.join(root,'js/acceleration-manifest.json');
function nativeSources(folder){const files=[];function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isDirectory()){if(item.name==='src')visit(path.join(dir,item.name));}else if(/\.rs$|^Cargo\.(?:toml|lock)$|^(?:data|reference)\.json$/.test(item.name))files.push(path.join(dir,item.name));}}visit(folder);return Object.fromEntries(files.sort().map(p=>[path.relative(root,p).replaceAll('\\','/'),sha(fs.readFileSync(p))]));}
const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile)):{};manifest.contract='tartarus-accel-v1';
for(const kind of kinds){const s=spec[kind],folder=path.join(root,'native',s.crate),reference=path.join(folder,'reference.json'),sources=Object.fromEntries(s.sources.map(n=>[n,sha(fs.readFileSync(path.join(root,'js',n)))]));
 if(accept)fs.writeFileSync(reference,JSON.stringify({contract:'tartarus-accel-v1',sources},null,2)+'\n');
 if(!fs.existsSync(reference)||JSON.stringify(JSON.parse(fs.readFileSync(reference)).sources)!==JSON.stringify(sources))throw Error(kind+': reference JS changed. Port and verify parity before an explicit --accept-reference build.');
 const args=['build','--release','--locked','--target','wasm32-unknown-unknown','--manifest-path',path.join(folder,'Cargo.toml'),'--lib'];if(kind==='solver')args.push('--features','solver');
 const env={...process.env,CARGO_TARGET_DIR:target},rustflags=['--remap-path-prefix',root+'=.','-C','link-arg=--max-memory='+(kind==='solver'?134217728:268435456)];if(process.env.CARGO_HOME)rustflags.push('--remap-path-prefix',process.env.CARGO_HOME+'=/registry');if(process.env.TARTARUS_WASM_SYSROOT){rustflags.push('--sysroot',process.env.TARTARUS_WASM_SYSROOT,'--remap-path-prefix',process.env.TARTARUS_WASM_SYSROOT+'=/rust-toolchain');if(process.env.TARTARUS_WASM_LINKER)rustflags.push('-C','linker='+process.env.TARTARUS_WASM_LINKER);}env.CARGO_ENCODED_RUSTFLAGS=rustflags.join('\x1f');
 const run=spawnSync(process.env.CARGO||'cargo',args,{cwd:root,env,windowsHide:true,stdio:'inherit'});if(run.error)throw run.error;if(run.status!==0)process.exit(run.status||1);
 const bytes=fs.readFileSync(path.join(target,'wasm32-unknown-unknown/release',s.artifact));fs.writeFileSync(path.join(root,'js',s.file),bytes);manifest[kind]={file:s.file,sha256:sha(bytes),sources,nativeSources:nativeSources(folder)};
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log('Built source-guarded acceleration assets: '+kinds.join(', '));
