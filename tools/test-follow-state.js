'use strict';
const assert = require('node:assert/strict');
const { create } = require('../js/follow-state');
const sound = 'UI_S16_Premium_Quality_Fly';
const slot = id => `Anim_Archive_LightUp, Id = ${id}`;
const open = 'S16BoardColoredPop Run', confirm = 'Btn_S16Board_ColoredPop_Confirm';
for (const events of [
  [[sound, 1000], [slot('a'), 1000], [slot('b'), 1000], [sound, 2000]],
  [[slot('a'), 1000], [slot('b'), 1000], [sound, 1000], [sound, 2000]],
  [[sound, 1000], [sound, 2000], [slot('a'), 1000], [slot('b'), 1000]],
]) {
  const state = create();
  for (const [line, at] of events) state.accept(line, at);
  assert.equal(state.snapshot().rainbows, 2, 'Each cue pairs once');
  state.accept(slot('a'), 2100);
  assert.equal(state.snapshot().rainbows, 2, 'Repeated slot animation is harmless');
  state.accept(open, 3000); state.accept(confirm, 3100); state.accept(confirm, 3101);
  state.accept('S16BoardColoredPop Destory', 3200);
  state.accept(open, 4000); state.accept(confirm, 4100);
  assert.equal(state.snapshot().taken, 2, 'Only an open gift accepts confirmation');
  state.accept('[S16LastDay] check cur=10 max=20', 5000);
  const epoch = state.snapshot().epoch;
  state.accept('[S16LastDay] check cur=0 max=20', 6000);
  assert.equal(state.snapshot().rainbows, 0);
  assert.equal(state.snapshot().taken, 0);
  assert.equal(state.snapshot().epoch, epoch + 1);
}
const duplicate = create(); duplicate.accept(sound, 0); duplicate.accept(sound, 0);
assert.equal(duplicate.snapshot().rainbows, 1);
duplicate.accept(slot('later'), 4001);
assert.equal(duplicate.snapshot().rainbows, 2, 'Old cues cannot pair outside the window');
for(const events of [
  [[sound,1000],[sound,1100],[slot('one'),1200]],
  [[slot('one'),1000],[sound,1100],[sound,1200]],
  [[sound,1000],[slot('one'),1100],[sound,1200]],
]) {
  const burst=create();for(const [line,at]of events)burst.accept(line,at);
  assert.equal(burst.snapshot().rainbows,1,'Two sounds and one vault cue are one Rainbow, in either order');
  burst.accept(sound,1300);burst.accept(sound,1400);burst.accept(slot('two'),1500);
  assert.equal(burst.snapshot().rainbows,2,'Four sounds and two different vault slots are two Rainbows');
}
const audioOnly=create();for(const at of [1000,1100,1200,1300])audioOnly.accept(sound,at);
assert.equal(audioOnly.snapshot().rainbows,2,'Missing vault events use half the sound count');
const original = create(); original.accept(sound, 5000);
const resumed = create(); assert.equal(resumed.restore(original.checkpoint()), true);
resumed.accept(slot('resumed'), 5100);
assert.equal(resumed.snapshot().rainbows, 1);
resumed.accept(sound,5200);
assert.equal(resumed.snapshot().rainbows,1,'Restore keeps the burst so its second sound cannot create another Rainbow');
const saved = create();
assert.equal(saved.restore({ rainbows: 3, taken: 6, epoch: 2, day: 14, giftOpen: true, lastGift: 1000 }), true);
saved.accept(confirm, 2000); saved.accept(confirm, 2001);
assert.equal(saved.snapshot().taken, 7);
const before = saved.snapshot();
assert.equal(saved.restore({ rainbows: -1, taken: 0, epoch: 1 }), false);
assert.deepEqual(saved.snapshot(), before);
console.log('PASS cue pairing, duplicate protection, restore and run reset');
