/* Tartarus Simulator: the board's art.
 * The ring layout, the beast portraits drawn for this simulator, the warden's
 * lantern and office, and how each cell looks. Shared by the game (ui.js) and
 * the board analyzer (analyze.js). */
(function (root) {
  'use strict';

  const T = root.Tartarus;
  const L = (n) => T.cellLabel(n);

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

  // The parts inside each cell button.
  const CELL_HTML = '<span class="cell-body"></span><span class="door" aria-hidden="true"></span><span class="cell-no"></span><span class="cell-hint"></span><span class="cell-badges"></span><span class="cell-tag"></span><span class="cell-warden"></span><span class="cell-fx"></span>';

  // A cell's classes, contents, hint, badges and accessible label.
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
        hint = `<span class="nest-count">${left}</span><span class="nest-label"><span class="nest-word">Nest · </span>day ${cell.nest.due}</span>`;
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

  root.TartarusBoard = { RING, PORTRAITS, LANTERN, FANGS, OFFICE_ART, CELL_HTML, cellParts };
})(typeof window !== 'undefined' ? window : globalThis);
