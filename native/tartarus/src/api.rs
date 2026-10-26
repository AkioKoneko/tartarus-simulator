use crate::engine;
use serde_json::{json, Value};
pub struct Core {
    #[cfg(feature = "solver")]
    job: Option<crate::job::Job>,
}
impl Core {
    pub const fn new() -> Self {
        Self {
            #[cfg(feature = "solver")]
            job: None,
        }
    }
    pub fn handle(&mut self, v: Value) -> Value {
        match self.dispatch(v) {
            Ok(x) => x,
            Err(e) => json!({"error":e}),
        }
    }
    fn dispatch(&mut self, v: Value) -> Result<Value, String> {
        let op = v["op"].as_str().unwrap_or("");
        if op == "info" {
            return Ok(
                json!({"contract":"tartarus-accel-v1","engine":"independent current-fork rules","solver":cfg!(feature="solver")}),
            );
        }
        if [
            "apply",
            "candidates",
            "decide",
            "trajectory",
            "init",
            "solve",
        ]
        .contains(&op)
        {
            validate_state(&v["state"])?;
        }
        match op {
            "apply" => {
                let mut s = v["state"].clone();
                let ok = engine::apply(&mut s, &v["action"]);
                Ok(json!({"ok":ok,"state":s}))
            }
            "candidates" => Ok(json!({"actions":engine::candidates(&v["state"])})),
            _ => self.solver_dispatch(&v),
        }
    }
    #[cfg(not(feature = "solver"))]
    fn solver_dispatch(&mut self, _: &Value) -> Result<Value, String> {
        Err("Solver build not enabled".into())
    }
    #[cfg(feature = "solver")]
    fn solver_dispatch(&mut self, v: &Value) -> Result<Value, String> {
        let seed = v["seed"].as_u64().unwrap_or(1) as u32;
        match v["op"].as_str().unwrap_or("") {
            "decide" => {
                let mut rng = seed;
                let action = crate::policy::decide(&v["state"], &v["params"], &mut rng);
                Ok(json!({"action":action,"rng":rng}))
            }
            "init" | "solve" => {
                let target = v["rollouts"].as_u64().unwrap_or(400) as usize;
                if target > 100_000 {
                    return Err("Rollout limit exceeded".into());
                }
                let mut job = crate::job::Job::new(
                    v["state"].clone(),
                    target,
                    seed,
                    v["stream"].as_u64().unwrap_or(0) as u32,
                    v["params"].clone(),
                    v["earlyVaultDays"].as_i64(),
                );
                if v["op"] == "solve" {
                    while !job.done() {
                        job.one_round();
                    }
                }
                let out = job.output(0);
                self.job = Some(job);
                Ok(out)
            }
            "cancel" => {
                self.job = None;
                Ok(json!({"ok":true}))
            }
            "step" => {
                let job = self.job.as_mut().ok_or("No current job")?;
                let from = job.rounds();
                let begin = clock();
                let ms = v["ms"].as_f64().unwrap_or(50.).clamp(1., 1000.);
                while !job.done()
                    && v["rounds"]
                        .as_u64()
                        .map(|n| job.rounds() - from < n as usize)
                        .unwrap_or_else(|| clock() - begin < ms)
                {
                    job.one_round();
                }
                Ok(job.output(from))
            }
            "trajectory" => Ok(crate::policy::trajectory(&v["state"], &v["params"], seed)),
            _ => Err("Unknown operation".into()),
        }
    }
}
fn validate_state(s: &Value) -> Result<(), String> {
    if !s.is_object()
        || s["cells"].as_array().map(|a| a.len()) != Some(16)
        || s["position"].as_u64().filter(|n| *n < 16).is_none()
        || !s["used"].is_object()
        || !s["params"].is_object()
        || !s["stats"].is_object()
        || !["pending", "vault", "tools", "prey"]
            .iter()
            .all(|k| s[*k].is_array())
    {
        return Err("Invalid engine state shape".into());
    }
    for (n, c) in s["cells"].as_array().unwrap().iter().enumerate() {
        if !c.is_object() || c["n"].as_u64() != Some(n as u64) {
            return Err("Invalid dense board".into());
        }
        for k in ["inmate", "hidden"] {
            let who = &c[k];
            if !who.is_null()
                && (!who.is_object()
                    || !engine::BEASTS.contains(&who["beast"].as_str().unwrap_or(""))
                    || who["tier"].as_u64().filter(|t| *t <= 4).is_none())
            {
                return Err("Unsupported inmate".into());
            }
        }
    }
    for p in s["pending"].as_array().unwrap() {
        if !p.is_object() || p["options"].as_array().map_or(true, |a| a.is_empty()) {
            return Err("Invalid pending offer".into());
        }
    }
    for (k, n) in [("tierWeights", 5), ("swapWeights", 5), ("beastWeights", 4)] {
        if s["params"][k].as_array().map(|a| a.len()) != Some(n) {
            return Err("Invalid rule weights".into());
        }
    }
    Ok(())
}
#[cfg(all(feature = "solver", target_arch = "wasm32"))]
#[link(wasm_import_module = "env")]
extern "C" {
    fn now() -> f64;
}
#[cfg(all(feature = "solver", target_arch = "wasm32"))]
fn clock() -> f64 {
    unsafe { now() }
}
#[cfg(all(feature = "solver", not(target_arch = "wasm32")))]
fn clock() -> f64 {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.
}
