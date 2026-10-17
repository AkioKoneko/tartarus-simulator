/* Tartarus Overlay: the card over the game. It shows what the board
 * analyzer recommends, read from the analyzer's own results panel
 * (lib/analyzer-adapter.js), and how Auto Screenshot Mode is doing. Everything
 * shown here is text the site wrote; it's set as text, never as markup. */
(function () {
  'use strict';

  const O = window.TartarusOverlay || window.Overlay;
  const $ = (id) => document.getElementById(id);
  const state = { shell: {}, game: {}, follow: null, advice: null, menu: false };
  const REFRESH_WAIT_MS = 20000;
  let refreshWait = null;

  // A small element maker: h('p', { class: 'x' }, 'text', child).
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'cmd') el.dataset.cmd = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
  }
  const button = (label, cmd, primary) => h('button', { type: 'button', class: `btn${primary ? ' is-primary' : ''}`, cmd }, label);
  const line = (kind, content, ...buttons) => h('div', { class: `line is-${kind}` }, kind === 'busy' ? h('span', { class: 'spin' }) : null, h('p', null, content), ...buttons);
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
  };

  // How to turn on the game's own log, which the triggers come from.
  const ENABLE_LOG = 'In the game, press Esc and click Enable Log, then log out and back in.';

  // What stops Auto Screenshot Mode from working, if anything.
  function followProblem() {
    const f = state.follow;
    const g = state.game;
    if (state.shell.offline) return line('bad', `Can’t reach the site (${state.shell.offline}). Retrying…`);
    if (state.shell.agreed === false) return line('warn', 'Read and agree on the Auto Screenshot Mode page first.', button('Open it', 'follow', true));
    if (!g.log) return line('bad', 'Couldn’t find your game log (UE_game.log).', button('Choose it', 'pick-log', true));
    if (!g.running) return line('info', 'Waiting for Torchlight: Infinite…');
    if (!f) return line('busy', 'Starting Auto Screenshot Mode…');
    if (f.log === 'gone') return line('warn', 'The game log isn’t there right now. It’s followed again once the game writes it.', button('Choose it', 'pick-log'));
    if (f.log === 'error') return line('bad', `The game log can’t be read: ${f.error || 'retrying'}.`, button('Choose it', 'pick-log'));
    if (f.log !== 'on') return line('busy', 'Connecting the game log…');
    if (f.window !== 'on') return line('busy', 'Sharing the game window…');
    // The game's own Enable Log is off: its log has none of the lines the
    // triggers look for, so no pictures come (js/capture.js tells).
    if (f.detail === 'off') return line('warn', `The game isn’t logging its moves, so no pictures come. ${ENABLE_LOG}`, button('How', 'enable-log'));
    // The game writes to its log all the time: one that stopped growing
    // isn't the one it's writing, and no pictures come.
    const grew = f.diag && f.diag.growingAt;
    if (grew && Date.now() - grew > 120000) return line('warn', `The game log hasn’t changed for ${Math.round((Date.now() - grew) / 60000)} minutes: it may not be the one the game writes. Choose the game’s UE_game.log.`, button('Choose it', 'pick-log'), button('Debug report', 'debug-report'));
    return null;
  }

  // The folded bar's one line: the advice, or what's in its way.
  function oneLine() {
    const a = state.advice;
    const f = state.follow;
    const sh = state.shell;
    if (sh.offline) return 'Can’t reach the site';
    if (sh.agreed === false) return 'Agree on Auto Screenshot Mode first';
    if (!state.game.log) return 'Game log not found';
    if (!state.game.running) return 'Waiting for the game';
    if (sh.riot) return 'Riot: fight on';
    if (sh.runOver) return 'Run over: ready for the next';
    if (f && (f.log !== 'on' || f.window !== 'on')) return 'Connecting…';
    if (f && f.detail === 'off') return 'Turn on Enable Log in the game';
    if (a && a.reading) return 'Reading the picture…';
    if (a && a.treasureWait) return 'Treasure: press View Prison Status';
    if (a && a.toolsConfirm) return sh.siteUpdate ? 'Confirm instruments, or Reload for the update' : 'Confirm your instruments';
    if (a && a.problems && a.problems.length) return 'The board needs a fix';
    if (a && a.working) return `Working it out${a.progress !== null && a.progress !== undefined ? `: ${a.progress}%` : '…'}`;
    if (a && a.stale) return 'Board changed: recheck';
    if (a && a.move) return `${a.move}${a.flagged ? ` (${a.flagged} to check)` : ''}`;
    return 'Waiting for the next move';
  }

  function render() {
    const a = state.advice;
    const f = state.follow;
    const sh = state.shell;
    document.body.classList.toggle('is-collapsed', !!sh.collapsed);
    $('fold').textContent = sh.collapsed ? '+' : '–';
    $('fold').title = 'Collapse to an icon';
    $('orb').title = `Expand Tartarus advice · ${oneLine()} · drag to move`;
    $('orb').setAttribute('aria-label', `Expand Tartarus advice: ${oneLine()}`);
    $('day').textContent = sh.collapsed ? oneLine()
      : a && a.riot !== null && a.riot !== undefined ? `${a.riot} ${a.riot === 1 ? 'day' : 'days'} until Riot${a.step ? ` · ${a.step}` : ''}` : sh.local ? 'local site' : '';

    const out = [];
    if (sh.appUpdate) out.push(line('info', `App update ${sh.appUpdate} is ready.`, button('Restart', 'restart')));
    // An update waiting while the old pages keep asking: it often fixes that.
    if (sh.siteUpdate) out.push(line(a && a.toolsConfirm ? 'warn' : 'info', a && a.toolsConfirm ? 'The site was updated, and the update may stop questions like the one below. It loads by itself when this run ends.' : 'The site was updated. It loads by itself when this run ends.', button('Reload now', 'reload', !!(a && a.toolsConfirm))));
    const problem = followProblem();
    if (problem) out.push(problem);

    if (a && a.reading) out.push(line('busy', `Reading the ${a.reading.kind === 'board' || a.reading.kind === 'manual' ? 'picture' : a.reading.kind}…`));
    const failed = a && a.lastRead && !a.lastRead.ok && !a.reading && Date.now() - a.lastRead.at < 120000;
    if (failed) out.push(line('bad', `Couldn’t read the last picture: ${a.lastRead.reason || 'no board in it'}.`, button('Try again', 'capture')));
    else if (f && f.lastFrame && !f.lastFrame.ok && Date.now() - f.lastFrame.at < 60000) out.push(line('warn', `No picture taken: ${f.lastFrame.why || 'the game window isn’t shared'}`));

    if (a && a.toolsConfirm) out.push(line('warn', a.toolsConfirm, button('These are right', 'tools-ok'), button('Board', 'board')));
    // The Warden's Treasure covers the board: the gift waits for a look at it.
    if (a && a.treasureWait) out.push(line('warn', 'The Warden’s Treasure is open. Press View Prison Status in the game, wait a second on the board, then go back to the Treasure: the gift advice uses that board.', button('Advise anyway', 'treasure-now')));
    if (a && a.problems && a.problems.length) {
      out.push(line('warn', `The board needs a fix: ${a.problems[0]}`, button('Fix', 'fix', true)));
    } else if (a && a.has && a.working) {
      out.push(line('busy', `Working out the best move${a.progress !== null && a.progress !== undefined ? `: ${a.progress}%` : '…'}`));
      if (a.flagged) out.push(line('warn', `${a.flagged} ${a.flagged === 1 ? 'cell' : 'cells'} to check against your game.`, button('Fix', 'fix')));
    } else if (a && a.has && a.stale) {
      out.push(line('warn', 'The board changed since the last advice.', button('Recheck', 'recheck', true)));
    } else if (a && a.has && a.move) {
      const sequence=renderPlan(a.plan,a.baseMove || a.move);
      const explanation=[
        a.why ? h('p', { class: 'why' }, a.why) : null,
        h('p', { class: 'meta' }, [
          (a.expect || '').replace(/^Expected: /, '').replace(/ Rainbows in the vault by the end of day (\d+)\.?$/, ' Rainbows expected by day $1').replace(/\.$/, ''),
          (a.status || '').replace(/^Live check: /, '').replace(/ playouts per option$/, ' playouts each'),
        ].filter(Boolean).join(' · ')),
        a.chain ? h('p', { class: 'alt' }, a.chain) : null,
        a.close && a.options && a.options[1] ? h('p', { class: 'alt' }, `About as good: ${a.options.find((o) => !o.best) ? a.options.find((o) => !o.best).label : a.options[1].label}`) : null,
      ];
      const advice = h('div', null,
        sequence || h('div',null,h('p',{class:'eyebrow'},'Recommended'),h('p',{class:'move'},a.move)),
        sequence ? h('details',{class:'advice-details'},h('summary',null,'Calculation and alternatives'),explanation) : explanation,
      );
      out.push(advice);
      if (a.flagged) out.push(line('warn', `${a.flagged} ${a.flagged === 1 ? 'cell' : 'cells'} to check against your game.`, button('Fix', 'fix'), button('Recheck', 'recheck')));
    } else if (a && a.has && a.nothing) {
      out.push(line('info', 'Nothing to decide on this screen.', button('Picture', 'capture')));
    } else if (!problem && !(a && a.treasureWait)) {
      out.push(sh.runOver
        ? line('info', 'Run over. Its record is saved (tray menu: Review the record). Ready for the next run.')
        : line('info', 'Advice comes with the next move. Or take a picture now.', button('Picture', 'capture')));
    }

    $('body').replaceChildren(...out);
    // Keep diagnostics below the advice and normal controls. A transient gap
    // between game screens must not immediately offer another capture.
    const hs=sh.hintsStatus;
    const eligible=hs && hs.refreshable===true && !(a && (a.reading || a.working));
    const waitKey=eligible ? JSON.stringify([hs.code,a && a.hints && a.hints.frameId,a && a.hints && a.hints.capturedAt]) : null;
    if(!eligible)refreshWait=null;
    else if(!refreshWait || refreshWait.key!==waitKey)refreshWait={key:waitKey,since:Date.now()};
    const refreshReady=refreshWait && Date.now()-refreshWait.since>=REFRESH_WAIT_MS;
    $('hints-status-area').replaceChildren(...(hs && typeof hs.text==='string' && hs.text.trim() ? [h('div', { id:'hints-status',class:'hints-status',role:'status','data-state':hs.code==='visible'?'active':'waiting' },
      h('p',null,h('span',{class:'hints-status-label'},'Target hints: '),hs.text),
      refreshReady ? h('button',{type:'button',class:'btn',cmd:'capture',id:'hints-refresh'},'Refresh picture') : null)] : []));
    const dot = (el, on, what) => {
      el.className = `dot ${on === true ? 'is-on' : on === false ? 'is-off' : ''}`;
      el.title = what;
    };
    // Green once the log has brought a game event; yellow while it's
    // followed but none has come yet (or the game's Enable Log is off).
    const quiet = !!f && f.log === 'on' && (!(f.hits > 0) || f.detail === 'off');
    dot($('dot-log'), f ? (f.log === 'on' ? (quiet ? null : true) : f.log === 'off' || f.log === 'error' ? false : null) : false,
      quiet ? `Following the log, but no game events yet. ${ENABLE_LOG}`
        : f && f.log === 'on' ? `Following ${f.file || 'the log'}: ${(f.lines || 0).toLocaleString()} new lines, ${f.hits || 0} triggers${f.diag && f.diag.lastTriggerAt ? `, the last ${ago(f.diag.lastTriggerAt)}` : ''}` : 'The game log isn’t followed');
    dot($('dot-win'), f ? (f.window === 'on' ? true : state.game.running ? null : false) : false, f && f.window === 'on' ? `Sharing the game window${f.lastFrame ? `, last picture ${ago(f.lastFrame.at)}` : ''}` : 'The game window isn’t shared');
    $('report-menu').hidden = !state.menu;
    $('report-reading').hidden = !(a && a.canReportReading);
  }



  function renderPlan(plan, currentMove) {
    if (!plan || !Array.isArray(plan.steps)) return null;
    const valid=plan.steps.filter(s=>s && typeof s.label==='string' && s.label.trim());
    const next=valid.filter(s=>s.certainty!=='current' && s.label!==currentMove);
    if(!next.length)return null;
    const first=valid.find(s=>s.certainty==='current');
    const steps=[{label:first?first.label:currentMove,certainty:'current'},...next];
    const stage={current:'Now',confirmed:'Then',planned:'Next · verify in game',conditional:'If a choice appears',recheck:'After a new reading'};
    return h('section', { class: 'plan', 'aria-label': 'Action sequence' },
      h('p', { class: 'eyebrow' }, 'Action sequence'),
      h('ol', null, steps.map((s,i) => h('li',{'data-state':i===0?'current':'next','aria-current':i===0?'step':null},
        h('span',{class:'step-number','aria-hidden':'true'},String(i+1).padStart(2,'0')),
        h('div',{class:'step-copy'},h('span',{class:'step-stage'},stage[s.certainty]||'Then'),h('p',{class:i===0?'move':'step-label'},s.label))))),
      typeof plan.note === 'string' && plan.note ? h('p', { class: 'plan-note' }, plan.note) : null);
  }

  // screen coordinates stay stable when main moves this window during a drag.
  const orb = $('orb');
  let drag = null;
  let suppressClickUntil = 0;
  let idleTimer = 0;
  function wakeIcon() {
    clearTimeout(idleTimer);
    orb.classList.remove('is-idle');
    if (!state.shell.collapsed) return;
    idleTimer = setTimeout(() => {
      if (!drag && !orb.matches(':hover, :focus-visible')) orb.classList.add('is-idle');
    }, 15000);
  }
  for (const event of ['pointerenter', 'pointermove', 'pointerleave', 'focus', 'blur', 'keydown']) orb.addEventListener(event, wakeIcon);
  orb.addEventListener('pointerdown', (e) => {
    wakeIcon();
    if (e.button !== 0 || !e.isPrimary) return;
    drag = { id: e.pointerId, x: e.screenX, y: e.screenY, startX: e.screenX, startY: e.screenY, moved: false };
    orb.setPointerCapture(e.pointerId);
  });
  orb.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved && Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY) < 4) return;
    drag.moved = true;
    orb.classList.add('is-dragging');
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    drag.x = e.screenX;
    drag.y = e.screenY;
    if (typeof O.drag === 'function' && (dx || dy)) O.drag({ dx, dy });
  });
  function finishDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.moved) suppressClickUntil = Date.now() + 500;
    drag = null;
    orb.classList.remove('is-dragging');
    if (orb.hasPointerCapture(e.pointerId)) orb.releasePointerCapture(e.pointerId);
    wakeIcon();
  }
  orb.addEventListener('pointerup', finishDrag);
  orb.addEventListener('pointercancel', finishDrag);
  orb.addEventListener('lostpointercapture', finishDrag);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'report') {
      state.menu = !state.menu;
      render();
      return;
    }
    if (b.id === 'orb' && e.detail !== 0 && Date.now() < suppressClickUntil) return;
    if (b.id === 'fold' || b.id === 'orb') return O.command('collapse');
    if (b.dataset.cmd) {
      if(b.id==='hints-refresh')refreshWait=null;
      state.menu = false;
      O.command(b.dataset.cmd);
      render();
    }
  });

  // The window takes the card's height.
  new ResizeObserver(() => O.size({ collapsed:!!state.shell.collapsed, width: state.shell.collapsed ? 56 : undefined, height: $('card').getBoundingClientRect().height })).observe($('card'));

  O.onShell((s) => {
    const wasCollapsed = !!state.shell.collapsed;
    state.shell = s || {};
    render();
    if (wasCollapsed !== !!state.shell.collapsed) wakeIcon();
  });
  O.onGame((g) => {
    state.game = g || {};
    render();
  });
  O.onFollow((f) => {
    state.follow = f;
    render();
  });
  O.onAdvice((a) => {
    state.advice = a;
    render();
  });
  setInterval(render, 5000); // "s ago", and old notes going away
  render();
})();
