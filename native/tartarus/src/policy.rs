//! Strategy independently translated from js/solver.js; presentation stays in JS.
use crate::engine::{self as e, *};
use crate::model::Value;
use crate::model_json as json;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::OnceLock;
type Comp = [i32; 24];

const WEIGHT_NAMES: [&str; 26] = [
    "stopMargin",
    "wStair",
    "wOpen",
    "wNow",
    "execMargin",
    "wChain",
    "wCrow",
    "wUsurp",
    "wInstigate",
    "wOfficeIncident",
    "wStep",
    "wWalk",
    "wNest",
    "wKeys",
    "wForged",
    "wFire",
    "wConsumeWalk",
    "wShort",
    "wGoal",
    "wIncident",
    "wPass",
    "wCage",
    "rerollMargin",
    "wConsume",
    "minDevour",
    "swapMargin",
];
#[inline]
fn weight_index(k: &str) -> usize {
    match k {
        "stopMargin" => 0,
        "wStair" => 1,
        "wOpen" => 2,
        "wNow" => 3,
        "execMargin" => 4,
        "wChain" => 5,
        "wCrow" => 6,
        "wUsurp" => 7,
        "wInstigate" => 8,
        "wOfficeIncident" => 9,
        "wStep" => 10,
        "wWalk" => 11,
        "wNest" => 12,
        "wKeys" => 13,
        "wForged" => 14,
        "wFire" => 15,
        "wConsumeWalk" => 16,
        "wShort" => 17,
        "wGoal" => 18,
        "wIncident" => 19,
        "wPass" => 20,
        "wCage" => 21,
        "rerollMargin" => 22,
        "wConsume" => 23,
        "minDevour" => 24,
        "swapMargin" => 25,
        _ => 26,
    }
}
fn numeric_weights(params: &Value) -> [f64; 27] {
    std::array::from_fn(|i| {
        if i < WEIGHT_NAMES.len() {
            num(&params[WEIGHT_NAMES[i]])
        } else {
            0.
        }
    })
}
pub struct Prepared {
    params: Value,
    weights: [f64; 27],
}
impl Prepared {
    pub fn new(st: &Value, params: &Value) -> Self {
        let params = prepare_params(st, params);
        let weights = numeric_weights(&params);
        Self { params, weights }
    }
}
#[derive(Clone, Copy, Default)]
struct CellView {
    tier: usize,
    beast: usize,
    open: bool,
    sealed: bool,
    ivory: bool,
    id: f64,
}
fn board_view(st: &Value) -> [CellView; 16] {
    let cells = slice(&st["cells"]);
    std::array::from_fn(|n| {
        let cell = &cells[n];
        let who = &cell["inmate"];
        let sealed = yes(&cell["sealed"]);
        CellView {
            tier: int(&who["tier"]),
            beast: beast(&who["beast"]),
            open: !sealed && yes(who),
            sealed,
            ivory: yes(&cell["ivory"]),
            id: num(&who["id"]),
        }
    })
}
fn view_composition(view: &[CellView; 16], exclude: Option<usize>) -> (Comp, i32) {
    let mut comp = [0; 24];
    let mut crowd = 0;
    for (n, c) in view.iter().enumerate() {
        if !c.open {
            continue;
        }
        crowd += 1;
        if Some(n) != exclude && c.tier < 5 {
            comp[c.tier * 4 + c.beast] += 1;
        }
    }
    (comp, crowd)
}

#[derive(Clone, Copy)]
struct Diet {
    items: [usize; 4],
    len: usize,
}
impl Diet {
    fn new(first: usize) -> Self {
        Self {
            items: [first, 0, 0, 0],
            len: 1,
        }
    }
    fn push(&mut self, x: usize) {
        if !self.items[..self.len].contains(&x) {
            self.items[self.len] = x;
            self.len += 1;
        }
    }
}
impl std::ops::Deref for Diet {
    type Target = [usize];
    fn deref(&self) -> &[usize] {
        &self.items[..self.len]
    }
}
impl IntoIterator for Diet {
    type Item = usize;
    type IntoIter = std::iter::Take<std::array::IntoIter<usize, 4>>;
    fn into_iter(self) -> Self::IntoIter {
        self.items.into_iter().take(self.len)
    }
}
impl<'d> IntoIterator for &'d Diet {
    type Item = &'d usize;
    type IntoIter = std::slice::Iter<'d, usize>;
    fn into_iter(self) -> Self::IntoIter {
        self.items[..self.len].iter()
    }
}
#[inline]
fn tool_bit(k: &str) -> u64 {
    match k {
        "saw" => 1u64 << 0,
        "whip" => 1u64 << 1,
        "muzzle" => 1u64 << 2,
        "skewer" => 1u64 << 3,
        "crown" => 1u64 << 4,
        "maul" => 1u64 << 5,
        "collar" => 1u64 << 6,
        "revenge" => 1u64 << 7,
        "axe" => 1u64 << 8,
        "dogtag" => 1u64 << 9,
        "cage" => 1u64 << 10,
        "blacklist" => 1u64 << 11,
        "shortchain" => 1u64 << 12,
        "keys" => 1u64 << 13,
        "forged" => 1u64 << 14,
        "fire" => 1u64 << 15,
        "maiden" => 1u64 << 16,
        "scapegoat" => 1u64 << 17,
        "stake" => 1u64 << 18,
        "rope" => 1u64 << 19,
        "shackles" => 1u64 << 20,
        _ => 0,
    }
}

