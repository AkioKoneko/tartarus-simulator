/* Tartarus Simulator: interface.
 * Renders the engine state, turns clicks into engine actions, and keeps the
 * undo history, saves and preferences. All rules live in engine.js. */
(function () {
  'use strict';

  const T = window.Tartarus;
  const Sound = window.TartarusSound;
  // The published single-file build sets this; its viewer cannot download files.
  const EMBEDDED = !!window.TARTARUS_EMBEDDED;

  const KEYS = { save: 'tartarus-sim:save:v2', prefs: 'tartarus-sim:prefs:v1', params: 'tartarus-sim:params:v2' };
  const HISTORY_LIMIT = 40;
  const DEFAULT_PREFS = { advisor: false, quick: false, motion: true, sound: true, volume: 60, immersive: false };

  // Where each cell sits on the 6×4 board as [row, column]: clockwise from the
  // top-left corner, around a courtyard that holds the decision panel.
  const RING = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [2, 6], [3, 6], [4, 6], [4, 5], [4, 4], [4, 3], [4, 2], [4, 1], [3, 1], [2, 1]];

  // Beast portraits drawn for this simulator.
  const svg = (inner) => `<svg class="portrait" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
  const PORTRAITS = {
    mammoth: svg(
      '<path class="p-shade" d="M19 18C8 15 3 26 6 36c2 7 9 9 14 4l3-4Z"/>' +
      '<path class="p-shade" d="M45 18c11-3 16 8 13 18-2 7-9 9-14 4l-3-4Z"/>' +
      '<path class="p-main" d="M17 25C17 15 24 9 32 9s15 6 15 16c0 5-4 8-9 10-1 6-2 11-1 15 1 3 4 3 5 1 2 3-1 8-6 7-4-1-6-6-6-12 0-5-1-8-3-10-5-2-9-5-9-11Z"/>' +
      '<path class="p-bone" d="M27 36c-5 5-9 8-13 5M37 36c5 5 9 8 13 5"/>' +
      '<circle class="p-ink" cx="25" cy="24" r="1.8"/><circle class="p-ink" cx="39" cy="24" r="1.8"/>' +
      '<path class="p-line" d="M28 10l-2-4M32 9V4M36 10l2-4"/>',
    ),
    lion: svg(
      '<path class="p-shade" d="M32 4L36.6 12L44.1 6.8L44.8 16L53.9 14.5L50.5 23.1L59.3 25.8L52.5 32L59.3 38.2L50.5 40.9L53.9 49.5L44.8 48L44.1 57.2L36.6 52L32 60L27.4 52L19.9 57.2L19.2 48L10.1 49.5L13.5 40.9L4.7 38.2L11.5 32L4.7 25.8L13.5 23.1L10.1 14.5L19.2 16L19.9 6.8L27.4 12Z"/>' +
      '<circle class="p-main" cx="21" cy="20" r="4.5"/><circle class="p-main" cx="43" cy="20" r="4.5"/>' +
      '<circle class="p-ink2" cx="21" cy="20" r="2"/><circle class="p-ink2" cx="43" cy="20" r="2"/>' +
      '<ellipse class="p-main" cx="32" cy="33" rx="13" ry="14.5"/>' +
      '<ellipse class="p-light" cx="32" cy="40.5" rx="7.5" ry="5.5"/>' +
      '<ellipse class="p-ink" cx="26.5" cy="30" rx="2.2" ry="1.5"/><ellipse class="p-ink" cx="37.5" cy="30" rx="2.2" ry="1.5"/>' +
      '<path class="p-ink" d="M29 35.5h6L32 39Z"/>' +
      '<path class="p-inkline" d="M32 39v2.5M32 41.5c-1.5 2-3.5 2.3-5 1.2M32 41.5c1.5 2 3.5 2.3 5 1.2"/>',
    ),
    wolf: svg(
      '<polygon class="p-main" points="16,5 26,19 32,17 38,19 48,5 51,25 53,34 41,46 32,58 23,46 11,34 13,25"/>' +
      '<polygon class="p-ink2" points="18,11 24,20 18,23"/><polygon class="p-ink2" points="46,11 40,20 46,23"/>' +
      '<polygon class="p-shade" points="30,18 34,18 32,30"/>' +
      '<polygon class="p-light" points="27,38 37,38 32,56"/>' +
      '<polygon class="p-ink" points="20,30 28,32 22,34.5"/><polygon class="p-ink" points="44,30 36,32 42,34.5"/>' +
      '<polygon class="p-ink" points="28.5,50 35.5,50 32,55"/>',
    ),
    rat: svg(
      '<circle class="p-shade" cx="17" cy="19" r="10"/><circle class="p-shade" cx="47" cy="19" r="10"/>' +
      '<circle class="p-ink2" cx="17" cy="19" r="5.5"/><circle class="p-ink2" cx="47" cy="19" r="5.5"/>' +
      '<path class="p-main" d="M32 15c13 0 18 12 13 23-4 8-9 15-13 18-4-3-9-10-13-18-5-11 0-23 13-23Z"/>' +
      '<circle class="p-ink" cx="26" cy="30" r="2.3"/><circle class="p-ink" cx="38" cy="30" r="2.3"/>' +
      '<circle class="p-ink" cx="32" cy="53.5" r="2.6"/>' +
      '<rect class="p-bonefill" x="30.6" y="56" width="2.8" height="4" rx="0.6"/>' +
      '<path class="p-line" d="M27 48L12 44M27 51L12 53M37 48l15-4M37 51l15 2"/>',
    ),
  };
  const LANTERN = '<svg class="warden" viewBox="0 0 16 18" aria-hidden="true"><path d="M6 1h4v2H6z"/><path d="M4 4h8l-1 10H5z"/><path d="M5 15h6v2H5z"/><path class="flame" d="M8 6.5c1.4 1.6 1.6 3 0 4.6-1.6-1.6-1.4-3 0-4.6Z"/></svg>';
  // Two rows of teeth: "ate" in the devour icons.
  const FANGS = '<svg class="fangs" viewBox="0 0 16 14" aria-hidden="true"><path d="M1 1h14l-1.75 4.5-1.75-3-1.75 3-1.75-3-1.75 3-1.75-3-1.75 3-1.75-3Z"/><path d="M1 13h14l-1.75-4.5-1.75 3-1.75-3-1.75 3-1.75-3-1.75 3-1.75-3-1.75 3Z"/></svg>';
  // Cell 01, the warden's office: a desk with the ledger open by a candle.
  const OFFICE_ART =
    '<span class="office"><svg class="office-art" viewBox="0 0 64 52" aria-hidden="true">' +
    '<circle class="o-glow" cx="48" cy="13" r="12"/>' +
    '<path class="o-paper" d="M10 27l12-3.5 12 3.5V15l-12-3.5L10 15Z"/>' +
    '<path class="o-line" d="M22 11.5v12M13.5 17.6l5.5-1.7M13.5 21.1l5.5-1.7M25 15.9l5.5 1.7M25 19.4l5.5 1.7"/>' +
    '<rect class="o-wax" x="45.5" y="17" width="5" height="10" rx="1"/>' +
    '<path class="o-flame" d="M48 8.5c2.3 2.6 2.5 4.9 0 7.3-2.5-2.4-2.3-4.7 0-7.3Z"/>' +
    '<rect class="o-wood" x="4" y="27" width="56" height="5" rx="1"/>' +
    '<path class="o-wood" d="M8 32h5v16H8zM51 32h5v16h-5z"/>' +
    '<rect class="o-wood-lo" x="29" y="32" width="18" height="8" rx="1"/>' +
    '<rect class="o-knob" x="36" y="35.2" width="4" height="1.6" rx="0.8"/>' +
    '</svg><span class="office-name">Office</span></span>';

  const $ = (id) => document.getElementById(id);
  const L = (n) => T.cellLabel(n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* Storage can be full or blocked; the run still works in memory. */
      }
    },
  };

  const ui = {
    state: null,
    history: [],
    selected: null,
    pending: null,
    hover: null,
    screen: 'title',
    prefs: Object.assign({}, DEFAULT_PREFS, store.get(KEYS.prefs) || {}),
    labParams: T.normalizeParams(store.get(KEYS.params)),
    labCell: 1,
    actedOn: null,
    labTab: 'scene',
    toastTimer: 0,
    endArmed: 0,
  };

  const cargo = { cells: new Set(), vault: new Set(), escort: 'light' };
  const cellEls = [];

  // ---------- Small helpers ----------

  function setHTML(el, html) {
    if (el.__html !== html) {
      el.innerHTML = html;
      el.__html = html;
    }
  }

  function makeButton(label, onClick, kind, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (kind === 'primary' ? ' btn-primary' : kind === 'danger' ? ' btn-danger' : '');
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function modeName(st) {
    if (st.mode === 'challenge') return `Contract challenge · ${T.LOADOUTS[st.loadout].name}`;
    return st.scenario === 'empty' ? 'Rules drill' : T.SCENARIOS[st.scenario].name;
  }

  const escortName = (key) => (key && T.ESCORTS[key] ? T.ESCORTS[key].name.toLowerCase() : '');
  const windowOpen = (st) => !!(st && st.challenge && st.challenge.window);
  const blocked = (st) => !st || st.phase === 'ended' || st.pending.length > 0 || windowOpen(st) || st.phase === 'event';

  function toast(text, info) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('is-info', !!info);
    if (typeof el.showPopover === 'function') {
      try {
        if (el.matches(':popover-open')) el.hidePopover();
        el.showPopover();
      } catch (e) {
        el.hidden = false;
      }
    } else {
      el.hidden = false;
    }
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      if (typeof el.hidePopover === 'function' && el.matches(':popover-open')) el.hidePopover();
      else el.hidden = true;
    }, 3400);
  }

  function persist() {
    if (ui.state) store.set(KEYS.save, { app: 'tartarus-sim', v: T.VERSION, state: ui.state });
  }

  // ---------- Running moves ----------

  // Applies one engine action with undo, autosave, effects and sound.
  function run(action, opts) {
    const options = opts || {};
    if (!ui.state) return false;
    const snapshot = T.serialize(ui.state);
    let result;
    try {
      result = action(ui.state);
    } catch (err) {
      console.error(err);
      result = { ok: false, reason: 'That move hit an error and was not applied.' };
    }
    if (!result || !result.ok) {
      ui.state = T.deserialize(snapshot);
      toast(result ? result.reason : 'That move is not allowed.');
      Sound.play('error');
      render();
      return false;
    }
    ui.history.push(snapshot);
    if (ui.history.length > HISTORY_LIMIT) ui.history.shift();
    if (!options.keepPending) ui.pending = null;
    if ('select' in options) ui.selected = options.select;
    tidySelection();
    persist();
    render();
    playEvents(result.events || []);
    followUp(ui.prefs.motion ? 600 : 0);
    return true;
  }

  // Opens whatever the run is now waiting on: a choice, a delivery or the roster.
  function followUp(delay) {
    setTimeout(() => {
      const st = ui.state;
      if (!st || ui.screen !== 'game') return;
      if (st.phase === 'ended') {
        if (!$('dlg-results').open) openResults();
      } else if (st.pending.length) {
        openChoice();
      } else if (windowOpen(st) && !$('dlg-deliver').open) {
        openDeliver();
      }
    }, delay);
  }

  function tidySelection() {
    const st = ui.state;
    if (ui.selected === null || !st) return;
    const cell = st.cells[ui.selected];
    if (!cell || (!cell.sealed && !cell.inmate)) ui.selected = null;
  }

  function undo() {
    if (!ui.history.length) {
      toast('Nothing to undo yet.', true);
      return;
    }
    ui.state = T.deserialize(ui.history.pop());
    ui.selected = null;
    ui.pending = null;
    persist();
    closeRunDialogs();
    if (ui.screen !== 'game') showScreen('game');
    else render();
    toast('Undid the last move.', true);
  }

  function cancel() {
    ui.pending = null;
    ui.selected = null;
    render();
  }

  const SOUND_ORDER = ['end', 'rainbow', 'deliver', 'devour', 'hatch', 'open', 'swap', 'nest', 'promote', 'tool', 'window', 'day', 'move'];
  const SOUND_ALIAS = { window: 'tool', move: 'select' };

  function playEvents(events) {
    // The bites of a chain flash one after another, so you can follow it.
    let bites = 0;
    for (const ev of events) {
      if (ev.type === 'open') fx(ev.cell, 'fx-open');
      else if (ev.type === 'move') fx(ev.to, 'fx-move');
      else if (ev.type === 'devour') {
        const show = () => {
          fx(ev.to, 'fx-devour');
          fx(ev.from, 'fx-promote');
        };
        if (bites++ && ui.prefs.motion) setTimeout(show, (bites - 1) * 380);
        else show();
      } else if (ev.type === 'promote') fx(ev.cell, 'fx-promote');
      else if (ev.type === 'rainbow') fx(ev.cell, 'fx-rainbow');
      else if (ev.type === 'swap') fx(ev.cell, 'fx-swap');
      else if (ev.type === 'hatch') fx(ev.cell, 'fx-hatch');
      else if (ev.type === 'nest') fx(ev.cell, 'fx-nest');
      else if (ev.type === 'deliver') ev.cells.forEach((n) => fx(n, 'fx-open'));
    }
    const types = new Set(events.map((e) => e.type));
    const name = SOUND_ORDER.find((t) => types.has(t));
    if (name) Sound.play(SOUND_ALIAS[name] || name);
  }

  function fx(n, cls) {
    if (!ui.prefs.motion || n === null || n === undefined || !cellEls[n]) return;
    const el = cellEls[n].fx;
    el.className = 'cell-fx';
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---------- Asking before acting ----------

  function askPatrol(n) {
    if (ui.prefs.quick) {
      run((st) => T.patrol(st, n), { select: n });
      return;
    }
    ui.selected = n;
    ui.pending = { kind: 'patrol', cell: n };
    render();
  }

  function askSwap(n) {
    if (n === null || n === undefined) return;
    if (ui.prefs.quick) {
      run((st) => T.swap(st, n));
      return;
    }
    ui.selected = n;
    ui.pending = { kind: 'swap', cell: n };
    render();
  }

  // Targets open to today's devour, which only the warden's cell can start.
  function devoursAvailable(st) {
    return T.startOptions(st).length;
  }

  // Short labels for any hard mode switches in play.
  function hardModeLabels(st) {
    const labels = [];
    if (st.params.loopChain) labels.push('Loop chain');
    return labels;
  }

  function askEndDay() {
    const st = ui.state;
    if (!st || blocked(st) || st.phase !== 'manage') return;
    const warnings = [];
    if (devoursAvailable(st)) warnings.push('You haven’t used today’s devour yet.');
    const due = T.currentContract(st);
    const deliveryDay = due && due.deadline === st.day;
    const last = st.mode === 'drill' && st.day >= st.maxDays;
    if (!ui.prefs.quick && (warnings.length || last)) {
      ui.pending = { kind: 'end', warnings, last, deliveryDay };
      render();
      return;
    }
    run((s) => T.endDay(s), { select: null });
  }

  // `clicks` is the click count, so the second click of a double-click acts at
  // once: it goes to a destination or devours a target, and on any other cell
  // it keeps the cell selected instead of toggling it off.
  function onCell(n, clicks) {
    const st = ui.state;
    if (!st) return;
    const double = clicks >= 2;
    // The first click may already have acted (quick decisions); a double-click
    // then has nothing left to do.
    const acted = ui.actedOn === n;
    ui.actedOn = null;
    if (double && acted) return;
    const act = (action, opts) => {
      ui.actedOn = n;
      run(action, opts);
    };
    const inspect = () => {
      ui.pending = null;
      ui.selected = ui.selected === n && !double ? null : n;
      render();
    };
    if (blocked(st)) {
      inspect();
      return;
    }
    if (st.phase === 'patrol') {
      if (T.patrolOptions(st).includes(n)) {
        // Clicking the chosen destination again goes there.
        const again = ui.pending && ui.pending.kind === 'patrol' && ui.pending.cell === n;
        if (double || again || ui.prefs.quick) act((s) => T.patrol(s, n), { select: n });
        else askPatrol(n);
        return;
      }
      inspect();
      return;
    }
    // Only the warden's cell can start today's devour. With it selected, a
    // click previews a target and a second click devours it; a double-click
    // devours whatever is selected.
    const option = T.startOptions(st).find((o) => o.cell === n);
    if (option && (double || ui.selected === st.position)) {
      const from = st.position;
      const again = ui.pending && ui.pending.kind === 'devour' && ui.pending.to === n;
      if (double || again || ui.prefs.quick) act((s) => T.devour(s, from, n), { select: from });
      else {
        ui.selected = from;
        ui.pending = { kind: 'devour', from, to: n };
        render();
      }
      return;
    }
    inspect();
    if (ui.selected !== null && !double) Sound.play('select');
  }

  // ---------- Rendering: cells ----------

  function cellParts(cell, st) {
    const warden = st.position === cell.n;
    if (cell.n === T.OFFICE) {
      const label = `Cell ${L(cell.n)}: the warden's office. No inmate is ever held here${warden ? '. The warden is here' : ''}`;
      return { cls: ['cell', 'is-office'], body: OFFICE_ART, hint: '', badges: '', label, warden };
    }
    const inmate = cell.inmate;
    const visible = !cell.sealed && !!inmate;
    const known = cell.sealed && cell.hidden && cell.known ? cell.hidden : null;
    const cls = ['cell', cell.sealed ? 'is-sealed' : visible ? 'has-inmate' : 'is-empty'];
    if (visible) cls.push('t' + inmate.tier);
    else if (known) cls.push('t' + known.tier);
    if (cell.scratch) cls.push('has-scratch');
    let body = '';
    let hint = '';
    const badges = [];
    let label = `Cell ${L(cell.n)}: `;
    if (cell.sealed) {
      if (cell.nest) {
        const left = Math.max(0, cell.nest.due - st.day);
        hint = `<span class="nest-count">${left}</span><span class="nest-label">Nest · day ${cell.nest.due}</span>`;
        label += `sealed rat nest, hatches on day ${cell.nest.due}`;
      } else if (known) {
        const text = cell.known === 2 ? T.describe(known) : T.tierName(known.tier);
        hint = `<span class="hint">${text}</span>`;
        label += `sealed, ${text} inside`;
      } else {
        label += 'sealed';
      }
      if (cell.event) {
        badges.push('<span class="badge badge-event">Event</span>');
        label += ', special event behind the door';
      }
    } else if (visible) {
      body = `<span class="token">${PORTRAITS[inmate.beast]}<span class="token-beast">${T.beastName(inmate.beast)}</span><span class="token-tier">${T.tierName(inmate.tier)}</span></span>`;
      label += T.describe(inmate);
      if (cell.ivory) {
        badges.push('<span class="badge badge-ivory">Ivory</span>');
        label += ', Ivory cell';
      }
      const link = T.linkOf(st, inmate.id);
      if (link) {
        const hunter = link.lion === inmate.id;
        const other = T.cellOf(st, hunter ? link.prey : link.lion);
        const where = other ? L(other.n) : '--';
        badges.push(`<span class="badge badge-prey">${hunter ? 'Hunt' : 'Prey'} ${where}·${link.rounds}</span>`);
        label += hunter ? `, hunting cell ${where}` : `, prey of cell ${where}`;
      }
    } else {
      body = '<span class="floor">Empty</span>';
      label += 'empty';
    }
    if (cell.scratch) {
      badges.push('<span class="badge badge-scratch">Scratch</span>');
      label += ', scratched door';
    }
    if (visible && badges.length) cls.push('has-badges');
    if (warden) label += '. The warden is here';
    return { cls, body, hint, badges: badges.join(''), label, warden };
  }

  function buildBoard() {
    const board = $('board');
    for (let n = 0; n < T.CELL_COUNT; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.style.gridRow = RING[n][0];
      b.style.gridColumn = RING[n][1];
      b.innerHTML = '<span class="cell-body"></span><span class="door" aria-hidden="true"></span><span class="cell-no"></span><span class="cell-hint"></span><span class="cell-badges"></span><span class="cell-tag"></span><span class="cell-warden"></span><span class="cell-fx"></span>';
      b.children[2].textContent = L(n);
      b.addEventListener('click', (e) => onCell(n, e.detail));
      b.addEventListener('mouseenter', () => {
        if (ui.state && ui.state.chain && ui.state.phase === 'patrol') {
          ui.hover = n;
          renderBoard();
        }
      });
      b.addEventListener('mouseleave', () => {
        if (ui.hover === n) {
          ui.hover = null;
          if (ui.state) renderBoard();
        }
      });
      board.appendChild(b);
      cellEls[n] = { btn: b, body: b.children[0], hint: b.children[3], badges: b.children[4], tag: b.children[5], warden: b.children[6], fx: b.children[7] };
    }
  }

  function renderBoard() {
    const st = ui.state;
    const free = !blocked(st);
    const sel = ui.selected !== null ? st.cells[ui.selected] : null;
    // Only the inmate in the warden's cell can start the day's devour.
    const hunter = free && st.phase === 'manage' && T.canDevourNow(st) && sel && sel.n === st.position && !sel.sealed && sel.inmate ? sel : null;
    const hunting = !!hunter;
    const targets = new Map();
    if (hunter) for (const o of T.devourOptions(st, hunter.n)) targets.set(o.cell, o);
    const victims = new Set(st.phase === 'event' && st.event && st.event.kind === 'execution' ? T.executionVictims(st, st.event.cell).map((c) => c.n) : []);
    const dests = free && st.phase === 'patrol' ? new Set(T.patrolOptions(st)) : new Set();
    $('board').classList.toggle('is-patrolling', dests.size > 0);
    const aim = ui.pending && ui.pending.kind === 'patrol' ? ui.pending.cell : ui.hover;
    const path = st.chain && st.phase === 'patrol' && dests.has(aim) ? new Set(T.clockwisePath(st, aim)) : new Set();
    const pendingTarget = ui.pending && ui.pending.kind === 'devour' ? ui.pending.to : null;
    for (const cell of st.cells) {
      const el = cellEls[cell.n];
      const p = cellParts(cell, st);
      let tag = '';
      if (ui.selected === cell.n || pendingTarget === cell.n || (st.phase === 'event' && st.event && st.event.cell === cell.n)) p.cls.push('is-selected');
      if (targets.has(cell.n)) {
        p.cls.push('is-target');
        tag = `Eat +${T.gainFor(st, hunter.n, targets.get(cell.n)).gain}`;
      } else if (hunting && targets.size && hunter.n !== cell.n) {
        p.cls.push('is-dim');
      }
      if (victims.has(cell.n)) p.cls.push('is-victim');
      if (dests.has(cell.n)) {
        p.cls.push('is-dest');
        if (ui.hover === cell.n) p.cls.push('is-aim');
        if (st.chain) {
          const opens = T.clockwisePath(st, cell.n).filter((k) => st.cells[k].sealed).length;
          tag = `Go +${opens}`;
        } else {
          tag = cell.sealed ? 'Go' : 'Walk';
        }
      }
      if (path.has(cell.n)) p.cls.push('on-path');
      el.btn.className = p.cls.join(' ');
      setHTML(el.body, p.body);
      setHTML(el.hint, p.hint);
      setHTML(el.badges, p.badges);
      setHTML(el.warden, p.warden ? LANTERN : '');
      el.tag.textContent = tag;
      el.btn.setAttribute('aria-label', p.label + (tag ? `. ${tag}` : ''));
      el.btn.setAttribute('aria-pressed', String(ui.selected === cell.n));
    }
    $('emblem-text').textContent = st.phase === 'ended' ? 'Run complete' : `Warden ${wardenAt(st)} · clockwise`;
  }

  function wardenAt(st) {
    return st.position === T.OFFICE ? 'in the office' : `at cell ${L(st.position)}`;
  }

  // The morning's destination doors as cards under the ring.
  function renderDestBar() {
    const st = ui.state;
    const show = st.phase === 'patrol' && !blocked(st);
    $('dest-bar').hidden = !show;
    if (!show) return;
    const options = T.patrolOptions(st);
    const chosen = ui.pending && ui.pending.kind === 'patrol' ? ui.pending.cell : null;
    setHTML($('dest-cards'), st.destinations
      .map((n) => {
        const c = st.cells[n];
        const usable = options.includes(n);
        let meta;
        if (st.chain) meta = `Chain opens ${T.plural(T.clockwisePath(st, n).filter((k) => st.cells[k].sealed).length, 'door')}`;
        else if (!c.sealed && c.inmate) {
          const count = T.devourOptions(st, n).length;
          meta = `${T.describe(c.inmate)} · ${count ? T.plural(count, 'target') : 'no target'}`;
        } else if (!c.sealed) meta = 'Empty cell';
        else if (c.nest) meta = `Rat nest · hatches day ${c.nest.due}`;
        else if (c.known === 2) meta = `${T.describe(c.hidden)} inside`;
        else if (c.known === 1) meta = `${T.tierName(c.hidden.tier)} inside`;
        else meta = 'Locked · unknown inside';
        const event = c.sealed && c.event && !st.chain ? '<span class="dest-event">Event</span>' : '';
        // A known inmate shows its portrait; a locked cell shows its door.
        const face = !c.sealed && c.inmate
          ? `<span class="dest-face t${c.inmate.tier}" aria-hidden="true">${PORTRAITS[c.inmate.beast]}</span>`
          : `<span class="dest-door${c.sealed ? '' : ' is-open'}" aria-hidden="true"></span>`;
        const here = n === st.position ? ' (warden here)' : '';
        return `<button type="button" class="dest-card${chosen === n ? ' is-selected' : ''}" data-dest="${n}"${usable ? '' : ' disabled'}>${face}<span class="dest-label">Go to cell ${L(n)}</span><span class="dest-meta">${esc(meta + here)}</span>${event}</button>`;
      })
      .join(''));
  }

  function renderSample() {
    const make = (id, beast, tier) => ({ id, beast, tier });
    const base = (n) => ({ n, sealed: true, inmate: null, hidden: null, known: 0, scratch: false, nest: null, event: null, ivory: false });
    const spec = [
      { sealed: false },
      { event: 'chain' },
      { sealed: false, inmate: make(3, 'wolf', 1), ivory: true },
      { hidden: make(4, 'rat', 3), known: 1 },
      { sealed: false, inmate: make(5, 'mammoth', 4) },
      {},
      { sealed: false, inmate: make(7, 'rat', 0) },
      { nest: { due: 10 } },
      { sealed: false, inmate: make(9, 'rat', 3) },
      { event: 'execution' },
      { hidden: make(11, 'mammoth', 1), known: 1, scratch: true },
      { sealed: false, inmate: make(12, 'rat', 2) },
      { sealed: false, inmate: make(13, 'mammoth', 1) },
      {},
      { sealed: false, inmate: make(15, 'lion', 0) },
      { sealed: false, inmate: make(2, 'lion', 2) },
    ];
    const cells = spec.map((s, n) => Object.assign(base(n), s));
    const sample = { day: 9, position: 6, cells, prey: [{ lion: 2, prey: 12, rounds: 2 }] };
    // Three of the five cells just ahead of the warden, as on a real morning.
    const dests = new Set([8, 9, 10]);
    const html = cells
      .map((cell) => {
        const p = cellParts(cell, sample);
        const tag = dests.has(cell.n) ? (cell.sealed ? 'Go' : 'Walk') : '';
        if (tag) p.cls.push('is-dest');
        const [row, col] = RING[cell.n];
        return `<div class="${p.cls.join(' ')}" style="grid-row:${row};grid-column:${col}"><span class="cell-body">${p.body}</span><span class="door"></span><span class="cell-no">${L(cell.n)}</span><span class="cell-hint">${p.hint}</span><span class="cell-badges">${p.badges}</span><span class="cell-tag">${tag}</span><span class="cell-warden">${p.warden ? LANTERN : ''}</span></div>`;
      })
      .join('');
    $('sample-board').classList.add('is-patrolling');
    $('sample-board').innerHTML = `${html}<div class="board-center"><div class="decision"><div class="decision-text"><p class="decision-title">Patrol: pick a destination</p><p class="decision-detail">Day 9. The glowing cells are today's destinations, all within five steps clockwise of the warden. Open a locked door, or walk to an inmate you already know.</p></div></div></div>`;
  }

  // ---------- Rendering: decision panel ----------

  function setDecision(title, detail, actions, pending) {
    $('decision-title').textContent = title;
    $('decision-detail').textContent = detail || '';
    $('decision-actions').replaceChildren(...actions.map((a) => makeButton(a[0], a[1], a[2], a[3])));
    $('decision').classList.toggle('is-pending', !!pending);
  }

  function renderDecision() {
    const st = ui.state;
    if (st.phase === 'ended') {
      setDecision('Run complete', 'The handoff roster is ready. Undo the last move to keep playing, or start a new run.', [
        ['Handoff roster', openResults, 'primary'],
        ['New run', () => openNewRun()],
      ]);
      return;
    }
    if (st.pending.length) {
      const kind = st.pending[0].kind;
      const title = kind === 'gift' ? "Warden's Cache" : kind === 'refit' ? 'Refit' : 'Milestone';
      const detail = kind === 'gift' ? 'A Rainbow reached the vault. Pick one gift; it takes effect at once.' : kind === 'refit' ? 'Delivery complete. Pick a tool for the rest of the run.' : 'Your first Supreme earns a tool for the rest of the run.';
      setDecision(title, detail, [['Choose', openChoice, 'primary']], true);
      return;
    }
    if (windowOpen(st)) {
      const contract = T.currentContract(st);
      setDecision(
        st.challenge.window.early ? 'Early heavy delivery' : 'Delivery window',
        `"${contract.name}" is ready to ship: ${contract.needs.join('; ').toLowerCase()}.`,
        [['Prepare delivery', () => openDeliver(), 'primary'], ...(st.challenge.window.early ? [['Close window', () => run((s) => T.cancelEarlyDelivery(s))]] : [['Skip contract', () => run((s) => T.skipDelivery(s)), 'danger']])],
        true,
      );
      return;
    }
    if (st.phase === 'event' && st.event) {
      renderEvent(st);
      return;
    }
    if (ui.pending) {
      renderPending(ui.pending);
      return;
    }
    if (ui.selected !== null) {
      renderSelection(st.cells[ui.selected]);
      return;
    }
    if (st.phase === 'patrol') {
      const options = T.patrolOptions(st);
      const parts = [`The warden stands ${wardenAt(st)}. Pick one of the ${T.plural(options.length, 'cell')} below, or double-click a glowing cell on the ring. Whichever inmate the warden ends up with makes today's devour.`];
      if (st.chain) parts.push('Chain reaction armed: every sealed door on the clockwise walk opens.');
      setDecision('Patrol: select a destination', parts.join(' '), []);
      return;
    }
    const devours = devoursAvailable(st);
    const due = T.currentContract(st);
    const warden = st.cells[st.position];
    let lead;
    if (!T.canDevourNow(st)) lead = 'Today’s devour is used. Swap or end the day.';
    else if (st.position === T.OFFICE) lead = 'The warden is in the office, so there is no devour today. Swap or end the day.';
    else if (!warden.inmate || warden.sealed) lead = `The warden's cell (${L(st.position)}) is empty, so there is no devour today. Swap or end the day.`;
    else if (devours) lead = `The ${T.describe(warden.inmate)} in the warden's cell (${L(st.position)}) can make today's devour. Select it to see its ${T.plural(devours, 'target')}, or double-click a target to devour it. The eater then chains on by itself.`;
    else lead = `The ${T.describe(warden.inmate)} in the warden's cell (${L(st.position)}) has no target today. Swap or end the day.`;
    const parts = [lead];
    if (due && due.deadline === st.day) parts.push(`"${due.name}" is due: ending the day opens its delivery window.`);
    setDecision('Manage the block', parts.join(' '), []);
  }

  function renderEvent(st) {
    const { kind, cell: n } = st.event;
    if (kind === 'chain') {
      setDecision('Chain reaction', `Accept to arm it. Your next patrol walks clockwise from the warden to its destination and opens every sealed door on the way. Doors opened this way trigger nothing else.`, [
        ['Accept', () => run((s) => T.resolveEvent(s, true)), 'primary'],
        ['Skip', () => run((s) => T.resolveEvent(s, false))],
      ], true);
      return;
    }
    const exec = st.cells[n].inmate;
    const victims = T.executionVictims(st, n);
    const rule = st.params.executionSameTier ? 'same-rarity' : 'lower-rarity';
    const detail = victims.length
      ? `The ${T.describe(exec)} in cell ${L(n)} removes ${victims.map((c) => `${T.describe(c.inmate)} (${L(c.n)})`).join(', ')} and rises to ${T.tierName(Math.min(T.RAINBOW, exec.tier + victims.length))}.`
      : `The ${T.describe(exec)} in cell ${L(n)} has no ${rule} prey on the block, so accepting does nothing.`;
    setDecision('Execution', detail, [
      ['Accept', () => run((s) => T.resolveEvent(s, true)), 'primary'],
      ['Skip', () => run((s) => T.resolveEvent(s, false))],
    ], true);
  }

  function renderPending(p) {
    const st = ui.state;
    const back = () => {
      ui.pending = null;
      render();
    };
    if (p.kind === 'patrol') {
      const c = st.cells[p.cell];
      const parts = [];
      if (st.chain) {
        const opens = T.clockwisePath(st, p.cell).filter((k) => st.cells[k].sealed).length;
        parts.push(`Chain reaction: the walk from cell ${L(st.position)} opens ${T.plural(opens, 'sealed door')}, including this one.`);
      } else if (!c.sealed && c.inmate) {
        const count = T.devourOptions(st, p.cell).length;
        parts.push(`The warden walks to the ${T.describe(c.inmate)} in cell ${L(p.cell)}. It then makes today's devour${count ? ` (${T.plural(count, 'target')} from there)` : ', but it has no target from there'}.`);
      } else if (!c.sealed) parts.push('An empty cell: the warden walks there.');
      else if (c.nest) parts.push(`This destroys the rat nest due on day ${c.nest.due}.`);
      else if (c.known === 2) parts.push(`A ${T.describe(c.hidden)} waits inside.`);
      else if (c.known === 1) parts.push(`A ${T.tierName(c.hidden.tier)} inmate waits inside. Its beast is unknown.`);
      else parts.push('The occupant stays unknown until the door opens.');
      if (c.sealed && c.event && !st.chain) parts.push('A special event waits behind this door.');
      if (st.tools.includes('keys') && c.sealed && !st.chain) parts.push('Lost Key Ring: 80% chance the neighbors open too.');
      const actions = [[c.sealed || st.chain ? 'Open door' : 'Walk here', () => run((s) => T.patrol(s, p.cell), { select: p.cell }), 'primary']];
      actions.push(['Cancel', cancel]);
      setDecision(`Patrol to cell ${L(p.cell)}?`, parts.join(' '), actions, true);
      return;
    }
    if (p.kind === 'devour') {
      const eater = st.cells[p.from].inmate;
      const option = eater ? T.devourOptions(st, p.from).find((o) => o.cell === p.to) : null;
      if (!option) {
        ui.pending = null;
        renderDecision();
        return;
      }
      const target = st.cells[p.to];
      const { gain, notes, saw, revenge } = T.gainFor(st, p.from, option);
      const to = Math.min(T.RAINBOW, eater.tier + gain);
      const meal = target.sealed ? `the ${T.tierName(target.hidden.tier)} inmate behind the scratched door` : `the ${T.describe(target.inmate)}`;
      const extras = [];
      if (notes.length) extras.push(`Bonus: ${notes.join(', ')}.`);
      extras.push('This is today’s devour. Afterwards the eater chains on by itself into random valid targets. Click the target again to devour.');
      if (saw) extras.push('Rusty Saw may add +1.');
      if (revenge) extras.push("Avenger's Box may open a new meal.");
      if (T.linkOf(st, eater.id) && to < T.RAINBOW) extras.push('If its beast changes, its prey mark ends.');
      const outcome = to === T.RAINBOW ? 'reaches Rainbow and leaves for the vault' : `rises to ${T.tierName(to)}, then its beast re-rolls`;
      setDecision(`Devour, +${gain}?`, `The ${T.describe(eater)} in cell ${L(p.from)} eats ${meal} in cell ${L(p.to)}. It ${outcome}. ${extras.join(' ')}`.trim(), [
        ['Devour', () => run((s) => T.devour(s, p.from, p.to)), 'primary'],
        ['Cancel', back],
      ], true);
      return;
    }
    if (p.kind === 'swap') {
      const cell = st.cells[p.cell];
      if (!cell.inmate) {
        ui.pending = null;
        renderDecision();
        return;
      }
      const parts = [`A brand-new random inmate replaces the ${T.describe(cell.inmate)}. It can come out stronger or weaker.`];
      if (st.tools.includes('rope')) parts.push("Hangman's Rope: never Normal or Magic.");
      if (st.tools.includes('fire') && cell.inmate.tier < 3) parts.push('Burning Stake: 40% chance of a Legendary.');
      if (cell.ivory) parts.push(`Ivory cell: ${T.plural(st.params.ivoryCount, 'inmate')} then gain a tier.`);
      setDecision(`Swap cell ${L(p.cell)}?`, parts.join(' '), [
        ['Swap', () => run((s) => T.swap(s, p.cell)), 'primary'],
        ['Cancel', back],
      ], true);
      return;
    }
    if (p.kind === 'end') {
      const lead = p.last ? `Day ${st.day} is the last day. Ending it closes the run.` : p.deliveryDay ? 'Ending today opens the delivery window.' : '';
      setDecision(p.last ? 'Finish the run?' : `End day ${st.day}?`, [lead, ...p.warnings].filter(Boolean).join(' '), [
        [p.last ? 'Finish run' : 'End day', () => run((s) => T.endDay(s), { select: null }), 'primary'],
        ['Cancel', cancel],
      ], true);
    }
  }

  function renderSelection(cell) {
    const st = ui.state;
    const actions = [];
    const free = !blocked(st);
    if (cell.n === T.OFFICE) {
      setDecision(`Cell ${L(cell.n)}: the warden's office`, "Every run starts here. No inmate, marker or event is ever held in the office, so it is never a patrol destination. The warden passes it on the walk around the ring.", [['Deselect', cancel]]);
      return;
    }
    if (cell.sealed) {
      const parts = [];
      if (cell.nest) parts.push(`A rat nest. It hatches a ${T.tierName(st.params.nestTier)} Rat on the morning of day ${cell.nest.due}. Opening it earlier destroys it.`);
      else if (cell.known === 2) parts.push(`A ${T.describe(cell.hidden)} waits inside.`);
      else if (cell.known === 1) parts.push(`A ${T.tierName(cell.hidden.tier)} inmate waits inside. Its beast is unknown.`);
      else parts.push('The occupant is unknown.');
      if (cell.scratch) parts.push(`A ${T.tierName(cell.hidden.tier)} Wolf can devour it through the scratched door.`);
      if (cell.event) parts.push('A special event waits behind this door. It triggers only when a patrol opens it.');
      if (free && st.phase === 'patrol' && !st.destinations.includes(cell.n)) parts.push('It is not one of today’s destinations.');
      actions.push(['Deselect', cancel]);
      setDecision(`Cell ${L(cell.n)}: sealed`, parts.join(' '), actions);
      return;
    }
    if (!cell.inmate) {
      setDecision(`Cell ${L(cell.n)}: empty`, 'This cell stays empty for the rest of the run.', [['Deselect', cancel]]);
      return;
    }
    const inmate = cell.inmate;
    const eats = T.eatsOf(st, inmate.beast).map(T.beastName);
    if (inmate.beast === 'rat' && st.tools.includes('skewer')) eats.push('Rat');
    const parts = [`Eats ${eats.join(' and ')} of the same rarity.`];
    if (inmate.beast === 'wolf') parts.push('Can also devour through scratched doors.');
    if (st.phase === 'patrol') parts.push('Patrol first. Then the inmate in the warden’s cell can devour.');
    else if (st.phase === 'manage') {
      const options = T.devourOptions(st, cell.n);
      if (cell.n !== st.position) parts.push(`Only the inmate in the warden's cell (${L(st.position)}) can start today's devour.`);
      else if (!T.canDevourNow(st)) parts.push('Today’s devour is used.');
      else parts.push(options.length ? `It stands in the warden's cell: ${T.plural(options.length, 'target')} highlighted. Double-click one to devour it, or click once to preview the bite.` : 'It stands in the warden’s cell but has no target right now.');
    }
    if (cell.ivory) parts.push(`Ivory cell: swapping here raises ${T.plural(st.params.ivoryCount, 'inmate')} a tier.`);
    const link = T.linkOf(st, inmate.id);
    if (link) {
      const hunter = link.lion === inmate.id;
      const other = T.cellOf(st, hunter ? link.prey : link.lion);
      parts.push(`${hunter ? `Hunting cell ${other ? L(other.n) : '--'}` : `Prey of the Lion in cell ${other ? L(other.n) : '--'}`}: both rise a tier on each of the next ${T.plural(link.rounds, 'morning')}.`);
    }
    if (free && st.phase === 'manage' && cell.n === st.position) {
      const left = st.params.swapsPerDay - st.used.swap;
      actions.push([`Swap (${Math.max(0, left)} left)`, () => askSwap(cell.n), null, left <= 0]);
    } else if (st.phase === 'manage') parts.push("Only the inmate in the warden's cell can be swapped.");
    actions.push(['Deselect', cancel]);
    setDecision(`Cell ${L(cell.n)}: ${T.describe(inmate)}`, parts.join(' '), actions);
  }

  // ---------- Rendering: frame and ledger ----------

  function renderTop() {
    const st = ui.state;
    const hard = hardModeLabels(st);
    $('mode-chip').textContent = `${modeName(st)}${hard.length ? ` · Hard: ${hard.join(', ')}` : ''} · ${st.seed}`;
    const chain = $('chain-svg');
    chain.classList.toggle('is-loop', !!st.params.loopChain);
    $('chain-desc').textContent = st.params.loopChain
      ? 'Loop food chain: Mammoth eats Lion. Lion eats Wolf. Wolf eats Rat. Rat eats Mammoth.'
      : 'Mammoth eats Lion and Wolf. Lion eats Wolf and Rat. Wolf eats Rat. Rat eats Mammoth.';
    $('chain-note').textContent = `${st.params.loopChain ? 'Hard mode loop: each beast has one meal. ' : ''}Arrows point from eater to meal. Both must share a rarity. A devour raises the eater one tier, then re-rolls its beast.`;
    $('day-num').textContent = String(st.day).padStart(2, '0');
    $('day-of').textContent = `/ ${st.maxDays}`;
    const pill = $('phase-pill');
    const phase = st.phase === 'ended' ? 'Handed off' : st.phase === 'patrol' ? 'Patrol' : st.phase === 'event' ? 'Event' : windowOpen(st) ? 'Delivery' : 'Manage';
    pill.textContent = phase;
    pill.className = 'phase' + (st.phase === 'ended' ? ' is-ended' : st.phase === 'patrol' ? '' : ' is-manage');
    const left = st.maxDays - st.day;
    $('handoff').textContent = st.phase === 'ended' ? 'Run complete' : left === 0 ? 'Last day' : `${T.plural(left, 'day')} after today`;
  }

  function renderActions() {
    const st = ui.state;
    const free = !blocked(st);
    const swapBtn = $('btn-swap');
    const left = Math.max(0, st.params.swapsPerDay - st.used.swap);
    const here = st.cells[st.position];
    const canSwap = free && st.phase === 'manage' && left > 0 && !here.sealed && !!here.inmate;
    swapBtn.textContent = `Swap (${left})`;
    swapBtn.disabled = !canSwap;
    swapBtn.title = canSwap ? `Swap the inmate in the warden's cell (${L(st.position)}).` : "Only the inmate in the warden's cell can be swapped, after the patrol.";

    const deliverBtn = $('btn-deliver');
    deliverBtn.hidden = st.mode !== 'challenge';
    if (st.mode === 'challenge') {
      const early = T.canOpenEarly(st);
      deliverBtn.textContent = windowOpen(st) ? 'Delivery window' : 'Deliver heavy early';
      deliverBtn.disabled = !windowOpen(st) && !early;
    }

    $('btn-undo').disabled = !ui.history.length;
    const endBtn = $('btn-end');
    endBtn.disabled = !free || st.phase !== 'manage';
    const due = T.currentContract(st);
    endBtn.textContent = st.mode === 'drill' && st.day >= st.maxDays ? 'Finish run' : due && due.deadline === st.day ? 'End day · deliver' : 'End day';
  }

  function renderLog() {
    const st = ui.state;
    const list = $('log');
    const last = st.log[st.log.length - 1];
    const key = `${st.log.length}|${last ? last.t : ''}|${st.seed}`;
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    const items = [];
    let day = null;
    for (let i = st.log.length - 1; i >= 0; i--) {
      const e = st.log[i];
      if (e.d !== day) {
        day = e.d;
        items.push(`<li class="log-day">Day ${String(e.d).padStart(2, '0')}</li>`);
      }
      // A devour also shows its bites as icons; the text says the same.
      const icons = e.x && e.x.type === 'devour' ? `<span class="log-icons" aria-hidden="true">${chainStrip(e.x)}</span>` : '';
      items.push(`<li class="log-entry k-${esc(e.k)}"><span class="log-text">${esc(e.t)}${icons}</span></li>`);
    }
    list.innerHTML = items.join('') || '<li class="log-empty">Nothing logged yet.</li>';
  }

  // ---------- Beast icons and the day recap ----------

  // A small portrait in its rarity color. Meals are struck through, and a
  // Rainbow gets the rainbow ring.
  function tok(who, opts) {
    const o = opts || {};
    const cls = ['tok', `t${who.tier}`];
    if (o.eaten) cls.push('is-eaten');
    if (who.tier >= T.RAINBOW) cls.push('is-rainbow');
    const title = `${T.describe(who)}${o.cell !== undefined ? `, cell ${L(o.cell)}` : ''}${o.eaten ? ', eaten' : ''}`;
    return `<span class="${cls.join(' ')}" title="${esc(title)}">${PORTRAITS[who.beast]}</span>`;
  }

  // A devour as icons: each bite is the eater, its fangs with the tiers it
  // gained, and the meal. Every bite re-rolls the eater, so the next bite
  // starts from its new form, and the strip ends with how it finished.
  function chainStrip(x) {
    const then = '<span class="then">›</span>';
    const bites = x.bites.map((b) => `<span class="bite">${tok(b.eater, { cell: b.from })}<span class="fang">${FANGS}<b>+${b.gain}</b></span>${tok(b.meal, { cell: b.cell, eaten: true })}</span>`);
    const end = x.bites[x.bites.length - 1].after;
    return `<span class="chain-strip">${bites.join(then)}${then}${tok(end)}${end.tier >= T.RAINBOW ? '<span class="vault-note">Vault</span>' : ''}</span>`;
  }

  // Each morning the recap under the ring looks back at yesterday; after the
  // patrol it follows today. On day 1 the patrol hint has the space.
  function renderRecap() {
    const st = ui.state;
    const day = st.phase === 'patrol' ? st.day - 1 : st.day;
    const items = day >= 1 ? recapItems(st, day) : [];
    const box = $('day-recap');
    box.hidden = !items.length;
    $('dest-hint').hidden = items.length > 0;
    if (!items.length) return;
    $('recap-title').textContent = st.phase === 'patrol' || st.phase === 'ended' ? `Day ${String(day).padStart(2, '0')} recap` : 'Today so far';
    setHTML($('recap-items'), items.join(''));
  }

  function recapItems(st, day) {
    const item = (label, body, cls) => `<li class="recap-item${cls ? ` ${cls}` : ''}"><span class="recap-label">${esc(label)}</span>${body}</li>`;
    const records = st.log.filter((e) => e.d === day && e.x).map((e) => e.x);
    const out = [];
    for (let i = 0; i < records.length; i++) {
      const x = records[i];
      if (x.type === 'open' && x.side) {
        // Doors opened together (Key Ring, a chain reaction) share one item.
        const group = [x];
        while (records[i + 1] && records[i + 1].type === 'open' && records[i + 1].side) group.push(records[++i]);
        out.push(item(group.length === 1 ? `Also opened ${L(x.cell)}` : `${group.length} extra doors`, group.map((g) => tok(g.who, { cell: g.cell })).join('')));
      } else if (x.type === 'open') out.push(item(`Opened ${L(x.cell)}`, tok(x.who, { cell: x.cell })));
      else if (x.type === 'walk') out.push(item(`Walked to ${L(x.cell)}`, x.who ? tok(x.who, { cell: x.cell }) : ''));
      else if (x.type === 'sweep') out.push(item(`Chain walk ${L(x.from)} to ${L(x.cell)}`, ''));
      else if (x.type === 'armed') out.push(item('Chain reaction armed', ''));
      else if (x.type === 'skipped') out.push(item(`Skipped ${x.name}`, ''));
      else if (x.type === 'execution') {
        const took = x.victims.length ? `<span class="fang">${FANGS}<b>×${x.victims.length}</b></span>${x.victims.map((v) => tok(v, { eaten: true })).join('')}` : '<span class="recap-note">no one</span>';
        out.push(item('Execution', `${tok(x.who, { cell: x.cell })}${took}`, 'is-devour'));
      } else if (x.type === 'devour') out.push(item(x.bites.length > 1 ? `Chain ×${x.bites.length}` : 'Devour', chainStrip(x), 'is-devour'));
      else if (x.type === 'swap') out.push(item(`Swap ${L(x.cell)}`, `${tok(x.old, { cell: x.cell, eaten: true })}<span class="then">›</span>${tok(x.fresh, { cell: x.cell })}`));
      else if (x.type === 'rainbow') out.push(item('Rainbow', tok(x.who), 'is-rainbow'));
      else if (x.type === 'tool') out.push(item('Tool', `<span class="recap-note">${esc(T.toolName(x.id))}</span>`));
      else if (x.type === 'gift') out.push(item('Cache', `<span class="recap-note">${esc(T.toolName(x.id))}</span>`));
      else if (x.type === 'ivory') out.push(item('Ivory', `<span class="recap-note">${T.plural(x.count, 'inmate')} +1</span>`));
      else if (x.type === 'deliver') out.push(item('Delivered', `<span class="recap-note">${esc(x.name)} · ${x.points} pts</span>`));
      else if (x.type === 'skip') out.push(item('Skipped', `<span class="recap-note">${esc(x.name)}</span>`));
    }
    return out;
  }

  function facts(pairs) {
    return pairs.map(([k, v, text]) => `<div><dt>${esc(k)}</dt><dd${text ? ' class="is-text"' : ''}>${esc(v)}</dd></div>`).join('');
  }

  function renderGoal() {
    const st = ui.state;
    const board = T.boardInmates(st);
    if (st.mode === 'challenge') {
      const ch = st.challenge;
      $('goal-title').textContent = 'Contract challenge';
      $('goal-text').textContent = `Deliver at least two contracts, including the heavy one. Seed ${st.seed}.`;
      $('goal-facts').innerHTML = facts([
        ['Vouchers', ch.vouchers],
        ['Score', ch.score],
        ['Delivered', `${ch.deliveries.filter((d) => d.success).length} / 3`],
      ]);
      return;
    }
    $('goal-title').textContent = st.scenario === 'empty' ? 'Rules drill' : T.SCENARIOS[st.scenario].name;
    $('goal-text').textContent = `Raise as many inmates to Rainbow as you can before the run ends on day ${st.maxDays}. Seed ${st.seed}.`;
    const best = Math.max(st.vault.length ? T.RAINBOW : 0, ...board.map((i) => i.tier), 0);
    $('goal-facts').innerHTML = facts([
      ['Rainbows', st.vault.length],
      ['Best now', board.length || st.vault.length ? T.tierName(best) : '—', true],
      ['On block', board.length],
    ]);
  }

  function renderVault() {
    const st = ui.state;
    const slots = Math.max(5, st.vault.length + 1);
    let html = '';
    for (let i = 0; i < slots; i++) {
      const v = st.vault[i];
      html += v
        ? `<span class="vault-slot is-filled" title="Rainbow ${esc(T.beastName(v.beast))}, contained on day ${v.day}"><span>${PORTRAITS[v.beast]}</span></span>`
        : '<span class="vault-slot" aria-hidden="true"></span>';
    }
    $('vault').innerHTML = html;
    const cache = st.params.rewards ? `Warden's Cache gifts earned: ${st.cache}.` : `Warden's Cache claims: ${st.cache}.`;
    $('vault-note').textContent = st.vault.length
      ? `${T.plural(st.vault.length, 'Rainbow')} in the vault. ${cache}${st.mode === 'challenge' ? ' Vault Rainbows count for the heavy contract.' : ''}`
      : st.params.rewards
        ? "Inmates that reach Rainbow leave the block and wait here. Each one opens the Warden's Cache, where you pick a gift."
        : "Inmates that reach Rainbow leave the block and wait here. Each one adds a Warden's Cache claim.";
  }

  function renderTools() {
    const st = ui.state;
    const list = $('tool-list');
    if (!st.tools.length) {
      let empty;
      if (st.mode === 'challenge') empty = 'No tools yet. Your first Supreme and each of your first two deliveries earn one.';
      else if (st.params.rewards) empty = 'No tools yet. Your first Supreme earns one. The Lab can add more, or start drills with random tools.';
      else empty = 'Rewards are off for this drill. Add tools in the Lab to test them.';
      list.innerHTML = `<li class="tool-text">${empty}</li>`;
      return;
    }
    list.innerHTML = st.tools.map((id) => `<li class="tool"><span class="tool-name">${esc(T.toolName(id))}</span><span class="tool-text">${esc(T.toolText(id))}</span></li>`).join('');
  }

  function renderContracts() {
    const st = ui.state;
    const panel = $('panel-contracts');
    panel.hidden = st.mode !== 'challenge';
    if (panel.hidden) return;
    const ch = st.challenge;
    let html = `<div class="voucher-line"><span><b>${ch.vouchers}</b> vouchers</span><span><b>${ch.score}</b> points</span></div>`;
    ch.contracts.forEach((c, i) => {
      const d = ch.deliveries[i];
      const active = !d && i === ch.deliveries.length;
      let status;
      if (d && d.success) status = `<span class="status is-done">Delivered · ${d.points} pts</span>`;
      else if (d) status = '<span class="status is-failed">Missed</span>';
      else if (active) status = `<span class="status is-active">Due end of day ${c.deadline}</span>`;
      else status = `<span class="status">Due day ${c.deadline}</span>`;
      html += `<article class="contract${active ? ' is-active' : ''}${d && !d.success ? ' is-missed' : ''}">
        <div class="contract-head"><span class="contract-name">${esc(c.name)}</span>${status}</div>
        <ul class="contract-lines">${c.needs.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        ${c.heavy ? '<p class="contract-meta"><span class="contract-heavy">Heavy contract</span> · needed to pass</p>' : ''}
      </article>`;
    });
    if (T.canOpenEarly(st)) html += '<button type="button" class="btn" data-early>Deliver the heavy contract early</button>';
    $('contract-list').innerHTML = html;
  }

  function tipAction(tip) {
    switch (tip.kind) {
      case 'patrol':
        return ['Go', () => run((s) => T.patrol(s, tip.cell), { select: tip.cell })];
      case 'devour':
        return ['Devour', () => run((s) => T.devour(s, tip.from, tip.to), { select: tip.from })];
      case 'swap':
        return ['Swap', () => run((s) => T.swap(s, tip.cell))];
      case 'event':
        return [tip.accept ? 'Accept' : 'Skip', () => run((s) => T.resolveEvent(s, tip.accept))];
      case 'choose':
        return ['Take', () => run((s) => T.choose(s, tip.id))];
      case 'cargo':
        return ['Load', () => openDeliver(tip.cargo)];
      case 'early':
        return ['Open', () => run((s) => T.openEarlyDelivery(s))];
      case 'end':
        return ['End day', askEndDay];
      default:
        return null;
    }
  }

  function renderAdvisor() {
    const panel = $('panel-advisor');
    panel.hidden = !ui.prefs.advisor;
    $('btn-advisor').setAttribute('aria-pressed', String(ui.prefs.advisor));
    if (!ui.prefs.advisor) return;
    const tips = T.advise(ui.state);
    const list = $('advisor-list');
    if (!tips.length) {
      list.innerHTML = '<li class="tip"><span>The run is over. Open the handoff roster to review it.</span></li>';
      return;
    }
    list.replaceChildren(
      ...tips.map((tip) => {
        const li = document.createElement('li');
        li.className = 'tip';
        const text = document.createElement('span');
        text.textContent = tip.text;
        li.appendChild(text);
        const action = tipAction(tip);
        if (action) li.appendChild(makeButton(action[0], action[1]));
        return li;
      }),
    );
  }

  function render() {
    if (!ui.state || ui.screen !== 'game') return;
    renderTop();
    renderBoard();
    renderDestBar();
    renderRecap();
    renderDecision();
    renderActions();
    renderLog();
    renderGoal();
    renderAdvisor();
    renderContracts();
    renderVault();
    renderTools();
    $('screen-game').classList.toggle('is-immersive', !!ui.prefs.immersive);
    $('btn-sound').setAttribute('aria-pressed', String(ui.prefs.sound));
    $('btn-sound').textContent = ui.prefs.sound ? 'Sound on' : 'Sound off';
  }

  // ---------- Screens and runs ----------

  function showScreen(name) {
    ui.screen = name === 'game' && ui.state ? 'game' : 'title';
    $('screen-title').hidden = ui.screen !== 'title';
    $('screen-game').hidden = ui.screen !== 'game';
    if (ui.screen === 'title') renderTitle();
    else render();
  }

  function renderTitle() {
    const st = ui.state;
    $('btn-continue').hidden = !st;
    if (st) $('continue-meta').textContent = st.phase === 'ended' ? `${modeName(st)} · finished` : `${modeName(st)} · day ${st.day} of ${st.maxDays}`;
    $('btn-title-sound').textContent = `Sound: ${ui.prefs.sound ? 'on' : 'off'}`;
  }

  // Dialogs that belong to one run close whenever the run is replaced.
  function closeRunDialogs() {
    for (const id of ['dlg-choice', 'dlg-deliver', 'dlg-results']) closeDialog(id);
  }

  function startRun(opts) {
    ui.state = T.newGame(Object.assign({ params: ui.labParams }, opts));
    ui.history = [];
    ui.selected = null;
    ui.pending = null;
    closeRunDialogs();
    persist();
    showScreen('game');
    Sound.play('open');
  }

  function routeFromTitle(route) {
    const unfinished = ui.state && ui.state.phase !== 'ended';
    if (route === 'drill' && !unfinished) startRun({ mode: 'drill', scenario: 'empty' });
    else if (route === 'drill') openNewRun({ mode: 'drill', scenario: 'empty' });
    else if (route === 'challenge') openNewRun({ mode: 'challenge' });
    else openNewRun({ mode: 'drill', scenario: 'events' });
  }

  function openNewRun(preset) {
    const p = preset || {};
    const mode = p.mode || (ui.state ? ui.state.mode : 'drill');
    $(mode === 'challenge' ? 'new-mode-challenge' : 'new-mode-drill').checked = true;
    const scenario = p.scenario || (ui.state && ui.state.scenario) || 'empty';
    const loadout = p.loadout || (ui.state && ui.state.loadout) || 'supply';
    $('scenario-options').innerHTML = Object.entries(T.SCENARIOS)
      .map(([key, s]) => `<label class="option"><input type="radio" name="scenario" value="${key}"${key === scenario ? ' checked' : ''}><strong>${esc(s.name)}</strong><small>${esc(s.text)}</small></label>`)
      .join('');
    $('loadout-options').innerHTML = Object.entries(T.LOADOUTS)
      .map(([key, k]) => `<label class="option"><input type="radio" name="loadout" value="${key}"${key === loadout ? ' checked' : ''}><strong>${esc(k.name)} · ${esc(k.level)}</strong><small>${esc(k.text)}</small></label>`)
      .join('');
    $('new-seed').value = T.randomSeed();
    $('new-loop-chain').checked = !!ui.labParams.loopChain;
    syncNewMode();
    $('new-replace').hidden = !(ui.state && ui.state.phase !== 'ended');
    openDialog('dlg-new');
  }

  function syncNewMode() {
    const challenge = $('new-mode-challenge').checked;
    $('new-scenarios').hidden = challenge;
    $('new-loadouts').hidden = !challenge;
  }

  // ---------- Dialogs ----------

  const onOpen = {
    'dlg-run': fillRunDialog,
    'dlg-prefs': fillPrefs,
    'dlg-lab': fillLab,
  };

  function openDialog(id) {
    const d = $(id);
    if (onOpen[id]) onOpen[id]();
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  function closeDialog(id) {
    const d = $(id);
    if (!d.open) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function fillRunDialog() {
    const st = ui.state;
    const runButtons = ['btn-run-undo', 'btn-run-export', 'btn-run-end'];
    if (!st) {
      $('run-facts').innerHTML = facts([['Run', 'No run yet', true]]);
      $('run-inmates').innerHTML = '<li>Start a run from the title screen.</li>';
      runButtons.forEach((id) => ($(id).disabled = true));
      return;
    }
    $('run-facts').innerHTML = facts([
      ['Mode', modeName(st), true],
      ['Seed', st.seed, true],
      ['Day', `${st.day} / ${st.maxDays}`],
      ['Warden at', L(st.position)],
      ['Rainbows', st.vault.length],
      ['Moves to undo', ui.history.length],
    ]);
    const cells = st.cells.filter((c) => !c.sealed && c.inmate).sort((a, b) => b.inmate.tier - a.inmate.tier || a.n - b.n);
    $('run-inmates').innerHTML = cells.length
      ? cells.map((c) => `<li class="t${c.inmate.tier}"><b>${T.tierName(c.inmate.tier)}</b> ${T.beastName(c.inmate.beast)} · cell ${L(c.n)}${c.ivory ? ' · Ivory' : ''}</li>`).join('')
      : '<li>No inmates on the block.</li>';
    $('btn-run-undo').disabled = !ui.history.length;
    $('btn-run-export').disabled = false;
    $('btn-run-end').disabled = st.phase === 'ended';
    $('btn-run-end').textContent = 'End run now';
    ui.endArmed = 0;
  }

  function fillPrefs() {
    $('pref-advisor').checked = !!ui.prefs.advisor;
    $('pref-quick').checked = !!ui.prefs.quick;
    $('pref-motion').checked = !!ui.prefs.motion;
    $('pref-immersive').checked = !!ui.prefs.immersive;
    $('pref-sound').checked = !!ui.prefs.sound;
    $('pref-volume').value = ui.prefs.volume;
  }

  function setPref(key, value) {
    ui.prefs[key] = value;
    store.set(KEYS.prefs, ui.prefs);
    applyPrefs();
  }

  function applyPrefs() {
    document.documentElement.classList.toggle('no-motion', !ui.prefs.motion);
    Sound.setEnabled(ui.prefs.sound);
    Sound.setVolume(ui.prefs.volume / 100);
    renderTitle();
    render();
  }

  function openExport() {
    if (!ui.state) {
      toast('There is no run to export yet.');
      return;
    }
    $('save-title').textContent = 'Export save';
    $('save-export').hidden = false;
    $('save-import').hidden = true;
    $('save-out').value = JSON.stringify({ app: 'tartarus-sim', v: T.VERSION, savedAt: new Date().toISOString(), state: ui.state });
    $('btn-save-download').hidden = EMBEDDED;
    $('btn-save-copy').textContent = 'Copy save';
    openDialog('dlg-save');
  }

  function openImport() {
    $('save-title').textContent = 'Import save';
    $('save-export').hidden = true;
    $('save-import').hidden = false;
    $('save-in').value = '';
    $('save-file').value = '';
    $('save-error').hidden = true;
    openDialog('dlg-save');
  }

  function copySave() {
    const area = $('save-out');
    const done = () => {
      $('btn-save-copy').textContent = 'Copied';
      setTimeout(() => ($('btn-save-copy').textContent = 'Copy save'), 2000);
    };
    const fallback = () => {
      area.focus();
      area.select();
      $('btn-save-copy').textContent = 'Press Ctrl+C to copy';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(area.value).then(done, fallback);
    else fallback();
  }

  function downloadSave() {
    const st = ui.state;
    const blob = new Blob([$('save-out').value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tartarus-${st.seed.replace(/[^A-Z0-9-]/gi, '')}-day${st.day}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function loadSave() {
    const text = $('save-in').value.trim();
    const error = $('save-error');
    if (!text) {
      error.textContent = 'Choose a save file or paste save text first.';
      error.hidden = false;
      return;
    }
    try {
      ui.state = T.deserialize(text);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      return;
    }
    ui.history = [];
    ui.selected = null;
    ui.pending = null;
    closeRunDialogs();
    persist();
    closeDialog('dlg-save');
    showScreen('game');
    toast(`Loaded ${modeName(ui.state)}, day ${ui.state.day}.`, true);
    followUp(0);
  }

  // ---------- Choices, delivery and results ----------

  function openChoice() {
    const st = ui.state;
    const choice = st && st.pending[0];
    if (!choice) {
      closeDialog('dlg-choice');
      return;
    }
    const copy = {
      tool: ['Milestone', 'Choose a tool', 'Your first Supreme earns one tool for the rest of the run.'],
      gift: ["Warden's Cache", 'Choose a gift', 'A Rainbow reached the vault. Pick one gift; it takes effect at once.'],
      refit: ['Refit', 'Choose a tool', 'Delivery complete. Take one tool for the rest of the run.'],
    }[choice.kind];
    $('choice-eyebrow').textContent = copy[0];
    $('choice-title').textContent = copy[1];
    $('choice-note').textContent = copy[2];
    $('choice-options').innerHTML = choice.options
      .map((id) => `<div class="refit-card"><strong>${esc(T.toolName(id))}</strong><p>${esc(T.toolText(id))}</p><button type="button" class="btn btn-primary" data-take="${id}">Take</button></div>`)
      .join('');
    const refresh = $('btn-choice-refresh');
    refresh.hidden = choice.kind !== 'refit';
    refresh.disabled = !T.canRefresh(st);
    refresh.textContent = choice.refreshed ? 'Offer already refreshed' : `Refresh offer · 1 voucher (${st.challenge ? st.challenge.vouchers : 0} left)`;
    openDialog('dlg-choice');
  }

  function openDeliver(preset) {
    const st = ui.state;
    if (!st || !st.challenge) return;
    if (!windowOpen(st)) {
      if (preset || !T.canOpenEarly(st)) return;
      if (!run((s) => T.openEarlyDelivery(s))) return;
    }
    cargo.cells = new Set(preset ? preset.cells : []);
    cargo.vault = new Set(preset ? preset.vaultIds : []);
    cargo.escort = preset ? preset.escort : 'light';
    renderDeliver();
    openDialog('dlg-deliver');
  }

  function renderDeliver() {
    const st = ui.state;
    if (!windowOpen(st)) {
      closeDialog('dlg-deliver');
      return;
    }
    const ch = st.challenge;
    const contract = T.currentContract(st);
    const early = ch.window.early;
    $('deliver-eyebrow').textContent = early ? 'Early heavy delivery' : `Delivery window · day ${st.day}`;
    $('deliver-title').textContent = contract.name;
    $('deliver-contract').innerHTML = `<div class="contract-head"><span class="contract-name">${esc(contract.name)}</span><span class="status is-active">${contract.heavy ? 'Heavy contract' : `Due day ${contract.deadline}`}</span></div><ul class="contract-lines">${contract.needs.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><p class="contract-meta">${ch.vouchers} ${ch.vouchers === 1 ? 'voucher' : 'vouchers'} left · each inmate scores 2 to the power of its tier</p>`;
    const rows = [
      ...st.vault.map((v) => ({ kind: 'vault', key: v.id, tier: T.RAINBOW, beast: v.beast, where: 'vault' })),
      ...st.cells.filter((c) => !c.sealed && c.inmate).map((c) => ({ kind: 'cell', key: c.n, tier: c.inmate.tier, beast: c.inmate.beast, where: L(c.n) })),
    ].sort((a, b) => b.tier - a.tier);
    $('deliver-inmates').innerHTML = rows.length
      ? rows
          .map((r) => {
            const checked = r.kind === 'cell' ? cargo.cells.has(r.key) : cargo.vault.has(r.key);
            return `<label class="pick t${r.tier}"><input type="checkbox" data-kind="${r.kind}" value="${r.key}"${checked ? ' checked' : ''}><b>${T.tierName(r.tier)}</b> ${T.beastName(r.beast)} · ${r.where}<small>P${T.PRESSURE[r.tier]} · ${2 ** r.tier} pts</small></label>`;
          })
          .join('')
      : '<p class="field-note">Nobody is on the block or in the vault.</p>';
    $('btn-deliver-skip').hidden = early;
    $('btn-deliver-close').hidden = !early;
    $('btn-deliver-best').disabled = !T.bestCargo(st);
    updateDeliverStatus();
  }

  function updateDeliverStatus() {
    const st = ui.state;
    const ch = st.challenge;
    const check = T.deliveryCheck(st, [...cargo.cells], [...cargo.vault], cargo.escort);
    if (cargo.escort === 'light' && check.pressure > T.ESCORTS.light.cap) {
      cargo.escort = 'heavy';
      return updateDeliverStatus();
    }
    $('escort-light').checked = cargo.escort === 'light';
    $('escort-heavy').checked = cargo.escort === 'heavy';
    const picked = cargo.cells.size + cargo.vault.size;
    const status = $('deliver-status');
    if (check.ok) {
      status.textContent = `Ready: ${check.points} points${check.bonus ? ` (including a ${check.bonus}-point bounty)` : ''}, pressure ${check.pressure} of ${T.ESCORTS[cargo.escort].cap}. Costs ${T.plural(check.cost, 'voucher')}, leaving ${ch.vouchers - check.cost}. These inmates leave the run.`;
      status.className = 'deliver-status is-ok';
    } else {
      status.textContent = picked ? check.reason : 'Pick the inmates to send.';
      status.className = 'deliver-status' + (picked ? ' is-bad' : '');
    }
    $('btn-deliver-confirm').disabled = !check.ok;
  }

  function confirmDeliver() {
    if (run((s) => T.deliver(s, [...cargo.cells], [...cargo.vault], cargo.escort), { select: null })) closeDialog('dlg-deliver');
  }

  function openResults() {
    const st = ui.state;
    if (!st || !st.result) return;
    const r = st.result;
    const hard = hardModeLabels(st);
    $('results-eyebrow').textContent = `${modeName(st)}${hard.length ? ` · Hard: ${hard.join(', ')}` : ''} · seed ${st.seed}`;
    const verdict = $('results-verdict');
    const ch = st.challenge;
    if (ch && ch.result) {
      const res = ch.result;
      verdict.hidden = false;
      verdict.className = 'verdict' + (res.passed ? '' : ' is-fail');
      const heading = res.grade === 'full' ? 'Full clear' : res.passed ? 'Challenge passed' : 'Challenge failed';
      const reason = res.passed
        ? `${T.plural(res.completed, 'contract')} delivered, including the heavy one.`
        : res.completed >= 2
          ? 'Two contracts delivered, but not the heavy one.'
          : `${T.plural(res.completed, 'contract')} delivered. You need two, including the heavy one.`;
      verdict.innerHTML = `${heading}<small>${esc(reason)}</small>`;
      $('results-facts').innerHTML = facts([
        ['Score', res.score],
        ['Contracts', `${res.completed} / 3`],
        ['Vouchers left', res.vouchers],
        ['Rainbows', st.cache],
        ['Best rarity', T.tierName(r.best), true],
        ['Devours', r.stats.devours],
      ]);
      $('results-contracts').innerHTML = `<div class="table-scroll"><table class="score-table"><thead><tr><th>Contract</th><th>Day</th><th>Result</th><th>Points</th></tr></thead><tbody>${ch.deliveries
        .map((d, i) => `<tr><td>${esc(ch.contracts[i].name)}</td><td>${d.day}</td><td>${d.success ? `${d.early ? 'Delivered early' : 'Delivered'}, ${escortName(d.escort)}` : 'Missed'}</td><td>${d.points}</td></tr>`)
        .join('')}<tr class="total"><td>Score</td><td></td><td></td><td>${res.score}</td></tr></tbody></table></div>`;
    } else {
      verdict.hidden = true;
      $('results-contracts').innerHTML = '';
      $('results-facts').innerHTML = facts([
        ['Rainbows', r.roster.byTier[T.RAINBOW]],
        [st.params.rewards ? 'Cache gifts' : 'Cache claims', r.cache],
        ['Best rarity', T.tierName(r.best), true],
        ['Inmates', r.roster.rows.length],
        ['Patrols', r.stats.patrols],
        ['Devours', r.stats.devours],
        ['Swaps', r.stats.swaps],
        ['Executions', r.stats.executions],
      ]);
    }
    let roster = '';
    for (let t = T.RAINBOW; t >= 0; t--) {
      const rows = r.roster.rows.filter((x) => x.tier === t);
      if (!rows.length) continue;
      roster += `<div class="roster-row t${t}"><span class="tier-name">${T.TIERS[t]} ×${rows.length}</span><span class="names">${rows.map((x) => `${esc(T.beastName(x.beast))} <small>(${esc(x.where)})</small>`).join(', ')}</span></div>`;
    }
    $('results-roster').innerHTML = roster || '<p class="roster-empty">Nobody was left to hand off.</p>';
    openDialog('dlg-results');
  }

  function summaryText() {
    const st = ui.state;
    const r = st.result;
    const hard = hardModeLabels(st);
    const lines = [`Tartarus Simulator · ${modeName(st)}${hard.length ? ` · Hard: ${hard.join(', ')}` : ''} · seed ${st.seed}`, `Day ${r.day} of ${st.maxDays}${r.early ? ' (closed early)' : ''}`];
    const ch = st.challenge;
    if (ch && ch.result) {
      lines.push(`${ch.result.passed ? 'Passed' : 'Failed'} · ${T.plural(ch.result.completed, 'contract')} delivered · score ${ch.result.score} · ${T.plural(ch.result.vouchers, 'voucher')} left`);
      ch.deliveries.forEach((d, i) => lines.push(`${ch.contracts[i].name}: ${d.success ? `delivered on day ${d.day} (${d.points} points)` : 'missed'}`));
    }
    lines.push(`Rainbows: ${st.cache} · Best: ${T.tierName(r.best)}`);
    for (let t = T.RAINBOW; t >= 0; t--) {
      const rows = r.roster.rows.filter((x) => x.tier === t);
      if (rows.length) lines.push(`${T.TIERS[t]} ×${rows.length}: ${rows.map((x) => T.beastName(x.beast)).join(', ')}`);
    }
    lines.push(`Moves: ${r.stats.patrols} patrols, ${r.stats.devours} devours, ${r.stats.swaps} swaps, ${r.stats.executions} executions`);
    return lines.join('\n');
  }

  function copySummary() {
    const button = $('btn-results-copy');
    const done = () => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy summary'), 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(summaryText()).then(done, () => toast('Copying is blocked here. Use Export save instead.'));
    else toast('Copying is blocked here. Use Export save instead.');
  }

  // ---------- Lab ----------

  function fillLab() {
    const st = ui.state;
    const locked = !st || st.mode !== 'drill' || st.phase === 'ended';
    const note = $('lab-locked');
    note.hidden = !locked;
    if (!st) note.textContent = 'Start a drill to use the scene editor.';
    else if (st.mode !== 'drill') note.textContent = 'The contract challenge uses fixed rules, so the scene editor is off. Start a drill to edit scenes.';
    else note.textContent = 'This run is over. Start a new drill to edit scenes.';
    $('lab-editor').hidden = locked;
    if (!locked) {
      renderLabGrid();
      fillLabForm();
      renderLabTools();
    }
    renderParamsForm();
    selectLabTab(ui.labTab);
  }

  function selectLabTab(tab) {
    ui.labTab = tab;
    const scene = tab === 'scene';
    $('tab-scene').setAttribute('aria-selected', String(scene));
    $('tab-params').setAttribute('aria-selected', String(!scene));
    $('lab-scene').hidden = !scene;
    $('lab-params').hidden = scene;
    $('btn-params-reset').hidden = scene;
    $('btn-params-save').hidden = scene;
  }

  function renderLabGrid() {
    const st = ui.state;
    $('lab-grid').replaceChildren(
      ...st.cells.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        const open = !c.sealed && c.inmate;
        const office = c.n === T.OFFICE;
        b.className = 'mini' + (open ? ` t${c.inmate.tier}` : '') + (office ? ' is-office' : '') + (st.position === c.n ? ' is-warden' : '');
        b.style.gridRow = RING[c.n][0];
        b.style.gridColumn = RING[c.n][1];
        b.setAttribute('aria-pressed', String(c.n === ui.labCell));
        const mark = office ? '·' : c.nest ? 'N' : open ? T.beastName(c.inmate.beast)[0] : c.sealed ? '#' : '·';
        const sub = office ? 'Office' : c.nest ? 'Nest' : open ? T.tierName(c.inmate.tier).slice(0, 4) : c.sealed ? (c.event ? 'Event' : 'Sealed') : 'Empty';
        b.innerHTML = `<b>${mark}</b>${L(c.n)}<br>${sub}`;
        b.setAttribute('aria-label', office ? "Cell 01, the warden's office" : `Edit cell ${L(c.n)}`);
        b.addEventListener('click', () => {
          ui.labCell = c.n;
          renderLabGrid();
          fillLabForm();
        });
        return b;
      }),
    );
  }

  function fillLabForm() {
    const st = ui.state;
    const c = st.cells[ui.labCell];
    // The office takes no contents; the warden can still be moved there.
    const office = c.n === T.OFFICE;
    $('lab-cell-label').textContent = `Cell ${L(c.n)}${office ? " · the warden's office" : ''}${st.position === c.n ? ' · warden here' : ''}`;
    $('lab-contents').hidden = office;
    $('lab-office-note').hidden = !office;
    $('btn-lab-apply').hidden = office;
    $('btn-lab-apply').textContent = `Apply to cell ${L(c.n)}`;
    // A sealed occupant stays hidden here too, so the editor never spoils a door.
    let kind = 'open';
    if (c.nest) kind = 'nest';
    else if (c.sealed) kind = 'unknown';
    else if (!c.inmate) kind = 'empty';
    $('lab-kind').value = kind;
    const shown = !c.sealed && c.inmate;
    $('lab-beast').value = shown ? c.inmate.beast : 'mammoth';
    $('lab-tier').value = String(shown ? c.inmate.tier : 0);
    $('lab-ivory').checked = !!c.ivory;
    $('lab-scratch').checked = false;
    $('lab-event').value = c.event || 'none';
    syncLabKind();
    const lion = shown && c.inmate.beast === 'lion' && !T.linkOf(st, c.inmate.id);
    $('lab-prey-wrap').hidden = !lion;
    if (lion) {
      const options = st.cells.filter((o) => !o.sealed && o.inmate && T.canEat(st, c.inmate, o.inmate) && !T.linkOf(st, o.inmate.id));
      $('lab-prey').innerHTML = options.length ? options.map((o) => `<option value="${o.n}">Cell ${L(o.n)}: ${T.describe(o.inmate)}</option>`).join('') : '<option value="">No same-rarity meal on the block</option>';
      $('btn-lab-prey').disabled = !options.length;
    }
  }

  function syncLabKind() {
    const kind = $('lab-kind').value;
    $('lab-inmate-fields').hidden = !(kind === 'open' || kind === 'hidden');
    $('lab-ivory-wrap').hidden = kind !== 'open';
    $('lab-scratch-wrap').hidden = kind !== 'hidden';
    $('lab-event-wrap').hidden = !(kind === 'hidden' || kind === 'unknown');
  }

  function renderLabTools() {
    const st = ui.state;
    const free = T.TOOL_IDS.filter((id) => !st.tools.includes(id));
    $('lab-tool').innerHTML = free.map((id) => `<option value="${id}">${esc(T.toolName(id))}</option>`).join('') || '<option value="">All tools added</option>';
    $('btn-lab-tool').disabled = !free.length;
    $('lab-tools').innerHTML = st.tools.map((id) => `<li>${esc(T.toolName(id))}<button type="button" data-remove-tool="${id}" aria-label="Remove ${esc(T.toolName(id))}">×</button></li>`).join('');
  }

  function refreshLab() {
    renderLabGrid();
    fillLabForm();
    renderLabTools();
  }

  function applyLabCell() {
    const spec = {
      kind: $('lab-kind').value,
      beast: $('lab-beast').value,
      tier: Number($('lab-tier').value),
      ivory: $('lab-ivory').checked,
      scratch: $('lab-scratch').checked,
      event: $('lab-event').value,
    };
    if (run((s) => T.editCell(s, ui.labCell, spec), { select: null })) refreshLab();
  }

  function paramField(f, value) {
    const id = `param-${f.key}`;
    const label = `<span>${esc(f.label)}</span>`;
    if (f.type === 'int') return `<label class="param" for="${id}">${label}<input type="number" id="${id}" min="${f.min}" max="${f.max}" step="1" value="${value}"></label>`;
    if (f.type === 'bool') return `<label class="param" for="${id}">${label}<input type="checkbox" id="${id}"${value ? ' checked' : ''}></label>`;
    if (f.type === 'tier') {
      return `<label class="param" for="${id}">${label}<select id="${id}">${T.TIERS.slice(0, 5).map((t, i) => `<option value="${i}"${i === value ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
    }
    return `<div class="param">${label}<div class="list">${f.names
      .map((name, i) => `<label for="${id}-${i}">${esc(name)}<input type="number" id="${id}-${i}" min="0" max="1000" step="1" value="${value[i]}"></label>`)
      .join('')}</div></div>`;
  }

  function renderParamsForm() {
    const groups = new Map();
    for (const f of T.PARAM_FIELDS) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    $('form-params').innerHTML = [...groups]
      .map(([name, fields]) => `<fieldset class="param-group"><legend>${esc(name)}</legend>${fields.map((f) => paramField(f, ui.labParams[f.key])).join('')}</fieldset>`)
      .join('');
  }

  function readParamsForm() {
    const out = {};
    for (const f of T.PARAM_FIELDS) {
      const id = `param-${f.key}`;
      if (f.type === 'bool') out[f.key] = $(id).checked;
      else if (f.type === 'list') out[f.key] = f.names.map((_, i) => Number($(`${id}-${i}`).value));
      else out[f.key] = Number($(id).value);
    }
    return T.normalizeParams(out);
  }

  // ---------- Fullscreen ----------

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      toast('Fullscreen is not available here.');
    }
  }

  // ---------- Wiring ----------

  function bind() {
    document.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => routeFromTitle(b.dataset.route)));
    $('btn-continue').addEventListener('click', () => {
      showScreen('game');
      followUp(0);
    });
    $('btn-title-import').addEventListener('click', openImport);
    $('btn-title-sound').addEventListener('click', () => {
      setPref('sound', !ui.prefs.sound);
      if (ui.prefs.sound) Sound.play('tool');
    });

    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-open]');
      if (opener) {
        const parent = opener.closest('dialog');
        if (parent) parent.close();
        openDialog(opener.dataset.open);
        return;
      }
      const closer = e.target.closest('[data-close]');
      if (closer) {
        const d = closer.closest('dialog');
        if (d) d.close();
      }
    });

    document.querySelectorAll('dialog').forEach((d) => {
      d.addEventListener('click', (e) => {
        if (e.target === d) d.close();
      });
    });

    $('btn-home').addEventListener('click', () => showScreen('title'));
    $('btn-menu').addEventListener('click', () => openDialog('dlg-menu'));
    $('btn-full').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      $('btn-full').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    });
    $('btn-advisor').addEventListener('click', () => setPref('advisor', !ui.prefs.advisor));
    $('btn-sound').addEventListener('click', () => {
      setPref('sound', !ui.prefs.sound);
      if (ui.prefs.sound) Sound.play('tool');
    });

    // A card click chooses that door; clicking the chosen card again goes there.
    $('dest-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dest]');
      if (!b || b.disabled) return;
      const n = Number(b.dataset.dest);
      if (ui.pending && ui.pending.kind === 'patrol' && ui.pending.cell === n) run((s) => T.patrol(s, n), { select: n });
      else askPatrol(n);
    });
    $('dest-cards').addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-dest]');
      const n = b ? Number(b.dataset.dest) : null;
      if (n !== null && ui.hover !== n && ui.state) {
        ui.hover = n;
        renderBoard();
      }
    });
    $('dest-cards').addEventListener('mouseleave', () => {
      if (ui.hover !== null && ui.state) {
        ui.hover = null;
        renderBoard();
      }
    });
    $('btn-swap').addEventListener('click', () => askSwap(ui.state && ui.state.position));
    $('btn-deliver').addEventListener('click', () => openDeliver());
    $('btn-undo').addEventListener('click', undo);
    $('btn-end').addEventListener('click', askEndDay);
    $('contract-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-early]')) openDeliver();
    });

    $('btn-menu-new').addEventListener('click', () => {
      closeDialog('dlg-menu');
      openNewRun();
    });
    $('btn-menu-title').addEventListener('click', () => {
      closeDialog('dlg-menu');
      showScreen('title');
    });

    $('new-mode-drill').addEventListener('change', syncNewMode);
    $('new-mode-challenge').addEventListener('change', syncNewMode);
    $('btn-reseed').addEventListener('click', () => ($('new-seed').value = T.randomSeed()));
    $('form-new').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      // The hard mode switches are remembered for the next run too.
      ui.labParams = T.normalizeParams(Object.assign({}, ui.labParams, { loopChain: $('new-loop-chain').checked }));
      store.set(KEYS.params, ui.labParams);
      closeDialog('dlg-new');
      startRun({ mode: data.get('mode'), scenario: data.get('scenario'), loadout: data.get('loadout'), seed: $('new-seed').value });
    });

    $('btn-run-undo').addEventListener('click', () => {
      undo();
      fillRunDialog();
    });
    $('btn-run-export').addEventListener('click', () => {
      closeDialog('dlg-run');
      openExport();
    });
    $('btn-run-import').addEventListener('click', () => {
      closeDialog('dlg-run');
      openImport();
    });
    $('btn-run-end').addEventListener('click', () => {
      const b = $('btn-run-end');
      if (Date.now() - ui.endArmed > 4000) {
        ui.endArmed = Date.now();
        b.textContent = 'Click again to end the run';
        setTimeout(() => {
          if (Date.now() - ui.endArmed >= 4000) b.textContent = 'End run now';
        }, 4100);
        return;
      }
      ui.endArmed = 0;
      closeDialog('dlg-run');
      run((s) => T.endRun(s), { select: null });
    });

    $('btn-save-copy').addEventListener('click', copySave);
    $('btn-save-download').addEventListener('click', downloadSave);
    $('btn-save-load').addEventListener('click', loadSave);
    $('save-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        $('save-in').value = String(reader.result || '');
        $('save-error').hidden = true;
      };
      reader.onerror = () => {
        $('save-error').textContent = 'That file could not be read.';
        $('save-error').hidden = false;
      };
      reader.readAsText(file);
    });

    const prefInputs = { 'pref-advisor': 'advisor', 'pref-quick': 'quick', 'pref-motion': 'motion', 'pref-immersive': 'immersive', 'pref-sound': 'sound' };
    for (const [id, key] of Object.entries(prefInputs)) $(id).addEventListener('change', (e) => setPref(key, e.target.checked));
    $('pref-volume').addEventListener('input', (e) => setPref('volume', Number(e.target.value)));
    $('btn-sound-test').addEventListener('click', () => {
      if (!ui.prefs.sound) setPref('sound', true);
      $('pref-sound').checked = true;
      Sound.play('rainbow');
    });

    $('form-params').addEventListener('submit', (e) => e.preventDefault());
    $('tab-scene').addEventListener('click', () => selectLabTab('scene'));
    $('tab-params').addEventListener('click', () => selectLabTab('params'));
    $('lab-beast').innerHTML = T.BEASTS.map((b) => `<option value="${b}">${T.beastName(b)}</option>`).join('');
    $('lab-tier').innerHTML = T.TIERS.slice(0, 5).map((t, i) => `<option value="${i}">${t}</option>`).join('');
    $('lab-kind').addEventListener('change', syncLabKind);
    $('btn-lab-apply').addEventListener('click', applyLabCell);
    $('btn-lab-warden').addEventListener('click', () => {
      if (run((s) => T.moveWarden(s, ui.labCell))) refreshLab();
    });
    $('btn-lab-prey').addEventListener('click', () => {
      const target = Number($('lab-prey').value);
      if (Number.isInteger(target) && run((s) => T.markPrey(s, ui.labCell, target))) refreshLab();
    });
    $('btn-lab-tool').addEventListener('click', () => {
      const id = $('lab-tool').value;
      if (id && run((s) => T.addTool(s, id))) renderLabTools();
    });
    $('lab-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove-tool]');
      if (b && run((s) => T.removeTool(s, b.dataset.removeTool))) renderLabTools();
    });
    $('btn-params-reset').addEventListener('click', () => {
      ui.labParams = T.normalizeParams(null);
      renderParamsForm();
    });
    $('btn-params-save').addEventListener('click', () => {
      ui.labParams = readParamsForm();
      store.set(KEYS.params, ui.labParams);
      closeDialog('dlg-lab');
      const scenario = ui.state && ui.state.mode === 'drill' ? ui.state.scenario : 'empty';
      startRun({ mode: 'drill', scenario });
      toast('Practice values saved. A new drill has started.', true);
    });

    $('choice-options').addEventListener('click', (e) => {
      const b = e.target.closest('[data-take]');
      if (!b) return;
      run((s) => T.choose(s, b.dataset.take));
      // Shows the next waiting choice, or closes when none is left.
      openChoice();
    });
    $('btn-choice-refresh').addEventListener('click', () => {
      if (run((s) => T.refreshRefit(s))) openChoice();
    });

    $('deliver-inmates').addEventListener('change', (e) => {
      const input = e.target;
      const set = input.dataset.kind === 'vault' ? cargo.vault : cargo.cells;
      if (input.checked) set.add(Number(input.value));
      else set.delete(Number(input.value));
      updateDeliverStatus();
    });
    $('escort-light').addEventListener('change', () => {
      cargo.escort = 'light';
      updateDeliverStatus();
    });
    $('escort-heavy').addEventListener('change', () => {
      cargo.escort = 'heavy';
      updateDeliverStatus();
    });
    $('btn-deliver-best').addEventListener('click', () => {
      const best = T.bestCargo(ui.state);
      if (!best) return;
      cargo.cells = new Set(best.cells);
      cargo.vault = new Set(best.vaultIds);
      cargo.escort = best.escort;
      renderDeliver();
    });
    $('btn-deliver-confirm').addEventListener('click', confirmDeliver);
    $('btn-deliver-skip').addEventListener('click', () => {
      if (run((s) => T.skipDelivery(s), { select: null })) closeDialog('dlg-deliver');
    });
    $('btn-deliver-close').addEventListener('click', () => {
      if (run((s) => T.cancelEarlyDelivery(s))) closeDialog('dlg-deliver');
    });

    $('btn-results-copy').addEventListener('click', copySummary);
    $('btn-results-new').addEventListener('click', () => {
      closeDialog('dlg-results');
      openNewRun();
    });

    document.addEventListener('keydown', (e) => {
      if (ui.screen !== 'game' || document.querySelector('dialog[open]')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        cancel();
      } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        const primary = $('decision-actions').querySelector('.btn-primary');
        if (primary && $('decision').classList.contains('is-pending')) {
          e.preventDefault();
          primary.click();
        }
      }
    });
  }

  function fillHandbookTools() {
    const tools = T.TOOL_IDS.map((id) => `<dt>${esc(T.toolName(id))}</dt><dd>${esc(T.toolText(id))}</dd>`);
    const gifts = T.GIFT_IDS.map((id) => `<dt class="m-gift">${esc(T.toolName(id))}</dt><dd>Warden's Cache gift. ${esc(T.toolText(id))}</dd>`);
    $('hb-tools').innerHTML = [...tools, ...gifts].join('');
  }

  function boot(hotData) {
    const data = hotData || {};
    const toastEl = $('toast');
    if (typeof toastEl.showPopover !== 'function') toastEl.hidden = true;
    buildBoard();
    renderSample();
    fillHandbookTools();
    bind();
    const saved = data.save || store.get(KEYS.save);
    if (saved) {
      try {
        ui.state = T.deserialize(saved);
        ui.history = Array.isArray(data.history) ? data.history.filter((h) => typeof h === 'string').slice(-HISTORY_LIMIT) : [];
      } catch (e) {
        ui.state = null;
      }
    }
    applyPrefs();
    showScreen(data.screen === 'game' ? 'game' : 'title');
    requestAnimationFrame(() => $('board').classList.add('is-live'));
  }

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') {
    hot.snapshot(() => ({
      save: ui.state ? { app: 'tartarus-sim', v: T.VERSION, state: ui.state } : null,
      history: ui.history,
      screen: ui.screen,
    }));
  }
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
