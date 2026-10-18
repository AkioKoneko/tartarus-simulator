'use strict';
const assert = require('node:assert/strict');
const T = require('../js/engine');
const S = require('../js/solver');

function board(inmates, tools = []) {
  const st = T.newGame({ seed: 'gift-effect-test' });
  st.cells.forEach(c => Object.assign(c, { sealed: c.n !== T.OFFICE, inmate: null, hidden: null, scratch: false }));
  inmates.forEach(([n, beast, tier], id) => Object.assign(st.cells[n], { sealed: false, inmate: { id: id + 1, beast, tier } }));
  st.tools = tools;
  st.position = 6;
  st.phase = 'manage';
  st.pending = [{ kind: 'gift', options: T.GIFT_IDS.slice() }];
  st.chaining = null;
  return st;
}

for (const inmates of [[[8, 'rat', 3]], [[4, 'lion', 1], [10, 'rat', 0], [14, 'lion', 4]]]) {
  const st = board(inmates, ['rope', 'maiden']);
  const before = JSON.stringify(st);
  const text = S.actionEffect(st, { type: 'choose', id: 'horn' });
  assert.match(text, /Horn would do nothing/);
  assert.match(text, /uses one Treasure pick without changing the board/);
  assert.match(text, /can be intentional/);
  assert.equal(JSON.stringify(st), before, 'explanation must not play a move');
  const cells = JSON.stringify(st.cells);
  assert(T.choose(st, 'horn').ok);
  assert.equal(JSON.stringify(st.cells), cells, 'the described Horn has no immediate effect');
}
const alone = board([[8, 'rat', 3]]);
assert.match(S.actionEffect(alone, { type: 'choose', id: 'brand' }), /no compatible meal|No hungry inmate has a compatible meal/);
assert.match(S.actionEffect(alone, { type: 'choose', id: 'wine' }), /without changing the board/);
assert.doesNotMatch(S.actionEffect(board([[8, 'rat', 1]]), { type: 'choose', id: 'wine' }), /without changing the board/);
assert.doesNotMatch(S.actionEffect(board([[8, 'wolf', 2], [9, 'rat', 2]]), { type: 'choose', id: 'horn' }), /without changing the board/);
const walk = board([], ['shortchain']);
walk.pending = [];
assert.match(S.actionEffect(walk, { type: 'patrol', cell: 8 }), /2-cell walk has a 50% chance/);
assert.match(S.actionEffect(walk, { type: 'patrol', cell: 10 }), /4-cell walk cannot trigger/);
walk.tools = [];
assert.equal(S.actionEffect(walk, { type: 'patrol', cell: 8 }), '');
walk.tools = ['shortchain'];
assert.equal(S.actionEffect(walk, { type: 'end' }), '');
assert.equal(S.actionEffect(walk, { type: 'choose', id: 'shortchain' }), '', 'tool choices are not Treasure gifts');
console.log('action effects: recorded board shapes, actual transitions, meal/rarity negatives and equipped-tool walks passed');

const tie = board([], ['shortchain']);
tie.pending = []; tie.phase = 'patrol'; tie.destinations = [8, 10];
const long = { action: { type: 'patrol', cell: 10 }, mean: 3.38, gapSe: 0.15 };
const short = { action: { type: 'patrol', cell: 8 }, mean: 3.39, gapSe: 0 };
assert.equal(S.preferShortWalk(tie, [short, long], long, 0.05), short);
assert.equal(S.preferShortWalk(tie, [{ ...long, mean: 4, gapSe: 0 }, { ...short, mean: 3, gapSe: 0.01 }], { ...long, mean: 4, gapSe: 0 }, 0.05), null, 'clear long-walk advantage stands');
assert.equal(S.preferShortWalk(tie, [{ ...long, mean: 3.4 }, short], { ...long, mean: 3.4 }, 0.05), null, 'do not prefer a lower-estimated short walk');
tie.destinations = [10];
assert.equal(S.preferShortWalk(tie, [short, long], long, 0.05), null, 'only offered destinations qualify');
tie.destinations = [8, 10]; tie.tools = [];
assert.equal(S.preferShortWalk(tie, [short, long], long, 0.05), null, 'only the equipped instrument enables this preference');
tie.tools = ['shortchain']; tie.cells.forEach(c => c.sealed = false);
assert.equal(S.preferShortWalk(tie, [short, long], long, 0.05), null, 'a proc needs another locked cell');
console.log('short-walk preference: offered proc, clear advantage, lower estimate, missing tool and exhausted doors passed');
