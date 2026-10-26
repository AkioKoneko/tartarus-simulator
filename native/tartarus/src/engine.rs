//! Independently translated from this repository's js/engine.js.
//! Logs are presentation-only and intentionally not synthesized.
use crate::model::Value;
use crate::model_json as json;
use std::sync::OnceLock;
pub const BEASTS: [&str; 4] = ["mammoth", "lion", "wolf", "rat"];
pub fn data() -> &'static Value {
    static D: OnceLock<Value> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../data.json")).unwrap())
}
pub fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.)
}
pub fn int(v: &Value) -> usize {
    num(v) as usize
}
pub fn yes(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(_) => num(v) != 0.,
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
pub fn txt(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub fn slice(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], |a| a.as_slice())
}
pub fn pr<'a>(s: &'a Value, k: &str) -> &'a Value {
    s["params"].get(k).unwrap_or(&data()["params"][k])
}
pub fn arr(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}
pub fn has(s: &Value, t: &str) -> bool {
    s["tools"]
        .as_array()
        .map_or(false, |a| a.iter().any(|x| x == t))
}
pub fn p(s: &Value, k: &str) -> Value {
    s["params"]
        .get(k)
        .cloned()
        .unwrap_or_else(|| data()["params"][k].clone())
}
pub fn inc(v: &mut Value, n: f64) {
    *v = json!(num(v) + n);
}
pub fn hash_seed(s: &str) -> u32 {
    s.chars().fold(2166136261u32, |h, c| {
        (h ^ (c as u32)).wrapping_mul(16777619)
    })
}
pub fn random(r: &mut u32) -> f64 {
    *r = r.wrapping_add(0x6d2b79f5);
    let mut t = *r;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    ((t ^ (t >> 14)) as f64) / 4294967296.
}
pub fn rand(s: &mut Value) -> f64 {
    let mut r = num(&s["rng"]) as u32;
    let x = random(&mut r);
    s["rng"] = json!(r);
    x
}
pub fn pick_index(s: &mut Value, w: &[f64]) -> usize {
    let total: f64 = w.iter().map(|x| x.max(0.)).sum();
    if total <= 0. {
        return 0;
    }
    let mut r = rand(s) * total;
    for (i, x) in w.iter().enumerate() {
        r -= x.max(0.);
        if r < 0. {
            return i;
        }
    }
    w.len().saturating_sub(1)
}
pub fn pick(s: &mut Value, a: &[usize]) -> Option<usize> {
    if a.is_empty() {
        None
    } else {
        Some(a[(rand(s) * a.len() as f64) as usize])
    }
}
pub fn shuffled(s: &mut Value, mut a: Vec<usize>) -> Vec<usize> {
    for i in (1..a.len()).rev() {
        let j = (rand(s) * (i + 1) as f64) as usize;
        a.swap(i, j)
    }
    a
}
pub fn weights(v: &Value) -> Vec<f64> {
    slice(v).iter().map(num).collect()
}
pub fn board_cells(s: &Value) -> Vec<usize> {
    slice(&s["cells"])
        .iter()
        .enumerate()
        .filter(|(_, c)| !yes(&c["sealed"]) && yes(&c["inmate"]))
        .map(|(i, _)| i)
        .collect()
}
pub fn sealed(s: &Value) -> Vec<usize> {
    slice(&s["cells"])
        .iter()
        .enumerate()
        .filter(|(_, c)| yes(&c["sealed"]))
        .map(|(i, _)| i)
        .collect()
}
pub fn cell_of(s: &Value, id: &Value) -> Option<usize> {
    slice(&s["cells"])
        .iter()
        .position(|c| yes(&c["inmate"]) && c["inmate"]["id"] == *id)
}
pub fn board_cell_of(s: &Value, id: &Value) -> Option<usize> {
    cell_of(s, id).filter(|&n| !yes(&s["cells"][n]["sealed"]))
}
pub fn link_of(s: &Value, id: &Value) -> Option<Value> {
    slice(&s["prey"])
        .iter()
        .find(|l| l["lion"] == *id || l["prey"] == *id)
        .cloned()
}
pub fn eats_of(s: &Value, b: &str, t: Option<f64>) -> Vec<&'static str> {
    let mut a = match b {
        "mammoth" => vec!["lion"],
        "lion" => vec!["wolf"],
        "wolf" => vec!["rat"],
        "rat" => vec!["mammoth"],
        _ => vec![],
    };
    let floor = if s["startEvent"] == "cagefight" {
        0.
    } else {
        num(pr(s, "doubleEatTier"))
    };
    if t.map_or(false, |t| t >= floor) {
        if b == "mammoth" {
            a.push("wolf")
        }
        if b == "lion" {
            a.push("rat")
        }
    }
    a
}
#[derive(Clone, Copy)]
struct EatRules {
    fight: bool,
    double_from: f64,
    skewer: bool,
    crown: bool,
    maul: bool,
    guillotine: bool,
}
fn beast_code(b: &Value) -> usize {
    match txt(b) {
        "mammoth" => 0,
        "lion" => 1,
        "wolf" => 2,
        "rat" => 3,
        _ => 4,
    }
}
impl EatRules {
    fn new(s: &Value) -> Self {
        let tools = slice(&s["tools"]);
        let has = |k: &str| tools.iter().any(|v| v == k);
        let fight = s["startEvent"] == "cagefight";
        Self {
            fight,
            double_from: if fight {
                0.
            } else {
                num(pr(s, "doubleEatTier"))
            },
            skewer: has("skewer"),
            crown: has("crown"),
            maul: has("maul"),
            guillotine: has("guillotine"),
        }
    }
    fn can(self, b: usize, t: f64, mb: usize, mt: f64) -> bool {
        if t >= 5. || b >= 4 || mb >= 4 {
            return false;
        }
        let counter = mb == [1, 2, 3, 0][b]
            || (t >= self.double_from && ((b == 0 && mb == 2) || (b == 1 && mb == 3)))
            || (b == 3 && mb == 3 && self.skewer);
        if t != mt {
            if mt < t && counter && self.fight {
                return true;
            }
            if mt > t && counter && b == 0 && self.maul {
                return true;
            }
            return t > mt && b == 2 && self.guillotine && mb == 3;
        }
        counter || (b == 1 && self.crown)
    }
}
pub fn can_eat(s: &Value, e: &Value, m: &Value) -> bool {
    yes(e)
        && yes(m)
        && e["id"] != m["id"]
        && EatRules::new(s).can(
            beast_code(&e["beast"]),
            num(&e["tier"]),
            beast_code(&m["beast"]),
            num(&m["tier"]),
        )
}
#[derive(Clone, Copy)]
pub struct MealChoice {
    pub cell: usize,
    pub scratch: bool,
}
pub fn devour_choices(s: &Value, n: usize) -> Vec<MealChoice> {
    let cells = slice(&s["cells"]);
    let c = &cells[n];
    let e = &c["inmate"];
    if yes(&c["sealed"]) || !yes(e) {
        return vec![];
    }
    let rules = EatRules::new(s);
    let b = beast_code(&e["beast"]);
    let t = num(&e["tier"]);
    let id = &e["id"];
    let mut out = Vec::new();
    for (i, c) in cells.iter().enumerate() {
        if i == n {
            continue;
        }
        let sealed = yes(&c["sealed"]);
        let m = &c["inmate"];
        if !sealed
            && yes(m)
            && m["id"] != *id
            && rules.can(b, t, beast_code(&m["beast"]), num(&m["tier"]))
        {
            out.push(MealChoice {
                cell: i,
                scratch: false,
            });
        } else if sealed && b == 2 && t < 5. && yes(&c["scratch"]) {
            let h = &c["hidden"];
            if yes(h) && num(&h["tier"]) == t {
                out.push(MealChoice {
                    cell: i,
                    scratch: true,
                });
            }
        }
    }
    out
}
fn framed_choices(s: &Value, mut opts: Vec<MealChoice>) -> Vec<MealChoice> {
    if let Some(only) = s["used"]["mealOnly"].as_array() {
        opts.retain(|o| only.iter().any(|n| num(n) == o.cell as f64));
    }
    opts
}
pub fn start_choices(s: &Value) -> Vec<MealChoice> {
    if !can_devour_now(s) || s["phase"] != "manage" {
        vec![]
    } else {
        framed_choices(s, devour_choices(s, int(&s["position"])))
    }
}
pub fn chain_choices(s: &Value) -> Vec<MealChoice> {
    board_cell_of(s, &s["chaining"]["eater"])
        .filter(|_| yes(&s["chaining"]))
        .map_or(vec![], |n| framed_choices(s, devour_choices(s, n)))
}

