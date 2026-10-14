/* Tartarus Simulator: Follow my game (beta, hidden unless ?auto=1).
 * The analyzer's panel for js/capture.js. The player connects the game log
 * and shares the game window; each time the log shows a move, the frame it
 * grabs is read into the board (TartarusAnalyzer.readFrame) and the advice
 * refreshes. Pictures never leave the browser. The triggers are editable on
 * the page while the prison's log lines are being worked out. ?auto=1 shows
 * the panel in this browser, ?auto=0 hides it; nothing in it runs until the
 * player agrees on follow.html. */
(function () {
  'use strict';

  const C = window.TartarusCapture;
  const A = window.TartarusAnalyzer;
  const panel = document.getElementById('az-auto');
  if (!C || !A || !panel) return;

  const KEY = 'tartarus-sim:auto:v1';
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
  // player's agreement) is written only by follow.html.
  const OWN = ['show', 'rules', 'watch', 'read', 'ask'];
  const prefs = Object.assign({ show: false, rules: DEFAULT_RULES, watch: DEFAULT_WATCH, read: true, ask: true }, load());
  const save = () => {
    try {
      const all = load();
      for (const k of OWN) all[k] = prefs[k];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      // Private windows can refuse; settings last until the tab closes.
    }
  };
  // While it's in beta, the panel shows only with ?auto=1 (?auto=0 hides it).
  const flag = new URLSearchParams(location.search).get('auto');
  if (flag === '1' || flag === '0') {
    prefs.show = flag === '1';
    save();
  }
  panel.hidden = !prefs.show;
  if (!prefs.show) return;
  // #region agreement
  // Nothing runs until the player has read follow.html and agreed to this
  // version of it: the panel shows only a link to that page, and none of
  // the code below (connecting the log, sharing a window) is set up.
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

  // ---------- The panel ----------

  const captures = []; // newest first: { id, time, kind, hits, thumb, full, read }
  const seen = []; // newest first: { at, line, kind }
  let nextId = 1;
  let reading = null; // the capture being read

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

  function renderCaptures() {
    $('az-auto-caps').innerHTML = captures.map((c) => {
      const read = !c.frame ? `No picture: ${c.why || 'share the game window first.'}`
        : !c.read ? (prefs.read ? 'Reading…' : 'Not read (reading is off).')
          : c.read.skipped ? 'Skipped: a newer picture came in.'
            : c.read.ok ? `Read day ${c.read.day}${c.read.unsure ? `, ${c.read.unsure} to check` : ''} in ${(c.read.ms / 1000).toFixed(1)} s${c.used ? ', loaded' : ''}${c.asked ? ', asked' : ''}.`
              : `Not read: ${c.read.reason}`;
      const why = c.hits.length ? c.hits.map((h) => h.text || h.kind).slice(0, 3).join(', ') : c.kind;
      return `<li>${c.thumb ? `<a href="${c.full || c.thumb}" target="_blank" rel="noopener"><img src="${c.thumb}" alt="The game at ${esc(c.time.toLocaleTimeString())}"></a>` : '<span class="az-auto-nothumb"></span>'}<div><p><b>${esc(c.kind)}</b> · ${esc(c.time.toLocaleTimeString())}</p><p class="field-note">${esc(why)}</p><p class="field-note">${esc(read)}</p></div></li>`;
    }).join('') || '<li class="az-auto-empty">No pictures yet. They come when the log shows a move, or when you press Take a picture now.</li>';
  }

  // ---------- Each picture ----------

  const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

  async function shrink(frame, width, maxBytes) {
    let w = Math.min(width, frame.width);
    for (let tries = 0; tries < 6; tries++) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = Math.round((frame.height * w) / frame.width);
      canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height);
      for (const q of [0.8, 0.68]) {
        let blob = await toBlob(canvas, 'image/webp', q);
        if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', q);
        if (blob && (!maxBytes || blob.size <= maxBytes)) return blob;
      }
      w = Math.round(w * 0.8);
    }
    return null;
  }

  // #region each-picture
  // Each picture is read into the board in this browser, and the 12 newest
  // are listed here as small previews, in memory only: closing the tab
  // drops them. Nothing is uploaded.
  async function onFrame(f) {
    const c = { id: nextId++, time: f.time, kind: f.kind, hits: f.hits || [], frame: f.frame, why: f.why || '', read: null, thumb: '', full: '' };
    captures.unshift(c);
    for (const old of captures.splice(KEEP)) {
      if (old.thumb) URL.revokeObjectURL(old.thumb);
      if (old.full) URL.revokeObjectURL(old.full);
      old.frame = null;
    }
    if (f.frame) {
      const thumb = await shrink(f.frame, 320, 0);
      const full = await shrink(f.frame, 1600, 0);
      if (thumb) c.thumb = URL.createObjectURL(thumb);
      if (full) c.full = URL.createObjectURL(full);
    }
    renderCaptures();
    if (!f.frame) return;
    if (prefs.read) {
      // The newest picture wins: one still being read is skipped.
      reading = c;
      c.read = await A.readFrame(f.frame);
      if (c.read.ok && reading === c) {
        A.useReading();
        c.used = true;
        if (prefs.ask) {
          A.ask();
          c.asked = true;
        }
      }
      renderCaptures();
    }
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

  $('az-auto-rules').value = prefs.rules;
  $('az-auto-watch').value = prefs.watch;
  $('az-auto-read').checked = prefs.read;
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
  for (const id of ['read', 'ask']) {
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
  // The log picked last time: the browser asks again before reading it.
  C.resumeLog(false).then(renderStatus).catch(() => {});
})();
