/* Pure log state. Every sound and vault cue can match exactly one opposite cue. */
(function (root) {
  'use strict';
  function create() {
    let state;
    const reset = () => { state = { rainbows: 0, taken: 0, giftOpen: false, lastGift: 0, epoch: (state ? state.epoch : 0) + 1, day: null, sounds: [], slots: [], lit: new Map(), seen: new Set(), sequence: 0 }; };
    reset();
    function snapshot() {
      return { rainbows: state.rainbows, taken: state.taken, epoch: state.epoch, sequence: state.sequence, giftOpen: state.giftOpen, lastGift: state.lastGift, day:state.day };
    }
    function restore(v) {
      if(!v || !['rainbows','taken','epoch'].every(k=>Number.isInteger(v[k]) && v[k]>=0 && v[k]<100000))return false;
      state.rainbows=v.rainbows;state.taken=v.taken;state.epoch=v.epoch;
      state.sequence=Number.isInteger(v.sequence)?v.sequence:0;state.giftOpen=!!v.giftOpen;
      state.lastGift=Number.isFinite(v.lastGift)?v.lastGift:0;state.day=Number.isInteger(v.day)?v.day:null;
      state.sounds=(v.sounds||[]).filter(Number.isFinite).slice(-16);state.slots=(v.slots||[]).filter(Number.isFinite).slice(-16);
      state.lit=new Map((v.lit||[]).filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isFinite(x[1])).slice(-32));
      state.seen=new Set();return true;
    }
    const checkpoint=()=>Object.assign(snapshot(),{sounds:state.sounds.slice(),slots:state.slots.slice(),lit:[...state.lit]});
    function accept(line, at) {
      const day = /\[S16LastDay\] check cur=(\d+) max=([1-9]\d*)/.exec(line);
      if (day) {
        const n = +day[1];
        if ((state.day !== null && n < state.day) || (n === 0 && state.day === null && (state.rainbows || state.taken))) reset();
        state.day = n;
      }
      const key = `${at}:${line}`;
      if (state.seen.has(key)) return snapshot();
      state.seen.add(key);
      // Bound replay deduplication; exact duplicate lines in a polling burst remain covered.
      if (state.seen.size > 4096) state.seen.delete(state.seen.values().next().value);
      state.sequence += 1;
      if (/S16BoardColoredPop Run\b/.test(line)) state.giftOpen = true;
      if (/ColoredPop_Confirm/.test(line) && state.giftOpen) {
        state.taken += 1;
        state.lastGift = at;
        state.giftOpen = false;
      }
      const vault = /Anim_Archive_LightUp, Id = (\S+)/.exec(line);
      const sound = /UI_S16_Premium_Quality_Fly/.test(line);
      if ((vault || sound) && Number.isFinite(at)) {
        state.sounds = state.sounds.filter((t) => Math.abs(at - t) <= 1500);
        state.slots = state.slots.filter((t) => Math.abs(at - t) <= 1500);
        if (vault && state.lit.has(vault[1]) && Math.abs(at - state.lit.get(vault[1])) < 2000) return snapshot();
        if (vault) state.lit.set(vault[1], at);
        const opposite = vault ? state.sounds : state.slots;
        if (opposite.length) opposite.shift();
        else {
          state.rainbows += 1;
          (vault ? state.slots : state.sounds).push(at);
        }
      }
      return snapshot();
    }
    return { accept, reset, snapshot, restore, checkpoint };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusFollowState = api;
})(typeof window !== 'undefined' ? window : globalThis);
