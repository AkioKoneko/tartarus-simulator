/* Display-only coordinates from main, already converted to window-relative DIP. */
(function () {
  'use strict';
  const layer = document.getElementById('hints');
  const bridge = window.TartarusHints || window.Hints;

  function render(payload) {
    layer.replaceChildren();
    layer.hidden = true;
    if (!payload || payload.visible !== true || !Number.isFinite(payload.width) || payload.width <= 0 ||
      !Number.isFinite(payload.height) || payload.height <= 0 || !Array.isArray(payload.targets)) return;
    const { width, height, targets } = payload;
    // Reject the whole frame on malformed geometry rather than showing a partial stale plan.
    if (targets.some((t) => !t || !Number.isFinite(t.x) || !Number.isFinite(t.y) ||
      !Number.isFinite(t.radius) || t.radius <= 0 || t.radius > Math.max(width, height) ||
      t.x < 0 || t.x > width || t.y < 0 || t.y > height ||
      (t.label !== undefined && typeof t.label !== 'string') ||
      (t.kind !== undefined && typeof t.kind !== 'string') ||
      (t.shape === 'underline' && (!Number.isFinite(t.width) || !Number.isFinite(t.height) || t.width<=0 || t.height<=0)) ||
      (t.priority !== undefined && !['primary','reference'].includes(t.priority)))) return;
    const chain = targets.filter((t) => t.chainStep !== undefined || t.chainState !== undefined);
    // A damaged chain must not leave an apparently complete route on screen.
    if (chain.some((t) => t.kind !== 'cell' || t.shape === 'underline' ||
      !Number.isInteger(t.chainStep) || t.chainStep < 1 || t.chainStep > 6 ||
      !['current', 'planned'].includes(t.chainState) ||
      (t.chainState === 'current' && t.chainStep !== 1))) return;
    chain.sort((a, b) => a.chainStep - b.chainStep);
    if (chain.some((t, index) => t.chainStep !== index + 1)) return;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    const fragment = document.createDocumentFragment();
    if (chain.length > 1) fragment.append(connectors(chain, width, height));
    targets.forEach((t, index) => {
      const ring = document.createElement('div');
      ring.className = 'target';
      if (t.kind) ring.dataset.kind = t.kind;
      if(t.shape)ring.dataset.shape=t.shape;
      if(t.priority)ring.dataset.priority=t.priority;
      if (t.chainStep !== undefined) {
        ring.dataset.chainStep = String(t.chainStep);
        ring.dataset.chainState = t.chainState;
      }
      const rw=t.shape==='underline'?t.width:t.radius*2, rh=t.shape==='underline'?t.height:t.radius*2;
      ring.style.left = `${t.x - rw/2}px`;
      ring.style.top = `${t.y - rh/2}px`;
      ring.style.width = `${rw}px`;
      ring.style.height = `${rh}px`;
      if (t.chainStep !== undefined) {
        const badge = document.createElement('div');
        badge.className = 'chain-badge';
        badge.dataset.chainStep = String(t.chainStep);
        badge.dataset.chainState = t.chainState;
        const number = String(t.chainStep).padStart(2, '0');
        badge.textContent = t.chainStep === 1 ? `${number} ${t.chainState === 'current' ? 'Now' : 'After Consume'}` : number;
        // Compact badges sit just outside the circle; keep them inside the DIP viewport.
        const badgeWidth = Math.min(t.chainStep === 1 ? 136 : 28, width);
        badge.style.maxWidth = `${badgeWidth}px`;
        badge.style.left = `${Math.max(0, Math.min(width - badgeWidth, t.x - t.radius + 4))}px`;
        badge.style.top = `${Math.max(0, Math.min(height - 23, t.y - t.radius - 24))}px`;
        fragment.append(ring, badge);
        return;
      }
      const callout = document.createElement('div');
      callout.className = 'callout';
      if(t.priority)callout.dataset.priority=t.priority;
      const calloutWidth = Math.min(240, width);
      callout.style.maxWidth = `${calloutWidth}px`;
      callout.style.left = `${Math.max(0, Math.min(width - calloutWidth, t.x - rw/2))}px`;
      const below = t.y + rh/2 + 7;
      callout.style.top = `${below + 40 < height ? below : Math.max(0, t.y - rh/2 - 35)}px`;
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = String(index + 1);
      if(t.priority!=='reference')callout.append(number);
      if (t.label) {
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = t.label;
        callout.append(label);
      }
      fragment.append(ring, callout);
    });
    layer.replaceChildren(fragment);
    layer.hidden = targets.length === 0;
  }

  function connectors(chain, width, height) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'chain-connectors');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(namespace, 'defs');
    const marker = document.createElementNS(namespace, 'marker');
    const attrs = { id: 'chain-arrowhead', viewBox: '0 0 10 10', refX: '10', refY: '5', markerWidth: '9', markerHeight: '9', markerUnits: 'userSpaceOnUse', orient: 'auto' };
    for (const [key, value] of Object.entries(attrs)) marker.setAttribute(key, value);
    const tip = document.createElementNS(namespace, 'path');
    tip.setAttribute('d', 'M 1 1 L 10 5 L 1 9');
    tip.setAttribute('class', 'chain-arrowhead');
    marker.append(tip);
    defs.append(marker);
    svg.append(defs);
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1];
      const to = chain[i];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const start = from.radius + 6;
      const end = to.radius + 6;
      // Keep both nodes, but never draw a backwards or portrait-crossing arrow.
      if (!Number.isFinite(distance) || distance <= start + end + 10) continue;
      const line = document.createElementNS(namespace, 'line');
      const attrs = { x1: from.x + dx / distance * start, y1: from.y + dy / distance * start,
        x2: to.x - dx / distance * end, y2: to.y - dy / distance * end };
      for (const [key, value] of Object.entries(attrs)) line.setAttribute(key, String(value));
      line.setAttribute('class', 'chain-arrow');
      line.setAttribute('data-from-step', String(from.chainStep));
      line.setAttribute('data-to-step', String(to.chainStep));
      line.setAttribute('marker-end', 'url(#chain-arrowhead)');
      svg.append(line);
    }
    return svg;
  }

  if (bridge && typeof bridge.onHints === 'function') bridge.onHints(render);
})();
