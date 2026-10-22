#!/usr/bin/env node
'use strict';
// Fork-owned integration gate. Sources: tools/test-*.js and the real page
// entrypoints. Run after every upstream merge; extend when enhancements change.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(args) {
  const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const required = {
  'analyze.html': ['js/engine.js', 'js/solver.js', 'js/local-assist.js', 'js/analyze.js'],
  'follow.html': ['js/capture.js', 'js/follow-state.js', 'js/follow.js']
};
const scripts = new Set(['desktop/main.js', 'desktop/lib/local-site.js', 'desktop/lib/analyzer-adapter.js']);
for (const [file, needed] of Object.entries(required)) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  if (/^(?:<<<<<<< |=======|>>>>>>> )/m.test(html)) throw new Error(`${file}: unresolved merge conflict`);
  const loaded = [...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^" ]*)?"/g)].map(m=>m[1]);
  for (const item of needed) if (loaded.filter(x=>x===item).length !== 1) throw new Error(`${file}: must load ${item} exactly once`);
  if (loaded.indexOf(needed[needed.length-2]) > loaded.indexOf(needed[needed.length-1])) throw new Error(`${file}: enhancement must load before its consumer`);
  for (const script of loaded) if (!/^(?:https?:)?\/\//.test(script)) scripts.add(script);
}
for (const script of scripts) run(['--check', script]);
const tests = fs.readdirSync(__dirname).filter(name=>/^test-.*\.js$/.test(name)).sort();
if (!tests.length) throw new Error('No portable enhancement regressions found');
for (const test of tests) run([path.join('tools', test)]);
console.log(`Enhanced integration gate passed: ${tests.length} test files and real entrypoint syntax/load checks.`);
