/* Tartarus Simulator: following the game as it's played (beta).
 * Reads Torchlight: Infinite's log (UE_game.log), which the player picks
 * once, and grabs frames from the game window, which the player shares once.
 * When log lines match a trigger (a move, a new screen), it waits for the
 * animations to settle, then hands the page one frame of the game. Chrome
 * and Edge only: other browsers can't re-read a file on disk. Nothing leaves
 * the browser here; the page decides what to do with each frame.
 *
 * The log is followed in a background worker where the browser allows it,
 * so a hidden tab keeps up; otherwise on the page.
 *
 *   TartarusCapture.on('status' | 'hit' | 'seen' | 'frame', fn)
 *   connectLog() / resumeLog(click) / stopLog()
 *   connectWindow() / useStream(stream) / stopWindow()
 *   setRules([{ kind, pattern, settle, rank }]) / setWatch(pattern)
 *   captureNow(kind) / useHandle(handle) (tests: any object with getFile()) */
(function () {
  'use strict';

  const POLL_MS = 1000;
  const IDB = 'tartarus-sim-capture';
  const listeners = { status: [], hit: [], seen: [], frame: [] };
  const state = { log: 'off', file: '', window: 'off', windowSize: '', lines: 0, hits: 0, frames: 0, note: '', error: '' };
  let rules = []; // [{ kind, re, settle, rank }]
  let watch = null; // log lines worth showing while finding triggers
  let burst = null; // matched lines waiting for the animations to settle
  let tail = null; // { post(message), stop() }
  let track = null;
  let imageCapture = null;
  let surface = ''; // what's shared: 'window' is the only kind accepted
  let video = null;

  const emit = (name, data) => listeners[name].forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  });
  const setState = (patch) => {
    Object.assign(state, patch);
    emit('status', Object.assign({}, state));
  };

  // ---------- Following the log ----------

  // #region read-log
  // The log follower, shared by the worker and the page. It reads only what
  // was added since the last look, decodes it as UTF-8, and reports the lines
  // that match a trigger or the watch pattern.
  function follower(post) {
    let handle = null;
    let offset = 0;
    let decoder = null;
    let rest = '';
    let busy = false;
    let triggers = [];
    let watching = null;
    const compile = (list) => list.map((s) => {
      try {
        return new RegExp(s, 'i');
      } catch (e) {
        return null;
      }
    });
    return {
      async start(h, fromStart) {
        handle = h;
        const file = await h.getFile();
        offset = fromStart ? 0 : file.size;
        decoder = new TextDecoder('utf-8');
        rest = '';
        post({ type: 'started', name: file.name || h.name || 'UE_game.log', size: file.size });
      },
      stop() {
        handle = null;
      },
      rules(list, watchSource) {
        triggers = compile(list);
        watching = watchSource ? compile([watchSource])[0] : null;
      },
      async tick() {
        if (!handle || busy) return;
        busy = true;
        try {
          const file = await handle.getFile();
          if (file.size < offset) {
            // The game started a new log.
            offset = 0;
            decoder = new TextDecoder('utf-8');
            rest = '';
            post({ type: 'rotated' });
          }
          if (file.size > offset) {
            const buf = await file.slice(offset, file.size).arrayBuffer();
            offset = file.size;
            const lines = (rest + decoder.decode(buf, { stream: true })).split(/\r?\n/);
            rest = lines.pop();
            const hits = [];
            for (const line of lines) {
              const rule = triggers.findIndex((re) => re && re.test(line));
              if (rule >= 0) hits.push({ rule, line: line.slice(0, 400) });
              else if (watching && watching.test(line)) hits.push({ rule: -1, line: line.slice(0, 400) });
            }
            post({ type: 'lines', count: lines.length, hits });
          }
        } catch (e) {
          post({ type: 'error', message: String((e && e.message) || e) });
        }
        busy = false;
      },
    };
  }

  // #endregion

  // The follower in a worker: a hidden tab throttles the page's timers, but
  // not a worker's. File handles can be sent to a worker; test objects can't,
  // and those are followed on the page.
  function startFollower(handle) {
    if (tail) tail.stop();
    const onMessage = (m) => {
      if (stopIfOff()) return;
      if (m.type === 'started') setState({ log: 'on', file: m.name, error: '', note: '' });
      else if (m.type === 'rotated') setState({ note: 'The game started a new log.' });
      else if (m.type === 'error') setState({ log: 'error', error: m.message });
      else if (m.type === 'lines') {
        const patch = { lines: state.lines + m.count };
        if (state.log === 'error') Object.assign(patch, { log: 'on', error: '' });
        setState(patch);
        for (const h of m.hits) onLine(h);
      }
    };
    const message = { rules: rules.map((r) => r.re.source), watch: watch ? watch.source : null };
    const real = typeof FileSystemFileHandle !== 'undefined' && handle instanceof FileSystemFileHandle;
    if (real && typeof Worker === 'function') {
      try {
        const source = `const follow = (${follower.toString()})((m) => postMessage(m));
          onmessage = (e) => {
            const m = e.data;
            if (m.type === 'start') follow.start(m.handle, false);
            else if (m.type === 'rules') follow.rules(m.rules, m.watch);
            else if (m.type === 'stop') follow.stop();
          };
          setInterval(() => follow.tick(), ${POLL_MS});`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = (e) => onMessage(e.data);
        worker.postMessage(Object.assign({ type: 'rules' }, message));
        worker.postMessage({ type: 'start', handle });
        tail = {
          post: (m) => worker.postMessage(m),
          stop: () => worker.terminate(),
        };
        return;
      } catch (e) {
        // Fall back to the page.
      }
    }
    const follow = follower(onMessage);
    follow.rules(message.rules, message.watch);
    const timer = setInterval(() => follow.tick(), POLL_MS);
    follow.start(handle, false).catch((e) => onMessage({ type: 'error', message: String(e.message || e) }));
    tail = {
      post: (m) => {
        if (m.type === 'rules') follow.rules(m.rules, m.watch);
      },
      stop: () => {
        clearInterval(timer);
        follow.stop();
      },
    };
  }

  function sendRules() {
    if (tail) tail.post({ type: 'rules', rules: rules.map((r) => r.re.source), watch: watch ? watch.source : null });
  }

  const stampOf = (line) => {
    const m = /^\[([^\]]+)\]/.exec(line);
    return m ? m[1] : '';
  };

  // #region triggers
  function onLine(h) {
    const at = stampOf(h.line);
    if (h.rule < 0) {
      emit('seen', { at, line: h.line });
      return;
    }
    const rule = rules[h.rule];
    if (!rule) return;
    const m = rule.re.exec(h.line);
    const hit = { kind: rule.kind, at, text: m ? (m[1] || m[0]).slice(0, 120) : '', line: h.line };
    setState({ hits: state.hits + 1 });
    emit('hit', hit);
    emit('seen', { at, line: h.line, kind: rule.kind });
    // Lines in a burst become one frame, once the log has been quiet for the
    // longest settle time among them.
    if (!burst) burst = { kind: rule.kind, rank: rule.rank, settle: 0, hits: [], timer: 0 };
    if (rule.rank > burst.rank) {
      burst.kind = rule.kind;
      burst.rank = rule.rank;
    }
    burst.settle = Math.max(burst.settle, rule.settle);
    if (burst.hits.length < 40) burst.hits.push({ kind: hit.kind, at: hit.at, text: hit.text });
    clearTimeout(burst.timer);
    burst.timer = setTimeout(fire, burst.settle);
  }

  async function fire() {
    const b = burst;
    burst = null;
    if (!b) return;
    const frame = await grab();
    if (frame) setState({ frames: state.frames + 1 });
    emit('frame', { kind: b.kind, hits: b.hits, frame, why: frame ? '' : whyNot(), time: new Date() });
  }

  // #endregion

  // ---------- Remembering the log between visits ----------

  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function remember(handle) {
    try {
      const d = await db();
      d.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'log');
    } catch (e) {
      // Without IndexedDB the log is picked again next visit.
    }
  }

  async function recall() {
    try {
      const d = await db();
      return await new Promise((resolve) => {
        const q = d.transaction('handles', 'readonly').objectStore('handles').get('log');
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  // ---------- When pictures may be taken ----------

  // #region guard
  // What follow.html saves when the player agrees (shared with js/auto.js),
  // and the version of that page they agreed to.
  const SETTINGS = 'tartarus-sim:auto:v1';
  const CONSENT_VERSION = 1;

  // Whether the player agreed to this version of follow.html. It's read
  // again every time it's needed, so turning Follow my game off on that
  // page stops it here at once, even in a tab that's already open.
  function agreed() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
      return !!s && s.enabled === true && s.consent === CONSENT_VERSION;
    } catch (e) {
      return false;
    }
  }

  function mustAgree() {
    if (!agreed()) throw new Error('Read and agree on the Follow my game page first.');
  }

  // A picture may be taken only when all of these hold, checked right
  // before each one: the player agreed, a game log is connected and being
  // read, and what's shared is a single window that's still live. A whole
  // screen or a browser tab is never accepted (see useStream).
  function mayCapture() {
    return agreed() && state.log === 'on' && !!track && track.readyState === 'live' && surface === 'window';
  }

  // Why a picture can't be taken right now, for the page to say.
  function whyNot() {
    if (!agreed()) return 'Follow my game is off.';
    if (state.log !== 'on') return 'connect the game log first.';
    return 'share the game window first.';
  }

  // Turning Follow my game off on follow.html, in any tab, stops everything
  // here at once: the log stops being read and the window share ends.
  function stopIfOff() {
    if (agreed()) return false;
    if (tail || track) {
      stopLog();
      stopWindow();
      setState({ note: 'Follow my game was turned off.' });
    }
    return true;
  }
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS) stopIfOff();
  });
  // #endregion

  // ---------- The log: picking it ----------

  // #region pick-log
  async function connectLog() {
    mustAgree();
    if (typeof window.showOpenFilePicker !== 'function') throw new Error('This browser can’t follow a file on your PC. Use Chrome or Edge.');
    const [handle] = await window.showOpenFilePicker({ id: 'torchlight-log', multiple: false, types: [{ description: 'Torchlight: Infinite log', accept: { 'text/plain': ['.log'] } }] });
    useHandle(handle);
    remember(handle);
  }

  // The log picked on an earlier visit. The browser asks again for leave to
  // read it, and that takes a click: without one this returns 'ask'.
  async function resumeLog(click) {
    if (!agreed()) return 'none';
    const handle = await recall();
    if (!handle || typeof handle.queryPermission !== 'function') return 'none';
    let p = await handle.queryPermission({ mode: 'read' });
    if (p !== 'granted' && click) p = await handle.requestPermission({ mode: 'read' });
    if (p !== 'granted') {
      setState({ file: handle.name });
      return 'ask';
    }
    useHandle(handle);
    return 'on';
  }

  // #endregion

  function useHandle(handle) {
    mustAgree();
    setState({ log: 'starting', file: handle.name || '', error: '' });
    startFollower(handle);
  }

  function stopLog() {
    if (tail) tail.stop();
    tail = null;
    setState({ log: 'off' });
  }

  // ---------- The window ----------

  // #region share-window
  async function connectWindow() {
    mustAgree();
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') throw new Error('This browser can’t share a window.');
    // The browser's picker lists the open windows; the player picks the
    // game. Whole screens and this tab aren't offered, and the share can't
    // be switched to something else while it runs.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window', frameRate: { ideal: 5, max: 10 } },
      audio: false,
      monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    });
    useStream(stream);
  }

  function useStream(stream) {
    mustAgree();
    stopWindow();
    const t = stream.getVideoTracks()[0];
    const kind = t && t.getSettings ? t.getSettings().displaySurface : '';
    // Only a single window is accepted: a whole screen or a browser tab is
    // turned away, and its share stopped at once.
    if (kind !== 'window') {
      stream.getTracks().forEach((x) => x.stop());
      throw new Error('Share the Torchlight: Infinite window itself, not a whole screen or a browser tab.');
    }
    track = t;
    surface = kind;
    track.addEventListener('ended', () => {
      track = null;
      surface = '';
      imageCapture = null;
      setState({ window: 'off', windowSize: '', note: 'Window sharing stopped.' });
    });
    // Chrome and Edge take a still frame only when a picture is due, and
    // nothing plays the window as video in between. Other browsers need a
    // hidden video element to take a frame from.
    if (typeof ImageCapture === 'function') imageCapture = new ImageCapture(track);
    else {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    const s = track.getSettings();
    setState({ window: 'on', windowSize: s.width ? `${s.width}×${s.height}` : '', note: '' });
  }

  function stopWindow() {
    if (track) track.stop();
    track = null;
    surface = '';
    imageCapture = null;
    if (video) video.srcObject = null;
    video = null;
    setState({ window: 'off', windowSize: '' });
  }

  // One frame of the shared window, as an ImageBitmap, or null when a
  // picture isn't allowed right now (see mayCapture).
  async function grab() {
    if (!mayCapture()) {
      stopIfOff();
      return null;
    }
    try {
      if (imageCapture) return await imageCapture.grabFrame();
    } catch (e) {
      // Fall back to the video element.
    }
    try {
      if (video && video.readyState >= 2) return await createImageBitmap(video);
    } catch (e) {
      // No frame this time.
    }
    return null;
  }

  // #endregion

  async function captureNow(kind) {
    const frame = await grab();
    if (frame) setState({ frames: state.frames + 1 });
    emit('frame', { kind: kind || 'manual', hits: [], frame, why: frame ? '' : whyNot(), time: new Date() });
    return !!frame;
  }

  // ---------- Triggers ----------

  // [{ kind, pattern, settle, rank }]. Patterns that aren't valid are skipped.
  function setRules(list) {
    rules = [];
    for (const r of list || []) {
      try {
        rules.push({ kind: r.kind || 'board', re: new RegExp(r.pattern, 'i'), settle: Math.max(100, Number(r.settle) || 900), rank: Number(r.rank) || 0 });
      } catch (e) {
        // A bad pattern is left out.
      }
    }
    sendRules();
    return rules.length;
  }

  function setWatch(pattern) {
    try {
      watch = pattern ? new RegExp(pattern, 'i') : null;
    } catch (e) {
      watch = null;
    }
    sendRules();
    return !!watch || !pattern;
  }

  window.TartarusCapture = {
    // follow.html explains this code. When what it does changes, this goes
    // up, and players are asked to read and agree again.
    CONSENT_VERSION,
    agreed,
    supported: {
      log: typeof window.showOpenFilePicker === 'function',
      window: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'),
    },
    get state() {
      return Object.assign({}, state);
    },
    on(name, fn) {
      if (listeners[name]) listeners[name].push(fn);
    },
    connectLog,
    resumeLog,
    stopLog,
    useHandle,
    connectWindow,
    useStream,
    stopWindow,
    setRules,
    setWatch,
    captureNow,
    grab,
  };
})();
