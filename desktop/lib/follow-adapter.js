/* Tartarus Overlay: put into follow.html by the app, after the page's own
 * scripts. Auto Screenshot Mode itself is the site's code (js/capture.js and
 * js/follow.js), with its triggers, its agreement and its checks. This only
 * does what the player does by hand in a browser: it connects the log the
 * app found, and shares the game window, which the app picks by its title
 * (main.js). Both wait for the player's agreement on this page, as the
 * site's own code does. It also tells the overlay how Auto Screenshot Mode is
 * doing. */
(function () {
  'use strict';

  const D = window.TartarusDesktop;
  const C = window.TartarusCapture;
  if (!D || !C || window.__tartarusDesktop) return;
  window.__tartarusDesktop = true;

  // #region agreement
  // ---------- The agreement, kept by the app ----------
  // Agreed on this page: the app keeps it, for this version of the page.
  // Then a copy of the page from another address (the local test site), or
  // a new install, doesn't ask again. Turned off on this page: it's off for
  // the app, including where an older agreement is still saved.
  const KEY = 'tartarus-sim:auto:v1';
  const savedPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      return null;
    }
  };
  const writePrefs = (patch) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, savedPrefs() || {}, patch)));
      return true;
    } catch (e) {
      return false;
    }
  };
  (async () => {
    const app = await D.consent();
    const saved = savedPrefs();
    const now = new Date().toISOString();
    if (C.agreed()) {
      const newer = !!(saved && saved.consentAt && app && saved.consentAt > app.at);
      if (app && app.withdrawn && !newer) {
        // Agreed here before it was turned off in the app.
        if (writePrefs({ enabled: false, consent: 0, consentAt: null })) location.reload();
      } else if (!app || app.withdrawn || app.version !== C.CONSENT_VERSION) {
        D.setConsent({ version: C.CONSENT_VERSION, at: (saved && saved.consentAt) || now });
      }
    } else if (saved && saved.enabled === false) {
      if (app && !app.withdrawn) D.setConsent({ withdrawn: true, at: now });
    } else if (app && !app.withdrawn && app.version === C.CONSENT_VERSION) {
      if (writePrefs({ enabled: true, consent: C.CONSENT_VERSION, consentAt: app.at || now })) location.reload();
    }
  })();
  document.addEventListener('click', (e) => {
    if (e.target.closest('#agree-off')) D.setConsent({ withdrawn: true, at: new Date().toISOString() });
  }, true);

  // #endregion
  // #region connect
  // The log as follow.html's code expects a picked file: a handle whose
  // file has a size and slices. The app reads it from disk, read only.
  const handle = {
    kind: 'file',
    name: 'UE_game.log',
    async getFile() {
      const st = await D.logStat();
      if (!st) throw new DOMException('The game log isn’t there.', 'NotFoundError');
      return {
        name: st.name,
        size: st.size,
        slice: (start, end) => ({ arrayBuffer: () => D.logRead(start, end) }),
      };
    },
  };

  let game = { running: false, log: null };
  let logFor = ''; // the log path being followed
  let sharing = false;
  // The player stopped the log or the share on this page: they stay off
  // until the game starts again.
  let stoppedLog = false;
  let stoppedWindow = false;
  const note = (text) => {
    const el = document.getElementById('az-auto-note');
    if (el) el.textContent = text;
  };

  async function sync() {
    if (!C.agreed()) return;
    const st = C.state;
    if (game.log && !stoppedLog && (st.log === 'off' || game.log.path !== logFor)) {
      if (st.log !== 'off') C.stopLog();
      try {
        C.useHandle(handle);
        logFor = game.log.path;
      } catch (e) {
        note(e.message || String(e));
      }
    }
    if (game.running && !stoppedWindow && st.window !== 'on' && !sharing) {
      sharing = true;
      try {
        await C.connectWindow();
      } catch (e) {
        // The game window closed as it was being shared: the next look retries.
      }
      sharing = false;
    }
  }

  // The page's own Stop buttons are the player's: respect them.
  document.addEventListener('click', (e) => {
    const st = C.state;
    if (e.target.closest('#az-auto-log')) stoppedLog = st.log === 'on' || st.log === 'starting';
    if (e.target.closest('#az-auto-win')) stoppedWindow = st.window === 'on';
  }, true);

  // In the app, a log dragged onto this page, or chosen with its button,
  // goes to the app's own reader: it reads the log wherever the game is
  // installed, and never needs the browser's leave again.
  document.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length !== 1 || !/\.log$/i.test(files[0].name)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stoppedLog = false;
    note(D.useLogFile(files[0]) ? `Using ${files[0].name}: the app reads it.` : 'The app can’t find that file on this PC. Choose it with the button instead.');
  }, true);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#az-auto-log')) return;
    const st = C.state;
    if (st.log === 'on' || st.log === 'starting') return; // Stop following: the page's own
    e.preventDefault();
    e.stopImmediatePropagation();
    stoppedLog = false;
    D.pickLog();
  }, true);

  // #endregion
  // The Riot: after the last day, the screen with the monsters to fight
  // (S16GamePlayCheckOut, with its Riot sound) folds the overlay until the
  // fight is over; the prison's own screens unfold it again. Only these
  // facts go to the app, never the log's lines.
  const RIOT = /S16GamePlayCheckOut Run|UI_S16_Riot_Interface/;
  const PRISON = /S16GamePlayEntry Run|Btn_S16GamePlay_Start|S16BoardTaskPop Run|S16BoardRelicPop Run|S16BoardMain Run/;
  // Ignore on the Riot screen (Btn_S16GamePlay_CheckOut_AbandonChallenge)
  // ends the run; the next run's Start, objective or instrument pick begins
  // one.
  const RUN_OVER = /Btn_S16GamePlay_CheckOut_AbandonChallenge/;
  const RUN_NEW = /Btn_S16GamePlay_Start|S16BoardTaskPop Run|S16BoardRelicPop Run/;
  const riotWatch = (s) => {
    if (RUN_OVER.test(s.line)) D.run('over');
    else if (RUN_NEW.test(s.line)) D.run('new');
    if (RIOT.test(s.line)) D.riot(true);
    else if (PRISON.test(s.line)) D.riot(false);
  };
  C.on('seen', riotWatch);

  // How Auto Screenshot Mode is doing, for the overlay. Never the log's lines.
  let lastFrame = null;
  // For finding out why pictures don't come: how many lines were read and
  // triggers matched (by kind), whether the log file still grows, and what
  // became of the last picture. Counts and states only, never a log line.
  const diag = { triggers: {}, lastTriggerAt: 0, lastTriggerKind: '', failed: 0, logSize: 0, growingAt: 0, lastNote: '' };
  const lastCaptureNote = () => {
    const li = document.querySelector('#az-auto-caps li');
    const notes = li ? [...li.querySelectorAll('.field-note')] : [];
    return notes.length ? notes[notes.length - 1].textContent.trim().slice(0, 160) : '';
  };
  const tell = () => {
    const st = C.state;
    diag.lastNote = lastCaptureNote();
    D.follow({ agreed: C.agreed(), log: st.log, file: st.file, window: st.window, windowSize: st.windowSize, frames: st.frames, lines: st.lines, hits: st.hits, detail: st.detail || '', error: st.error, note: st.note, lastFrame, logFound: !!game.log, logThere: !!(game.log && game.log.there), running: game.running, diag });
  };
  C.on('hit', (h) => {
    diag.triggers[h.kind] = (diag.triggers[h.kind] || 0) + 1;
    diag.lastTriggerAt = Date.now();
    diag.lastTriggerKind = h.kind;
    if (typeof D.trigger === 'function') D.trigger(h.kind);
  });
  // Whether the log file grows: the game writes to it every second or so
  // while it runs, so a log that stays the same isn't the one it writes.
  setInterval(async () => {
    if (C.state.log !== 'on') return;
    const st = await D.logStat();
    if (st && st.size !== diag.logSize) {
      diag.logSize = st.size;
      diag.growingAt = Date.now();
    }
  }, 5000);
  let wasShared = false;
  C.on('status', (st) => {
    // The share ends when the game closes; it's shared again when it's back.
    // It also ends when the game makes a new window (a change of display
    // mode, say) while it runs: then it's shared again shortly.
    if (st.window === 'off' && !game.running) stoppedWindow = false;
    if (wasShared && st.window === 'off' && game.running && !stoppedWindow) setTimeout(sync, 2500);
    wasShared = st.window === 'on';
    tell();
  });
  C.on('frame', (f) => {
    lastFrame = { at: Date.now(), kind: f.kind, ok: !!f.frame, why: f.why || '' };
    if (!f.frame) diag.failed += 1;
    tell();
    setTimeout(tell, 4000); // what became of it (read, or why not)
  });

  // In the app, steps 1 and 2 happen by themselves: say so at the top.
  const body = document.getElementById('az-auto-body');
  const desktopNote = body ? document.createElement('p') : null;
  if (desktopNote) {
    desktopNote.className = 'note';
    desktopNote.id = 'desktop-note';
    desktopNote.style.cssText = 'padding:10px 12px;border:1px solid var(--teal);border-radius:var(--radius);';
    body.prepend(desktopNote);
  }
  function sayHow() {
    if (!desktopNote) return;
    desktopNote.textContent = game.log
      ? `Tartarus Overlay connects your game log (${game.log.path}) and shares the Torchlight: Infinite window by itself, whenever the game is running. The buttons below still work.`
      : 'Tartarus Overlay didn’t find your game log. Choose it from the tray icon’s menu (Choose the game log…), or drag it onto the box below.';
  }

  function onGame(g) {
    const started = g.running && !game.running;
    game = g;
    if (started) {
      stoppedLog = false;
      stoppedWindow = false;
    }
    sayHow();
    tell();
    sync();
  }
  D.onGame(onGame);
  D.onCommand((cmd) => {
    if (cmd === 'capture') C.captureNow('manual');
  });

  D.game().then((g) => {
    if (g) onGame(g);
  });
  setInterval(tell, 10000);
})();
