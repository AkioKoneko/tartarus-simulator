//! Raw Monte Carlo sample rows. Ranking and presentation remain in JS.
use crate::model::Value;
use crate::{engine as e, policy as p};
use serde_json::json;
struct Row {
    action: Value,
    vals: Vec<Option<f64>>,
    early: Option<Vec<Option<f64>>>,
    best: f64,
    policy: bool,
}
pub struct Job {
    base: Value,
    target: usize,
    round: usize,
    rng: u32,
    params: p::Prepared,
    early_days: Option<i64>,
    rows: Vec<Row>,
}
impl Job {
    pub fn new(
        state: serde_json::Value,
        rollouts: usize,
        seed: u32,
        stream: u32,
        params: serde_json::Value,
        early_days: Option<i64>,
    ) -> Self {
        let state = Value::from(state);
        let params = Value::from(params);
        let params = p::Prepared::new(&state, &params);
        let base = p::clone_state(&state);
        let actions = e::candidates_typed(&base);
        let mut pick_rng = seed ^ 0x5bd1e995;
        let pick = if actions.is_empty() {
            Value::Null
        } else {
            p::decide_prepared(&p::clone_state(&base), &params, &mut pick_rng)
        };
        let early_days = early_days.filter(|d| *d > 0);
        let rows = actions
            .into_iter()
            .map(|action| Row {
                policy: action == pick,
                action,
                vals: vec![],
                early: early_days.map(|_| vec![]),
                best: 0.,
            })
            .collect();
        Self {
            base,
            target: rollouts,
            round: 0,
            rng: if stream != 0 {
                seed ^ stream.wrapping_mul(0x9e3779b1)
            } else {
                seed
            },
            params,
            early_days,
            rows,
        }
    }
    pub fn rounds(&self) -> usize {
        self.round
    }
    pub fn done(&self) -> bool {
        self.round >= self.target || self.rows.len() <= 1
    }
    pub fn one_round(&mut self) {
        if self.done() {
            return;
        }
        let seed = (e::random(&mut self.rng) * 4294967296.) as u32;
        for row in &mut self.rows {
            let mut trial = p::clone_state(&self.base);
            p::hide_future(&mut trial, seed);
            let mut early = self.early_days.map(|d| p::EarlyTracker::new(&trial, d));
            if !e::apply_typed(&mut trial, &row.action) {
                row.vals.push(None);
                if let Some(vals) = &mut row.early {
                    vals.push(None);
                }
                continue;
            }
            let mut roll = seed ^ 0x9e3779b9;
            if let Some(t) = &mut early {
                t.observe(&trial);
            }
            p::playout_prepared(&mut trial, &self.params, &mut roll, early.as_mut());
            row.vals.push(Some(e::slice(&trial["vault"]).len() as f64));
            if let (Some(vals), Some(t)) = (&mut row.early, &mut early) {
                vals.push(Some(t.observe(&trial)));
            }
            let best = e::board_cells(&trial)
                .iter()
                .map(|&n| e::num(&trial["cells"][n]["inmate"]["tier"]))
                .fold(
                    if e::slice(&trial["vault"]).is_empty() {
                        0.
                    } else {
                        5.
                    },
                    f64::max,
                );
            row.best += best;
        }
        self.round += 1;
    }
    pub fn output(&self, from: usize) -> serde_json::Value {
        let rows:Vec<serde_json::Value>=self.rows.iter().map(|r|{let mut out=json!({"action":r.action,"vals":r.vals.get(from..).unwrap_or(&[]),"best":r.best,"policy":r.policy});if let Some(early)=&r.early{out["earlyVals"]=json!(early.get(from..).unwrap_or(&[]));}out}).collect();
        json!({"rows":rows,"rounds":self.round,"done":self.done(),"goal":"rainbows"})
    }
}
