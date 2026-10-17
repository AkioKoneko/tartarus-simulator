/* Conservative display helpers. Never send input or roll an unseen future. */
(function (root) {
  'use strict';
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
      return active.length ? active.concat(firstMealPreview()) : [];
    }
    if (a.type === 'devour' || a.type === 'chain') {
      const offered = r.chain && r.chain.targets;
      return Array.isArray(offered) && offered.includes(a.to) ? cell(a.to) : [];
    }
    if (a.type === 'office' && r.decision && r.decision.office && ['instigate', 'bestow'].includes(a.choice)) return button(a.choice);
    if (a.type === 'swap' && r.decision && r.decision.replace) return button('replace');
    if (a.type === 'end' && r.decision && !r.decision.office && !r.decision.ratway) return button('end');
    return [];
  }

  const api = { buildTargets };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusAssist = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
