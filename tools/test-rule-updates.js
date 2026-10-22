'use strict';
const assert = require('node:assert/strict');
const T = require('../js/engine');
const S = require('../js/solver');

function board(tiers, tools = []) {
  const st = T.newGame({seed: 'updated-rules', params: {startTools: 0, rewards: false, eventStartChance: 0, eventActionChance: 0}});
  st.cells.forEach(c => Object.assign(c, {sealed: c.n !== T.OFFICE, inmate: null, hidden: null, ivory: false, prey: null, event: null}));
  tiers.forEach((tier, i) => Object.assign(st.cells[i + 1], {sealed: false, inmate: {id: 1000 + i, beast: 'rat', tier}}));
  Object.assign(st, {position: 1, phase: 'manage', tools, pending: [], event: null, chaining: null, used: {swap: 0, devour: 0}});
  return st;
}

// Removing both higher-tier neighbours must not create a Maiden bonus.
const unbalanced = board([0, 1, 2], ['maiden', 'scapegoat']);
unbalanced.params.swapWeights = [0, 1, 0, 0, 0];
assert(T.swap(unbalanced, 1).ok);
assert.equal(unbalanced.cells[1].inmate.tier, 1);
assert.equal(unbalanced.log.some(e => e.x?.type === 'maiden'), false);
assert.equal(unbalanced.cells.filter(c => c.inmate).length, 1);

// The replaced Magic is balanced, even though its Normal newcomer is not.
const balanced = board([1, 0, 2], ['maiden']);
balanced.params.swapWeights = [1, 0, 0, 0, 0];
assert(T.swap(balanced, 1).ok);
assert.equal(balanced.cells[1].inmate.tier, 3);
assert(balanced.log.some(e => e.x?.type === 'maiden'));

// A balanced newcomer does not qualify an unbalanced replaced inmate.
const newcomer = board([0, 0, 2, 2, 4], ['maiden']);
newcomer.params.swapWeights = [0, 0, 1, 0, 0];
assert(T.swap(newcomer, 1).ok);
assert.equal(newcomer.cells[1].inmate.tier, 2);
assert.equal(newcomer.log.some(e => e.x?.type === 'maiden'), false);

const meal = board([1, 1, 1, 2]);
meal.cells[1].inmate.beast = 'mammoth';
meal.cells[2].inmate.beast = 'lion';
meal.cells[3].inmate.beast = 'wolf';
meal.cells[4].inmate.beast = 'lion';
meal.used.mealOnly = [3];
assert.deepEqual(T.startOptions(meal).map(o => o.cell), [3]);
assert(S.candidates(meal).filter(o => o.action.type === 'devour').every(o => o.action.to === 3));
const before = T.serialize(meal);
assert.equal(T.devour(meal, 1, 2).ok, false);
assert.equal(T.serialize(meal), before);
assert(T.devour(meal, 1, 3).ok);
assert.equal(meal.used.mealOnly, null);
assert(T.chainOptions(meal).some(o => o.cell === 4), 'the next meal must not inherit the old picker restriction');
meal.used.mealOnly = [];
assert.deepEqual(T.chainOptions(meal), []);
assert.equal(T.chainBite(meal, 4).ok, false);

function beastShare(odds) {
  let beasts = 0, total = 0;
  for (let i = 0; i < 1000; i++) {
    const st = T.newGame({seed: 'offer-odds-' + i, params: {startTools: 1, beastToolOdds: odds}});
    const offer = st.pending.find(p => p.kind === 'tool');
    assert.equal(new Set(offer.options).size, 3);
    total += offer.options.length;
    beasts += offer.options.filter(id => T.BEAST_TOOLS.includes(id)).length;
  }
  return beasts / total;
}
const rare = beastShare(12), equal = beastShare(100);
assert(rare > .02 && rare < .09, `weighted beast instrument share: ${rare}`);
assert(equal > .18 && equal < .34, `equal instrument share: ${equal}`);
// Hunt cannot promise mornings after the Riot, including custom run lengths.
for (const maxDays of [21, 9]) {
  const hunt = board([2, 2], ['trap']);
  hunt.cells[1].inmate.beast = 'lion';
  hunt.maxDays = maxDays;
  hunt.day = maxDays - 1;
  assert.equal(S.decide(hunt).type, 'hunt', 'one remaining morning still pays');
  hunt.prey = [{lion: hunt.cells[1].inmate.id, prey: hunt.cells[2].inmate.id, preyBeast: 'rat', rounds: 3, next: maxDays}];
  const longMark = S.devourScores(hunt, S.context(hunt))[0].score;
  hunt.prey[0].rounds = 1;
  assert.equal(S.devourScores(hunt, S.context(hunt))[0].score, longMark, 'only one morning fits');
  hunt.day = maxDays;
  const expired = S.devourScores(hunt, S.context(hunt))[0].score;
  hunt.prey = [];
  assert.equal(S.devourScores(hunt, S.context(hunt))[0].score, expired, 'expired marks must not penalize eating');
  assert.notEqual(S.decide(hunt).type, 'hunt', 'a last-day Hunt has no return');
  const tiers = hunt.cells.filter(c=>c.inmate).map(c=>c.inmate.tier);
  assert(T.hunt(hunt, 2).ok);
  assert(T.endDay(hunt).ok);
  assert.equal(hunt.phase, 'ended');
  assert.deepEqual(hunt.cells.filter(c=>c.inmate).map(c=>c.inmate.tier), tiers, 'Riot precedes another morning');
}
console.log('rule updates: Maiden, framed meals, weighted offers and Hunt morning horizon passed');
