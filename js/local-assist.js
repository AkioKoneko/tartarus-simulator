/* Conservative display helpers. Never send input or roll an unseen future. */
(function (root) {
  'use strict';
  const RANDOM_CONSUME = new Set(['saw', 'whip', 'collar', 'revenge', 'cage']);
  const pending = (st) => !!(st.pending && st.pending.length);
  const knownTools = (st, T) => Array.isArray(st.tools) && T && Array.isArray(T.TOOL_IDS) && st.tools.every((id) => T.TOOL_IDS.includes(id));
  const copy = (st) => JSON.parse(JSON.stringify(st));
  // Missing/unknown odds are not evidence of determinism. The current engine
  // can add a visible event after any walk, without an instrument proc.
  const randomEvent = (st, key) => !st.params || !Number.isFinite(st.params[key]) || st.params[key] !== 0;
  function noWalkEventSlot(st, T, steps) {
    // Only the pre-walk shortcut may use current occupancy. After a bite the
    // consumed cell seals, and a sampled spawn may already occupy that slot.
    if (!Array.isArray(st.cells) || st.cells.length !== T.CELL_COUNT) return false;
    for (let n=0;n<T.CELL_COUNT;n++) {
      const c=st.cells[n];
      if (!c || c.n!==n || typeof c.sealed!=='boolean') return false;
      if (n!==T.OFFICE && c.sealed && !c.event && !c.nest) return false;
    }
    // A walk promotion can vault an inmate and create a newly sealed slot
    // before spawnEvent. Keep that branch behind the conservative gate.
    if (st.tools.includes('shackles') && steps>=4 && st.cells.some(c=>!c.sealed && c.inmate)) return false;
    return true;
  }

  function travelPreview(st, action, T, S) {
    const stop = (reason) => ({reason});
    const office=action.cell===T.OFFICE;
    const destination=st.cells && st.cells[action.cell];
    if(!office && (!destination || destination.sealed || !destination.inmate || destination.event)) return stop('Read the destination before planning its action.');
    if (!knownTools(st,T)) return stop('Confirm the instruments before planning the room choice.');
    if (st.phase !== 'patrol' || !st.destinations || !st.destinations.includes(action.cell) || st.ratway || st.event || st.chaining || st.challenge && st.challenge.window) return stop('Finish the current decision before planning the room choice.');
    if (st.startEvent && !['none', ...Object.keys(T.START_EVENTS || {})].includes(st.startEvent)) return stop('The starting effect is unknown.');
    if (office && st.startEvent === 'tyranny') return stop('Tyranny changes the board before the room choice.');
    if (st.chain) return stop('Chain reaction opens doors on the way.');
    const steps=T.stepsBetween(st.position,action.cell);
    if (randomEvent(st,'eventWalkChance') && !noWalkEventSlot(st,T,steps)) return stop('A random Prison Incident may appear after the walk. Read the arrival board before choosing.');
    if (st.tools.includes('shortchain') && steps<=3 && st.cells.some(c=>c.sealed)) return stop('Short-Chained Shackles may open an unknown door on the way.');
    const walk=st.objective && st.objective.id==='walk' && !st.milestone;
    const threshold=T.OBJECTIVES && T.OBJECTIVES.walk && T.OBJECTIVES.walk.need;
    if (walk && !Number.isFinite(threshold)) return stop('The walking objective is unknown; read the arrival board.');
    if (walk && st.params && st.params.rewards && T.TOOL_IDS.some(id=>!st.tools.includes(id)) &&
        (!Number.isFinite(st.objective.progress) || st.objective.progress+steps>=threshold)) return stop('Prison Walk may require an instrument choice before the room choice.');
    if (!S || !S.clone || !S.apply || !S.instant) return stop('Read the room before choosing.');
    const pool=st.tools.includes('shackles') && steps>=4 ? st.cells.filter(c=>!c.sealed && c.inmate && c.inmate.tier<T.RAINBOW) : [];
    const expected=new Set(['none',...pool.map(c=>String(c.n))]);
    const seen=new Set();
    let next=null,arrival=null;
    // For Long-Chained Shackles the complete outcome space is no proc or
    // one tier for each eligible inmate. Seeds locate those engine outcomes;
    // a plan is returned only after every outcome is actually covered.
    for(let i=0;i<(pool.length?128:1);i++) {
      const preview=S.clone(copy(st));
      preview.rng=Math.imul(i+1,0x9e3779b1)>>>0;
      const result=S.apply(preview,action);
      if(!result || !result.ok || preview.phase!==(office?'office':'manage')) return stop('Read the room before choosing.');
      if(pending(preview)) return stop('A reward may require a choice on the way; finish it before choosing in the room.');
      // Rewards or changed occupancy are not described by a promote.cell key.
      if((result.events||[]).some(e=>e.type==='rainbow' || e.type==='open')) return stop('The walk can change doors or create a Rainbow; read the resulting board.');
      const rises=(result.events||[]).filter(e=>e.type==='promote');
      const outcome=rises.length===0?'none':rises.length===1?String(rises[0].cell):'unknown';
      if(!expected.has(outcome)) return stop('The walk has another effect; read the resulting board.');
      if(seen.has(outcome))continue;
      const pick=S.instant(preview);
      const valid=pick && pick.action && (office ? pick.action.type==='office' && ['bestow','instigate'].includes(pick.action.choice) : ['swap','devour','end'].includes(pick.action.type));
      if(!valid) return stop('Read the room before choosing.');
      const same=S.sameAction || ((a,b)=>JSON.stringify(a)===JSON.stringify(b));
      if(next && !same(next.action,pick.action)) return stop('Long-Chained Shackles can change which room choice is better.');
      next=next||pick;arrival=arrival||preview;seen.add(outcome);
      if(seen.size===expected.size) return {next,arrival,outcomes:seen.size};
    }
    return stop('Not all walk outcomes were resolved; read the room before choosing.');
  }

  function buildPlan(st, rec, T, S) {
    const plan = { steps: [], note: '' };
    if (!st || !rec || typeof rec.label !== 'string' || !rec.label.trim()) return plan;
    plan.steps.push({ label: rec.label, certainty: 'current' });
    const action = rec.action;
    if (st.mode && st.mode !== 'drill') {
      plan.note = 'This run mode is not supported by the current engine. Read the board before planning another action.';
      return plan;
    }
    if (!action || pending(st)) {
      plan.note = 'Resolve the current choice, then read the board again.';
      return plan;
    }
    const wait = 'Read the resulting board before choosing the next action.';
    if (action.type === 'stopchain') {
      plan.steps[0].label = 'Press Cancel on the meal picker';
      plan.steps.push({label: st.day >= st.maxDays ? 'Finish the run' : 'End the day', action:{type:'end'}, certainty:'planned'});
      plan.headline = st.day >= st.maxDays ? 'Cancel → Finish the run' : 'Cancel → End the day';
      plan.note = 'Cancel closes the picker; this advice means stop eating for today. Confirm End on the resulting board.';
      return plan;
    }
    if (action.type === 'patrol' && T && (action.cell === T.OFFICE || st.cells && st.cells[action.cell] && !st.cells[action.cell].sealed && st.cells[action.cell].inmate)) {
      const office=action.cell===T.OFFICE;
      const result=travelPreview(st,action,T,S);
      if (result.next) {
        const next=result.next;
        plan.steps.push({label:next.label,action:next.action,certainty:'planned'});
        const choice=office ? (next.action.choice==='bestow'?'Bestow':'Instigate') : next.label;
        plan.headline=`${rec.label.replace(/\s*\(Instigate or Bestow\)\s*$/,'')} → ${choice}`;
        plan.note=result.outcomes>1
          ? `The same room choice is planned for all ${result.outcomes} Shackles outcomes. Confirm it against the board on arrival.`
          : office ? 'Room choice planned from the current board; confirm it on arrival. Stop after this choice: its result is random.' : 'Arrival action planned from the known board; confirm it on arrival.';
        plan.outcomes=result.outcomes;
        // A deterministic Cage Fight chain can follow a deterministic walk.
        // Never apply Replace, End the day, or any random consume here.
        if(!office && result.outcomes===1 && next.action.type==='devour') {
          const chain=buildPlan(result.arrival,next,T,S);
          for(const step of chain.steps.slice(1)) {
            if(step.certainty!=='confirmed' || plan.steps.length>=6)break;
            plan.steps.push(Object.assign({},step,{certainty:'planned'}));
          }
        }
      } else {
        plan.steps.push({label:office?'Choose Bestow or Instigate after the arrival check.':'Check Consume or Replace on arrival.',certainty:'recheck'});
        plan.note=result.reason;
      }
      return plan;
    }
    if (action.type === 'devour' || action.type === 'chain') {
      if (st.startEvent !== 'cagefight' || !knownTools(st,T) || st.tools.some(id=>RANDOM_CONSUME.has(id))) {
        plan.steps.push({ label: 'If a consume chain opens, check its available meals.', certainty: 'conditional' });
        plan.note = `Consume outcomes can change the available meals. ${wait}`;
        return plan;
      }
      if (!S || !S.clone || !S.apply || !S.instant) return plan;
      const firstMeal = st.cells && st.cells[action.to];
      if (!firstMeal || firstMeal.sealed || !firstMeal.inmate) { plan.note = wait; return plan; }
      plan.consumeChain = true;
      const preview = S.clone(copy(st));
      let nextAction = action;
      while (plan.steps.length < 6) {
        const meal = preview.cells && preview.cells[nextAction.to];
        // A scratched/hidden meal can cause a random reveal: no preview.
        if (!meal || meal.sealed || !meal.inmate) { plan.note = wait; break; }
        const applied = S.apply(preview, nextAction);
        if (!applied || !applied.ok || pending(preview)) { plan.note = wait; break; }
        if (!preview.chaining) {
          if (randomEvent(preview,'eventActionChance')) {
            // acted() only spawns after the chain finishes; no event is
            // inserted between its bites. The spawned event is on a locked
            // door, so an otherwise sole legal End remains the same action.
            // Do not use one sampled event board to select any other action.
            const options=typeof S.candidates==='function' ? S.candidates(preview) : [];
            if(options.length===1 && options[0].action && options[0].action.type==='end') {
              plan.steps.push({label:options[0].label,action:options[0].action,certainty:'confirmed'});
            }
            plan.note='A random Prison Incident may appear when the consume chain ends. Recheck before any other action; End the day does not predict the next morning.';
            break;
          }
          const final=S.instant(preview);
          if(final && final.action && final.action.type==='end') plan.steps.push({label:final.label,action:final.action,certainty:'confirmed'});
          break;
        }
        const next = S.instant(preview);
        if (!next || !next.action || !['chain', 'stopchain'].includes(next.action.type) || typeof next.label !== 'string') break;
        if (next.action.type === 'stopchain' && randomEvent(preview,'eventActionChance')) plan.note='Cancel can finish the chain and spawn a random Prison Incident. Read the board before choosing another action.';
        if (next.action.type === 'chain') {
          const target = preview.cells && preview.cells[next.action.to];
          if (!target || target.sealed || !target.inmate) { plan.note = wait; break; }
        }
        plan.steps.push({ label: next.label, action:next.action, certainty: 'confirmed' });
        if (next.action.type === 'stopchain') break;
        nextAction = next.action;
      }
      if (!plan.note) plan.note = 'These steps assume the visible board and instruments are correct; recheck after the sequence.';
      return plan;
    }
    plan.note = wait;
    return plan;
  }

  function buildTargets(st, rec, reading, plan) {
    const r = reading && reading.result;
    const a = rec && rec.action;
    if (!st || !a || !r || r.ok === false) return [];
    const label = typeof rec.label === 'string' ? rec.label : a.type;
    function lowerButton(b) {
      if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
        b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0) return [];
      const x = b.x + b.width / 2;
      // Labels sit near the lower edge of the game's cards. Keep the marker
      // below that edge and leave the original label and click area unobscured.
      const y = b.y + b.height + Math.max(16,2.5*b.height);
      const width=Math.max(90,Math.min(340,b.width+2*b.height));
      return [{ x,y,width,height:12,radius:6,label,kind:'button',shape:'underline',priority:'primary' }];
    }
    function button(key) {
      return lowerButton(r.decision && r.decision.targets && r.decision.targets[key]);
    }
    if (r.pick && r.pick.ok && st.pending && st.pending[0] && st.pending[0].kind==='tool') {
      if (a.type==='reroll') return r.pick.reroll ? lowerButton(r.pick.rerollTarget) : [];
      if (a.type!=='choose' || !st.pending[0].options.includes(a.id)) return [];
      const cards=r.pick.cards.filter(c=>c.sim===a.id);
      if (cards.length!==1 || cards[0].conf<0.5) return [];
      const b=cards[0].box;
      if (!Array.isArray(b) || b.length!==4 || !b.every(Number.isFinite) || b[0]<0 || b[1]<0 || b[2]<=b[0] || b[3]<=b[1]) return [];
      return [{x:(b[0]+b[2])/2,y:b[3]+20,width:Math.min(400,b[2]-b[0]+40),height:12,radius:6,label,kind:'button',shape:'underline',priority:'primary'}];
    }
    if(a.type==='choose' && st.pending && st.pending[0] && st.pending[0].kind==='gift' && st.pending[0].options.includes(a.id)) {
      const b=r.treasure && r.treasure.ok && r.treasure.targets && r.treasure.targets[a.id];
      if(!b || ![b.x,b.y,b.width,b.height].every(Number.isFinite) || b.x<0 || b.y<0 || b.width<=0 || b.height<=0)return [];
      // Gift titles sit midway down their cards. Put the line immediately
      // below the observed title, above the description, not at a guessed slot.
      return [{x:b.x+b.width/2,y:b.y+b.height+Math.max(8,b.height*0.35),width:Math.min(440,b.width+b.height),height:12,radius:6,label,kind:'button',shape:'underline',priority:'primary'}];
    }
    function cell(n) {
      if (!Number.isInteger(n) || !Array.isArray(r.cells)) return [];
      const c = r.cells.find((entry) => entry && entry.n === n);
      if (!c || ![c.x, c.y, c.k].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.k <= 0) return [];
      // Same cell artwork center and scale used by analyze.drawScan.
      const y = c.y - 40 * c.k;
      const radius = 40 * c.k;
      return Number.isFinite(y) && Number.isFinite(radius) && y >= 0 ? [{ x: c.x, y, radius, label, kind: 'cell' }] : [];
    }
    function mealRoute(management) {
      // Use the existing verified plan, never a second prediction. A doubtful
      // board still gets its normal current-action hint, but no future route.
      if(!reading.allowChain || !plan || !plan.consumeChain || st.startEvent!=='cagefight' ||
          !['devour','chain'].includes(a.type) || !Array.isArray(plan.steps))return null;
      const actions=[{action:a,label:plan.steps[0] && plan.steps[0].label || label}];
      for(const step of plan.steps.slice(1)) {
        if(!step || step.certainty!=='confirmed' || !step.action || step.action.type!=='chain')break;
        actions.push(step);
        if(actions.length===6)break;
      }
      const route=[],seen=new Set();
      for(const [i,step] of actions.entries()) {
        const n=step.action.to,c=st.cells && st.cells[n],raw=r.cells && r.cells.find(entry=>entry && entry.n===n);
        if(seen.has(n) || !c || c.sealed || !c.inmate || !raw || raw.kind!=='inmate' || raw.beast!==c.inmate.beast)break;
        const geometry=cell(n);
        if(!geometry.length)break;
        route.push(Object.assign({},geometry[0],{label:step.label,chainStep:i+1,chainState:!management && i===0?'current':'planned',priority:!management && i===0?'primary':'reference'}));
        seen.add(n);
      }
      return route;
    }
    function firstMealPreview() {
      // This is the target of the current settled recommendation, not a
      // prediction of a later bite. It remains useful without Cage Fight.
      const c=st.cells && st.cells[a.to],raw=r.cells && r.cells.find(entry=>entry && entry.n===a.to);
      if(!c || c.sealed || !c.inmate || !raw || raw.kind!=='inmate' || raw.beast!==c.inmate.beast ||
          Number.isFinite(raw.conf) && raw.conf<0.6)return [];
      return cell(a.to).map(t=>Object.assign({},t,{chainStep:1,chainState:'planned',priority:'reference'}));
    }
    if (a.type === 'patrol') {
      if(st.phase!=='patrol')return [];
      const cards=(r.doors && r.doors.targets || []).filter(t=>t.cell===a.cell);
      const primary=cards.length===1 ? lowerButton(cards[0]) : [];
      if(!primary.length)return cell(a.cell);
      const reference=cell(a.cell).map(t=>Object.assign({},t,{label:`Cell ${String(a.cell+1).padStart(2,'0')}`,priority:'reference'}));
      return primary.concat(reference);
    }
    // On management the real click remains the lower Consume button. The
    // numbered cell route is a preview until the actual target picker opens.
    if (a.type === 'devour' && r.decision && r.decision.consume) {
      const active=button('consume');
      const route=mealRoute(true);
      return active.length ? active.concat(route===null?firstMealPreview():route) : [];
    }
    if (a.type === 'devour' || a.type === 'chain') {
      const offered = r.chain && r.chain.targets;
      return Array.isArray(offered) && offered.includes(a.to) ? mealRoute(false)||cell(a.to) : [];
    }
    if (a.type === 'office' && r.decision && r.decision.office && ['instigate', 'bestow'].includes(a.choice)) return button(a.choice);
    if (a.type === 'swap' && r.decision && r.decision.replace) return button('replace');
    if (a.type === 'end' && r.decision && !r.decision.office && !r.decision.ratway) return button('end');
    return [];
  }

  const api = { buildPlan, buildTargets };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusAssist = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