pub fn params_for(st: &Value) -> Value {
    data()["profiles"][if yes(pr(st, "rewards")) {
        "rewards"
    } else {
        "notools"
    }]
    .clone()
}
pub fn clone_state(st: &Value) -> Value {
    let mut out = st.clone();
    out["log"] = json!([]);
    out
}
fn beast(v: &Value) -> usize {
    BEASTS.iter().position(|b| *b == txt(v)).unwrap_or(0)
}
pub fn composition(st: &Value, exclude: Option<usize>) -> (Comp, i32) {
    let mut comp = [0; 24];
    let mut crowd = 0;
    for n in board_cells(st) {
        crowd += 1;
        let who = &st["cells"][n]["inmate"];
        let tier = int(&who["tier"]);
        if Some(n) != exclude && tier < 5 {
            comp[tier * 4 + beast(&who["beast"])] += 1;
        }
    }
    (comp, crowd)
}
fn normalize(w: &[f64]) -> Vec<f64> {
    let total = w.iter().map(|x| x.max(0.)).sum::<f64>();
    let total = if total == 0. { 1. } else { total };
    w.iter().map(|x| x.max(0.) / total).collect()
}
fn floor_dist(w: &[f64], floor: usize) -> Vec<f64> {
    let k: Vec<f64> = w
        .iter()
        .enumerate()
        .map(|(t, x)| if t >= floor { *x } else { 0. })
        .collect();
    if k.iter().any(|x| *x > 0.) {
        normalize(&k)
    } else {
        w.to_vec()
    }
}
pub struct Context<'a> {
    pub st: &'a Value,
    pub params: Cow<'a, Value>,
    pub v: [f64; 6],
    pub r: f64,
    open: Vec<f64>,
    open_value: f64,
    sealed: usize,
    lift: f64,
    lift2: f64,
    all_lift2: f64,
    board_count: usize,
    goal: f64,
    incidents: f64,
    consumes: f64,
    swap_cap: f64,
    scapegoat: Option<f64>,
    maiden: Option<[usize; 5]>,
    fight: bool,
    double_from: usize,
    flags: u64,
    view: [CellView; 16],
    weights: [f64; 27],
    stop_chain: bool,
    scratch_extra: usize,
    memo: HashMap<[i32; 23], f64>,
}
impl<'a> Context<'a> {
    #[inline]
    fn w(&self, k: &str) -> f64 {
        self.weights[weight_index(k)]
    }
    #[inline]
    fn flag(&self, k: &str) -> bool {
        self.flags & tool_bit(k) != 0
    }
    fn val(&self, t: usize) -> f64 {
        if t >= 5 {
            self.r
        } else {
            self.v[t]
        }
    }
    fn diets(&self, t: usize, b: usize, counter: bool) -> Diet {
        let mut out = Diet::new([1, 2, 3, 0][b]);
        if b == 3 && self.flag("skewer") {
            out.push(3)
        }
        if !counter && b == 1 && self.flag("crown") {
            out = Diet {
                items: [0, 1, 2, 3],
                len: 4,
            }
        }
        if t >= self.double_from {
            match b {
                0 => out.push(2),
                1 => out.push(3),
                _ => {}
            }
        }
        out
    }
    fn top(&self, t: usize, b: usize) -> usize {
        if b == 0 && self.flag("maul") {
            4
        } else {
            t
        }
    }
}
pub fn context<'a>(st: &'a Value, params: &'a Value) -> Context<'a> {
    let params_full = if data()["defaults"]
        .as_object()
        .unwrap()
        .keys()
        .all(|k| params.get(k).is_some())
    {
        Cow::Borrowed(params)
    } else {
        Cow::Owned(merge_params(params))
    };
    let weights = numeric_weights(&params_full);
    context_inner(st, params_full, weights)
}
fn context_prepared<'a>(st: &'a Value, prepared: &'a Prepared) -> Context<'a> {
    context_inner(st, Cow::Borrowed(&prepared.params), prepared.weights)
}
fn context_inner<'a>(
    st: &'a Value,
    params_full: Cow<'a, Value>,
    weights: [f64; 27],
) -> Context<'a> {
    let view = board_view(st);
    let flags = slice(&st["tools"])
        .iter()
        .fold(0, |bits, t| bits | tool_bit(txt(t)));
    let flag = |t: &str| flags & tool_bit(t) != 0;
    let base = num(&params_full["tierBase"]);
    let v: [f64; 6] = std::array::from_fn(|t| base.powi(t as i32));
    let r = if slice(&st["vault"]).len() >= 10 {
        v[4]
    } else {
        v[5] * num(&params_full["rainbowMult"])
    };
    let board: Vec<usize> = (0..16)
        .filter(|&n| view[n].open && view[n].tier < 5)
        .collect();
    let lift = board
        .iter()
        .map(|&n| {
            let t = view[n].tier;
            (if t + 1 >= 5 { r } else { v[t + 1] }) - v[t]
        })
        .sum::<f64>()
        / board.len().max(1) as f64;
    let all_lift2 = board
        .iter()
        .map(|&n| {
            let t = view[n].tier;
            (if t + 2 >= 5 { r } else { v[t + 2] }) - v[t]
        })
        .sum::<f64>();
    let objective = &st["objective"];
    let remaining = if !yes(&st["milestone"]) && yes(pr(st, "rewards")) {
        num(&data()["objectives"][txt(&objective["id"])]["need"]) - num(&objective["progress"])
    } else {
        0.
    };
    let left = |id: &str| if objective["id"] == id { remaining } else { 0. };
    let maiden = if flag("maiden") {
        Some(std::array::from_fn(|t| {
            board.iter().filter(|&&n| view[n].tier == t).count()
        }))
    } else {
        None
    };
    let position = int(&st["position"]);
    let others: Vec<_> = board.iter().copied().filter(|&n| n != position).collect();
    let scapegoat = if flag("scapegoat") && others.len() >= 2 && others.len() < board.len() {
        Some(2. * others.iter().map(|&n| v[view[n].tier]).sum::<f64>() / others.len() as f64)
    } else {
        None
    };
    let swap_max = num(&params_full["swapMaxTier"]);
    let swap_cap = if swap_max < 0. {
        -1.
    } else if flag("scapegoat") && board.len() >= 3 {
        4.
    } else {
        (if flag("maiden") {
            swap_max.max(num(&params_full["maidenSwapTier"]))
        } else {
            swap_max
        })
        .max(if flag("stake") { 2. } else { 0. })
    };
    let open = normalize(&door_weights(st));
    let open_value = open.iter().enumerate().map(|(t, x)| x * v[t]).sum();
    Context {
        st,
        params: params_full,
        v,
        r,
        open,
        open_value,
        sealed: view.iter().filter(|c| c.sealed).count(),
        lift,
        lift2: all_lift2 / board.len().max(1) as f64,
        all_lift2,
        board_count: board.len(),
        goal: left("walk"),
        incidents: left("incident"),
        consumes: left("consume"),
        swap_cap,
        scapegoat,
        maiden,
        fight: st["startEvent"] == "cagefight",
        double_from: if st["startEvent"] == "cagefight" {
            0
        } else {
            int(pr(st, "doubleEatTier"))
        },
        flags,
        view,
        weights,
        stop_chain: can_stop_chain(st),
        scratch_extra: 1 + if yes(pr(st, "scratchStacksBase")) {
            1
        } else {
            0
        },
        memo: HashMap::new(),
    }
}
fn swap_dist(c: &Context, t: usize) -> Vec<f64> {
    let mut w = weights(&if c.st["params"]["swapWeights"].is_array() {
        c.st["params"]["swapWeights"].clone()
    } else {
        p(c.st, "tierWeights")
    });
    if c.flag("rope") {
        w[0] = 0.;
        w[1] = 0.;
    }
    let mut d = if c.scapegoat.is_some() {
        let higher: Vec<_> = w
            .iter()
            .enumerate()
            .map(|(i, x)| if i > t { *x } else { 0. })
            .collect();
        if higher.iter().any(|x| *x > 0.) {
            normalize(&higher)
        } else {
            (0..6)
                .map(|i| if i == (t + 1).min(5) { 1. } else { 0. })
                .collect()
        }
    } else {
        normalize(&w)
    };
    if c.flag("stake") && t < 3 {
        for p in &mut d {
            *p *= 0.6;
        }
        d[3] += 0.4;
    }
    d
}
fn rise(c: &mut Context, t: usize, comp: &mut Comp, crowd: i32, keep: Option<usize>) -> f64 {
    if t >= 5 {
        return c.r;
    }
    let kept = keep.unwrap_or(0);
    let beasts: &[usize] = if keep.is_some() {
        std::slice::from_ref(&kept)
    } else {
        &[0, 1, 2, 3]
    };
    let mut sum = 0.;
    for &b in beasts {
        if c.flag("revenge") && c.sealed > 0 {
            let foods = c.diets(t, b, false);
            let mut spawned = 0.;
            for &f in &foods {
                comp[t * 4 + f] += 1;
                spawned += c.v[t] + feed(c, t, b, comp, crowd + 1);
                comp[t * 4 + f] -= 1;
            }
            sum += 0.3 * spawned / foods.len() as f64 + 0.7 * feed(c, t, b, comp, crowd);
        } else {
            sum += feed(c, t, b, comp, crowd);
        }
    }
    sum / beasts.len() as f64
}
fn feed(c: &mut Context, t: usize, b: usize, comp: &mut Comp, crowd: i32) -> f64 {
    let mut key = [0i32; 23];
    key[0] = t as i32;
    key[1] = b as i32;
    key[2] = if c.flag("muzzle") { crowd } else { 0 };
    let start = if c.fight { 0 } else { t * 4 };
    key[3..3 + 20 - start].copy_from_slice(&comp[start..20]);
    if let Some(v) = c.memo.get(&key) {
        return *v;
    }
    let mut out = f64::NEG_INFINITY;
    for mt in if c.fight { 0 } else { t }..=c.top(t, b) {
        for f in c.diets(t, b, mt != t) {
            if comp[mt * 4 + f] == 0 {
                continue;
            }
            comp[mt * 4 + f] -= 1;
            out = out.max(bite(c, t, b, comp, crowd, 0, true, mt));
            comp[mt * 4 + f] += 1;
        }
    }
    if out == f64::NEG_INFINITY || (c.stop_chain && out - c.v[t] < c.w("stopMargin")) {
        out = c.v[t];
    }
    c.memo.insert(key, out);
    out
}
fn after(c: &mut Context, t: usize, b: usize, comp: &mut Comp, crowd: i32, g: usize) -> f64 {
    rise(
        c,
        (t + g).min(5),
        comp,
        crowd - 1,
        if c.fight { Some(b) } else { None },
    )
}
fn sawed(c: &mut Context, t: usize, b: usize, comp: &mut Comp, crowd: i32, g: usize) -> f64 {
    let s = if c.flag("saw") { 0.25 } else { 0. };
    let w = if c.flag("whip") { 0.35 } else { 0. };
    if s != 0. || w != 0. {
        (1. - s) * (1. - w) * after(c, t, b, comp, crowd, g)
            + (s + w - 2. * s * w) * after(c, t, b, comp, crowd, g + 1)
            + s * w * after(c, t, b, comp, crowd, g + 2)
    } else {
        after(c, t, b, comp, crowd, g)
    }
}
fn bite(
    c: &mut Context,
    t: usize,
    b: usize,
    comp: &mut Comp,
    crowd: i32,
    extra: usize,
    chained: bool,
    mt: usize,
) -> f64 {
    let mut g = if c.flag("maul") && b == 0 {
        (mt as i32 + 2 - t as i32).max(1) as usize
    } else {
        1
    } + extra;
    if c.flag("muzzle") && crowd <= 4 {
        g += 2;
    }
    if c.flag("skewer") && b == 3 {
        g += 1;
    }
    if c.flag("crown") && b == 1 {
        g += 2;
    }
    -c.v[mt]
        + if chained && c.flag("collar") {
            0.2 * sawed(c, t, b, comp, crowd, g) + 0.8 * sawed(c, t, b, comp, crowd, g + 1)
        } else {
            sawed(c, t, b, comp, crowd, g)
        }
}
fn devour_delta(
    c: &mut Context,
    t: usize,
    b: usize,
    meal: usize,
    scratch: bool,
    comp: &mut Comp,
    crowd: i32,
    chained: bool,
    mt: usize,
) -> f64 {
    let i = mt * 4 + meal;
    if !scratch {
        comp[i] -= 1;
    }
    let extra = if scratch { c.scratch_extra } else { 0 };
    let value = bite(
        c,
        t,
        b,
        comp,
        if scratch { crowd + 1 } else { crowd },
        extra,
        chained,
        mt,
    ) - c.v[t];
    if !scratch {
        comp[i] += 1;
    }
    value
}
fn best_meal(c: &mut Context, t: usize, b: usize, comp: &mut Comp, crowd: i32) -> f64 {
    let mut best = f64::NEG_INFINITY;
    for mt in if c.fight { 0 } else { t }..=c.top(t, b) {
        for f in c.diets(t, b, mt != t) {
            if comp[mt * 4 + f] != 0 {
                let v = devour_delta(c, t, b, f, false, comp, crowd, false, mt);
                if v > best {
                    best = v;
                }
            }
        }
    }
    best
}
fn stair(c: &Context, comp: &Comp) -> f64 {
    let mut value = 0.;
    for t in 0..5 {
        let mut fed = 0;
        for b in 0..4 {
            if c.diets(t, b, false).iter().any(|&f| comp[t * 4 + f] > 0) {
                fed += 1;
            }
        }
        value += (fed as f64 / 4.) * c.v[t];
    }
    value
}
fn stair_delta(c: &Context, comp: &mut Comp, t: usize, b: usize, sign: i32) -> f64 {
    if c.w("wStair") == 0. || t >= 5 {
        return 0.;
    }
    let before = stair(c, comp);
    comp[t * 4 + b] += sign;
    let after = stair(c, comp);
    comp[t * 4 + b] -= sign;
    c.w("wStair") * (after - before)
}
fn stair_fresh(c: &Context, d: &[f64], comp: &mut Comp) -> f64 {
    if c.w("wStair") == 0. {
        return 0.;
    }
    let mut sum = 0.;
    for (t, p) in d.iter().enumerate() {
        for b in 0..4 {
            if *p != 0. {
                sum += (*p / 4.) * stair_delta(c, comp, t, b, 1);
            }
        }
    }
    sum
}
fn maiden_bonus(c: &Context, t: usize) -> f64 {
    let Some(mut counts) = c.maiden else {
        return 0.;
    };
    if counts[t] > 0 {
        counts[t] -= 1;
    }
    let above: usize = counts
        .iter()
        .enumerate()
        .filter(|(u, _)| *u > t)
        .map(|(_, n)| n)
        .sum();
    let below: usize = counts
        .iter()
        .enumerate()
        .filter(|(u, _)| *u < t)
        .map(|(_, n)| n)
        .sum();
    if above != below {
        return 0.;
    }
    swap_dist(c, t)
        .iter()
        .enumerate()
        .filter(|(_, p)| **p != 0.)
        .map(|(t, p)| p * (c.val((t + 3).min(5)) - c.val(t)))
        .sum()
}
fn swap_value(c: &Context, t: usize) -> f64 {
    let dist = swap_dist(c, t);
    let mut value = dist
        .iter()
        .enumerate()
        .map(|(t, p)| p * c.val(t))
        .sum::<f64>()
        - c.v[t];
    if c.flag("axe") {
        value += dist
            .iter()
            .enumerate()
            .map(|(u, p)| if u > t { *p } else { 0. })
            .sum::<f64>()
            * c.sealed.min(2) as f64
            * c.w("wOpen")
            * c.open_value;
    }
    if let Some(loss) = c.scapegoat {
        value -= loss;
    }
    value + maiden_bonus(c, t)
}
fn trickster_value(c: &Context, d: &[f64]) -> f64 {
    d.iter()
        .enumerate()
        .map(|(t, p)| p * (c.v[4] - c.v[t.min(4)]).max(0.))
        .sum()
}
fn appetite_value(c: &Context, low: usize, d: &[f64]) -> f64 {
    let mut sum = 0.;
    for (t, p) in d.iter().enumerate() {
        if *p == 0. {
            continue;
        }
        let from = t.min(low);
        let mut choose = 1.;
        for k in 0..=5 {
            if k != 0 {
                choose = choose * (6 - k) as f64 / k as f64;
            }
            sum += p
                * choose
                * 0.5f64.powi(k as i32)
                * 0.5f64.powi((5 - k) as i32)
                * (c.val((from + k).min(5)) - c.val(from));
        }
    }
    sum
}
fn activation(
    c: &mut Context,
    t: usize,
    b: usize,
    comp: &mut Comp,
    crowd: i32,
    swap_left: bool,
) -> f64 {
    let mut value: f64 = 0.;
    if t < 5 {
        value = value.max(best_meal(c, t, b, comp, crowd));
    }
    if swap_left && t as f64 <= c.swap_cap {
        value = value.max(swap_value(c, t));
    }
    value
}
fn fresh_activation(
    c: &mut Context,
    d: &[f64],
    comp: &mut Comp,
    crowd: i32,
    swap_left: bool,
) -> f64 {
    let mut sum = 0.;
    for (t, p) in d.iter().enumerate() {
        if *p == 0. {
            continue;
        }
        for b in 0..4 {
            sum += (*p / 4.) * activation(c, t, b, comp, crowd, swap_left);
        }
    }
    sum
}
fn tagged(c: &Context, d: &[f64]) -> Vec<f64> {
    if !c.flag("dogtag") {
        return d.to_vec();
    }
    let mut out: Vec<f64> = d.iter().map(|p| 0.75 * p).collect();
    for (t, p) in d.iter().enumerate() {
        out[(t + 1).min(d.len() - 1)] += 0.25 * p;
    }
    out
}
fn fresh_value(c: &mut Context, d: &[f64], comp: &mut Comp, crowd: i32, swap_left: bool) -> f64 {
    let worth = d.iter().enumerate().map(|(t, p)| p * c.v[t]).sum::<f64>();
    c.w("wOpen") * worth
        + c.w("wNow") * fresh_activation(c, d, comp, crowd, swap_left)
        + stair_fresh(c, d, comp)
}
pub fn execution_value(c: &Context, t: usize, b: usize, comp: &Comp) -> f64 {
    let same = yes(pr(c.st, "executionSameTier"));
    let prey = [1, 2, 3, 0][b];
    let mut count = 0;
    let mut lost = 0.;
    for mt in 0..=t {
        if (same && mt != t) || (!same && mt >= t) {
            continue;
        }
        count += comp[mt * 4 + prey];
        lost += comp[mt * 4 + prey] as f64 * c.v[mt];
    }
    if count == 0 {
        return 0.;
    }
    c.val((t + count as usize).min(5)) - c.v[t] - lost
}
fn event_worth(c: &Context, comp: &Comp, id: &str) -> f64 {
    match id {
        "execution" => {
            let mut sum = 0.;
            for t in 0..c.open.len() {
                for b in 0..4 {
                    sum += (c.open[t] / 4.)
                        * (execution_value(c, t, b, comp) - c.w("execMargin")).max(0.);
                }
            }
            sum
        }
        "chain" => c.w("wChain"),
        "trickster" => trickster_value(c, &c.open),
        "appetite" => appetite_value(
            c,
            (0..20)
                .find(|&i| comp[i] != 0)
                .map_or(usize::MAX, |i| i / 4),
            &c.open,
        ),
        "convict" => c.w("wOpen") * c.v[3],
        "crow" => c.w("wCrow"),
        "freedom" => 3. * c.w("wOpen") * c.open_value,
        "usurp1" => c.lift + 2. * c.lift * c.w("wUsurp"),
        "usurp2" => 2. * c.lift + 2. * c.lift2 * c.w("wUsurp"),
        "usurp3" => 2. * c.lift2 + c.all_lift2 * c.w("wUsurp"),
        "usurp4" => c.all_lift2,
        "portion" => c.board_count.min(3) as f64 * c.lift,
        "ratway" => c.w("wOpen") * c.open_value,
        "hunt" => c.w("wCrow") * (c.sealed as f64 / 4.).max(1.),
        _ => 0.,
    }
}
fn average_event(c: &Context, comp: &Comp) -> f64 {
    let pool = if c.st["eventPool"].is_array() {
        arr(&c.st["eventPool"])
    } else {
        arr(&data()["events"])
    };
    pool.iter()
        .map(|id| event_worth(c, comp, txt(id)))
        .sum::<f64>()
        / pool.len() as f64
}
fn office_values(st: &Value, c: &Context, comp: &Comp) -> (f64, f64, f64) {
    let bestow = c.lift;
    let free = instigate_cells(st).len();
    let each = average_event(c, comp);
    let extra = if st["startEvent"] == "tyranny" { 3 } else { 0 };
    let first = instigate_count(st);
    let tyranny = if extra > 0 {
        extra as f64 * bestow + (first + (extra - 1)).min(free) as f64 * each * c.w("wInstigate")
    } else {
        0.
    };
    let made = if extra > 0 { 1 } else { first }.min(free);
    let goal = if c.incidents != 0. {
        c.w("wOfficeIncident") * (made as f64).min(c.incidents) / c.incidents
    } else {
        0.
    };
    (
        bestow,
        made as f64 * each * c.w("wInstigate") + goal,
        tyranny,
    )
}
fn known(c: &mut Context, n: usize, swap_left: bool) -> f64 {
    let (mut comp, crowd) = view_composition(&c.view, Some(n));
    let t = c.view[n].tier;
    let b = c.view[n].beast;
    activation(c, t, b, &mut comp, crowd, swap_left)
}
fn incident_at(cell: &Value) -> bool {
    yes(&cell["event"]) && (yes(&cell["sealed"]) || yes(&cell["inmate"]))
}
pub fn patrol_scores(st: &Value, c: &mut Context) -> Vec<(usize, f64)> {
    let (mut comp, crowd) = view_composition(&c.view, None);
    let swap_left = can_swap_now(st);
    let mut fresh: Option<f64> = None;
    let mut out = vec![];
    let range = if num(pr(st, "patrolRange")) != 0. {
        int(pr(st, "patrolRange"))
    } else {
        int(&data()["params"]["patrolRange"])
    }
    .min(15);
    for nv in arr(&st["destinations"]) {
        let n = int(&nv);
        let cell = &st["cells"][n];
        let dist_steps = (n + 16 - int(&st["position"])) % 16;
        let steps = if !yes(&st["ratway"]) && dist_steps <= range {
            dist_steps
        } else {
            0
        };
        let mut score = c.w("wStep") * steps as f64;
        if yes(&st["chain"]) && !yes(&st["ratway"]) {
            let path = if steps > 0 {
                clockwise_path(st, n)
            } else {
                vec![n]
            };
            let locked = path
                .iter()
                .filter(|&&k| yes(&st["cells"][k]["sealed"]))
                .count();
            let extra = locked as f64 - if yes(&cell["sealed"]) { 1. } else { 0. };
            let here = if yes(&cell["sealed"]) {
                match fresh {
                    Some(x) => x,
                    None => {
                        let d = tagged(c, &c.open);
                        let x = fresh_value(c, &d, &mut comp, crowd + 1, swap_left);
                        fresh = Some(x);
                        x
                    }
                }
            } else if yes(&cell["inmate"]) {
                c.w("wWalk") * known(c, n, swap_left)
            } else {
                0.
            };
            score += c.w("wOpen") * extra * c.open_value + here;
        } else if yes(&cell["sealed"]) && yes(&cell["nest"]) {
            score += c.w("wNest");
        } else if yes(&cell["sealed"]) {
            let d = if yes(&cell["known"]) && yes(&cell["hidden"]) {
                Some(
                    (0..5)
                        .map(|t| {
                            if t == int(&cell["hidden"]["tier"]).min(4) {
                                1.
                            } else {
                                0.
                            }
                        })
                        .collect::<Vec<_>>(),
                )
            } else if yes(&cell["atLeast"]) {
                Some(floor_dist(&c.open, int(&cell["atLeast"])))
            } else {
                None
            };
            score += if let Some(d) = d {
                let d = tagged(c, &d);
                fresh_value(c, &d, &mut comp, crowd + 1, swap_left)
            } else {
                match fresh {
                    Some(x) => x,
                    None => {
                        let d = tagged(c, &c.open);
                        let x = fresh_value(c, &d, &mut comp, crowd + 1, swap_left);
                        fresh = Some(x);
                        x
                    }
                }
            };
            if c.flag("blacklist") && c.sealed as i32 - 1 <= 5 {
                score += 2. * c.lift;
            }
            if c.flag("keys") && c.w("wKeys") != 0. {
                let beside = [(n + 15) % 16, (n + 1) % 16]
                    .iter()
                    .filter(|&&k| yes(&st["cells"][k]["sealed"]))
                    .count();
                score += c.w("wKeys") * 0.8 * beside as f64 * c.w("wOpen") * c.open_value;
            }
            if c.flag("forged") && c.w("wForged") != 0. && c.sealed > 1 {
                score += c.w("wForged") * 0.5 * c.w("wOpen") * c.open_value;
            }
            if c.flag("fire") && c.w("wFire") != 0. && c.sealed > 1 {
                score += c.w("wFire") * 0.35 * c.w("wOpen") * c.open_value;
            }
            if yes(&cell["event"]) {
                score += if cell["eventKnown"] == false {
                    average_event(c, &comp)
                } else {
                    event_worth(c, &comp, txt(&cell["event"]))
                };
            }
        } else if n == 0 {
            let (bestow, instigate, tyranny) = office_values(st, c, &comp);
            score += bestow.max(instigate) + tyranny;
        } else if yes(&cell["inmate"]) {
            score += c.w("wWalk") * known(c, n, swap_left);
            if c.consumes != 0. && c.w("wConsumeWalk") != 0. && !devour_choices(st, n).is_empty() {
                score += c.w("wConsumeWalk") / c.consumes;
            }
            if yes(&cell["event"]) {
                score += if cell["eventKnown"] == false
                    || !slice(&data()["events"]).contains(&cell["event"])
                        && !txt(&cell["event"]).starts_with("usurp")
                {
                    average_event(c, &comp)
                } else {
                    event_worth(c, &comp, txt(&cell["event"]))
                };
            }
        }
        if c.flag("shackles") && c.lift != 0. && steps >= 4 {
            score += 0.4 * c.lift;
        }
        if c.flag("shortchain")
            && steps >= 1
            && steps <= 3
            && c.sealed > if yes(&cell["sealed"]) { 1 } else { 0 }
        {
            score += c.w("wShort") * 0.5 * c.w("wOpen") * c.open_value;
        }
        if c.goal != 0. {
            score += c.w("wGoal") * (steps as f64).min(c.goal);
        }
        if c.incidents != 0. {
            if incident_at(cell) {
                score += c.w("wIncident") / c.incidents;
            }
            if steps > 1 && c.w("wPass") != 0. {
                let passed = clockwise_path(st, n)
                    .iter()
                    .filter(|&&k| k != n && incident_at(&st["cells"][k]))
                    .count();
                score -= c.w("wPass") * passed as f64 / c.incidents;
            }
        }
        out.push((n, score));
    }
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}
fn link_value(st: &Value, c: &Context, link: &Value) -> f64 {
    let days = if yes(&st["maxDays"]) {
        num(&st["maxDays"])
    } else {
        num(&data()["params"]["drillDays"])
    };
    let rounds = num(&link["rounds"]).min(days - num(&st["day"])).max(0.);
    if rounds == 0. {
        return 0.;
    }
    let mut value = 0.;
    for id in [&link["lion"], &link["prey"]] {
        if let Some(n) = cell_of(st, id) {
            let t = int(&st["cells"][n]["inmate"]["tier"]);
            value += c.val((t + rounds as usize).min(5)) - c.v[t];
        }
    }
    value
}
fn best_hunt(st: &Value, c: &Context) -> Option<(usize, f64)> {
    if !can_hunt_now(st) {
        return None;
    }
    let lion = &st["cells"][int(&st["position"])]["inmate"];
    let mut best = None;
    for n in hunt_targets(st) {
        let link = json!({"lion":lion["id"],"prey":st["cells"][n]["inmate"]["id"],"rounds":p(st,"preyRounds")});
        let value = 0.8 * link_value(st, c, &link);
        if best.map_or(true, |(_, v)| value > v) {
            best = Some((n, value));
        }
    }
    best
}
fn link_loss(st: &Value, c: &Context, who: &Value, certain: bool) -> f64 {
    let Some(link) = link_of(st, &who["id"]) else {
        return 0.;
    };
    link_value(st, c, &link)
        * if certain || link["prey"] == who["id"] {
            1.
        } else {
            0.75
        }
}
pub fn devour_scores(st: &Value, c: &mut Context) -> Vec<(usize, f64)> {
    let here = &st["cells"][int(&st["position"])];
    if yes(&here["sealed"]) || !yes(&here["inmate"]) {
        return vec![];
    }
    let (mut comp, crowd) = view_composition(&c.view, Some(int(&st["position"])));
    let t = int(&here["inmate"]["tier"]);
    let b = beast(&here["inmate"]["beast"]);
    let own = link_loss(st, c, &here["inmate"], false);
    let chained = yes(&st["chaining"]) || yes(&st["used"]["pausedChain"]);
    let options = if yes(&st["chaining"]) {
        chain_choices(st)
    } else {
        start_choices(st)
    };
    let mut out = vec![];
    for o in options {
        let n = o.cell;
        let target = &st["cells"][n];
        let scratch = o.scratch;
        let meal = if scratch {
            &target["hidden"]
        } else {
            &target["inmate"]
        };
        let meal_link = if scratch {
            0.
        } else {
            link_loss(st, c, meal, true)
        };
        let same_link = own != 0.
            && meal_link != 0.
            && link_of(st, &here["inmate"]["id"]) == link_of(st, &meal["id"]);
        let loss = if same_link {
            own.max(meal_link)
        } else {
            own + meal_link
        };
        let stair_loss = if scratch {
            0.
        } else {
            stair_delta(c, &mut comp, int(&meal["tier"]), beast(&meal["beast"]), -1)
        };
        let cage = if c.flag("cage") {
            c.w("wCage") * 0.4 * c.w("wOpen") * c.open_value
        } else {
            0.
        };
        let score = devour_delta(
            c,
            t,
            b,
            beast(&meal["beast"]),
            scratch,
            &mut comp,
            crowd,
            chained,
            if scratch { t } else { int(&meal["tier"]) },
        ) - loss
            + stair_loss
            + cage;
        out.push((n, score));
    }
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}
fn swap_gain_here(st: &Value, c: &Context) -> f64 {
    let position = int(&st["position"]);
    let here = c.view[position];
    if !here.open || !can_swap_now(st) || c.swap_cap < 0. {
        return f64::NEG_INFINITY;
    }
    let mut gain =
        swap_value(c, here.tier) - link_loss(st, c, &st["cells"][position]["inmate"], true);
    if here.ivory {
        let board: Vec<_> = c.view.iter().filter(|v| v.open && v.tier < 5).collect();
        let lift = board
            .iter()
            .map(|v| c.v[v.tier + 1] - c.v[v.tier])
            .sum::<f64>()
            / board.len().max(1) as f64;
        gain += num(pr(st, "ivoryCount")).min(board.len() as f64) * lift;
        return gain;
    }
    if here.tier as f64 <= c.swap_cap {
        gain
    } else {
        f64::NEG_INFINITY
    }
}
fn board_value(st: &Value, c: &Context) -> f64 {
    let mut value = slice(&st["vault"]).len() as f64 * c.r;
    for (n, cell) in c.view.iter().enumerate() {
        if cell.open {
            value += c.v[cell.tier]
                * if devour_choices(st, n).is_empty() {
                    1.
                } else {
                    1.25
                };
        }
    }
    value
}
fn last_move_made(st: &Value) -> bool {
    num(&st["day"]) >= num(&st["maxDays"])
        && !yes(&st["chaining"])
        && !can_devour_now(st)
        && !can_swap_now(st)
        && !can_hunt_now(st)
}
fn pick_gift(st: &Value, c: &Context, options: &[Value], rng: &mut u32) -> Value {
    if yes(&c.params["giftRank"]) {
        return arr(&c.params["giftRank"])
            .into_iter()
            .find(|id| options.contains(id))
            .unwrap_or_else(|| options[0].clone());
    }
    if last_move_made(st) {
        let mut best: Option<(Value, i64)> = None;
        for id in options {
            let mut gain = 0;
            for _ in 0..3 {
                let mut trial = clone_state(st);
                trial["rng"] = json!((random(rng) * 4294967296.) as u32);
                if e::apply_typed(&mut trial, &json!({"type":"choose","id":id})) {
                    gain += slice(&trial["vault"]).len() as i64 - slice(&st["vault"]).len() as i64;
                }
            }
            if gain > 0 && best.as_ref().map_or(true, |(_, v)| gain > *v) {
                best = Some((id.clone(), gain));
            }
        }
        if let Some((id, _)) = best {
            return id;
        }
        if options.contains(&json!("ring")) {
            return json!("ring");
        }
    }
    if yes(&c.params["giftChain"]) {
        let left = slice(&st["pending"])
            .iter()
            .filter(|p| p["kind"] == "gift")
            .count();
        if options.contains(&json!("horn")) {
            for _ in 0..3 {
                let mut trial = clone_state(st);
                trial["rng"] = json!((random(rng) * 4294967296.) as u32);
                if e::apply_typed(&mut trial, &json!({"type":"choose","id":"horn"}))
                    && slice(&trial["vault"]).len() > slice(&st["vault"]).len()
                {
                    return json!("horn");
                }
            }
        }
        if left >= 3 && options.contains(&json!("ring")) && sealed(st).iter().any(|&n| n != 0) {
            return json!("ring");
        }
        if left >= 2
            && options.contains(&json!("wine"))
            && board_cells(st)
                .iter()
                .any(|&n| int(&st["cells"][n]["inmate"]["tier"]) < 3)
        {
            return json!("wine");
        }
    }
    let mut best: Option<(Value, f64)> = None;
    for id in options {
        let samples = if id == "ring" || id == "horn" { 3 } else { 1 };
        let mut value = 0.;
        for _ in 0..samples {
            let mut trial = clone_state(st);
            trial["rng"] = json!((random(rng) * 4294967296.) as u32);
            if !e::apply_typed(&mut trial, &json!({"type":"choose","id":id})) {
                continue;
            }
            value += board_value(&trial, &context(&trial, &c.params));
        }
        value /= samples as f64;
        if best.as_ref().map_or(true, |(_, v)| value > *v) {
            best = Some((id.clone(), value));
        }
    }
    best.map_or_else(|| options[0].clone(), |(id, _)| id)
}
fn subsets(
    held: &[Value],
    size: usize,
    from: usize,
    chosen: &mut Vec<Value>,
    out: &mut Vec<Vec<Value>>,
) {
    if chosen.len() == size {
        out.push(chosen.clone());
        return;
    }
    for i in from..held.len() {
        chosen.push(held[i].clone());
        subsets(held, size, i + 1, chosen, out);
        chosen.pop();
    }
}
fn measured_value(d: &Value, ids: &[Value]) -> Option<f64> {
    if ids.is_empty() {
        return d["base"].as_f64();
    }
    let names = slice(&d["ids"]);
    let mut key: Vec<u8> = ids
        .iter()
        .map(|id| 97 + names.iter().position(|x| x == id).unwrap() as u8)
        .collect();
    key.sort();
    d["v"][String::from_utf8(key).unwrap()].as_f64()
}
thread_local! {static TOOL_GAIN_CACHE:std::cell::RefCell<HashMap<Vec<u8>,Option<f64>>>=std::cell::RefCell::new(HashMap::new());}
fn tool_gains(st: &Value, options: &[Value]) -> Option<HashMap<String, f64>> {
    let d = &data()["combos"]["single"];
    let names = slice(&d["ids"]);
    if d.is_null() || !options.iter().all(|id| names.contains(id)) {
        return None;
    }
    let held: Vec<Value> = slice(&st["tools"])
        .iter()
        .filter(|id| names.contains(id))
        .cloned()
        .collect();
    let mut prefix: Vec<u8> = held
        .iter()
        .map(|id| names.iter().position(|x| x == id).unwrap() as u8)
        .collect();
    prefix.push(255);
    let mut keys = Vec::with_capacity(options.len());
    let mut cached = Vec::with_capacity(options.len());
    TOOL_GAIN_CACHE.with(|cache| {
        let cache = cache.borrow();
        for id in options {
            let mut key = prefix.clone();
            key.push(names.iter().position(|x| x == id).unwrap() as u8);
            cached.push(cache.get(&key).copied());
            keys.push(key);
        }
    });
    let mut subs = vec![];
    if cached.iter().any(|v| v.is_none()) {
        let largest = d["v"].as_object()?.keys().map(|k| k.len()).max()?;
        subsets(
            &held,
            held.len().min(largest - 1),
            0,
            &mut vec![],
            &mut subs,
        );
    }
    let mut gains = HashMap::new();
    for (i, id) in options.iter().enumerate() {
        let value = if let Some(v) = cached[i] {
            v
        } else {
            let mut sum = 0.;
            let mut n = 0;
            for sub in &subs {
                let mut with = sub.clone();
                with.push(id.clone());
                if let (Some(a), Some(b)) = (measured_value(d, &with), measured_value(d, sub)) {
                    sum += a - b;
                    n += 1;
                }
            }
            let result = if n > 0 { Some(sum / n as f64) } else { None };
            TOOL_GAIN_CACHE.with(|cache| {
                let mut cache = cache.borrow_mut();
                if cache.len() >= 8192 {
                    cache.clear();
                }
                cache.insert(keys[i].clone(), result);
            });
            result
        };
        gains.insert(txt(id).to_string(), value?);
    }
    Some(gains)
}
fn reroll_odds(st: &Value, options: &[Value]) -> Option<(f64, f64)> {
    let others: Vec<_> = arr(&data()["tools"])
        .into_iter()
        .filter(|id| !has(st, txt(id)) && !options.contains(id))
        .collect();
    let pool = if others.len() >= 3 {
        others
    } else {
        arr(&data()["tools"])
            .into_iter()
            .filter(|id| !has(st, txt(id)))
            .collect()
    };
    let mut union = options.to_vec();
    for id in &pool {
        if !union.contains(id) {
            union.push(id.clone())
        }
    }
    let gains = tool_gains(st, &union)?;
    if pool.len() < 3 {
        return None;
    }
    let w: Vec<f64> = pool.iter().map(|id| tool_weight(st, txt(id))).collect();
    let total: f64 = w.iter().sum();
    let mut next = 0.;
    let mut mass = 0.;
    for i in 0..pool.len() {
        for j in 0..pool.len() {
            if j == i || total - w[i] <= 0. {
                continue;
            }
            let pij = (w[i] / total) * (w[j] / (total - w[i]));
            let rest = total - w[i] - w[j];
            if rest <= 0. {
                continue;
            }
            for k in 0..pool.len() {
                if k == i || k == j {
                    continue;
                }
                let p = pij * (w[k] / rest);
                next += p * gains[txt(&pool[i])]
                    .max(gains[txt(&pool[j])])
                    .max(gains[txt(&pool[k])]);
                mass += p;
            }
        }
    }
    let now = options
        .iter()
        .map(|id| gains[txt(id)])
        .fold(f64::NEG_INFINITY, f64::max);
    Some((now, if mass > 0. { next / mass } else { 0. }))
}
fn wants_reroll(st: &Value, c: &Context, options: &[Value]) -> bool {
    if !can_reroll(st) || c.params["toolSets"] == false {
        return false;
    }
    reroll_odds(st, options).map_or(false, |(now, next)| next > now + c.w("rerollMargin"))
}
fn pick_tool(st: &Value, c: &Context, options: &[Value]) -> Value {
    if c.params["toolSets"] != false {
        if let Some(gains) = tool_gains(st, options) {
            let mut best = &options[0];
            for id in options.iter().skip(1) {
                if gains[txt(id)] > gains[txt(best)] {
                    best = id;
                }
            }
            return best.clone();
        }
    }
    arr(&c.params["toolRank"])
        .into_iter()
        .find(|id| options.contains(id))
        .unwrap_or_else(|| options[0].clone())
}
pub fn decide_typed(st: &Value, params: &Value, rng: &mut u32) -> Value {
    let prepared = Prepared::new(st, params);
    decide_prepared(st, &prepared, rng)
}
pub fn decide_prepared(st: &Value, prepared: &Prepared, rng: &mut u32) -> Value {
    let mut c = context_prepared(st, prepared);
    if st["phase"] == "ended" {
        return Value::Null;
    }
    if !slice(&st["pending"]).is_empty() {
        let choice = &st["pending"][0];
        let options = arr(&choice["options"]);
        if choice["kind"] == "gift" {
            return json!({"type":"choose","id":pick_gift(st,&c,&options,rng)});
        }
        if choice["kind"] == "tool" && wants_reroll(st, &c, &options) {
            return json!({"type":"reroll"});
        }
        return json!({"type":"choose","id":pick_tool(st,&c,&options)});
    }
    if yes(&st["chaining"]) {
        let options = devour_scores(st, &mut c);
        if can_stop_chain(st) && (options.is_empty() || options[0].1 < c.w("stopMargin")) {
            return json!({"type":"stopchain"});
        }
        return options
            .first()
            .map_or(json!({"type":"end"}), |o| json!({"type":"chain","to":o.0}));
    }
    if st["phase"] == "office" {
        if yes(&st["used"]["officeOnly"]) {
            return json!({"type":"office","choice":st["used"]["officeOnly"]});
        }
        if yes(&c.params["office"]) {
            return json!({"type":"office","choice":c.params["office"]});
        }
        let (comp, _) = composition(st, None);
        let (bestow, instigate, _) = office_values(st, &c, &comp);
        return json!({"type":"office","choice":if bestow>=instigate{"bestow"}else{"instigate"}});
    }
    if st["phase"] == "event" && yes(&st["event"]) {
        let kind = txt(&st["event"]["kind"]);
        let accept = if kind == "chain" {
            yes(&c.params["acceptChain"])
        } else if [
            "appetite", "convict", "crow", "freedom", "usurp1", "usurp2", "usurp3", "usurp4",
            "ratway", "hunt", "portion",
        ]
        .contains(&kind)
        {
            true
        } else {
            let n = int(&st["event"]["cell"]);
            let who = &st["cells"][n]["inmate"];
            if !yes(who) {
                false
            } else if kind == "trickster" {
                num(&who["tier"]) < 4.
            } else {
                let (comp, _) = composition(st, Some(n));
                execution_value(&c, int(&who["tier"]), beast(&who["beast"]), &comp)
                    > c.w("execMargin")
            }
        };
        return json!({"type":"event","accept":accept});
    }
    if st["phase"] == "patrol" {
        let scores = patrol_scores(st, &mut c);
        return scores.first().map_or(
            json!({"type":"end"}),
            |o| json!({"type":"patrol","cell":o.0}),
        );
    }
    let swap_gain = swap_gain_here(st, &c);
    let hunt = best_hunt(st, &c);
    if can_devour_now(st) {
        let mut devours = devour_scores(st, &mut c);
        if !devours.is_empty() && c.consumes != 0. && c.w("wConsume") != 0. {
            devours[0].1 += c.w("wConsume") / c.consumes;
        }
        if let Some(&(n, score)) = devours.first() {
            if score >= c.w("minDevour") {
                if let Some((n, v)) = hunt {
                    if v > score && v > swap_gain {
                        return json!({"type":"hunt","to":n});
                    }
                }
                if swap_gain > 0. && swap_gain > score + c.w("swapMargin") {
                    return json!({"type":"swap"});
                }
                return json!({"type":"devour","to":n});
            }
        }
    }
    if let Some((n, v)) = hunt {
        if v > 0. && v > swap_gain {
            return json!({"type":"hunt","to":n});
        }
    }
    if swap_gain > 0. {
        json!({"type":"swap"})
    } else {
        json!({"type":"end"})
    }
}
pub fn hide_future(st: &mut Value, seed: u32) {
    let mut rng = seed;
    st["rng"] = json!((random(&mut rng) * 4294967296.) as u32);
    let pool = if st["eventPool"].is_array() {
        arr(&st["eventPool"])
    } else {
        arr(&data()["events"])
    };
    for cell in st["cells"].as_array_mut().unwrap() {
        if yes(&cell["event"]) && cell["eventKnown"] == false {
            let i = (random(&mut rng) * pool.len() as f64) as usize;
            cell["event"] = pool[i].clone();
        }
        if !yes(&cell["sealed"]) || !yes(&cell["hidden"]) || num(&cell["known"]) >= 2. {
            continue;
        }
        if num(&cell["known"]) == 1. {
            cell["hidden"]["beast"] = json!(BEASTS[(random(&mut rng) * 4.) as usize])
        } else {
            cell["hidden"] = Value::Null;
        }
    }
}
pub struct EarlyTracker {
    pub end_day: f64,
    initial: usize,
    gained: f64,
}
impl EarlyTracker {
    pub fn new(st: &Value, days: i64) -> Self {
        Self {
            end_day: num(&st["maxDays"]).min(num(&st["day"]) + days.max(1) as f64 - 1.),
            initial: slice(&st["vault"]).len(),
            gained: 0.,
        }
    }
    pub fn observe(&mut self, st: &Value) -> f64 {
        if num(&st["day"]) <= self.end_day {
            self.gained = self
                .gained
                .max(slice(&st["vault"]).len() as f64 - self.initial as f64);
        }
        self.gained
    }
}
pub fn playout_observe(
    st: &mut Value,
    params: &Value,
    rng: &mut u32,
    early: Option<&mut EarlyTracker>,
) {
    let prepared = Prepared::new(st, params);
    playout_prepared(st, &prepared, rng, early)
}
pub fn playout_prepared(
    st: &mut Value,
    prepared: &Prepared,
    rng: &mut u32,
    mut early: Option<&mut EarlyTracker>,
) {
    for _ in 0..2000 {
        if st["phase"] == "ended" || slice(&st["vault"]).len() >= 10 {
            break;
        }
        let action = decide_prepared(st, prepared, rng);
        if action.is_null() {
            break;
        }
        let ok = e::apply_typed(st, &action);
        if let Some(t) = early.as_deref_mut() {
            t.observe(st);
        }
        if !ok && !(action["type"] != "end" && e::apply_typed(st, &json!({"type":"end"}))) {
            break;
        }
    }
}
pub fn playout_typed(
    st: &mut Value,
    params: &Value,
    rng: &mut u32,
    early_days: Option<i64>,
) -> Option<f64> {
    let mut early = early_days
        .filter(|d| *d > 0)
        .map(|d| EarlyTracker::new(st, d));
    playout_observe(st, params, rng, early.as_mut());
    early.map(|mut t| t.observe(st))
}
fn odds_from(
    c: &Context,
    t: usize,
    keep: Option<usize>,
    comp: &mut Comp,
    memo: &mut HashMap<Vec<i32>, (f64, f64)>,
) -> (f64, f64) {
    if t >= 5 {
        return (1., 0.);
    }
    let beasts = keep.map_or_else(|| vec![0, 1, 2, 3], |b| vec![b]);
    let mut p = 0.;
    let mut n = 0.;
    for b in &beasts {
        let (pb, nb) = odds_eat(c, t, *b, comp, memo);
        p += pb / beasts.len() as f64;
        n += nb / beasts.len() as f64;
    }
    (p, n)
}
fn odds_eat(
    c: &Context,
    t: usize,
    b: usize,
    comp: &mut Comp,
    memo: &mut HashMap<Vec<i32>, (f64, f64)>,
) -> (f64, f64) {
    let mut key = vec![t as i32, b as i32];
    key.extend_from_slice(&comp[if c.fight { 0 } else { t * 4 }..20]);
    if let Some(out) = memo.get(&key) {
        return *out;
    }
    let mut out: Option<(f64, f64)> = None;
    for mt in if c.fight { 0 } else { t }..=c.top(t, b) {
        for f in c.diets(t, b, mt != t) {
            if comp[mt * 4 + f] == 0 {
                continue;
            }
            comp[mt * 4 + f] -= 1;
            let next = if c.flag("maul") && b == 0 {
                (t + 1).max(mt + 2)
            } else {
                t + 1
            };
            let (p, n) = odds_from(c, next, if c.fight { Some(b) } else { None }, comp, memo);
            comp[mt * 4 + f] += 1;
            if out.map_or(true, |(po, no)| {
                p > po + 1e-12 || ((p - po).abs() <= 1e-12 && n + 1. > no)
            }) {
                out = Some((p, n + 1.));
            }
        }
    }
    let out = out.unwrap_or((0., 0.));
    memo.insert(key, out);
    out
}
pub fn chain_odds(st: &Value, from: usize, to: usize) -> Value {
    let odds_params = json!({"tierBase":1,"rainbowMult":1});
    let c = context(st, &odds_params);
    let eater = &st["cells"][from]["inmate"];
    let target = &st["cells"][to];
    let meal = if yes(&target["sealed"]) {
        &target["hidden"]
    } else {
        &target["inmate"]
    };
    if !yes(eater) || !yes(meal) {
        return json!({"rainbow":0,"bites":0});
    }
    let (mut comp, _) = composition(st, Some(from));
    if !yes(&target["sealed"]) {
        comp[int(&meal["tier"]) * 4 + beast(&meal["beast"])] -= 1;
    }
    let t = int(&eater["tier"]);
    let b = beast(&eater["beast"]);
    let gain = if yes(&target["sealed"]) && yes(&target["scratch"]) {
        2 + if yes(pr(st, "scratchStacksBase")) {
            1
        } else {
            0
        }
    } else if c.flag("maul") && b == 0 {
        (int(&meal["tier"]) as i32 + 2 - t as i32).max(1) as usize
    } else {
        1
    };
    let (p, n) = odds_from(
        &c,
        (t + gain).min(5),
        if c.fight { Some(b) } else { None },
        &mut comp,
        &mut HashMap::new(),
    );
    json!({"rainbow":p,"bites":1.+n})
}

