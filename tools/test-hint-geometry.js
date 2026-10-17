'use strict';
const assert = require('node:assert/strict');
const { transform } = require('../desktop/lib/hint-geometry');
const bounds = { x: 100, y: 200, width: 2560, height: 1440 };
const packet = { valid: true, width: 2560, height: 1440, targets: [{ x: 1280, y: 720, radius: 50 }] };
const half = b => ({ x: b.x / 2, y: b.y / 2, width: b.width / 2, height: b.height / 2 });
const before = JSON.stringify(packet), result = transform(packet, bounds, half);
assert.deepEqual(result.bounds, { x: 50, y: 100, width: 1280, height: 720 });
assert.equal(result.payload.targets[0].x, 640);
assert.equal(result.payload.targets[0].y, 360);
assert.equal(result.payload.targets[0].radius, 25);
assert.equal(JSON.stringify(packet), before);
assert.equal(transform(packet, { ...bounds, width: 800, height: 800 }, b => b), null);
assert.equal(transform({ ...packet, valid: false }, bounds, half), null);
assert.equal(transform(packet, bounds, () => null), null);
const underline = { x: 1280, y: 1200, radius: 6, width: 240, height: 12, shape: 'underline', kind: 'button', priority: 'primary' };
const marker = transform({ ...packet, targets: [underline] }, bounds, half).payload.targets[0];
assert.equal(marker.width, 120); assert.equal(marker.height, 6); assert.equal(marker.y, 600);
assert.equal(transform({ ...packet, targets: [{ ...underline, width: NaN }] }, bounds, half).payload.visible, false);
const route = Array.from({ length: 6 }, (_, i) => ({ kind: 'cell', x: 200 + i * 220, y: 600, radius: 60, chainStep: i + 1, chainState: i ? 'planned' : 'current' }));
assert.equal(transform({ ...packet, targets: [underline, ...route] }, bounds, half).payload.targets.length, 7);
for (const damage of [a => { a[2].chainStep = 1; }, a => { a.splice(1, 1); }, a => { a[2].chainState = 'current'; }, a => { a[2].x = NaN; }, a => { a[2].kind = 'button'; }, a => { delete a[2].chainState; }]) {
  const broken = route.map(t => ({ ...t })); damage(broken);
  assert.equal(transform({ ...packet, targets: broken }, bounds, half), null, 'Incomplete route fails closed');
}
console.log('PASS DPI, aspect, underline and complete route validation');