pub fn paused_eater(s: &Value) -> bool {
    let c = &s["cells"][int(&s["position"])];
    yes(&s["used"]["pausedChain"])
        && num(&s["used"]["devour"]) > 0.
        && !yes(&c["sealed"])
        && yes(&c["inmate"])
        && c["inmate"]["id"] == s["used"]["pausedChain"]["eater"]
}
pub fn can_devour_now(s: &Value) -> bool {
    (num(&s["used"]["devour"]) < 1. || paused_eater(s))
        && !yes(&s["used"]["hunt"])
        && !yes(&s["used"]["noDevour"])
        && (num(&s["used"]["swap"]) < 1. || yes(&s["used"]["devourAfterSwap"]))
}
pub fn can_swap_now(s: &Value) -> bool {
    num(&s["used"]["devour"]) < 1.
        && !yes(&s["used"]["hunt"])
        && !yes(&s["used"]["noSwap"])
        && num(&s["used"]["swap"]) < num(pr(s, "swapsPerDay"))
}
pub fn hunt_targets(s: &Value) -> Vec<usize> {
    let n = int(&s["position"]);
    let c = &s["cells"][n];
    if !has(s, "trap") || yes(&c["sealed"]) || c["inmate"]["beast"] != "lion" {
        return vec![];
    }
    if let Some(a) = s["used"]["huntOnly"].as_array() {
        return a
            .iter()
            .map(int)
            .filter(|&i| {
                i != n
                    && !s["cells"][i].is_null()
                    && !yes(&s["cells"][i]["sealed"])
                    && yes(&s["cells"][i]["inmate"])
            })
            .collect();
    }
    if link_of(s, &c["inmate"]["id"]).is_some() {
        return vec![];
    }
    board_cells(s)
        .into_iter()
        .filter(|&i| {
            i != n
                && can_eat(s, &c["inmate"], &s["cells"][i]["inmate"])
                && link_of(s, &s["cells"][i]["inmate"]["id"]).is_none()
                && !yes(&s["cells"][i]["inmate"]["marked"])
        })
        .collect()
}
pub fn can_hunt_now(s: &Value) -> bool {
    s["phase"] == "manage"
        && !yes(&s["chaining"])
        && num(&s["used"]["devour"]) < 1.
        && num(&s["used"]["swap"]) < 1.
        && !yes(&s["used"]["hunt"])
        && !yes(&s["used"]["noHunt"])
        && !hunt_targets(s).is_empty()
}
pub fn devour_options(s: &Value, n: usize) -> Vec<Value> {
    devour_choices(s, n)
        .into_iter()
        .map(|o| json!({"cell":o.cell,"scratch":o.scratch}))
        .collect()
}
fn framed(s: &Value, a: Vec<Value>) -> Vec<Value> {
    match s["used"]["mealOnly"].as_array() {
        Some(m) => a.into_iter().filter(|o| m.contains(&o["cell"])).collect(),
        None => a,
    }
}
pub fn start_options(s: &Value) -> Vec<Value> {
    if !can_devour_now(s) || s["phase"] != "manage" {
        vec![]
    } else {
        framed(s, devour_options(s, int(&s["position"])))
    }
}
pub fn chain_options(s: &Value) -> Vec<Value> {
    board_cell_of(s, &s["chaining"]["eater"])
        .filter(|_| yes(&s["chaining"]))
        .map_or(vec![], |n| framed(s, devour_options(s, n)))
}
pub fn can_stop_chain(s: &Value) -> bool {
    yes(pr(s, "chainStop"))
}
pub fn can_reroll(s: &Value) -> bool {
    s["pending"][0]["kind"] == "tool" && num(&s["pending"][0]["rerolls"]) > 0.
}
pub fn instigate_cells(s: &Value) -> Vec<usize> {
    slice(&s["cells"])
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            *i != 0
                && !yes(&c["event"])
                && if yes(&c["sealed"]) {
                    !yes(&c["nest"])
                } else {
                    yes(&c["inmate"])
                }
        })
        .map(|(i, _)| i)
        .collect()
}
pub fn instigate_count(s: &Value) -> usize {
    if slice(&s["cells"]).iter().any(|c| yes(&c["event"])) {
        1
    } else {
        2
    }
}
pub fn tool_weight(s: &Value, id: &str) -> f64 {
    if slice(&data()["beastTools"]).contains(&json!(id)) {
        num(pr(s, "beastToolOdds")).max(0.) / 100.
    } else {
        1.
    }
}
pub fn door_weights(s: &Value) -> Vec<f64> {
    let mut w = weights(pr(s, "tierWeights"));
    if has(s, "hook") && w.iter().skip(1).any(|x| *x > 0.) {
        w[0] = 0.
    }
    w
}
pub fn cell_weights(s: &Value, n: usize) -> Vec<f64> {
    let w = door_weights(s);
    let f = num(&s["cells"][n]["atLeast"]);
    let k: Vec<f64> = w
        .iter()
        .enumerate()
        .map(|(i, x)| if i as f64 >= f { *x } else { 0. })
        .collect();
    if k.iter().any(|x| *x > 0.) {
        k
    } else {
        w
    }
}
fn make_inmate(s: &mut Value, b: &str, t: f64) -> Value {
    let id = s["nextId"].clone();
    inc(&mut s["nextId"], 1.);
    json!({"id":id,"beast":b,"tier":t.clamp(0.,5.)})
}
fn roll_inmate(s: &mut Value, w: Vec<f64>) -> Value {
    let t = pick_index(s, &w);
    let bw = weights(pr(s, "beastWeights"));
    let b = BEASTS[pick_index(s, &bw)];
    make_inmate(s, b, t as f64)
}
fn hidden_of(s: &mut Value, n: usize) -> Value {
    if !yes(&s["cells"][n]["hidden"]) {
        let w = cell_weights(s, n);
        let who = roll_inmate(s, w);
        s["cells"][n]["hidden"] = who;
    }
    s["cells"][n]["hidden"].clone()
}
fn empty_cell(s: &mut Value, n: usize) -> Value {
    let reusable = yes(pr(s, "reusableCells"));
    let c = &mut s["cells"][n];
    let old = c["inmate"].clone();
    for k in ["inmate", "hidden", "nest", "event"] {
        c[k] = Value::Null
    }
    for k in ["known", "atLeast"] {
        c[k] = json!(0)
    }
    for k in ["scratch", "ivory", "seen"] {
        c[k] = json!(false)
    }
    c["sealed"] = json!(reusable);
    old
}
fn check_prey(s: &mut Value) {
    s["prey"] = Value::Array(
        arr(&s["prey"])
            .into_iter()
            .filter(
                |l| match (board_cell_of(s, &l["lion"]), board_cell_of(s, &l["prey"])) {
                    (Some(a), Some(b)) => {
                        s["cells"][a]["inmate"]["beast"] == "lion"
                            && s["cells"][b]["inmate"]["beast"] == l["preyBeast"]
                    }
                    _ => false,
                },
            )
            .collect(),
    );
}
fn draw_tools(s: &mut Value, mut pool: Vec<Value>, k: usize) -> Vec<Value> {
    let mut out = vec![];
    while out.len() < k && !pool.is_empty() {
        let w: Vec<f64> = pool.iter().map(|x| tool_weight(s, txt(x))).collect();
        let i = pick_index(s, &w);
        out.push(pool.remove(i));
    }
    out
}
fn meet_objective(s: &mut Value) {
    s["milestone"] = json!(true);
    if yes(pr(s, "rewards")) {
        let pool = arr(&data()["tools"])
            .into_iter()
            .filter(|x| !has(s, txt(x)))
            .collect();
        let options = draw_tools(s, pool, 3);
        if !options.is_empty() {
            s["pending"]
                .as_array_mut()
                .unwrap()
                .push(json!({"kind":"tool","options":options}));
        }
    }
}
fn count_objective(s: &mut Value, id: &str, by: f64) {
    if s["objective"]["id"] != id || yes(&s["milestone"]) {
        return;
    }
    let need = num(&data()["objectives"][id]["need"]);
    s["objective"]["progress"] = json!((num(&s["objective"]["progress"]) + by).min(need));
    if num(&s["objective"]["progress"]) >= need {
        meet_objective(s)
    }
}
fn after_growth(s: &mut Value, who: &mut Value) {
    if num(&who["tier"]) >= 5. && slice(&s["vault"]).len() >= 10 {
        who["tier"] = json!(4)
    }
    s["stats"]["best"] = json!(num(&s["stats"]["best"]).max(num(&who["tier"])));
    if s["objective"]["id"] == "king" && !yes(&s["milestone"]) && num(&who["tier"]) >= 4. {
        meet_objective(s)
    }
    if let Some(n) = cell_of(s, &who["id"]) {
        s["cells"][n]["inmate"] = who.clone();
        if num(&who["tier"]) >= 5. {
            empty_cell(s, n);
            let day = s["day"].clone();
            s["vault"]
                .as_array_mut()
                .unwrap()
                .push(json!({"id":who["id"],"beast":who["beast"],"day":day}));
            inc(&mut s["cache"], 1.);
            if yes(pr(s, "rewards")) {
                for _ in 0..if s["startEvent"] == "opulence" { 3 } else { 1 } {
                    s["pending"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"kind":"gift","options":["ring","horn","wine","brand"]}));
                }
            }
        }
    }
}
fn promote(s: &mut Value, n: usize, by: f64, reroll: bool) -> Value {
    let mut who = s["cells"][n]["inmate"].clone();
    who["tier"] = json!((num(&who["tier"]) + by).clamp(0., 5.));
    if reroll && num(&who["tier"]) < 5. {
        let bw = weights(pr(s, "beastWeights"));
        who["beast"] = json!(BEASTS[pick_index(s, &bw)]);
    }
    after_growth(s, &mut who);
    who
}
fn roll_event(s: &mut Value) -> Value {
    let pool = if s["eventPool"].is_array() {
        arr(&s["eventPool"])
    } else {
        arr(&data()["events"])
    };
    let i = (rand(s) * pool.len() as f64) as usize;
    pool.get(i).cloned().unwrap_or(Value::Null)
}
fn spawn_event(s: &mut Value, chance: f64, follow: bool) {
    if chance <= 0. || rand(s) * 100. >= chance {
        return;
    }
    let pool: Vec<usize> = if follow {
        instigate_cells(s)
            .into_iter()
            .filter(|i| *i != int(&s["position"]))
            .collect()
    } else {
        sealed(s)
            .into_iter()
            .filter(|&i| i != 0 && !yes(&s["cells"][i]["event"]) && !yes(&s["cells"][i]["nest"]))
            .collect()
    };
    if let Some(n) = pick(s, &pool) {
        let e = roll_event(s);
        s["cells"][n]["event"] = e;
        s["cells"][n]["seen"] = json!(true)
    }
}
fn open_cell(s: &mut Value, n: usize, patrol: bool, forced: Option<(&str, f64)>) -> Value {
    if !yes(&s["cells"][n]["sealed"]) {
        return Value::Null;
    }
    let event = s["cells"][n]["event"].clone();
    let h = s["cells"][n]["hidden"].clone();
    let mut who = if let Some((b, t)) = forced {
        make_inmate(s, b, t)
    } else if yes(&h) && (num(&h["tier"]) > 0. || yes(&s["cells"][n]["known"]) || !has(s, "hook")) {
        h
    } else {
        let w = cell_weights(s, n);
        roll_inmate(s, w)
    };
    let id = who["id"].clone();
    let c = &mut s["cells"][n];
    c["sealed"] = json!(false);
    c["inmate"] = who.clone();
    for k in ["hidden", "nest", "event"] {
        c[k] = Value::Null
    }
    for k in ["known", "atLeast"] {
        c[k] = json!(0)
    }
    c["scratch"] = json!(false);
    inc(&mut s["stats"]["opened"], 1.);
    count_objective(s, "doors", 1.);
    after_growth(s, &mut who);
    if patrol
        && has(s, "dogtag")
        && s["cells"][n]["inmate"]["id"] == id
        && num(&who["tier"]) < 5.
        && rand(s) < 0.25
    {
        who = promote(s, n, 1., false);
    }
    if patrol && has(s, "blacklist") && sealed(s).len() <= 5 {
        let pool = board_cells(s)
            .into_iter()
            .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) < 5.)
            .collect();
        let picks = shuffled(s, pool);
        for i in picks.into_iter().take(2) {
            if yes(&s["cells"][i]["inmate"]) {
                let out = promote(s, i, 1., false);
                if out["id"] == id {
                    who = out;
                }
            }
        }
    }
    if patrol && has(s, "fire") && rand(s) < 0.35 && s["cells"][n]["inmate"]["id"] == id {
        let pool = sealed(s);
        if let Some(i) = pick(s, &pool) {
            open_cell(s, i, false, Some((txt(&who["beast"]), num(&who["tier"]))));
        }
    }
    if patrol && has(s, "keys") && rand(s) < 0.8 {
        open_cell(s, (n + 15) % 16, false, None);
        open_cell(s, (n + 1) % 16, false, None);
    }
    if patrol && has(s, "forged") && rand(s) < 0.5 {
        let pool = sealed(s);
        if let Some(i) = pick(s, &pool) {
            open_cell(s, i, false, None);
        }
    }
    if patrol {
        event
    } else {
        Value::Null
    }
}
fn destination_limit(s: &Value) -> usize {
    let base = if yes(&s["destBase"]) {
        num(&s["destBase"])
    } else {
        num(pr(s, "destinations"))
    };
    (base
        - ["forged", "whip", "stake"]
            .iter()
            .filter(|&&t| has(s, t))
            .count() as f64)
        .max(1.) as usize
}
fn roll_destinations(s: &mut Value) {
    let fewer = rand(s) * 100. < num(pr(s, "fewerDoorsChance"));
    s["destBase"] = json!((num(pr(s, "destinations")) - if fewer { 1. } else { 0. }).max(1.));
    let pos = int(&s["position"]);
    let range = int(pr(s, "patrolRange")).min(15);
    let mut ahead: Vec<usize> = (1..=range).map(|i| (pos + i) % 16).collect();
    let mut picks = vec![];
    for _ in 0..destination_limit(s) {
        if ahead.is_empty() {
            break;
        }
        let w: Vec<f64> = ahead
            .iter()
            .map(|i| {
                if *i == 0 {
                    num(pr(s, "officeDoorOdds")) / 100.
                } else {
                    1.
                }
            })
            .collect();
        if !picks.is_empty() && !w.iter().any(|x| *x > 0.) {
            break;
        }
        let j = pick_index(s, &w);
        picks.push(ahead.remove(j));
    }
    let has_event = |i: &usize| {
        yes(&s["cells"][*i]["sealed"])
            && yes(&s["cells"][*i]["event"])
            && yes(&s["cells"][*i]["seen"])
    };
    if yes(pr(s, "eventTwoDoors")) && picks.iter().any(has_event) {
        picks.sort_by_key(|i| !has_event(i));
        picks.truncate(2);
    }
    picks.sort_by_key(|i| (i + 16 - pos) % 16);
    s["destinations"] = json!(picks);
}
fn coin(s: &mut Value) {
    let board = board_cells(s);
    let same = |a: usize, b: usize| {
        s["cells"][a]["inmate"]["beast"] == s["cells"][b]["inmate"]["beast"]
            && num(&s["cells"][a]["inmate"]["tier"]) == num(&s["cells"][b]["inmate"]["tier"])
    };
    let matching: Vec<usize> = board
        .iter()
        .copied()
        .filter(|&a| board.iter().filter(|&&b| same(a, b)).count() >= 2)
        .collect();
    if matching.is_empty() || rand(s) >= 0.6 {
        return;
    }
    let gone = pick(s, &matching).unwrap();
    let pool: Vec<usize> = matching
        .iter()
        .copied()
        .filter(|&b| {
            b != gone
                && s["cells"][gone]["inmate"]["beast"] == s["cells"][b]["inmate"]["beast"]
                && num(&s["cells"][gone]["inmate"]["tier"]) == num(&s["cells"][b]["inmate"]["tier"])
        })
        .collect();
    let lucky = pick(s, &pool).unwrap();
    empty_cell(s, gone);
    check_prey(s);
    promote(s, lucky, 2., false);
}
fn ravenous(s: &mut Value) {
    let board = board_cells(s);
    if board.is_empty() {
        return;
    }
    let top = board
        .iter()
        .map(|&i| num(&s["cells"][i]["inmate"]["tier"]))
        .fold(0., f64::max);
    let pool = board
        .into_iter()
        .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) == top)
        .collect::<Vec<_>>();
    let n = pick(s, &pool).unwrap();
    let sides: Vec<usize> = [(n + 15) % 16, (n + 1) % 16]
        .into_iter()
        .filter(|&i| !yes(&s["cells"][i]["sealed"]) && yes(&s["cells"][i]["inmate"]))
        .collect();
    let mut rises = 0.;
    for i in sides {
        empty_cell(s, i);
        if rand(s) < 0.4 {
            rises += 1.;
        }
    }
    check_prey(s);
    if rises > 0. {
        promote(s, n, rises, false);
    }
}
fn begin_day(s: &mut Value) {
    s["phase"] = json!("patrol");
    s["used"] = json!({"swap":0,"devour":0});
    check_prey(s);
    let links = arr(&s["prey"]);
    for l in links {
        if num(&l["next"]) > num(&s["day"]) {
            continue;
        }
        let a = board_cell_of(s, &l["lion"]);
        let b = board_cell_of(s, &l["prey"]);
        let mut next = vec![];
        for mut x in arr(&s["prey"]) {
            if x == l {
                inc(&mut x["rounds"], -1.);
                x["next"] = json!(num(&s["day"]) + 1.);
                if num(&x["rounds"]) <= 0. {
                    continue;
                }
            }
            next.push(x);
        }
        s["prey"] = json!(next);
        if let Some(a) = a {
            promote(s, a, 1., false);
        }
        if let Some(b) = b {
            promote(s, b, 1., false);
        }
    }
    check_prey(s);
    for n in 0..16 {
        if yes(&s["cells"][n]["nest"]) && num(&s["cells"][n]["nest"]["due"]) <= num(&s["day"]) {
            let tier = num(pr(s, "nestTier"));
            open_cell(s, n, false, Some(("rat", tier)));
        }
    }
    if has(s, "tongs") {
        let pool: Vec<_> = board_cells(s)
            .into_iter()
            .filter(|&i| {
                s["cells"][i]["inmate"]["beast"] == "mammoth" && !yes(&s["cells"][i]["ivory"])
            })
            .collect();
        if let Some(i) = pick(s, &pool) {
            s["cells"][i]["ivory"] = json!(true);
        }
    }
    if has(s, "claws") {
        let pool: Vec<_> = sealed(s)
            .into_iter()
            .filter(|&i| !yes(&s["cells"][i]["scratch"]) && !yes(&s["cells"][i]["nest"]))
            .collect();
        if let Some(i) = pick(s, &pool) {
            hidden_of(s, i);
            s["cells"][i]["scratch"] = json!(true);
            s["cells"][i]["known"] = json!(num(&s["cells"][i]["known"]).max(1.));
        }
    }
    if has(s, "ironbox") {
        let pool: Vec<_> = sealed(s)
            .into_iter()
            .filter(|&i| !yes(&s["cells"][i]["nest"]))
            .collect();
        if let Some(i) = pick(s, &pool) {
            s["cells"][i]["nest"] = json!({"due":num(&s["day"])+num(pr(s,"nestDays"))});
        }
    }
    if has(s, "ravenous") {
        ravenous(s)
    }
    if has(s, "coin") {
        coin(s)
    }
    if num(&s["day"]) > 1. {
        let chance = num(pr(s, "eventMorningChance"));
        spawn_event(s, chance, false);
    }
    roll_destinations(s);
}
fn instigate(s: &mut Value) {
    let n = instigate_count(s);
    let pool = instigate_cells(s);
    let picks = shuffled(s, pool);
    for i in picks.into_iter().take(n) {
        let e = roll_event(s);
        s["cells"][i]["event"] = e;
        s["cells"][i]["seen"] = json!(true);
    }
}
fn bestow(s: &mut Value) {
    let pool: Vec<_> = board_cells(s)
        .into_iter()
        .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) < 5.)
        .collect();
    if let Some(i) = pick(s, &pool) {
        promote(s, i, 1., false);
    }
}
fn walked(s: &mut Value, steps: usize) {
    if has(s, "shortchain") && steps <= 3 && rand(s) < 0.5 {
        let pool = sealed(s);
        if let Some(i) = pick(s, &pool) {
            open_cell(s, i, false, None);
        }
    }
    if has(s, "shackles") && steps >= 4 && rand(s) < 0.4 {
        bestow(s)
    }
    count_objective(s, "walk", steps as f64);
}
fn guard(s: &Value, phase: &str) -> bool {
    s["phase"] != "ended"
        && slice(&s["pending"]).is_empty()
        && !yes(&s["chaining"])
        && s["phase"] != "office"
        && s["phase"] != "event"
        && if phase == "patrol" {
            s["phase"] == "patrol"
        } else {
            s["phase"] != "patrol"
        }
}
fn patrol(s: &mut Value, n: usize) -> bool {
    if !guard(s, "patrol") || !slice(&s["destinations"]).iter().any(|v| int(v) == n) {
        return false;
    }
    let ratway = yes(&s["ratway"]);
    s["ratway"] = json!(false);
    let pos = int(&s["position"]);
    let steps = if ratway { 0 } else { (n + 16 - pos) % 16 };
    if !ratway {
        inc(&mut s["stats"]["patrols"], 1.);
    }
    let mut event = Value::Null;
    if yes(&s["chain"]) && !ratway {
        let path = clockwise_path(s, n);
        for k in path {
            open_cell(s, k, false, None);
        }
        s["chain"] = json!(false);
    } else if yes(&s["cells"][n]["sealed"]) {
        event = open_cell(s, n, true, None);
    }
    if !yes(&event)
        && !yes(&s["cells"][n]["sealed"])
        && yes(&s["cells"][n]["inmate"])
        && yes(&s["cells"][n]["event"])
    {
        event = s["cells"][n]["event"].clone();
        s["cells"][n]["event"] = Value::Null;
    }
    s["position"] = json!(n);
    check_prey(s);
    if !ratway {
        walked(s, steps)
    }
    let chance = num(pr(s, "eventWalkChance"));
    spawn_event(s, chance, false);
    if yes(&event) && yes(&s["cells"][n]["inmate"]) {
        s["phase"] = json!("event");
        s["event"] = json!({"kind":event,"cell":n});
        count_objective(s, "incident", 1.);
    } else {
        s["phase"] = json!(if n == 0 { "office" } else { "manage" });
        if n == 0 && s["startEvent"] == "tyranny" {
            for _ in 0..3 {
                instigate(s);
                bestow(s);
            }
        }
    }
    true
}
pub fn clockwise_path(s: &Value, to: usize) -> Vec<usize> {
    let mut path = vec![];
    let mut n = int(&s["position"]);
    while n != to {
        n = (n + 1) % 16;
        path.push(n)
    }
    if path.is_empty() {
        path.push(to)
    }
    path
}
pub fn execution_victims(s: &Value, n: usize) -> Vec<usize> {
    let e = &s["cells"][n]["inmate"];
    if yes(&s["cells"][n]["sealed"]) || !yes(e) {
        return vec![];
    }
    let eats = eats_of(s, txt(&e["beast"]), None);
    board_cells(s)
        .into_iter()
        .filter(|&i| {
            i != n
                && eats.contains(&txt(&s["cells"][i]["inmate"]["beast"]))
                && if yes(pr(s, "executionSameTier")) {
                    num(&s["cells"][i]["inmate"]["tier"]) == num(&e["tier"])
                } else {
                    num(&s["cells"][i]["inmate"]["tier"]) < num(&e["tier"])
                }
        })
        .collect()
}
pub fn scarce_beasts(s: &Value) -> Vec<usize> {
    let board = board_cells(s);
    let counts: Vec<usize> = BEASTS
        .iter()
        .map(|b| {
            board
                .iter()
                .filter(|&&i| s["cells"][i]["inmate"]["beast"] == *b)
                .count()
        })
        .collect();
    let low = *counts.iter().min().unwrap();
    (0..4).filter(|&i| counts[i] == low).collect()
}
pub fn lowest_inmates(s: &Value) -> Vec<usize> {
    let board = board_cells(s);
    let low = board
        .iter()
        .map(|&i| num(&s["cells"][i]["inmate"]["tier"]))
        .fold(f64::INFINITY, f64::min);
    board
        .into_iter()
        .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) == low)
        .collect()
}
fn resolve_event(s: &mut Value, accept: bool) -> bool {
    if s["phase"] != "event" || !yes(&s["event"]) || !slice(&s["pending"]).is_empty() {
        return false;
    }
    let kind = txt(&s["event"]["kind"]).to_string();
    let n = int(&s["event"]["cell"]);
    if !accept {
        s["event"] = Value::Null;
        s["phase"] = json!("manage");
        return true;
    }
    match kind.as_str() {
        "ratway" => {
            s["event"] = Value::Null;
            s["phase"] = json!("patrol");
            s["ratway"] = json!(true);
            s["destinations"] = json!((1usize..16).collect::<Vec<_>>());
            return true;
        }
        "chain" => s["chain"] = json!(true),
        "trickster" => {
            if !yes(&s["cells"][n]["inmate"]) {
                return false;
            }
            let pool = scarce_beasts(s);
            let i = pick(s, &pool).unwrap();
            s["cells"][n]["inmate"]["beast"] = json!(BEASTS[i]);
            s["cells"][n]["inmate"]["tier"] = json!(4);
            check_prey(s);
            let mut who = s["cells"][n]["inmate"].clone();
            after_growth(s, &mut who);
        }
        "crow" => {
            let mut seen = 0;
            for k in 1..16 {
                let i = (n + k) % 16;
                if !yes(&s["cells"][i]["sealed"]) || yes(&s["cells"][i]["nest"]) {
                    continue;
                }
                hidden_of(s, i);
                s["cells"][i]["known"] = json!(num(&s["cells"][i]["known"]).max(1.));
                seen += 1;
                if seen >= 4 {
                    break;
                }
            }
        }
        "hunt" => {
            for i in 0..16 {
                if !yes(&s["cells"][i]["sealed"]) || yes(&s["cells"][i]["nest"]) {
                    continue;
                }
                let h = hidden_of(s, i);
                if num(&h["tier"]) < 2. {
                    s["cells"][i]["known"] = json!(num(&s["cells"][i]["known"]).max(1.))
                } else {
                    s["cells"][i]["atLeast"] = json!(num(&s["cells"][i]["atLeast"]).max(2.))
                }
            }
        }
        "portion" | "usurp1" | "usurp2" | "usurp3" | "usurp4" => {
            let pool: Vec<_> = board_cells(s)
                .into_iter()
                .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) < 5.)
                .collect();
            let count = match kind.as_str() {
                "usurp1" => 1,
                "usurp2" | "usurp3" => 2,
                "portion" => 3,
                _ => 16,
            };
            let by = if kind == "usurp3" || kind == "usurp4" {
                2.
            } else {
                1.
            };
            let picks = if kind == "usurp4" {
                pool
            } else {
                shuffled(s, pool)
            };
            for i in picks.into_iter().take(count) {
                if yes(&s["cells"][i]["inmate"]) {
                    promote(s, i, by, false);
                }
            }
            if kind.starts_with("usurp") {
                let next = match kind.as_str() {
                    "usurp1" => Some("usurp2"),
                    "usurp2" => Some("usurp3"),
                    "usurp3" => Some("usurp4"),
                    _ => None,
                };
                let mut pool = if s["eventPool"].is_array() {
                    arr(&s["eventPool"])
                } else {
                    arr(&data()["events"])
                };
                pool.retain(|x| x != &kind);
                if let Some(next) = next {
                    if !pool.contains(&json!(next)) {
                        pool.push(json!(next))
                    }
                    let free = instigate_cells(s);
                    if let Some(i) = pick(s, &free) {
                        s["cells"][i]["event"] = json!(next);
                        s["cells"][i]["seen"] = json!(true);
                    }
                }
                s["eventPool"] = json!(pool);
            }
        }
        "freedom" => {
            let pool = sealed(s);
            let picks = shuffled(s, pool);
            for i in picks.into_iter().take(3) {
                open_cell(s, i, false, None);
            }
        }
        "convict" => {
            let pool = sealed(s);
            if let Some(i) = pick(s, &pool) {
                let w: Vec<f64> = weights(pr(s, "tierWeights"))
                    .into_iter()
                    .enumerate()
                    .map(|(t, w)| if t >= 3 { w } else { 0. })
                    .collect();
                let t = if w.iter().any(|x| *x > 0.) {
                    pick_index(s, &w)
                } else {
                    3
                };
                let bw = weights(pr(s, "beastWeights"));
                let b = BEASTS[pick_index(s, &bw)];
                open_cell(s, i, false, Some((b, t as f64)));
            }
        }
        "appetite" => {
            let pool = lowest_inmates(s);
            if let Some(i) = pick(s, &pool) {
                let mut gain = 0.;
                for _ in 0..5 {
                    if rand(s) < 0.5 {
                        gain += 1.;
                    }
                }
                if gain > 0. {
                    promote(s, i, gain, false);
                }
            }
        }
        _ => {
            if !yes(&s["cells"][n]["inmate"]) {
                return false;
            }
            let victims = execution_victims(s, n);
            for &i in &victims {
                empty_cell(s, i);
            }
            inc(&mut s["stats"]["executions"], 1.);
            check_prey(s);
            if !victims.is_empty() {
                let reroll = yes(pr(s, "executionRerolls"));
                promote(s, n, victims.len() as f64, reroll);
            }
        }
    }
    s["event"] = Value::Null;
    s["phase"] = json!("manage");
    true
}
pub fn gain_for(s: &Value, from: usize, o: &Value) -> f64 {
    let e = &s["cells"][from]["inmate"];
    let c = &s["cells"][int(&o["cell"])];
    let m = if yes(&c["sealed"]) {
        &c["hidden"]
    } else {
        &c["inmate"]
    };
    let mut g = if yes(&o["scratch"]) {
        2. + if yes(pr(s, "scratchStacksBase")) {
            1.
        } else {
            0.
        }
    } else {
        1.
    };
    if !yes(&o["scratch"]) && yes(m) && e["beast"] == "mammoth" && has(s, "maul") {
        g = (num(&m["tier"]) + 2. - num(&e["tier"])).max(1.);
    }
    if has(s, "muzzle") && board_cells(s).len() <= 4 {
        g += 2.
    }
    if has(s, "skewer") && e["beast"] == "rat" {
        g += 1.
    }
    if has(s, "crown") && e["beast"] == "lion" {
        g += 2.
    }
    g
}
fn snap(v: &Value) -> Value {
    json!({"beast":v["beast"],"tier":v["tier"]})
}
fn do_devour(s: &mut Value, from: usize, o: &Value, chained: bool) -> Value {
    let to = int(&o["cell"]);
    let e = s["cells"][from]["inmate"].clone();
    let meal = if yes(&s["cells"][to]["sealed"]) {
        s["cells"][to]["hidden"].clone()
    } else {
        s["cells"][to]["inmate"].clone()
    };
    count_objective(s, "consume", 1.);
    let mut gain = gain_for(s, from, o);
    empty_cell(s, to);
    if has(s, "saw") && rand(s) < 0.25 {
        gain += 1.
    }
    if has(s, "whip") && rand(s) < 0.35 {
        gain += 1.
    }
    if chained && has(s, "collar") && rand(s) < 0.8 {
        gain += 1.
    }
    let revenge = has(s, "revenge") && rand(s) < 0.3;
    let reroll = s["startEvent"] != "cagefight";
    let after = promote(s, from, gain, reroll);
    inc(&mut s["stats"]["devours"], 1.);
    check_prey(s);
    if revenge && board_cell_of(s, &e["id"]).is_some() {
        let pool = sealed(s);
        if let Some(i) = pick(s, &pool) {
            let foods = eats_of(s, txt(&after["beast"]), Some(num(&after["tier"])));
            let f = (rand(s) * foods.len() as f64) as usize;
            open_cell(s, i, false, Some((foods[f], num(&after["tier"]))));
        }
    }
    if has(s, "cage") && yes(&s["cells"][to]["sealed"]) && rand(s) < 0.4 {
        open_cell(s, to, false, None);
    }
    json!({"from":from,"cell":to,"scratch":yes(&o["scratch"]),"eater":snap(&e),"meal":snap(&meal),"gain":gain,"notes":[],"after":snap(&after)})
}
fn go_on_chain(s: &mut Value) {
    let eater = s["chaining"]["eater"].clone();
    while let Some(n) = board_cell_of(s, &eater) {
        let opts = devour_options(s, n);
        if opts.is_empty() {
            break;
        }
        if opts.len() > 1 || can_stop_chain(s) {
            return;
        }
        let bite = do_devour(s, n, &opts[0], true);
        s["chaining"]["bites"].as_array_mut().unwrap().push(bite);
        inc(&mut s["stats"]["chains"], 1.);
    }
    s["chaining"] = Value::Null;
}
fn devour(s: &mut Value, to: usize) -> bool {
    if !guard(s, "manage") || !can_devour_now(s) {
        return false;
    }
    let n = int(&s["position"]);
    let o = start_options(s).into_iter().find(|o| int(&o["cell"]) == to);
    let Some(o) = o else { return false };
    let resumed = paused_eater(s);
    if !resumed {
        inc(&mut s["used"]["devour"], 1.);
    }
    s["used"]["pausedChain"] = Value::Null;
    s["used"]["mealOnly"] = Value::Null;
    s["chaining"] =
        json!({"eater":s["cells"][n]["inmate"]["id"],"at":slice(&s["log"]).len(),"bites":[]});
    let bite = do_devour(s, n, &o, resumed);
    s["chaining"]["bites"].as_array_mut().unwrap().push(bite);
    if resumed {
        inc(&mut s["stats"]["chains"], 1.);
    }
    go_on_chain(s);
    true
}
fn chain_bite(s: &mut Value, to: usize) -> bool {
    if !yes(&s["chaining"]) || !slice(&s["pending"]).is_empty() {
        return false;
    }
    let o = chain_options(s).into_iter().find(|o| int(&o["cell"]) == to);
    let Some(o) = o else { return false };
    let Some(n) = board_cell_of(s, &s["chaining"]["eater"]) else {
        return false;
    };
    s["used"]["mealOnly"] = Value::Null;
    let bite = do_devour(s, n, &o, true);
    s["chaining"]["bites"].as_array_mut().unwrap().push(bite);
    inc(&mut s["stats"]["chains"], 1.);
    go_on_chain(s);
    true
}
pub fn stop_chain(s: &mut Value) -> bool {
    if !yes(&s["chaining"]) || !can_stop_chain(s) || !slice(&s["pending"]).is_empty() {
        return false;
    }
    s["used"]["pausedChain"] = json!({"eater":s["chaining"]["eater"]});
    s["chaining"] = Value::Null;
    let chance = num(pr(s, "eventActionChance"));
    spawn_event(s, chance, false);
    true
}
fn scout(s: &mut Value) {
    let doors: Vec<_> = sealed(s)
        .into_iter()
        .filter(|&i| !yes(&s["cells"][i]["nest"]))
        .collect();
    if doors.is_empty() {
        return;
    }
    for &i in &doors {
        hidden_of(s, i);
    }
    let top = doors
        .iter()
        .map(|&i| num(&s["cells"][i]["hidden"]["tier"]))
        .fold(0., f64::max);
    let pool: Vec<_> = doors
        .into_iter()
        .filter(|&i| num(&s["cells"][i]["hidden"]["tier"]) == top)
        .collect();
    if let Some(i) = pick(s, &pool) {
        s["cells"][i]["known"] = json!(2);
    }
}
fn swap(s: &mut Value) -> bool {
    let n = int(&s["position"]);
    if !guard(s, "manage")
        || yes(&s["cells"][n]["sealed"])
        || !yes(&s["cells"][n]["inmate"])
        || num(&s["used"]["devour"]) > 0.
        || num(&s["used"]["swap"]) >= num(pr(s, "swapsPerDay"))
        || yes(&s["used"]["noSwap"])
    {
        return false;
    }
    let mut w = if s["params"]["swapWeights"].is_array() {
        weights(&s["params"]["swapWeights"])
    } else {
        weights(pr(s, "tierWeights"))
    };
    if has(s, "rope") {
        w[0] = 0.;
        w[1] = 0.;
    }
    if !w.iter().any(|x| *x > 0.) {
        return false;
    }
    let old = s["cells"][n]["inmate"].clone();
    let others: Vec<_> = board_cells(s).into_iter().filter(|&i| i != n).collect();
    let level = has(s, "maiden")
        && others
            .iter()
            .filter(|&&i| num(&s["cells"][i]["inmate"]["tier"]) > num(&old["tier"]))
            .count()
            == others
                .iter()
                .filter(|&&i| num(&s["cells"][i]["inmate"]["tier"]) < num(&old["tier"]))
                .count();
    s["cells"][n]["inmate"] = Value::Null;
    check_prey(s);
    let mut above = false;
    if has(s, "scapegoat") {
        let pool = board_cells(s);
        if pool.len() >= 2 {
            for i in shuffled(s, pool).into_iter().take(2) {
                empty_cell(s, i);
            }
            check_prey(s);
            above = true;
        }
    }
    let higher: Vec<_> = w
        .iter()
        .enumerate()
        .map(|(t, x)| if t as f64 > num(&old["tier"]) { *x } else { 0. })
        .collect();
    let mut fresh = roll_inmate(
        s,
        if above && higher.iter().any(|x| *x > 0.) {
            higher
        } else {
            w
        },
    );
    if above && num(&fresh["tier"]) <= num(&old["tier"]) {
        fresh["tier"] = json!((num(&old["tier"]) + 1.).min(5.));
    }
    if has(s, "stake") && num(&old["tier"]) < 3. && rand(s) < 0.4 && num(&fresh["tier"]) != 3. {
        fresh["tier"] = json!(3)
    }
    if yes(pr(s, "swapNewBeast")) && fresh["beast"] == old["beast"] {
        let others: Vec<_> = (0..4)
            .filter(|&i| BEASTS[i] != txt(&old["beast"]))
            .collect();
        let bw = weights(pr(s, "beastWeights"));
        let w: Vec<_> = others.iter().map(|&i| bw[i]).collect();
        fresh["beast"] = json!(BEASTS[others[pick_index(s, &w)]]);
    }
    if has(s, "pestle") {
        fresh["beast"] = old["beast"].clone();
    }
    s["cells"][n]["inmate"] = fresh.clone();
    inc(&mut s["used"]["swap"], 1.);
    inc(&mut s["stats"]["swaps"], 1.);
    if level {
        fresh = promote(s, n, 3., false);
    }
    after_growth(s, &mut fresh);
    if has(s, "axe") && num(&fresh["tier"]) > num(&old["tier"]) {
        let pool = sealed(s);
        for i in shuffled(s, pool).into_iter().take(2) {
            open_cell(s, i, false, None);
        }
    }
    if has(s, "scales") && rand(s) < 0.8 {
        scout(s)
    }
    if yes(&s["cells"][n]["ivory"]) && board_cell_of(s, &fresh["id"]).is_some() {
        let pool = board_cells(s)
            .into_iter()
            .filter(|&i| {
                yes(pr(s, "ivoryIncludesSwapped")) || s["cells"][i]["inmate"]["id"] != fresh["id"]
            })
            .collect();
        let count = int(pr(s, "ivoryCount"));
        for i in shuffled(s, pool).into_iter().take(count) {
            if yes(&s["cells"][i]["inmate"]) {
                promote(s, i, 1., false);
            }
        }
    }
    true
}
fn apply_gift(s: &mut Value, id: &str) {
    match id {
        "ring" => {
            let pool = sealed(s);
            for i in shuffled(s, pool).into_iter().take(3) {
                open_cell(s, i, false, None);
            }
        }
        "horn" => {
            let ids: Vec<Value> = board_cells(s)
                .into_iter()
                .filter(|&i| !devour_options(s, i).is_empty())
                .map(|i| s["cells"][i]["inmate"]["id"].clone())
                .collect();
            for id in ids {
                let Some(n) = board_cell_of(s, &id) else {
                    continue;
                };
                let options: Vec<_> = devour_options(s, n)
                    .into_iter()
                    .filter(|o| !yes(&o["scratch"]))
                    .collect();
                if !options.is_empty() {
                    let k = (rand(s) * options.len() as f64) as usize;
                    do_devour(s, n, &options[k], false);
                }
            }
        }
        "wine" => {
            let pool: Vec<_> = board_cells(s)
                .into_iter()
                .filter(|&i| num(&s["cells"][i]["inmate"]["tier"]) < 3.)
                .collect();
            for i in pool {
                if yes(&s["cells"][i]["inmate"]) {
                    promote(s, i, 1., false);
                }
            }
        }
        "brand" => {
            let pool = board_cells(s)
                .into_iter()
                .filter(|&i| devour_options(s, i).is_empty())
                .collect();
            for i in shuffled(s, pool).into_iter().take(4) {
                if !yes(&s["cells"][i]["inmate"]) || !devour_options(s, i).is_empty() {
                    continue;
                }
                let mut who = s["cells"][i]["inmate"].clone();
                let possible: Vec<usize> = (0..4)
                    .filter(|&b| {
                        who["beast"] = json!(BEASTS[b]);
                        board_cells(s)
                            .into_iter()
                            .any(|n| can_eat(s, &who, &s["cells"][n]["inmate"]))
                    })
                    .collect();
                if let Some(b) = pick(s, &possible) {
                    s["cells"][i]["inmate"]["beast"] = json!(BEASTS[b]);
                }
            }
            check_prey(s);
        }
        _ => {}
    }
}
fn choose(s: &mut Value, id: &str) -> bool {
    let choice = s["pending"][0].clone();
    if !slice(&choice["options"]).contains(&json!(id)) {
        return false;
    }
    s["pending"].as_array_mut().unwrap().remove(0);
    if choice["kind"] == "gift" {
        apply_gift(s, id)
    } else {
        s["tools"].as_array_mut().unwrap().push(json!(id));
        if s["phase"] == "patrol" {
            let n = destination_limit(s);
            s["destinations"].as_array_mut().unwrap().truncate(n);
        }
    }
    if s["phase"] == "event"
        && yes(&s["event"])
        && !yes(&s["cells"][int(&s["event"]["cell"])]["inmate"])
    {
        s["event"] = Value::Null;
        s["phase"] = json!("manage");
    }
    true
}
fn reroll_offer(s: &mut Value) -> bool {
    if !can_reroll(s) {
        return false;
    }
    let options = arr(&s["pending"][0]["options"]);
    let mut pool: Vec<_> = arr(&data()["tools"])
        .into_iter()
        .filter(|t| !has(s, txt(t)) && !options.contains(t))
        .collect();
    if pool.len() < 3 {
        pool = arr(&data()["tools"])
            .into_iter()
            .filter(|t| !has(s, txt(t)))
            .collect()
    }
    let picks = draw_tools(s, pool, 3);
    s["pending"][0]["options"] = json!(picks);
    inc(&mut s["pending"][0]["rerolls"], -1.);
    true
}
fn hunt(s: &mut Value, to: usize) -> bool {
    if !guard(s, "manage")
        || !has(s, "trap")
        || num(&s["used"]["devour"]) > 0.
        || num(&s["used"]["swap"]) > 0.
        || yes(&s["used"]["hunt"])
        || yes(&s["used"]["noHunt"])
        || !hunt_targets(s).contains(&to)
    {
        return false;
    }
    let n = int(&s["position"]);
    let link = json!({"lion":s["cells"][n]["inmate"]["id"],"prey":s["cells"][to]["inmate"]["id"],"preyBeast":s["cells"][to]["inmate"]["beast"],"rounds":p(s,"preyRounds"),"next":num(&s["day"])+1.});
    s["used"]["hunt"] = json!(1);
    s["prey"].as_array_mut().unwrap().push(link);
    true
}
fn office_act(s: &mut Value, choice: &str) -> bool {
    if s["phase"] != "office"
        || !slice(&s["pending"]).is_empty()
        || (yes(&s["used"]["officeOnly"]) && s["used"]["officeOnly"] != choice)
    {
        return false;
    }
    match choice {
        "instigate" => instigate(s),
        "bestow" => bestow(s),
        _ => return false,
    }
    s["phase"] = json!("manage");
    true
}
pub fn roster_of(s: &Value) -> Value {
    let mut rows:Vec<Value>=board_cells(s).into_iter().map(|i|json!({"beast":s["cells"][i]["inmate"]["beast"],"tier":s["cells"][i]["inmate"]["tier"],"where":format!("Cell {:02}",i+1)})).collect();
    for v in arr(&s["vault"]) {
        rows.push(
            json!({"beast":v["beast"],"tier":5,"where":format!("Vault, day {}",num(&v["day"]))}),
        );
    }
    rows.sort_by(|a, b| {
        num(&b["tier"]).total_cmp(&num(&a["tier"])).then(
            BEASTS
                .iter()
                .position(|x| *x == txt(&a["beast"]))
                .cmp(&BEASTS.iter().position(|x| *x == txt(&b["beast"]))),
        )
    });
    let tiers: Vec<usize> = (0..6)
        .map(|t| rows.iter().filter(|r| num(&r["tier"]) == t as f64).count())
        .collect();
    json!({"rows":rows,"byTier":tiers})
}
fn finish(s: &mut Value, early: bool) {
    s["phase"] = json!("ended");
    s["destinations"] = json!([]);
    s["event"] = Value::Null;
    s["chain"] = json!(false);
    let roster = roster_of(s);
    let best = slice(&roster["rows"])
        .iter()
        .map(|r| num(&r["tier"]))
        .fold(num(&s["stats"]["best"]), f64::max);
    s["result"] = json!({"day":s["day"],"early":early,"roster":roster,"cache":s["cache"],"best":best,"stats":s["stats"]});
}
pub fn end_day(s: &mut Value) -> bool {
    if !guard(s, "manage") {
        return false;
    }
    if num(&s["day"]) >= num(&s["maxDays"]) {
        finish(s, false)
    } else {
        inc(&mut s["day"], 1.);
        begin_day(s);
    }
    true
}
/// Solver action semantics: stopchain means Cancel followed by EndDay.
pub fn apply_typed(s: &mut Value, a: &Value) -> bool {
    let kind = txt(&a["type"]);
    let event_kind = txt(&s["event"]["kind"]).to_string();
    let ok = match kind {
        "choose" => choose(s, txt(&a["id"])),
        "reroll" => reroll_offer(s),
        "event" => resolve_event(s, yes(&a["accept"])),
        "patrol" => patrol(s, int(&a["cell"])),
        "devour" => devour(s, int(&a["to"])),
        "chain" => chain_bite(s, int(&a["to"])),
        "stopchain" => {
            if stop_chain(s) {
                end_day(s)
            } else {
                false
            }
        }
        "office" => office_act(s, txt(&a["choice"])),
        "swap" => swap(s),
        "hunt" => hunt(s, int(&a["to"])),
        "end" => end_day(s),
        _ => false,
    };
    if ok
        && kind == "event"
        && !(yes(&a["accept"]) && ["usurp1", "usurp2", "usurp3"].contains(&event_kind.as_str()))
    {
        let chance = num(pr(s, "eventFollowChance"));
        spawn_event(s, chance, true);
    }
    if ok && ["event", "devour", "chain", "swap", "hunt"].contains(&kind) && !yes(&s["chaining"]) {
        let chance = num(pr(s, "eventActionChance"));
        spawn_event(s, chance, false);
    }
    ok
}
/// Candidate actions in precisely the ordering of S.candidates; labels stay in JS.
pub fn candidates_typed(s: &Value) -> Vec<Value> {
    let mut out = vec![];
    if s["phase"] == "ended" {
        return out;
    }
    if !slice(&s["pending"]).is_empty() {
        for id in arr(&s["pending"][0]["options"]) {
            out.push(json!({"type":"choose","id":id}))
        }
        if can_reroll(s) {
            out.push(json!({"type":"reroll"}))
        }
        return out;
    }
    if yes(&s["chaining"]) {
        for o in chain_options(s) {
            out.push(json!({"type":"chain","to":o["cell"]}))
        }
        if can_stop_chain(s) {
            out.push(json!({"type":"stopchain"}))
        }
        return out;
    }
    if s["phase"] == "office" {
        let only = &s["used"]["officeOnly"];
        for choice in ["bestow", "instigate"] {
            if !yes(only) || only == choice {
                out.push(json!({"type":"office","choice":choice}))
            }
        }
        return out;
    }
    if s["phase"] == "event" && yes(&s["event"]) {
        out.push(json!({"type":"event","accept":true}));
        if s["event"]["kind"] != "hunt" {
            out.push(json!({"type":"event","accept":false}))
        }
        return out;
    }
    if s["phase"] == "patrol" {
        return arr(&s["destinations"])
            .into_iter()
            .map(|cell| json!({"type":"patrol","cell":cell}))
            .collect();
    }
    for o in start_options(s) {
        out.push(json!({"type":"devour","to":o["cell"]}))
    }
    let c = &s["cells"][int(&s["position"])];
    if can_swap_now(s) && !yes(&c["sealed"]) && yes(&c["inmate"]) {
        out.push(json!({"type":"swap"}))
    }
    if can_hunt_now(s) {
        for to in hunt_targets(s) {
            out.push(json!({"type":"hunt","to":to}))
        }
    }
    out.push(json!({"type":"end"}));
    out
}

/// JSON boundary; the rollout engine calls apply_typed without conversions.
pub fn apply(state: &mut serde_json::Value, action: &serde_json::Value) -> bool {
    let mut typed = Value::from(state.clone());
    let action = Value::from(action.clone());
    let ok = apply_typed(&mut typed, &action);
    *state = typed.to_json();
    ok
}
pub fn candidates(state: &serde_json::Value) -> Vec<serde_json::Value> {
    candidates_typed(&Value::from(state.clone()))
        .iter()
        .map(Value::to_json)
        .collect()
}