fn merge_params(params: &Value) -> Value {
    let mut out = data()["defaults"].clone();
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            out[k] = v.clone();
        }
    }
    out
}
fn merged_profile(st: &Value) -> &'static Value {
    static PROFILES: OnceLock<[Value; 2]> = OnceLock::new();
    let profiles = PROFILES.get_or_init(|| {
        [
            merge_params(&data()["profiles"]["notools"]),
            merge_params(&data()["profiles"]["rewards"]),
        ]
    });
    &profiles[if yes(pr(st, "rewards")) { 1 } else { 0 }]
}
pub fn prepare_params(st: &Value, params: &Value) -> Value {
    if params.is_null() {
        merged_profile(st).clone()
    } else {
        merge_params(params)
    }
}

pub fn decide(
    state: &serde_json::Value,
    params: &serde_json::Value,
    rng: &mut u32,
) -> serde_json::Value {
    decide_typed(
        &Value::from(state.clone()),
        &Value::from(params.clone()),
        rng,
    )
    .to_json()
}
pub fn playout(
    state: &mut serde_json::Value,
    params: &serde_json::Value,
    rng: &mut u32,
    early_days: Option<i64>,
) -> Option<f64> {
    let mut typed = Value::from(state.clone());
    let out = playout_typed(&mut typed, &Value::from(params.clone()), rng, early_days);
    *state = typed.to_json();
    out
}
pub fn trajectory(
    state: &serde_json::Value,
    params: &serde_json::Value,
    seed: u32,
) -> serde_json::Value {
    let mut state = Value::from(state.clone());
    let params = Prepared::new(&state, &Value::from(params.clone()));
    let mut rng = seed;
    let mut steps = Vec::new();
    for _ in 0..2000 {
        if state["phase"] == "ended" || slice(&state["vault"]).len() >= 10 {
            break;
        }
        let action = decide_prepared(&state, &params, &mut rng);
        let ok = e::apply_typed(&mut state, &action);
        steps.push(serde_json::json!({"action":action,"ok":ok,"state":state}));
        if !ok {
            break;
        }
    }
    serde_json::json!({"steps":steps,"state":state,"rng":rng})
}
