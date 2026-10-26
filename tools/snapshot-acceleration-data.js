#!/usr/bin/env node
'use strict';
// Explicit deterministic snapshot of the existing JS owners; no game data.
const fs=require('node:fs'),path=require('node:path');
function snapshot(){const T=require('../js/engine.js'),S=require('../js/solver.js'),combos=require('../js/tool-combos.js');return {params:T.DEFAULT_PARAMS,tools:T.TOOL_IDS,beastTools:T.BEAST_TOOLS,events:T.EVENT_POOL,objectives:T.OBJECTIVES,defaults:S.DEFAULTS,profiles:S.PROFILES,combos};}
module.exports=snapshot;
if(require.main===module){const file=path.join(__dirname,'../native/tartarus/data.json'),wanted=JSON.stringify(snapshot(),null,2)+'\n';if(process.argv.includes('--check')){const actual=JSON.parse(fs.readFileSync(file));if(JSON.stringify(actual)!==JSON.stringify(snapshot()))throw Error('Native constant snapshot differs from current JS. Review and regenerate it before rebuilding.');console.log('Native constants match the JS reference.');}else{fs.writeFileSync(file,wanted);console.log('Updated native reference constants; review the port, rebuild, and run parity before activation.');}}
