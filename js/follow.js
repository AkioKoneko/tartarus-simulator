/* Tartarus Simulator: Follow my game (beta), on follow.html.
 * After the player agrees on this page, they connect the game log and share
 * the game window here. Each time the log shows a move, js/capture.js grabs a
 * frame of the window; this page lists it as a small preview and hands it to
 * the board analyzer open in another tab of this browser (js/auto.js there),
 * which reads the board and refreshes the advice. Pictures never leave the
 * browser. The triggers are editable here while the prison's log lines are
 * being worked out. */
(function () {
  'use strict';

  const C = window.TartarusCapture;
  const panel = document.getElementById('follow');
  if (!C || !panel) return;

  const KEY = 'tartarus-sim:auto:v1';
  const CHANNEL = 'tartarus-follow';
  const KEEP = 12; // pictures listed
  const RANK = { board: 1, brushstroke: 2, open: 3, startover: 4, chest: 5, finish: 6, manual: 7 };
  // #region default-triggers
  // The prison's log lines aren't known until the season starts. Until
  // then the defaults are the Frozen Canvas's, which test the whole path.
  const DEFAULT_RULES = [
    '# kind | pattern | settle ms  (one trigger a line; # starts a note)',
    "# The prison's lines go here at launch. For now, the Frozen Canvas's:",
    'board | S8_HZXY_DrawPaper_Pigment_Puzzle | 900',
    'board | S8SnowField Anim_Fangzhi | 900',
    'brushstroke | S8_HZXY_DrawPaper_Brushwork$ | 900',
    'startover | S8_HZXY_DrawPaper_TearUp | 1200',
    'finish | S8_HZXY_DrawPaper_Draw_Finish | 1500',
  ].join('\n');
  const DEFAULT_WATCH = '^(?!.*Appear_Gen)(?=.*(S\\d+_|Anim_\\w+ Start|AudioEnum|requested row))';
  // #endregion

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Settings ----------

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }
  // The panel saves only its own settings. Whether Follow my game is on (the
  // player's agreement) is written only by the agreement at the bottom.
  const OWN = ['rules', 'watch', 'read', 'accept', 'ask'];
  const prefs = Object.assign({ rules: DEFAULT_RULES, watch: DEFAULT_WATCH, read: true, accept: false, ask: true }, load());
  const save = () => {
    try {
      const all = load();
      for (const k of OWN) all[k] = prefs[k];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      // Private windows can refuse; settings last until the tab closes.
    }
  };
  // #region agreement
  // Nothing runs until the player has read this page and agreed to this
  // version of it: the controls stay hidden, and none of the code below
  // (connecting the log, sharing a window, passing pictures to the
  // analyzer) is set up.
  const agreed = C.agreed();
  $('az-auto-gate').hidden = agreed;
  $('az-auto-body').hidden = !agreed;
  if (!agreed) return;
  // #endregion

  // "kind | pattern | settle" lines into triggers.
  function parseRules(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('|').map((s) => s.trim());
      const [kind, pattern, settle] = parts.length >= 2 ? parts : ['board', parts[0], ''];
      if (pattern) out.push({ kind: kind || 'board', pattern, settle: Number(settle) || 900, rank: RANK[kind] || 1 });
    }
    return out;
  }

  // ---------- The board analyzer, in another tab ----------

  // Analyzer tabs say they're open when this page asks, when they open and
  // when they're focused. Pictures go to the one used last.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const me = Math.random().toString(36).slice(2);
  const analyzers = new Map(); // id -> { seen, focusedAt }

  function target() {
    let best = null;
    for (const [id, a] of analyzers) {
      if (!best || a.focusedAt > best.focusedAt || (a.focusedAt === best.focusedAt && a.seen > best.seen)) best = Object.assign({ id }, a);
    }
    return best;
  }

  function renderAnalyzer() {
    const n = analyzers.size;
    $('az-auto-analyzer-state').textContent = !channel ? 'This browser can’t pass pictures between tabs.'
      : n > 1 ? `Open in ${n} tabs. Pictures go to the one you used last.`
        : n ? 'Open in another tab. Pictures go there.'
          : 'Not open yet.';
    $('az-auto-analyzer').textContent = n ? 'Go to the board analyzer' : 'Open the board analyzer';
  }

  // ---------- The panel ----------

  const captures = []; // newest first: { id, time, kind, hits, frame, why, thumb, full, sent, read, state, asked, note }
  const seen = []; // newest first: { at, line, kind }
  let nextId = 1;

  function renderStatus(s) {
    const st = s || C.state;
    const log = st.log === 'on'
      ? `Following ${esc(st.file || 'the log')}: ${st.lines.toLocaleString()} new lines, ${st.hits.toLocaleString()} triggers`
      : st.log === 'starting' ? 'Opening the log…'
        : st.log === 'error' ? `The log can’t be read right now (${esc(st.error)}). Retrying…`
          : st.file ? `Not following ${esc(st.file)} yet.` : 'Not connected.';
    $('az-auto-log-state').innerHTML = log;
    $('az-auto-win-state').textContent = st.window === 'on' ? `Sharing the game window${st.windowSize ? ` (${st.windowSize})` : ''}: ${st.frames} pictures taken.` : 'Not sharing.';
    $('az-auto-log').textContent = st.log === 'on' || st.log === 'starting' ? 'Stop following' : st.file ? `Follow ${st.file} again` : 'Connect the game log';
    $('az-auto-win').textContent = st.window === 'on' ? 'Stop sharing' : 'Share the game window';
    $('az-auto-note').textContent = st.note || '';
  }

  function renderSeen() {
    $('az-auto-seen').innerHTML = seen.slice(0, 80).map((s) => `<li class="${s.kind ? 'is-hit' : ''}"><span class="az-auto-at">${esc(s.at.slice(-12))}</span>${s.kind ? `<span class="az-auto-kind">${esc(s.kind)}</span>` : ''}<code>${esc(s.line.replace(/^\[[^\]]*\]\[[^\]]*\]/, '').slice(0, 220))}</code></li>`).join('') || '<li class="az-auto-empty">No log lines yet.</li>';
  }

  function readText(c) {
    if (!c.frame) return `No picture: ${c.why || 'share the game window first.'}`;
    if (c.note) return c.note;
    if (!c.sent) return prefs.read ? 'Sending to the analyzer…' : 'Not read (reading is off).';
    if (!c.read) return 'Sent to the analyzer, reading…';
    if (c.read.skipped) return 'Skipped: a newer picture came in.';
    if (!c.read.ok) return `Not read: ${c.read.reason}`;
    const how = { waiting: ', waiting for you to use it in the analyzer', used: ', loaded', skipped: ', skipped', replaced: ', replaced by a newer picture' }[c.state] || '';
    return `Read day ${c.read.day}${c.read.unsure ? `, ${c.read.unsure} to check` : ''} in ${(c.read.ms / 1000).toFixed(1)} s${how}${c.asked ? ', asked' : ''}.`;
  }

  function renderCaptures() {
    $('az-auto-caps').innerHTML = captures.map((c) => {
      const why = c.hits.length ? c.hits.map((h) => h.text || h.kind).slice(0, 3).join(', ') : c.kind;
      return `<li>${c.thumb ? `<a href="${c.full || c.thumb}" target="_blank" rel="noopener"><img src="${c.thumb}" alt="The game at ${esc(c.time.toLocaleTimeString())}"></a>` : '<span class="az-auto-nothumb"></span>'}<div><p><b>${esc(c.kind)}</b> · ${esc(c.time.toLocaleTimeString())}</p><p class="field-note">${esc(why)}</p><p class="field-note">${esc(readText(c))}</p></div></li>`;
    }).join('') || '<li class="az-auto-empty">No pictures yet. They come when the log shows a move, or when you press Take a picture now.</li>';
  }

  // ---------- Each picture ----------

  const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

  async function shrink(frame, width) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, frame.width);
    canvas.height = Math.round((frame.height * canvas.width) / frame.width);
    canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, 'image/webp', 0.8);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.8);
    return blob;
  }

  // The whole picture, without loss, for the screenshot reader.
  async function png(frame) {
    try {
      if (typeof OffscreenCanvas === 'function') {
        const canvas = new OffscreenCanvas(frame.width, frame.height);
        canvas.getContext('2d').drawImage(frame, 0, 0);
        return await canvas.convertToBlob({ type: 'image/png' });
      }
    } catch (e) {
      // Fall back to a canvas on the page.
    }
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d').drawImage(frame, 0, 0);
    return toBlob(canvas, 'image/png');
  }

  // #region each-picture
  // Each picture is listed here as a small preview, kept in memory only:
  // closing the tab drops it. Then it's handed to the board analyzer open
  // in another tab of this browser, which reads it into the board (see
  // js/auto.js). It goes by the browser's BroadcastChannel, which reaches
  // only this site's own pages in this browser. Nothing is uploaded.
  async function onFrame(f) {
    const c = { id: nextId++, time: f.time, kind: f.kind, hits: f.hits || [], frame: !!f.frame, why: f.why || '', thumb: '', full: '', sent: false, read: null, state: '', asked: false, note: '' };
    captures.unshift(c);
    for (const old of captures.splice(KEEP)) {
      if (old.thumb) URL.revokeObjectURL(old.thumb);
      if (old.full) URL.revokeObjectURL(old.full);
    }
    if (!f.frame) {
      renderCaptures();
      return;
    }
    const thumb = await shrink(f.frame, 320);
    const full = await shrink(f.frame, 1600);
    if (thumb) c.thumb = URL.createObjectURL(thumb);
    if (full) c.full = URL.createObjectURL(full);
    renderCaptures();
    if (prefs.read) {
      const to = target();
      if (!to) c.note = 'Not read: open the board analyzer first.';
      else {
        const blob = await png(f.frame);
        if (!blob) c.note = 'Not read: the picture couldn’t be prepared.';
        else {
          channel.postMessage({ type: 'frame', to: to.id, from: me, id: c.id, kind: c.kind, blob, accept: prefs.accept, ask: prefs.ask });
          c.sent = true;
        }
      }
      renderCaptures();
    }
    if (typeof f.frame.close === 'function') f.frame.close();
  }

  // What the analyzer made of a picture, as it goes.
  function onAnswer(m) {
    const c = captures.find((x) => x.id === m.id);
    if (!c) return;
    if (m.read) c.read = m.read;
    if (m.state) c.state = m.state;
    if (m.asked) c.asked = true;
    renderCaptures();
  }

  // #endregion

  // ---------- Wiring ----------

  C.on('status', renderStatus);
  C.on('seen', (s) => {
    seen.unshift(s);
    seen.length = Math.min(seen.length, 200);
    renderSeen();
  });
  C.on('frame', (f) => onFrame(f).catch((e) => console.error(e)));

  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'here' && m.id) {
        analyzers.set(m.id, { seen: Date.now(), focusedAt: m.focusedAt || 0 });
        renderAnalyzer();
      } else if (m.type === 'bye') {
        analyzers.delete(m.id);
        renderAnalyzer();
      } else if (m.type === 'read' && m.to === me) onAnswer(m);
    };
    // Ask now and then which analyzer tabs are still open.
    const ask = () => {
      const now = Date.now();
      for (const [id, a] of analyzers) if (now - a.seen > 75000) analyzers.delete(id);
      renderAnalyzer();
      channel.postMessage({ type: 'hello' });
    };
    ask();
    setInterval(ask, 30000);
  }

  $('az-auto-rules').value = prefs.rules;
  $('az-auto-watch').value = prefs.watch;
  $('az-auto-read').checked = prefs.read;
  $('az-auto-accept').checked = prefs.accept;
  $('az-auto-ask').checked = prefs.ask;
  const applyRules = () => {
    const n = C.setRules(parseRules(prefs.rules));
    $('az-auto-rules-note').textContent = `${n} ${n === 1 ? 'trigger' : 'triggers'} in use.`;
  };
  applyRules();
  C.setWatch(prefs.watch);

  $('az-auto-rules').addEventListener('change', (e) => {
    prefs.rules = e.target.value;
    save();
    applyRules();
  });
  $('az-auto-rules-reset').addEventListener('click', () => {
    prefs.rules = DEFAULT_RULES;
    $('az-auto-rules').value = prefs.rules;
    save();
    applyRules();
  });
  $('az-auto-watch').addEventListener('change', (e) => {
    prefs.watch = e.target.value;
    save();
    $('az-auto-watch-note').textContent = C.setWatch(prefs.watch) ? '' : 'That pattern isn’t valid.';
  });
  for (const id of ['read', 'accept', 'ask']) {
    $(`az-auto-${id}`).addEventListener('change', (e) => {
      prefs[id] = e.target.checked;
      save();
    });
  }
  $('az-auto-log').addEventListener('click', async () => {
    const st = C.state;
    try {
      if (st.log === 'on' || st.log === 'starting') C.stopLog();
      else if (st.file && (await C.resumeLog(true)) === 'on') return;
      else await C.connectLog();
    } catch (e) {
      if (e && e.name !== 'AbortError') $('az-auto-note').textContent = e.message || String(e);
    }
  });
  $('az-auto-win').addEventListener('click', async () => {
    try {
      if (C.state.window === 'on') C.stopWindow();
      else await C.connectWindow();
    } catch (e) {
      if (e && e.name !== 'NotAllowedError') $('az-auto-note').textContent = e.message || String(e);
    }
  });
  $('az-auto-now').addEventListener('click', () => C.captureNow('manual'));
  $('az-auto-seen-save').addEventListener('click', () => {
    const text = seen.slice().reverse().map((s) => `${s.kind ? `[${s.kind}] ` : ''}${s.line}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'log-lines.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('az-auto-seen-clear').addEventListener('click', () => {
    seen.length = 0;
    renderSeen();
  });

  if (!C.supported.log || !C.supported.window) $('az-auto-note').textContent = 'This browser can’t follow the game. Use Chrome or Edge on a PC.';
  renderStatus();
  renderSeen();
  renderCaptures();
  renderAnalyzer();
  // The log picked last time: the browser asks again before reading it.
  C.resumeLog(false).then(renderStatus).catch(() => {});
})();
