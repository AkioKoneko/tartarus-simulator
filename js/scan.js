/* Tartarus Simulator: screenshot reader.
 * Reads a screenshot of the live game's prison screen: which cells are
 * locked, each inmate's beast and rarity, the warden, today's doors, the
 * days until the riot, the torture instruments held and the Chromatic
 * prisoners. Pure functions on RGBA pixels, so the page and the Node tests
 * share them. The reference data comes from js/scan-data.js, which
 * tools/scan-build.js makes from labeled screenshots.
 *
 * The board is part of the game's scene and the panels around it are UI,
 * which players can scale on its own. So the board is found by matching its
 * fixed frame, and every panel is found by itself, by its own text. */
(function (root) {
  'use strict';

  // ---------- Board geometry ----------

  // Board grid to pixels in the reference screenshot: (u, v) is the column
  // and row of a cell's padlock, the spot every cell is measured from.
  const H0 = [119.44981, -9.9567366, 358.07993, -0.26960321, 90.497559, 136.75498, -0.00012281694, -0.015743494, 1];
  // Cells 01-16 clockwise from the office, as grid columns and rows.
  const RING = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [5, 1], [5, 2], [5, 3], [4, 3], [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]];
  const PITCH0 = 119.45; // pixels between cells on the top row of the reference

  function project(h, u, v) {
    const w = h[6] * u + h[7] * v + h[8];
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  }

  function invert(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  const H0_INV = invert(H0);
  // Image point of grid point (u, v) on a located board.
  const at = (loc, u, v) => {
    const [x, y] = project(H0, u, v);
    return [loc.s * x + loc.tx, loc.s * y + loc.ty];
  };
  // Grid point of an image point.
  const gridOf = (loc, x, y) => project(H0_INV, (x - loc.tx) / loc.s, (y - loc.ty) / loc.s);
  // Pixels per reference pixel at a grid point: lower rows are drawn larger.
  const scaleAt = (loc, u, v) => {
    const [x0, y0] = project(H0, u - 0.5, v);
    const [x1, y1] = project(H0, u + 0.5, v);
    return (loc.s * Math.hypot(x1 - x0, y1 - y0)) / PITCH0;
  };

  // ---------- Pixels ----------

  function grayOf(img) {
    const n = img.width * img.height;
    const g = new Float32Array(n);
    const d = img.data;
    for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  }

  // Separable box blur of radius r.
  function blur(g, w, h, r) {
    if (r < 1) return g;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += g[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / span;
        acc += g[y * w + Math.min(w - 1, x + r + 1)] - g[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / span;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function half(g, w, h) {
    const W = w >> 1;
    const H = h >> 1;
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = 2 * y * w + 2 * x;
        out[y * W + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) / 4;
      }
    }
    return { g: out, w: W, h: H };
  }

  function sample(g, w, h, x, y) {
    if (x < 0) x = 0;
    else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0;
    else if (y > h - 1.001) y = h - 1.001;
    const x0 = x | 0;
    const y0 = y | 0;
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * w + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  }

  // Hue (0-360), saturation and value (0-1) of the pixel at (x, y).
  function hsvAt(img, x, y) {
    const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
    const o = (yi * img.width + xi) * 4;
    return hsv(img.data[o], img.data[o + 1], img.data[o + 2]);
  }

  function hsv(r, g, b) {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return [h * 60, mx ? d / mx : 0, mx / 255];
  }

  // Connected groups of pixels in a box that pass `test(x, y)`.
  function blobs(img, x0, y0, x1, y1, test) {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(img.width - 1, Math.ceil(x1));
    y1 = Math.min(img.height - 1, Math.ceil(y1));
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return [];
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test(x0 + x, y0 + y)) mask[y * w + x] = 1;
    const out = [];
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (mask[i] !== 1) continue;
      mask[i] = 2;
      stack.push(i);
      const b = { n: 0, sx: 0, sy: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
      while (stack.length) {
        const j = stack.pop();
        const x = j % w;
        const y = (j / w) | 0;
        b.n += 1;
        b.sx += x;
        b.sy += y;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
        if (x > 0 && mask[j - 1] === 1) { mask[j - 1] = 2; stack.push(j - 1); }
        if (x < w - 1 && mask[j + 1] === 1) { mask[j + 1] = 2; stack.push(j + 1); }
        if (y > 0 && mask[j - w] === 1) { mask[j - w] = 2; stack.push(j - w); }
        if (y < h - 1 && mask[j + w] === 1) { mask[j + w] = 2; stack.push(j + w); }
      }
      out.push({ n: b.n, cx: x0 + b.sx / b.n, cy: y0 + b.sy / b.n, x0: x0 + b.x0, y0: y0 + b.y0, x1: x0 + b.x1, y1: y0 + b.y1, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 });
    }
    return out;
  }

  const rgbAt = (img, x, y) => {
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };

  // ---------- Finding the board ----------

  // Matches the board's fixed frame (walls, office, courtyard, cell numbers)
  // at every scale and position, coarse to fine. Returns { s, tx, ty, score }:
  // an image point is s * (reference point) + (tx, ty).
  function locateBoard(img, gray, ref) {
    const W = img.width;
    const H = img.height;
    const pts = ref.board.points;
    const n = pts.length;
    let mean = 0;
    for (const p of pts) mean += p[2];
    mean /= n;
    const tv = new Float32Array(n);
    let norm = 0;
    for (let i = 0; i < n; i++) {
      tv[i] = pts[i][2] - mean;
      norm += tv[i] * tv[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < n; i++) tv[i] /= norm;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    const levels = [{ g: blur(gray, W, H, 1), w: W, h: H, f: 1 }];
    while (levels[levels.length - 1].w > 120 && levels[levels.length - 1].h > 60) {
      const l = levels[levels.length - 1];
      const d = half(l.g, l.w, l.h);
      levels.push({ g: d.g, w: d.w, h: d.h, f: l.f * 2 });
    }
    const score = (lv, s, ox, oy, nearest) => {
      let sx = 0;
      let sxx = 0;
      let sxt = 0;
      const k = s / lv.f;
      for (let i = 0; i < n; i++) {
        const x = ox + pts[i][0] * k;
        const y = oy + pts[i][1] * k;
        let v;
        if (nearest) {
          const xi = x < 0 ? 0 : x >= lv.w ? lv.w - 1 : x | 0;
          const yi = y < 0 ? 0 : y >= lv.h ? lv.h - 1 : y | 0;
          v = lv.g[yi * lv.w + xi];
        } else v = sample(lv.g, lv.w, lv.h, x, y);
        sx += v;
        sxx += v * v;
        sxt += v * tv[i];
      }
      const varx = sxx - (sx * sx) / n;
      return varx > 1e-6 ? sxt / Math.sqrt(varx) : -1;
    };
    // Coarse: every scale the board could appear at, on a small level, with
    // a quarter of the points. The board spans most of a screenshot's width
    // when cropped to it, and about half in a full-screen one.
    const coarse = { pts: [], tv: null };
    const keepIdx = [];
    for (let i = 0; i < n; i += 4) keepIdx.push(i);
    const cn = keepIdx.length;
    const ctv = new Float32Array(cn);
    let cmean = 0;
    for (const i of keepIdx) cmean += pts[i][2];
    cmean /= cn;
    let cnorm = 0;
    keepIdx.forEach((i, j) => {
      ctv[j] = pts[i][2] - cmean;
      cnorm += ctv[j] * ctv[j];
    });
    cnorm = Math.sqrt(cnorm);
    for (let j = 0; j < cn; j++) ctv[j] /= cnorm;
    coarse.pts = keepIdx.map((i) => pts[i]);
    const coarseScore = (lv, s, ox, oy) => {
      let sx = 0;
      let sxx = 0;
      let sxt = 0;
      const k = s / lv.f;
      for (let j = 0; j < cn; j++) {
        let xi = (ox + coarse.pts[j][0] * k) | 0;
        let yi = (oy + coarse.pts[j][1] * k) | 0;
        if (xi < 0) xi = 0;
        else if (xi >= lv.w) xi = lv.w - 1;
        if (yi < 0) yi = 0;
        else if (yi >= lv.h) yi = lv.h - 1;
        const v = lv.g[yi * lv.w + xi];
        sx += v;
        sxx += v * v;
        sxt += v * ctv[j];
      }
      const varx = sxx - (sx * sx) / cn;
      return varx > 1e-6 ? sxt / Math.sqrt(varx) : -1;
    };
    const sMin = Math.max(0.12, (0.3 * W) / bw);
    const sMax = Math.min(8, (1.1 * Math.max(W / bw, H / bh)));
    const top = [];
    for (let s = sMin; s <= sMax; s *= 1.05) {
      // The coarsest level that still shows the frame's detail.
      let L = 0;
      while (L + 1 < levels.length && s / levels[L + 1].f >= 0.2) L += 1;
      const lv = levels[L];
      const k = s / lv.f;
      // Allow a little of the board's edge to fall outside the picture.
      const ox0 = Math.ceil(-minX * k - 0.06 * bw * k);
      const ox1 = Math.floor(lv.w - 1 - maxX * k + 0.06 * bw * k);
      const oy0 = Math.ceil(-minY * k - 0.08 * bh * k);
      const oy1 = Math.floor(lv.h - 1 - maxY * k + 0.08 * bh * k);
      if (ox1 < ox0 || oy1 < oy0) continue;
      let best = null;
      for (let oy = oy0; oy <= oy1; oy++) {
        for (let ox = ox0; ox <= ox1; ox++) {
          const sc = coarseScore(lv, s, ox, oy);
          if (!best || sc > best.score) best = { ox, oy, score: sc };
        }
      }
      if (best) top.push({ s, tx: best.ox * lv.f, ty: best.oy * lv.f, f: lv.f, score: best.score });
    }
    if (!top.length) return null;
    top.sort((a, b) => b.score - a.score);
    // Fine: search around the best few, first on a middle level, then at
    // full size, over scale and position together.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const grid = (c, lv, ds, steps, dt, reach) => {
      let best = c;
      for (let i = -steps; i <= steps; i++) {
        const s = c.s * (1 + i * ds);
        // Scale about the board's middle, so the board stays in place.
        const bx = c.tx - (s - c.s) * cx;
        const by = c.ty - (s - c.s) * cy;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const tx = bx + dx * dt;
            const ty = by + dy * dt;
            const sc = score(lv, s, tx / lv.f, ty / lv.f, lv.f > 1);
            if (sc > best.score) best = { s, tx, ty, score: sc };
          }
        }
      }
      return best;
    };
    let best = null;
    for (const c of top.slice(0, 5)) {
      let L = 0;
      while (L + 1 < levels.length && c.s / levels[L + 1].f >= 0.5) L += 1;
      const mid = levels[L];
      let cur = { s: c.s, tx: c.tx, ty: c.ty, score: -2 };
      cur = grid(cur, mid, 0.01, 4, Math.max(1, c.f / 2), 3);
      cur = grid(Object.assign({}, cur, { score: -2 }), levels[0], 0.0025, 3, 0.5, 3);
      if (!best || cur.score > best.score) best = cur;
    }
    return best;
  }

  // ---------- Reading cells ----------

  // A padlock: a compact beige blob on the cell's padlock spot.
  function padlockAt(img, x, y, k) {
    const test = (px, py) => {
      const [r, g, b] = rgbAt(img, px, py);
      const l = (r + g + b) / 3;
      return l > 112 && r >= g && g >= b - 4 && r - b >= 6 && r - b <= 64;
    };
    const found = blobs(img, x - 13 * k, y - 11 * k, x + 13 * k, y + 11 * k, test);
    let best = null;
    for (const b of found) {
      const area = b.n / (k * k);
      const w = b.w / k;
      const h = b.h / k;
      const off = Math.hypot(b.cx - x, b.cy - y) / k;
      if (area < 35 || area > 150 || w < 7 || w > 18 || h < 5 || h > 15 || off > 7) continue;
      const fit = 1 - Math.abs(area - 78) / 78 - off / 14;
      if (!best || fit > best.fit) best = { fit, area, off };
    }
    return best ? Math.max(0.05, Math.min(1, 0.55 + best.fit / 2)) : 0;
  }

  // The face inside a portrait, on a fixed grid, zero-mean and unit-length.
  const FACE = { gx: 18, gy: 22, x0: -16, x1: 16, y0: -58, y1: -20 };
  function faceVector(gray, w, h, x, y, k) {
    const v = new Float32Array(FACE.gx * FACE.gy);
    let mean = 0;
    for (let j = 0; j < FACE.gy; j++) {
      for (let i = 0; i < FACE.gx; i++) {
        const px = x + k * (FACE.x0 + ((FACE.x1 - FACE.x0) * (i + 0.5)) / FACE.gx);
        const py = y + k * (FACE.y0 + ((FACE.y1 - FACE.y0) * (j + 0.5)) / FACE.gy);
        const val = sample(gray, w, h, px, py);
        v[j * FACE.gx + i] = val;
        mean += val;
      }
    }
    mean /= v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      v[i] -= mean;
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return { v, mean };
  }

  // The best beast for a portrait, allowing for a small misplacement.
  function faceMatch(gray, w, h, x, y, k, faces) {
    const scores = {};
    let brightness = 0;
    for (let dy = -3; dy <= 3; dy += 1.5) {
      for (let dx = -3; dx <= 3; dx += 1.5) {
        const f = faceVector(gray, w, h, x + dx * k, y + dy * k, k);
        if (dx === 0 && dy === 0) brightness = f.mean;
        for (const [beast, refs] of Object.entries(faces)) {
          for (const ref of refs) {
            let dot = 0;
            for (let i = 0; i < ref.length; i++) dot += ref[i] * f.v[i];
            if (scores[beast] === undefined || dot > scores[beast]) scores[beast] = dot;
          }
        }
      }
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return { beast: ranked[0][0], score: ranked[0][1], second: ranked[1] ? ranked[1][1] : -1, brightness, scores };
  }

  // Rarity from the color of the portrait's frame, read on its sides and
  // bottom, clear of the jaws and flames above it.
  const TIER_BY_HUE = [
    [0, 14, 4], [14, 62, 3], [175, 242, 1], [242, 305, 2], [330, 360, 4],
  ];
  function frameRarity(img, x, y, k) {
    const bins = [0, 0, 0, 0, 0];
    let samples = 0;
    let bright = 0;
    const visit = (px, py) => {
      const [hh, ss, vv] = hsvAt(img, px, py);
      samples += 1;
      if (vv > 0.62 && ss < 0.25) bright += 1;
      if (vv < 0.45 || ss < 0.32) return;
      for (const [lo, hi, t] of TIER_BY_HUE) if (hh >= lo && hh < hi) bins[t] += 1;
    };
    const stepPx = Math.max(1, k);
    for (let py = y - 60 * k; py <= y - 12 * k; py += stepPx) {
      for (let px = x - 29 * k; px <= x - 17 * k; px += stepPx) visit(px, py);
      for (let px = x + 17 * k; px <= x + 29 * k; px += stepPx) visit(px, py);
    }
    for (let py = y - 14 * k; py <= y - 4 * k; py += stepPx) for (let px = x - 9 * k; px <= x + 9 * k; px += stepPx) visit(px, py);
    const colored = bins.reduce((a, b) => a + b, 0);
    // A Normal's frame has no colored pixels at all, at every scale tested;
    // the dimmest colored frame had 3%. A few stray ones leave it in doubt.
    if (colored < 0.025 * samples) return { tier: 0, conf: colored < 0.008 * samples ? 0.85 : bright > 0.04 * samples ? 0.8 : 0.55, colored: colored / samples };
    let tier = 0;
    for (let t = 1; t < bins.length; t++) if (bins[t] > bins[tier]) tier = t;
    return { tier, conf: Math.min(1, 0.5 + bins[tier] / colored / 2), colored: colored / samples };
  }

  // Share of pixels in a box that pass a color test.
  function colorShare(img, x0, y0, x1, y1, test) {
    let n = 0;
    let hit = 0;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(img.height - 1, y1); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(img.width - 1, x1); x++) {
        n += 1;
        const [r, g, b] = rgbAt(img, x, y);
        if (test(...hsv(r, g, b))) hit += 1;
      }
    }
    return n ? hit / n : 0;
  }

  const isJaws = (h, s, v) => (h < 16 || h > 340) && s > 0.4 && v > 0.55;
  const isOrange = (h, s, v) => h >= 18 && h <= 46 && s > 0.6 && v > 0.55;
  const isGold = (h, s, v) => h >= 32 && h <= 56 && s > 0.38 && s < 0.9 && v > 0.5;

  function readCell(img, gray, loc, n, ref) {
    if (n === 0) {
      const [ox, oy] = at(loc, 0, 0);
      return { n, kind: 'office', conf: 1, x: ox, y: oy, k: scaleAt(loc, 0, 0) };
    }
    const [u, v] = RING[n];
    const [x, y] = at(loc, u, v);
    const k = scaleAt(loc, u, v);
    const lock = padlockAt(img, x, y, k);
    const cell = { n, x, y, k, lock };
    // Rat nest: an orange rat head sitting on the padlock.
    cell.nest = colorShare(img, x - 15 * k, y - 28 * k, x + 15 * k, y - 6 * k, (h, s, v) => h >= 18 && h <= 46 && s > 0.5 && v > 0.45) > 0.07;
    if (lock > 0.4) {
      Object.assign(cell, { kind: 'locked', conf: lock });
      return cell;
    }
    const face = faceMatch(gray, img.width, img.height, x, y, k, ref.faces);
    const frame = frameRarity(img, x, y, k);
    cell.face = face;
    cell.frame = frame;
    // The red jaws sit over the top of the portrait (0.24-0.32 of this box
    // in every labeled screenshot, 0 without them).
    cell.jaws = colorShare(img, x - 12 * k, y - 70 * k, x + 12 * k, y - 50 * k, isJaws) > 0.14;
    // A washed-out, very bright portrait (an inmate shown through a door?).
    cell.ghost = face.brightness > 175 && face.score < 0.55;
    if (face.score > 0.42 || cell.ghost || frame.colored > 0.12) {
      const margin = face.score - face.second;
      Object.assign(cell, {
        kind: 'inmate',
        beast: face.beast,
        tier: frame.tier,
        conf: Math.max(0.05, Math.min(1, (face.score - 0.3) * 1.6, 0.4 + margin * 3, frame.conf)) * (cell.ghost ? 0.5 : 1),
      });
      return cell;
    }
    Object.assign(cell, { kind: 'empty', conf: 0.4 });
    return cell;
  }

  // ---------- The warden ----------

  // Where the warden's arrow sits for each cell, in grid units: on the
  // courtyard side of the cell. Corners are estimates.
  const ARROW = [[0.56, 0.2], [1, 0.25], [2, 0.25], [3, 0.25], [4, 0.25], [4.44, 0.2], [4.42, 0.57], [4.42, 1.57], [4.45, 1.95], [4, 1.9], [3, 1.9], [2, 1.9], [1, 1.9], [0.55, 1.95], [0.58, 1.57], [0.58, 0.57]];

  function findWarden(img, loc) {
    // Gold pixels along the courtyard's edge.
    const corners = [[0.15, -0.15], [4.85, -0.15], [4.85, 2.3], [0.15, 2.3]].map(([u, v]) => at(loc, u, v));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const found = blobs(img, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => {
      const [r, g, b] = rgbAt(img, px, py);
      return isGold(...hsv(r, g, b));
    });
    const k = loc.s;
    // The arrow's dark inner lines split it into pieces: group nearby ones.
    const groups = [];
    for (const b of found.filter((x) => x.n >= 6 * k * k)) {
      const g = groups.find((q) => Math.hypot(q.cx - b.cx, q.cy - b.cy) < 22 * k);
      if (g) {
        g.cx = (g.cx * g.n + b.cx * b.n) / (g.n + b.n);
        g.cy = (g.cy * g.n + b.cy * b.n) / (g.n + b.n);
        g.n += b.n;
      } else groups.push({ cx: b.cx, cy: b.cy, n: b.n });
    }
    let best = null;
    for (const b of groups) {
      const area = b.n / (k * k);
      if (area < 70 || area > 1600) continue;
      const [gu, gv] = gridOf(loc, b.cx, b.cy);
      let cell = -1;
      let dist = Infinity;
      ARROW.forEach(([au, av], n) => {
        const d = Math.hypot(au - gu, av - gv);
        if (d < dist) {
          dist = d;
          cell = n;
        }
      });
      if (dist > 0.55) continue;
      const fit = area / 500 - dist;
      if (!best || fit > best.fit) best = { cell, fit, dist, area };
    }
    return best ? { cell: best.cell, conf: Math.max(0.2, Math.min(1, 1 - best.dist)) } : null;
  }

  // An event's "!" sits just outside its cell: orange, tall and thin.
  function findEvents(img, loc, cells) {
    const corners = [[-0.7, -1.1], [5.7, -1.1], [5.7, 3.5], [-0.7, 3.5]].map(([u, v]) => at(loc, u, v));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const found = blobs(img, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => {
      const [r, g, b] = rgbAt(img, px, py);
      return isOrange(...hsv(r, g, b));
    });
    const out = new Set();
    for (const b of found) {
      const k = loc.s;
      if (b.h < 12 * k || b.h > 36 * k || b.h < 1.8 * b.w) continue;
      // Not inside a cell's room, where nests and frames are orange too.
      let nearest = -1;
      let dist = Infinity;
      for (const c of cells) {
        if (c.n === 0) continue;
        const d = Math.hypot(b.cx - c.x, b.cy - (c.y - 38 * c.k)) / c.k;
        if (d < dist) {
          dist = d;
          nearest = c.n;
        }
      }
      if (dist > 35 && dist < 95) out.add(nearest);
    }
    return out;
  }

  // ---------- Text ----------

  // Light, unsaturated glyphs in a box, grouped into lines, words and the
  // separate pieces of a line (like one card's text).
  function textLines(img, x0, y0, x1, y1, opts) {
    const o = Object.assign({ minH: 6, maxH: 60, s: 0.34 }, opts || {});
    // Text is any unsaturated pixel clearly brighter than its surroundings:
    // the day counter is dim grey, the card text near white.
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(img.width - 1, Math.ceil(x1));
    y1 = Math.min(img.height - 1, Math.ceil(y1));
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w < 4 || h < 4) return [];
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(img, x0 + x, y0 + y);
      lum[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const around = blur(lum, w, h, o.r || Math.max(3, Math.round(o.maxH / 3)));
    const found = blobs(img, x0, y0, x1, y1, (px, py) => {
      const i = (py - y0) * w + (px - x0);
      const l = lum[i];
      if (l < 45 || l - around[i] < Math.max(16, 0.3 * around[i])) return false;
      const [r, g, b] = rgbAt(img, px, py);
      return hsv(r, g, b)[1] < o.s;
    }).filter((b) => b.h >= o.minH * 0.45 && b.h <= o.maxH && b.w <= o.maxH * 1.2 && b.n >= 4);
    // Lines: glyphs whose vertical middles line up.
    found.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
    const lines = [];
    for (const g of found) {
      const mid = (g.y0 + g.y1) / 2;
      const line = lines.find((l) => Math.abs(l.mid - mid) < Math.max(4, l.h * 0.55));
      if (line) {
        line.glyphs.push(g);
        line.h = Math.max(line.h, g.h);
      } else lines.push({ mid, h: g.h, glyphs: [g] });
    }
    for (const line of lines) {
      line.glyphs.sort((a, b) => a.x0 - b.x0);
      const tall = line.glyphs.map((g) => g.h).sort((a, b) => a - b);
      line.h = tall[Math.floor(tall.length * 0.75)] || line.h;
      // Specks of noise are tiny next to the line's letters; at large sizes
      // they'd otherwise pass for letters.
      line.glyphs = line.glyphs.filter((g) => !(g.h < 0.32 * line.h && g.n < 0.06 * line.h * line.h));
      if (!line.glyphs.length) continue;
      // A letter can come apart (an 8's two loops): merge pieces that share
      // most of their width.
      const merged = [];
      for (const g of line.glyphs) {
        const prev = merged[merged.length - 1];
        const overlap = prev ? Math.min(prev.x1, g.x1) - Math.max(prev.x0, g.x0) + 1 : 0;
        if (prev && overlap > 0.5 * Math.min(prev.w, g.w)) {
          prev.x0 = Math.min(prev.x0, g.x0);
          prev.x1 = Math.max(prev.x1, g.x1);
          prev.y0 = Math.min(prev.y0, g.y0);
          prev.y1 = Math.max(prev.y1, g.y1);
          prev.w = prev.x1 - prev.x0 + 1;
          prev.h = prev.y1 - prev.y0 + 1;
          prev.n += g.n;
        } else merged.push(Object.assign({}, g));
      }
      line.glyphs = merged;
      // Words split at gaps wider than a third of the line height; pieces at
      // gaps wider than two line heights.
      line.pieces = [];
      let piece = null;
      let word = null;
      let last = null;
      for (const g of line.glyphs) {
        const gap = last ? g.x0 - last.x1 : Infinity;
        if (!piece || gap > 2 * line.h) {
          piece = { words: [], glyphs: [], x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 };
          line.pieces.push(piece);
          word = null;
        }
        if (!word || gap > line.h * 0.36) {
          word = { glyphs: [], x0: g.x0, x1: g.x1 };
          piece.words.push(word);
        }
        word.glyphs.push(g);
        piece.glyphs.push(g);
        word.x1 = Math.max(word.x1, g.x1);
        piece.x1 = Math.max(piece.x1, g.x1);
        piece.y0 = Math.min(piece.y0, g.y0);
        piece.y1 = Math.max(piece.y1, g.y1);
        last = g;
      }
      line.x0 = line.glyphs[0].x0;
      line.x1 = Math.max(...line.glyphs.map((g) => g.x1));
      line.y0 = Math.min(...line.glyphs.map((g) => g.y0));
      line.y1 = Math.max(...line.glyphs.map((g) => g.y1));
    }
    return lines.filter((l) => l.glyphs.length >= 1);
  }

  // A glyph as a small normalized picture, for comparing with digits.
  const GLYPH = { w: 10, h: 14 };
  function glyphVector(gray, w, h, g, lineH) {
    const v = new Float32Array(GLYPH.w * GLYPH.h);
    // Scale by the line height, so a narrow 1 stays narrow.
    const scale = Math.max(g.h, lineH * 0.7) / GLYPH.h;
    const cx = (g.x0 + g.x1) / 2;
    const cy = (g.y0 + g.y1) / 2;
    let mean = 0;
    for (let j = 0; j < GLYPH.h; j++) {
      for (let i = 0; i < GLYPH.w; i++) {
        const val = sample(gray, w, h, cx + (i + 0.5 - GLYPH.w / 2) * scale, cy + (j + 0.5 - GLYPH.h / 2) * scale);
        v[j * GLYPH.w + i] = val;
        mean += val;
      }
    }
    mean /= v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      v[i] -= mean;
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }

  // Scores for each digit 0-9 for a glyph.
  function digitScores(gray, w, h, g, lineH, digits) {
    const v = glyphVector(gray, w, h, g, lineH);
    const out = new Array(10).fill(-1);
    for (const [d, refs] of Object.entries(digits)) {
      for (const ref of refs) {
        let dot = 0;
        for (let i = 0; i < ref.length; i++) dot += ref[i] * v[i];
        if (dot > out[d]) out[d] = dot;
      }
    }
    return out;
  }

  // The most likely number for a word, from a list of allowed values.
  function readNumber(gray, w, h, word, lineH, digits, allowed) {
    const glyphs = word.glyphs;
    const per = glyphs.map((g) => digitScores(gray, w, h, g, lineH, digits));
    let best = null;
    for (const value of allowed) {
      const s = String(value);
      if (s.length !== glyphs.length) continue;
      let sc = 0;
      for (let i = 0; i < s.length; i++) sc += per[i][Number(s[i])];
      sc /= s.length;
      if (!best || sc > best.score) best = { value, score: sc };
    }
    return best;
  }

  // The board placed by its cell numbers, for screens where the frame match
  // fails: a devour's meal pick darkens the board and wraps meals in big
  // fangs, but leaves the numbers lit. Every short number in the picture
  // that reads as a cell's is a candidate. Each pair of different cells
  // gives a placement (an image point is s * reference + t), and the one
  // that most cells agree with wins, refined by least squares.
  function locateByLabels(img, gray, ref) {
    const unit = { s: 1, tx: 0, ty: 0 };
    // Where each cell's number sits for the board at s = 1, t = 0 (as
    // tools/scan-build.js reads them).
    const spot = RING.map(([u, v], n) => {
      if (n === 0) return null;
      const [x, y] = at(unit, u, v);
      const k = scaleAt(unit, u, v);
      const off = v === 0 ? [0, -88] : v === 3 ? [0, 22] : u === 5 ? [63, -38] : [-62, -39];
      return [x + off[0] * k, y + off[1] * k];
    });
    const cell = at(unit, 1, 0)[0] - at(unit, 0, 0)[0];
    const sharp = blur(gray, img.width, img.height, 1);
    const allowed = [];
    for (let v = 2; v <= 16; v++) allowed.push(v);
    const seen = [];
    for (const line of textLines(img, 0, 0, img.width - 1, img.height - 1, { minH: 6, maxH: 40 })) {
      for (const p of line.pieces) {
        if (p.words.length !== 1 || !p.words[0].glyphs.length || p.words[0].glyphs.length > 2) continue;
        const read = readNumber(sharp, img.width, img.height, p.words[0], line.h, ref.digits, allowed);
        if (read && read.score > 0.7) seen.push({ n: read.value - 1, x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 });
      }
    }
    let best = null;
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const a = seen[i];
        const b = seen[j];
        if (a.n === b.n) continue;
        const dr = Math.hypot(spot[b.n][0] - spot[a.n][0], spot[b.n][1] - spot[a.n][1]);
        if (dr < cell * 0.9) continue;
        const s = Math.hypot(b.x - a.x, b.y - a.y) / dr;
        if (s < 0.2 || s > 6) continue;
        const tx = a.x - s * spot[a.n][0];
        const ty = a.y - s * spot[a.n][1];
        const inl = seen.filter((c) => Math.hypot(s * spot[c.n][0] + tx - c.x, s * spot[c.n][1] + ty - c.y) < 0.18 * cell * s);
        const cells = new Set(inl.map((c) => c.n)).size;
        if (!best || cells > best.cells) best = { s, cells, inl };
      }
    }
    if (!best || best.cells < 5) return null;
    const m = best.inl.length;
    const rx = best.inl.reduce((t, c) => t + spot[c.n][0], 0) / m;
    const ry = best.inl.reduce((t, c) => t + spot[c.n][1], 0) / m;
    const px = best.inl.reduce((t, c) => t + c.x, 0) / m;
    const py = best.inl.reduce((t, c) => t + c.y, 0) / m;
    let num = 0;
    let den = 0;
    for (const c of best.inl) {
      num += (spot[c.n][0] - rx) * (c.x - px) + (spot[c.n][1] - ry) * (c.y - py);
      den += (spot[c.n][0] - rx) ** 2 + (spot[c.n][1] - ry) ** 2;
    }
    const s = den > 0 ? num / den : best.s;
    return { s, tx: px - s * rx, ty: py - s * ry, score: Math.min(1, best.cells / 15), cells: best.cells, byLabels: true };
  }

  // ---------- A devour's meal pick ----------

  // "Select an Inmate to Consume": a red banner under the board, and each
  // inmate the eater can take wrapped in big red fangs, which rise well
  // above its portrait (an inmate's own jaws marker is small). Null on any
  // other screen. The warden's cell holds the eater.
  const isBannerRed = (h, s, v) => (h < 16 || h > 340) && s > 0.45 && v > 0.4;
  function readChainScreen(img, loc, cells, warden) {
    let banner = 0;
    for (let v = 3.9; v <= 5.01; v += 0.15) {
      const [x0, y0] = at(loc, 1, v);
      const [x1, y1] = at(loc, 4, v + 0.15);
      banner = Math.max(banner, colorShare(img, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), isBannerRed));
    }
    if (banner < 0.2) return null;
    const targets = [];
    for (const c of cells) {
      if (c.n === 0 || (warden && c.n === warden.cell)) continue;
      const k = c.k;
      if (colorShare(img, c.x - 40 * k, c.y - 80 * k, c.x + 40 * k, c.y - 50 * k, isBannerRed) > 0.15) targets.push(c.n);
    }
    return targets.length ? { banner, targets } : null;
  }

  // ---------- Panels around the board ----------

  // Today's doors: the "Go to Cell N" texts on the cards under the board.
  // Gaps between words shift with the text's size, but "Go to Cell" always
  // ends 5.46 cap heights after its "G", so the number is whatever follows.
  const PREFIX = { w: 40, h: 10, end: 5.46, num: 5.66 };

  // The "Go to Cell" part of a card's text as a small picture.
  function prefixVector(gray, w, h, piece, end, dy0, dy1) {
    const g0 = piece.glyphs[0];
    const x0 = g0.x0;
    const x1 = x0 + (end || PREFIX.end) * g0.h;
    const y0 = g0.y0 + (dy0 || 0);
    const y1 = g0.y1 + (dy1 || 0);
    const v = new Float32Array(PREFIX.w * PREFIX.h);
    let mean = 0;
    for (let j = 0; j < PREFIX.h; j++) {
      for (let i = 0; i < PREFIX.w; i++) {
        const val = sample(gray, w, h, x0 + ((x1 - x0) * (i + 0.5)) / PREFIX.w, y0 + ((y1 - y0) * (j + 0.5)) / PREFIX.h);
        v[j * PREFIX.w + i] = val;
        mean += val;
      }
    }
    mean /= v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      v[i] -= mean;
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }

  const best1 = (v, refs) => refs.reduce((m, r) => {
    let dot = 0;
    for (let i = 0; i < r.length; i++) dot += r[i] * v[i];
    return Math.max(m, dot);
  }, -1);

  // How much a piece reads like "Go to Cell": the best match over small
  // shifts, since a pixel matters when the text is small.
  function prefixLike(gray, w, h, piece, refs) {
    let best = -1;
    for (const end of [5.3, 5.46, 5.62]) {
      for (const dy0 of [-1, 0, 1]) {
        for (const dy1 of [-1, 0, 1]) best = Math.max(best, best1(prefixVector(gray, w, h, piece, end, dy0, dy1), refs));
      }
    }
    return best;
  }

  // The card texts: pieces as wide as "Go to Cell" plus a number, that read
  // "Go to Cell". A selected card sits a little higher, so cards are
  // grouped across nearby lines.
  function doorCards(img, loc, gray, ref) {
    const bottom = Math.max(at(loc, 0, 3)[1], at(loc, 5, 3)[1]) + 30 * loc.s;
    let best = [];
    // Text size follows the UI scale, so try contrast windows of each size.
    for (const r of textRadii(img)) {
      const lines = textLines(img, 0, bottom, img.width - 1, img.height - 1, { minH: 6, maxH: Math.max(48, img.height * 0.07), r });
      const cards = [];
      for (const line of lines) {
        for (const p of line.pieces) {
          const cap = p.glyphs[0].h;
          if (cap < 6 || p.glyphs.length < 4) continue;
          const span = (p.x1 - p.x0) / cap;
          if (span < 5.9 || span > 7.8) continue;
          // The number starts after the space that follows "Cell": the widest
          // gap after a glyph ending about 5 to 5.7 cap heights in.
          let start = p.x0 + PREFIX.num * cap;
          let gapBest = 0;
          for (let i = 0; i + 1 < p.glyphs.length; i++) {
            const end = (p.glyphs[i].x1 - p.x0) / cap;
            const gap = p.glyphs[i + 1].x0 - p.glyphs[i].x1;
            if (end >= 4.9 && end <= 5.75 && gap > gapBest) {
              gapBest = gap;
              start = p.glyphs[i + 1].x0;
            }
          }
          const num = p.glyphs.filter((g) => g.x0 >= start);
          if (!num.length || num.length > 3) continue;
          const like = gray && ref && ref.prefix ? prefixLike(gray, img.width, img.height, p, ref.prefix) : 1;
          if (like < 0.5) continue;
          cards.push({ p, h: cap, mid: (p.y0 + p.y1) / 2, word: { glyphs: num }, fit: 1 - like });
        }
      }
      // The biggest group of cards whose rows sit close together.
      for (const c of cards) {
        const group = cards.filter((d) => Math.abs(d.mid - c.mid) < 2.5 * c.h && Math.abs(d.h - c.h) < 0.3 * c.h);
        if (group.length > 3) continue;
        const fit = group.reduce((a, d) => a + d.fit, 0);
        if (group.length > best.length || (group.length === best.length && fit < best.fit)) {
          best = group;
          best.fit = fit;
        }
      }
    }
    return best.length >= 2 ? best.sort((a, b) => a.p.x0 - b.p.x0) : [];
  }

  // Contrast windows for finding text of any size: a fraction of the
  // picture's height, from small UI text to large.
  function textRadii(img) {
    return [0.006, 0.01, 0.016, 0.026].map((f) => Math.max(3, Math.round(img.height * f)));
  }

  // Two digits can run together into one blob: splits it where the ink is
  // thinnest near the middle.
  function splitGlyph(gray, w, g) {
    let cut = -1;
    let least = Infinity;
    for (let x = Math.round(g.x0 + g.w * 0.3); x <= g.x1 - g.w * 0.3; x++) {
      let ink = 0;
      for (let y = g.y0; y <= g.y1; y++) ink += gray[y * w + x];
      if (ink < least) {
        least = ink;
        cut = x;
      }
    }
    if (cut < 0) return null;
    const left = Object.assign({}, g, { x1: cut - 1, w: cut - g.x0 });
    const right = Object.assign({}, g, { x0: cut + 1, w: g.x1 - cut });
    return [left, right];
  }

  function readDoors(img, gray, loc, ref) {
    const cards = doorCards(img, loc, gray, ref);
    if (!cards.length) return null;
    // Doors are prison cells, 02-16.
    const allowed = [];
    for (let c = 2; c <= 16; c++) allowed.push(c);
    const read = cards.map((c) => {
      const glyphs = c.word.glyphs;
      // A blob wider than any one digit (about 0.65 of the letter height)
      // is two digits that touch, like "11" in small text.
      if (glyphs.length === 1 && glyphs[0].w > 0.72 * c.h) {
        const parts = splitGlyph(gray, img.width, glyphs[0]);
        if (parts) return readNumber(gray, img.width, img.height, { glyphs: parts }, c.h, ref.digits, allowed);
      }
      return readNumber(gray, img.width, img.height, c.word, c.h, ref.digits, allowed);
    });
    if (read.some((r) => !r)) return null;
    const score = read.reduce((a, r) => a + r.score, 0) / read.length;
    const cells = [...new Set(read.map((r) => r.value - 1))];
    return { cells, conf: Math.max(0.1, Math.min(1, (score - 0.3) * 1.6)) * (cells.length === read.length ? 1 : 0.4), boxes: cards.map((c) => [c.p.x0, c.p.y0, c.p.x1, c.p.y1]) };
  }

  // "N day(s) until Riot" over the board: the number is the tall glyphs at
  // the start of the line, and the rest of the line is smaller and dimmer.
  function dayNumber(img, loc) {
    const top = Math.min(at(loc, 0, 0)[1], at(loc, 5, 0)[1]) - 95 * loc.s;
    if (top < 8) return null;
    let best = null;
    const lines = [];
    for (const r of textRadii(img)) lines.push(...textLines(img, img.width * 0.2, 0, img.width * 0.8, top, { minH: 8, maxH: Math.max(70, img.height * 0.1), r }));
    // The day number is the biggest text over the board.
    const tallest = Math.max(1, ...lines.flatMap((l) => l.glyphs.filter((g) => g.w >= 0.25 * g.h).map((g) => g.h)));
    for (const line of lines) {
      const glyphs = line.glyphs.filter((g) => g.w >= 0.25 * g.h && g.h >= img.height * 0.016);
      // Two glyphs of the same height, side by side: one number.
      const pair = (a, b) => !!a && !!b && Math.abs(b.h - a.h) < 0.2 * a.h && b.x0 - a.x1 < 0.7 * a.h && b.w < b.h * 1.1 && a.w < a.h * 1.1;
      for (let i = 0; i < glyphs.length; i++) {
        // A run of one or two glyphs of the same height, taller than what
        // follows: the number, then "day(s) until Riot". The second digit of
        // a pair never starts a number of its own.
        const a = glyphs[i];
        if (a.h < 8 || a.h > img.height * 0.09 || a.w > a.h * 1.1 || pair(glyphs[i - 1], a)) continue;
        const word = [a];
        const b = glyphs[i + 1];
        if (pair(a, b)) word.push(b);
        const end = word[word.length - 1].x1;
        const after = glyphs.filter((g) => g.x0 > end && g.x0 - end < 6 * a.h);
        const smaller = after.filter((g) => g.h < 0.85 * a.h).length;
        if (after.length && smaller < after.length / 2) continue;
        const cx = (a.x0 + end) / 2;
        const sc = Math.min(smaller, 8) + 6 * (1 - Math.abs(cx - img.width / 2) / (img.width / 2)) + 6 * (a.h / tallest);
        if (!best || sc > best.sc) best = { sc, word: { glyphs: word }, h: a.h };
      }
    }
    return best;
  }

  function readDays(img, gray, loc, ref) {
    const found = dayNumber(img, loc);
    if (!found) return null;
    const allowed = [];
    for (let d = 0; d <= 40; d++) allowed.push(d);
    const r = readNumber(gray, img.width, img.height, found.word, found.h, ref.digits, allowed);
    return r ? { days: r.value, conf: Math.max(0.1, Math.min(1, (r.score - 0.3) * 1.6)) } : null;
  }

  // Finds a label in a box by its letter count and its shape (width over
  // letter height): word breaks in this font are uneven, and colored labels
  // can come apart into extra pieces.
  function findLabel(img, box, letters, shape) {
    const lines = [];
    for (const r of textRadii(img)) lines.push(...textLines(img, box[0], box[1], box[2], box[3], { minH: 6, maxH: Math.max(40, img.height * 0.06), r, s: 0.5 }));
    let best = null;
    for (const line of lines) {
      for (const p of line.pieces) {
        const n = p.words.reduce((a, w) => a + w.glyphs.length, 0);
        const ratio = (p.x1 - p.x0) / Math.max(1, line.h);
        if (Math.abs(n - letters) > 6 || Math.abs(ratio - shape) > 2.5) continue;
        const off = Math.abs(n - letters) / 3 + Math.abs(ratio - shape);
        if (!best || off < best.off) best = { off, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, h: line.h };
      }
    }
    return best;
  }

  // Torture instruments: the icons under the "Torture Instrument" label,
  // left of the board, each matched to the instrument it shows.
  function readTools(img, loc, ref) {
    const found = findToolIcons(img, loc);
    found.tools = found.icons.map((icon) => {
      const feat = artFeature(img, ...icon.box);
      const ranked = ref.tools.map((t) => ({ id: t.id, score: similarity(feat, t.feat) })).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      const second = ranked.find((r) => r.id !== best.id);
      const margin = best.score - (second ? second.score : 0);
      return { id: best.id, score: best.score, margin, box: icon.box, conf: Math.max(0.1, Math.min(1, (best.score - 0.6) * 2.5 + margin * 5)) };
    });
    return found;
  }

  // Finds the instrument icons: dim cards in a row under the label, laid out
  // in the label's own UI scale (its letter height).
  function findToolIcons(img, loc) {
    const left = Math.min(at(loc, 0, 0)[0], at(loc, 0, 3)[0]) - 70 * loc.s;
    if (left < 30) return { icons: [], found: false };
    const label = findLabel(img, [0, 0, left, img.height - 1], 17, 12.2);
    if (!label) return { icons: [], found: false };
    // The label is 12.2 letter heights wide; its width is steadier than its
    // height when letters come apart.
    const h = (label.x1 - label.x0) / 12.2;
    const mean = (x0, y0, x1, y1) => {
      let sum = 0;
      let n = 0;
      for (let y = Math.max(0, Math.round(y0)); y <= Math.min(img.height - 1, y1); y += 1) {
        for (let x = Math.max(0, Math.round(x0)); x <= Math.min(img.width - 1, x1); x += 1) {
          sum += hsvAt(img, x, y)[2];
          n += 1;
        }
      }
      return n ? sum / n : 0;
    };
    const out = [];
    for (let i = 0; i < 6; i++) {
      const x0 = label.x0 + (0.15 + 6.05 * i) * h;
      const x1 = x0 + 4.45 * h;
      const y0 = label.y1 + 1.55 * h;
      const y1 = y0 + 7.45 * h;
      if (x1 > left) break;
      // A card is a little lighter than the wall around it.
      const inside = mean(x0 + 0.5 * h, y0 + 0.5 * h, x1 - 0.5 * h, y1 - 0.5 * h);
      const wall = mean(x1 + 0.35 * h, y0, x1 + 1.3 * h, y1);
      // Art: pixels well above the card's own darkness.
      const thr = Math.max(0.16, inside * 1.9);
      let ax0 = Infinity;
      let ay0 = Infinity;
      let ax1 = -1;
      let ay1 = -1;
      let art = 0;
      for (let y = Math.round(y0 + 0.4 * h); y <= y1 - 0.4 * h; y++) {
        for (let x = Math.round(x0 + 0.4 * h); x <= x1 - 0.4 * h; x++) {
          const [, s, v] = hsvAt(img, x, y);
          if (v > thr && (s > 0.2 || v > thr * 1.3)) {
            art += 1;
            if (x < ax0) ax0 = x;
            if (x > ax1) ax1 = x;
            if (y < ay0) ay0 = y;
            if (y > ay1) ay1 = y;
          }
        }
      }
      // A card holds art; past the last instrument there's only wall. A dark
      // card with little art still counts if it's lighter than the wall.
      if (art < 1.0 * h * h && !(art > 0.5 * h * h && inside > wall + 0.012)) break;
      // An open tooltip spills its text over the next slots. Text is thin
      // strokes spread through a tall box, or a flat strip, where an icon is
      // a solid drawing (at least 7% of its box, never much wider than
      // tall), so the panel ends there.
      const bw = ax1 - ax0 + 1;
      const bh = ay1 - ay0 + 1;
      if (art / (bw * bh) < 0.065 || bw > 2 * bh) break;
      out.push({ box: [ax0, ay0, ax1, ay1], card: [x0, y0, x1, y1], art });
    }
    return { icons: out, found: true, label };
  }

  // A tool's art as a color picture on a 4x6 grid plus a hue histogram.
  function artFeature(img, x0, y0, x1, y1) {
    const gx = 4;
    const gy = 6;
    const grid = new Float32Array(gx * gy * 3);
    const hist = new Float32Array(13);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let y = y0 + Math.floor((j * h) / gy); y < y0 + Math.floor(((j + 1) * h) / gy); y++) {
          for (let x = x0 + Math.floor((i * w) / gx); x < x0 + Math.floor(((i + 1) * w) / gx); x++) {
            const [rr, gg, bb] = rgbAt(img, x, y);
            r += rr;
            g += gg;
            b += bb;
            n += 1;
            const [hh, ss, vv] = hsv(rr, gg, bb);
            if (ss > 0.25 && vv > 0.25) hist[Math.floor(hh / 30) % 12] += ss * vv;
            else hist[12] += vv * 0.3;
          }
        }
        const o = (j * gx + i) * 3;
        grid[o] = n ? r / n : 0;
        grid[o + 1] = n ? g / n : 0;
        grid[o + 2] = n ? b / n : 0;
      }
    }
    return { grid: Array.from(grid), hist: Array.from(hist) };
  }

  function cosine(a, b) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  }

  function centered(a) {
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return a.map((x) => x - m);
  }

  const similarity = (a, b) => 0.5 * cosine(a.hist, b.hist) + 0.5 * (0.5 + 0.5 * cosine(centered(a.grid), centered(b.grid)));

  // Chromatic prisoners: filled slots under the "Chromatic Prisoner" label,
  // right of the board. Empty slots are dark outlines; a filled one glows.
  function readChromatic(img, loc) {
    const right = Math.max(at(loc, 5, 0)[0], at(loc, 5, 3)[0]) + 60 * loc.s;
    if (right > img.width - 30) return null;
    const label = findLabel(img, [right, 0, img.width - 1, img.height - 1], 17, 14.4);
    if (!label) return null;
    // Sizes in the label's own UI scale, from its width (144 px at 1x).
    const u = (label.x1 - label.x0) / 144;
    const cx = label.x1;
    const cy = (label.y0 + label.y1) / 2;
    const slots = [];
    for (let r = 0; r < 5; r++) {
      for (const dx of [-66, -6]) {
        const x = cx + dx * u;
        const y = cy + (43.5 + 70 * r) * u;
        const share = colorShare(img, x - 14 * u, y - 14 * u, x + 14 * u, y + 14 * u, (h, s, v) => (s > 0.35 && v > 0.45) || v > 0.75);
        slots.push({ x, y, share, filled: share > 0.18 });
      }
    }
    return { count: slots.filter((s) => s.filled).length, slots, label, conf: 0.5 };
  }

  // The objective text, left of the board above the instruments, as a box
  // to show the player.
  function objectiveBox(img, loc, tools) {
    if (!tools || !tools.label) return null;
    const l = tools.label;
    const u = l.h / 13;
    const lines = textLines(img, Math.max(0, l.x0 - 40 * u), Math.max(0, l.y0 - 160 * u), Math.min(img.width - 1, l.x0 + 330 * u), l.y0 - 6 * u, { minH: 7, maxH: 40 });
    const real = lines.filter((line) => line.glyphs.length >= 4);
    if (!real.length) return null;
    const x0 = Math.min(...real.map((line) => line.x0));
    const x1 = Math.max(...real.map((line) => line.x1));
    const y0 = Math.min(...real.map((line) => line.y0));
    const y1 = Math.max(...real.map((line) => line.y1));
    return [Math.max(0, x0 - 34 * u), Math.max(0, y0 - 6 * u), Math.min(img.width - 1, x1 + 6 * u), Math.min(img.height - 1, y1 + 6 * u)];
  }

  // ---------- The instrument pick ----------

  // "Select a Torture Instrument", at the start of a run: three cards side by
  // side in the middle of the screen, in a UI scale set by the picture's
  // height (1080 px at 1x). Each card's art and its glow sit in the middle
  // of the card's top half, between torchlit walls, which are left out.
  // k is the card: -1, 0 or 1, left to right.
  function pickArtBox(img, k) {
    const s = img.height / 1080;
    const c = img.width / 2 + k * 480 * s;
    const x0 = Math.max(0, Math.round(c - 85 * s));
    const x1 = Math.min(img.width - 1, Math.round(c + 85 * s));
    const y0 = Math.round(270 * s);
    const y1 = Math.min(img.height - 1, Math.round(480 * s));
    const xs = [];
    const ys = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [h, sat, v] = hsvAt(img, x, y);
        // Bright metal, or a glow that isn't the torches' warm orange.
        if (v > 0.32 || (sat > 0.45 && v > 0.18 && !(h >= 15 && h <= 50))) {
          xs.push(x);
          ys.push(y);
        }
      }
    }
    if (xs.length < 400 * s * s) return null;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    // A few stray sparkles around the art don't stretch the box.
    const q = (a, f) => a[Math.round(f * (a.length - 1))];
    return [q(xs, 0.01), q(ys, 0.01), q(xs, 0.99), q(ys, 0.99)];
  }

  // Whether the Re-roll button shows, left of Confirm: its label's light
  // letters. Without a re-roll left, Confirm stands alone in the middle.
  function pickRerollShown(img) {
    const s = img.height / 1080;
    const x0 = Math.round(img.width / 2 - 330 * s);
    const x1 = Math.round(img.width / 2 - 90 * s);
    let light = 0;
    for (let y = Math.round(940 * s); y <= Math.min(img.height - 1, Math.round(985 * s)); y++) {
      for (let x = Math.max(0, x0); x <= x1; x++) {
        const [, sat, v] = hsvAt(img, x, y);
        if (v > 0.55 && sat < 0.25) light += 1;
      }
    }
    return light > 60 * s * s;
  }

  // The three cards on offer, left to right, each matched by its art to the
  // instruments the reader knows: art from this page itself (pick.tools,
  // js/pick-data.js), then the icons beside the board (ref.tools). Results
  // are simulator ids. A card the reader isn't sure of has a low conf.
  function scanPick(img, ref, pick) {
    const t0 = Date.now();
    const pool = [];
    for (const t of (pick && pick.tools) || []) pool.push({ sim: t.sim, feat: t.feat });
    for (const t of ref.tools) {
      const known = ref.toolNames && ref.toolNames[t.id];
      if (known && known.sim) pool.push({ sim: known.sim, feat: t.feat });
    }
    const cards = [-1, 0, 1].map((k) => {
      const box = pickArtBox(img, k);
      if (!box) return null;
      const feat = artFeature(img, ...box);
      const best = new Map();
      for (const r of pool) {
        const score = similarity(feat, r.feat);
        if (!best.has(r.sim) || score > best.get(r.sim)) best.set(r.sim, score);
      }
      const ranked = [...best].map(([sim, score]) => ({ sim, score })).sort((a, b) => b.score - a.score);
      if (!ranked.length) return null;
      const margin = ranked[0].score - (ranked[1] ? ranked[1].score : 0);
      const conf = Math.max(0, Math.min(1, (ranked[0].score - 0.85) * 5 + margin * 8));
      return { sim: ranked[0].sim, score: ranked[0].score, margin, conf, box, alts: ranked.slice(1, 4).map((r) => r.sim) };
    });
    const ms = Date.now() - t0;
    if (cards.some((c) => !c)) return { ok: false, reason: 'The three instrument cards weren’t found in this picture.', cards, ms };
    if (cards.every((c) => c.conf < 0.2)) return { ok: false, reason: 'This doesn’t look like the instrument pick.', cards, ms };
    return { ok: true, cards, reroll: pickRerollShown(img), ms };
  }

  // The reader's references with the panel icons from js/pick-data.js added:
  // instruments as their icons look left of the board, from labeled
  // screenshots of the live game (tools/pick-build.js).
  function withPanelIcons(ref, pick) {
    if (!pick || !pick.icons || !pick.icons.length) return ref;
    return Object.assign({}, ref, { tools: ref.tools.concat(pick.icons) });
  }

  // ---------- The run's objective ----------

  // The objective popup at the start of a run ("Objective: Undercurrents"):
  // its title is the largest text in the middle of the screen. Its words'
  // letter counts tell the known objectives apart; the words themselves
  // aren't read. Returns the objective's id, or null.
  // Short words can run together ("of the" reads as one word).
  const OBJECTIVE_WORDS = { consume: [[8, 2, 3, 7], [8, 5, 7]], incident: [[13]], king: [[4, 2, 3, 5], [4, 5, 5]], walk: [[6, 4]], cagefight: [[4, 5], [4, 4]] };
  function readObjectiveTitle(img) {
    let best = null;
    for (const r of textRadii(img)) {
      for (const line of textLines(img, img.width * 0.25, img.height * 0.12, img.width * 0.75, img.height * 0.4, { minH: 6, maxH: Math.max(48, img.height * 0.07), r })) {
        for (const p of line.pieces) {
          const words = p.words.map((w) => w.glyphs.length);
          if (words.length >= 2 && (!best || line.h > best.h)) best = { h: line.h, words };
        }
      }
    }
    if (!best) return null;
    // "Objective:" first, then the name.
    const name = best.words[0] >= 8 && best.words[0] <= 11 ? best.words.slice(1) : best.words;
    let match = null;
    for (const [id, forms] of Object.entries(OBJECTIVE_WORDS)) {
      for (const want of forms) {
        if (want.length !== name.length) continue;
        const off = want.reduce((a, n, i) => a + Math.abs(n - name[i]), 0);
        const total = want.reduce((a, n) => a + n, 0);
        if (off <= 1 + total * 0.15 && (!match || off < match.off)) match = { id, off };
      }
    }
    return match ? { id: match.id, words: best.words } : { id: null, words: best.words };
  }

  // ---------- The day's decision ----------

  // "Make Your Decision", after a move: a row of cards under the board, one
  // for each action the game allows now. Replace and End have pale labels;
  // the Consume card is red all over, its label too. Returns which cards
  // show, or null when there's no such row.
  function readDecision(img, loc) {
    const bottom = Math.max(at(loc, 0, 3)[1], at(loc, 5, 3)[1]) + 30 * loc.s;
    if (bottom >= img.height - 20) return null;
    const x0 = Math.max(0, Math.min(at(loc, 0, 0)[0], at(loc, 0, 3)[0]) - 40 * loc.s);
    const x1 = Math.min(img.width - 1, Math.max(at(loc, 5, 0)[0], at(loc, 5, 3)[0]) + 40 * loc.s);
    let title = false;
    let pickCell = false;
    let replace = false;
    let end = false;
    // The row's title, by its words' letter counts: "Make Your Decision"
    // [4, 4, 8], or the Sewer Ratway's "Select an Objective" [6, 2, 9]
    // (a stray mark can lead).
    const near = (w, want) => {
      const tail = w.slice(-want.length);
      return tail.length === want.length && tail.reduce((a, n, i) => a + Math.abs(n - want[i]), 0) <= 2;
    };
    for (const r of textRadii(img)) {
      for (const line of textLines(img, x0, bottom, x1, img.height - 1, { minH: 6, maxH: Math.max(48, img.height * 0.07), r })) {
        for (const p of line.pieces) {
          const n = p.words.reduce((a, w) => a + w.glyphs.length, 0);
          const span = (p.x1 - p.x0) / Math.max(1, line.h);
          if (n >= 14 && n <= 20 && span > 7 && span < 15) {
            const words = p.words.map((w) => w.glyphs.length);
            if (near(words, [6, 2, 9]) && !near(words, [4, 4, 8])) pickCell = true;
            else title = true; // Make Your Decision
          }
          else if (n >= 6 && n <= 8 && span > 3 && span < 6.5) replace = true;
          else if (n === 3 && span > 1.5 && span < 3.2) end = true;
        }
      }
    }
    // The Consume card: a red block, not the torches' orange. Read in
    // strips about a third of a card wide: the Consume card's best strip is
    // about 5% strongly red, and nothing else under the board passes 1%.
    const strip = Math.max(8, Math.round(100 * loc.s));
    let red = 0;
    for (let sx = Math.round(x0); sx + strip <= x1; sx += strip) {
      let n = 0;
      let hit = 0;
      for (let y = Math.round(bottom); y < Math.min(img.height, bottom + 260 * loc.s); y += 2) {
        for (let x = sx; x < sx + strip; x += 2) {
          const [h, s, v] = hsvAt(img, x, y);
          n += 1;
          if ((h < 12 || h > 348) && s > 0.55 && v > 0.3) hit += 1;
        }
      }
      if (n) red = Math.max(red, hit / n);
    }
    const consume = red > 0.025;
    // The Sewer Ratway: the player picks any cell, with no cards.
    if (pickCell && !title) return { ratway: true, replace: false, consume: false, end: false, title: false };
    // Without its title, a stray short word isn't a row of cards.
    if (!title) return null;
    return { replace, consume, end, title, red: Math.round(1000 * red) / 1000 };
  }

  // ---------- Everything ----------

  function scan(img, ref) {
    const t0 = Date.now();
    const gray = grayOf(img);
    let loc = locateBoard(img, gray, ref);
    // Real boards match their frame at 0.81 or more at every size tested;
    // instrument picks, popups and other screens stay near 0.5 or under. A
    // darkened board (a devour's meal pick) also matches weakly, but its
    // cell numbers stay lit, so it's placed by them instead.
    if (!loc || loc.score < 0.65) {
      const byLabels = locateByLabels(img, gray, ref);
      if (byLabels && byLabels.cells >= 8) loc = byLabels;
    }
    const notes = [];
    if (!loc || (!loc.byLabels && loc.score < 0.65)) return { ok: false, reason: 'No Tartarus prison board found in this picture.', loc, ms: Date.now() - t0 };
    const sharp = blur(gray, img.width, img.height, 1);
    const cells = [];
    for (let n = 0; n < 16; n++) cells.push(readCell(img, sharp, loc, n, ref));
    const warden = findWarden(img, loc);
    for (const n of findEvents(img, loc, cells)) if (cells[n].kind === 'locked') cells[n].event = true;
    const doors = readDoors(img, sharp, loc, ref);
    const days = readDays(img, sharp, loc, ref);
    const tools = readTools(img, loc, ref);
    const chromatic = readChromatic(img, loc);
    const objective = objectiveBox(img, loc, tools);
    const chain = readChainScreen(img, loc, cells, warden);
    const decision = doors || chain ? null : readDecision(img, loc);
    if (!warden) notes.push('The warden’s arrow was not found.');
    return { ok: true, loc, cells, warden, doors, days, tools, chromatic, objective, chain, decision, notes, ms: Date.now() - t0 };
  }

  const api = { scan, scanPick, pickArtBox, pickRerollShown, locateBoard, readCell, findWarden, findToolIcons, readDoors, readDays, doorCards, dayNumber, prefixVector, textLines, glyphVector, faceVector, artFeature, similarity, hsv, blobs, at, gridOf, scaleAt, grayOf, blur, RING, H0, ARROW, FACE, GLYPH, locateByLabels, readChainScreen, readDecision, readObjectiveTitle, withPanelIcons };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusScan = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
