/* Tartarus Simulator: Follow my game, in the board analyzer (beta).
 * Follow my game runs on follow.html: the player connects the game log and
 * shares the game window there (js/follow.js). Each picture it takes comes
 * here, to the board analyzer open in the same browser, which reads it into
 * the board, shows what it read and refreshes the advice. The analyzer has
 * no Follow my game controls of its own. Nothing here runs until the player
 * has agreed on follow.html, and pictures never leave the browser. */
(function () {
  'use strict';

  const C = window.TartarusCapture;
  const A = window.TartarusAnalyzer;
  if (!C || !A || typeof BroadcastChannel !== 'function') return;

  // #region receive
  // The analyzer tells Follow my game it's open only once the player has
  // agreed on follow.html, and it reads only the pictures sent to it. What
  // was read is shown, and becomes the board when the player uses it (or
  // at once, if they turned on using each reading without asking); then it
  // asks what to do. Only how the reading went goes back to follow.html.
  // Nothing is sent anywhere else.
  const channel = new BroadcastChannel('tartarus-follow');
  const me = Math.random().toString(36).slice(2);
  let focusedAt = document.hasFocus() ? Date.now() : 0;
  let newest = 0;
  const say = (m) => {
    if (C.agreed()) channel.postMessage(Object.assign({ id: me }, m));
  };
  const announce = () => say({ type: 'here', focusedAt });

  async function onPicture(m) {
    const answer = (patch) => channel.postMessage(Object.assign({ type: 'read', to: m.from, id: m.id }, patch));
    const mine = ++newest;
    let bitmap;
    try {
      bitmap = await createImageBitmap(m.blob);
    } catch (e) {
      answer({ read: { ok: false, reason: 'the picture couldn’t be opened' } });
      return;
    }
    const read = await A.readFrame(bitmap);
    answer({ read });
    // The newest picture wins: an older one still being read is left.
    if (!read.ok || mine !== newest) return;
    const use = () => {
      answer({ state: 'used' });
      if (m.ask) {
        A.ask();
        answer({ asked: true });
      }
    };
    if (m.accept) {
      A.useReading();
      use();
      return;
    }
    answer({ state: 'waiting' });
    A.offerReading(use, (why) => answer({ state: why === 'replaced' ? 'replaced' : 'skipped' }));
  }

  channel.onmessage = (e) => {
    const m = e.data || {};
    if (!C.agreed()) return;
    if (m.type === 'hello') announce();
    else if (m.type === 'frame' && m.to === me && m.blob) onPicture(m).catch((err) => console.error(err));
  };
  window.addEventListener('focus', () => {
    focusedAt = Date.now();
    announce();
  });
  window.addEventListener('pagehide', () => say({ type: 'bye' }));
  announce();
  // #endregion
})();
