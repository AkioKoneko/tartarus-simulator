//! Internal mutable model: indexed typed records, array/scalar variants and
//! an exact-presence metadata sidecar. No JSON conversion in rollout actions.
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeMap;
use std::ops::{Index, IndexMut};
use std::sync::Arc;
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(Arc<str>),
    Array(Vec<Value>),
    Object(Object),
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    State,
    Cell,
    Inmate,
    Used,
    Stats,
    Params,
    Strategy,
    Choice,
    Prey,
    Vault,
    Objective,
    Event,
    Chain,
    Bite,
    Result,
    Action,
    Generic,
}
impl Kind {
    fn fields(self) -> &'static [&'static str] {
        match self {
            Self::State => &[
                "v",
                "mode",
                "scenario",
                "seed",
                "rng",
                "params",
                "day",
                "maxDays",
                "startEvent",
                "phase",
                "position",
                "destinations",
                "chain",
                "event",
                "cells",
                "vault",
                "cache",
                "tools",
                "pending",
                "objective",
                "milestone",
                "used",
                "chaining",
                "eventPool",
                "prey",
                "nextId",
                "log",
                "stats",
                "result",
                "ratway",
                "destBase",
            ],
            Self::Cell => &[
                "n",
                "sealed",
                "inmate",
                "hidden",
                "known",
                "atLeast",
                "scratch",
                "nest",
                "event",
                "ivory",
                "seen",
                "eventKnown",
            ],
            Self::Inmate => &["id", "beast", "tier", "marked", "where"],
            Self::Used => &[
                "swap",
                "devour",
                "hunt",
                "noDevour",
                "noSwap",
                "noHunt",
                "mealOnly",
                "officeOnly",
                "devourAfterSwap",
                "huntOnly",
                "pausedChain",
            ],
            Self::Stats => &[
                "patrols",
                "opened",
                "devours",
                "chains",
                "swaps",
                "executions",
                "best",
            ],
            Self::Params => &[
                "drillDays",
                "destinations",
                "patrolRange",
                "eventTwoDoors",
                "fewerDoorsChance",
                "swapsPerDay",
                "reusableCells",
                "chainStop",
                "tierWeights",
                "swapWeights",
                "swapNewBeast",
                "beastWeights",
                "startInmates",
                "startInmatesFewer",
                "startWeights",
                "officeDoorOdds",
                "doubleEatTier",
                "eventStartChance",
                "eventFollowChance",
                "eventMorningChance",
                "eventWalkChance",
                "eventActionChance",
                "executionSameTier",
                "executionRerolls",
                "ivoryCount",
                "ivoryIncludesSwapped",
                "preyRounds",
                "scratchStacksBase",
                "nestDays",
                "nestTier",
                "rewards",
                "startTools",
                "beastToolOdds",
            ],
            Self::Strategy => &[
                "tierBase",
                "rainbowMult",
                "wOpen",
                "wNow",
                "wWalk",
                "wStep",
                "wNest",
                "wChain",
                "wGoal",
                "wIncident",
                "wPass",
                "wOfficeIncident",
                "wConsume",
                "wConsumeWalk",
                "wUsurp",
                "wInstigate",
                "wCrow",
                "wShort",
                "wKeys",
                "wForged",
                "wFire",
                "wCage",
                "rerollMargin",
                "wStair",
                "minDevour",
                "stopMargin",
                "swapMaxTier",
                "swapMargin",
                "maidenSwapTier",
                "execMargin",
                "acceptChain",
                "toolRank",
                "toolSets",
                "office",
                "giftRank",
                "giftChain",
            ],
            Self::Choice => &["kind", "options", "start", "rerolls"],
            Self::Prey => &["lion", "prey", "preyBeast", "rounds", "next"],
            Self::Vault => &["id", "beast", "day"],
            Self::Objective => &["id", "progress"],
            Self::Event => &["kind", "cell"],
            Self::Chain => &["eater", "at", "bites"],
            Self::Bite => &[
                "from", "cell", "scratch", "eater", "meal", "gain", "notes", "after",
            ],
            Self::Result => &["day", "early", "roster", "cache", "best", "stats"],
            Self::Action => &["type", "id", "cell", "to", "accept", "choice"],
            Self::Generic => &[],
        }
    }
    #[inline(always)]
    fn slot(self, key: &str) -> Option<usize> {
        match self {
            Self::State => match key {
                "v" => Some(0),
                "mode" => Some(1),
                "scenario" => Some(2),
                "seed" => Some(3),
                "rng" => Some(4),
                "params" => Some(5),
                "day" => Some(6),
                "maxDays" => Some(7),
                "startEvent" => Some(8),
                "phase" => Some(9),
                "position" => Some(10),
                "destinations" => Some(11),
                "chain" => Some(12),
                "event" => Some(13),
                "cells" => Some(14),
                "vault" => Some(15),
                "cache" => Some(16),
                "tools" => Some(17),
                "pending" => Some(18),
                "objective" => Some(19),
                "milestone" => Some(20),
                "used" => Some(21),
                "chaining" => Some(22),
                "eventPool" => Some(23),
                "prey" => Some(24),
                "nextId" => Some(25),
                "log" => Some(26),
                "stats" => Some(27),
                "result" => Some(28),
                "ratway" => Some(29),
                "destBase" => Some(30),
                _ => None,
            },
            Self::Cell => match key {
                "n" => Some(0),
                "sealed" => Some(1),
                "inmate" => Some(2),
                "hidden" => Some(3),
                "known" => Some(4),
                "atLeast" => Some(5),
                "scratch" => Some(6),
                "nest" => Some(7),
                "event" => Some(8),
                "ivory" => Some(9),
                "seen" => Some(10),
                "eventKnown" => Some(11),
                _ => None,
            },
            Self::Inmate => match key {
                "id" => Some(0),
                "beast" => Some(1),
                "tier" => Some(2),
                "marked" => Some(3),
                "where" => Some(4),
                _ => None,
            },
            Self::Used => match key {
                "swap" => Some(0),
                "devour" => Some(1),
                "hunt" => Some(2),
                "noDevour" => Some(3),
                "noSwap" => Some(4),
                "noHunt" => Some(5),
                "mealOnly" => Some(6),
                "officeOnly" => Some(7),
                "devourAfterSwap" => Some(8),
                "huntOnly" => Some(9),
                "pausedChain" => Some(10),
                _ => None,
            },
            Self::Stats => match key {
                "patrols" => Some(0),
                "opened" => Some(1),
                "devours" => Some(2),
                "chains" => Some(3),
                "swaps" => Some(4),
                "executions" => Some(5),
                "best" => Some(6),
                _ => None,
            },
            Self::Params => match key {
                "drillDays" => Some(0),
                "destinations" => Some(1),
                "patrolRange" => Some(2),
                "eventTwoDoors" => Some(3),
                "fewerDoorsChance" => Some(4),
                "swapsPerDay" => Some(5),
                "reusableCells" => Some(6),
                "chainStop" => Some(7),
                "tierWeights" => Some(8),
                "swapWeights" => Some(9),
                "swapNewBeast" => Some(10),
                "beastWeights" => Some(11),
                "startInmates" => Some(12),
                "startInmatesFewer" => Some(13),
                "startWeights" => Some(14),
                "officeDoorOdds" => Some(15),
                "doubleEatTier" => Some(16),
                "eventStartChance" => Some(17),
                "eventFollowChance" => Some(18),
                "eventMorningChance" => Some(19),
                "eventWalkChance" => Some(20),
                "eventActionChance" => Some(21),
                "executionSameTier" => Some(22),
                "executionRerolls" => Some(23),
                "ivoryCount" => Some(24),
                "ivoryIncludesSwapped" => Some(25),
                "preyRounds" => Some(26),
                "scratchStacksBase" => Some(27),
                "nestDays" => Some(28),
                "nestTier" => Some(29),
                "rewards" => Some(30),
                "startTools" => Some(31),
                "beastToolOdds" => Some(32),
                _ => None,
            },
            Self::Strategy => match key {
                "tierBase" => Some(0),
                "rainbowMult" => Some(1),
                "wOpen" => Some(2),
                "wNow" => Some(3),
                "wWalk" => Some(4),
                "wStep" => Some(5),
                "wNest" => Some(6),
                "wChain" => Some(7),
                "wGoal" => Some(8),
                "wIncident" => Some(9),
                "wPass" => Some(10),
                "wOfficeIncident" => Some(11),
                "wConsume" => Some(12),
                "wConsumeWalk" => Some(13),
                "wUsurp" => Some(14),
                "wInstigate" => Some(15),
                "wCrow" => Some(16),
                "wShort" => Some(17),
                "wKeys" => Some(18),
                "wForged" => Some(19),
                "wFire" => Some(20),
                "wCage" => Some(21),
                "rerollMargin" => Some(22),
                "wStair" => Some(23),
                "minDevour" => Some(24),
                "stopMargin" => Some(25),
                "swapMaxTier" => Some(26),
                "swapMargin" => Some(27),
                "maidenSwapTier" => Some(28),
                "execMargin" => Some(29),
                "acceptChain" => Some(30),
                "toolRank" => Some(31),
                "toolSets" => Some(32),
                "office" => Some(33),
                "giftRank" => Some(34),
                "giftChain" => Some(35),
                _ => None,
            },
            Self::Choice => match key {
                "kind" => Some(0),
                "options" => Some(1),
                "start" => Some(2),
                "rerolls" => Some(3),
                _ => None,
            },
            Self::Prey => match key {
                "lion" => Some(0),
                "prey" => Some(1),
                "preyBeast" => Some(2),
                "rounds" => Some(3),
                "next" => Some(4),
                _ => None,
            },
            Self::Vault => match key {
                "id" => Some(0),
                "beast" => Some(1),
                "day" => Some(2),
                _ => None,
            },
            Self::Objective => match key {
                "id" => Some(0),
                "progress" => Some(1),
                _ => None,
            },
            Self::Event => match key {
                "kind" => Some(0),
                "cell" => Some(1),
                _ => None,
            },
            Self::Chain => match key {
                "eater" => Some(0),
                "at" => Some(1),
                "bites" => Some(2),
                _ => None,
            },
            Self::Bite => match key {
                "from" => Some(0),
                "cell" => Some(1),
                "scratch" => Some(2),
                "eater" => Some(3),
                "meal" => Some(4),
                "gain" => Some(5),
                "notes" => Some(6),
                "after" => Some(7),
                _ => None,
            },
            Self::Result => match key {
                "day" => Some(0),
                "early" => Some(1),
                "roster" => Some(2),
                "cache" => Some(3),
                "best" => Some(4),
                "stats" => Some(5),
                _ => None,
            },
            Self::Action => match key {
                "type" => Some(0),
                "id" => Some(1),
                "cell" => Some(2),
                "to" => Some(3),
                "accept" => Some(4),
                "choice" => Some(5),
                _ => None,
            },
            Self::Generic => match key {
                _ => None,
            },
        }
    }
}
#[derive(Clone, Debug)]
pub struct Object {
    kind: Kind,
    present: u64,
    slots: Vec<Value>,
    extra: Option<Box<BTreeMap<String, Value>>>,
}
impl Object {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            present: 0,
            slots: vec![Value::Null; kind.fields().len()],
            extra: None,
        }
    }
    #[inline(always)]
    pub fn get(&self, k: &str) -> Option<&Value> {
        if let Some(i) = self.kind.slot(k) {
            if self.present & (1 << i) != 0 {
                return Some(&self.slots[i]);
            }
            return None;
        }
        self.extra.as_ref().and_then(|m| m.get(k))
    }
    #[inline(always)]
    fn entry(&mut self, k: &str) -> &mut Value {
        if let Some(i) = self.kind.slot(k) {
            self.present |= 1 << i;
            return &mut self.slots[i];
        }
        self.extra
            .get_or_insert_with(|| Box::new(BTreeMap::new()))
            .entry(k.to_string())
            .or_insert(Value::Null)
    }
    pub fn len(&self) -> usize {
        self.present.count_ones() as usize + self.extra.as_ref().map_or(0, |m| m.len())
    }
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.kind
            .fields()
            .iter()
            .enumerate()
            .filter_map(move |(i, k)| {
                if self.present & (1 << i) != 0 {
                    Some((*k, &self.slots[i]))
                } else {
                    None
                }
            })
            .chain(
                self.extra
                    .iter()
                    .flat_map(|m| m.iter().map(|(k, v)| (k.as_str(), v))),
            )
    }
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.iter().map(|(k, _)| k)
    }
}
impl PartialEq for Object {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|(k, v)| other.get(k) == Some(v))
    }
}
impl<'a> IntoIterator for &'a Object {
    type Item = (&'a str, &'a Value);
    type IntoIter = std::vec::IntoIter<Self::Item>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter().collect::<Vec<_>>().into_iter()
    }
}
impl Value {
    pub fn object(fields: Vec<(&str, Value)>) -> Self {
        let kind = classify_by(|k| fields.iter().any(|(key, _)| *key == k));
        let mut out = Object::new(kind);
        for (k, v) in fields {
            *out.entry(k) = v;
        }
        Self::Object(out)
    }
    pub fn as_f64(&self) -> Option<f64> {
        if let Self::Number(n) = self {
            Some(*n)
        } else {
            None
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(s) = self {
            Some(s)
        } else {
            None
        }
    }
    pub fn as_array(&self) -> Option<&Vec<Value>> {
        if let Self::Array(a) = self {
            Some(a)
        } else {
            None
        }
    }
    pub fn as_array_mut(&mut self) -> Option<&mut Vec<Value>> {
        if let Self::Array(a) = self {
            Some(a)
        } else {
            None
        }
    }
    pub fn as_object(&self) -> Option<&Object> {
        if let Self::Object(o) = self {
            Some(o)
        } else {
            None
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
    pub fn is_array(&self) -> bool {
        matches!(self, Self::Array(_))
    }
    pub fn is_object(&self) -> bool {
        matches!(self, Self::Object(_))
    }
    pub fn get(&self, k: &str) -> Option<&Value> {
        self.as_object().and_then(|o| o.get(k))
    }
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Null => serde_json::Value::Null,
            Self::Bool(b) => (*b).into(),
            Self::Number(n) => {
                if n.is_finite() && n.fract() == 0. && n.abs() <= 9007199254740991. {
                    serde_json::Value::Number(serde_json::Number::from(*n as i64))
                } else {
                    serde_json::Number::from_f64(*n)
                        .map_or(serde_json::Value::Null, serde_json::Value::Number)
                }
            }
            Self::String(s) => serde_json::Value::String(s.to_string()),
            Self::Array(a) => serde_json::Value::Array(a.iter().map(Self::to_json).collect()),
            Self::Object(o) => serde_json::Value::Object(
                o.iter()
                    .map(|(k, v)| (k.to_string(), v.to_json()))
                    .collect(),
            ),
        }
    }
}
fn classify(m: &serde_json::Map<String, serde_json::Value>) -> Kind {
    classify_by(|k| m.contains_key(k))
}
fn classify_by(has: impl Fn(&str) -> bool) -> Kind {
    if has("cells") && has("params") {
        Kind::State
    } else if has("sealed") && has("n") {
        Kind::Cell
    } else if has("beast") && has("tier") {
        Kind::Inmate
    } else if has("swap") && has("devour") {
        Kind::Used
    } else if has("patrols") && has("opened") {
        Kind::Stats
    } else if has("tierWeights") {
        Kind::Params
    } else if has("tierBase") {
        Kind::Strategy
    } else if has("kind") && has("options") {
        Kind::Choice
    } else if has("lion") && has("prey") {
        Kind::Prey
    } else if has("id") && has("beast") && has("day") {
        Kind::Vault
    } else if has("id") && has("progress") {
        Kind::Objective
    } else if has("kind") && has("cell") {
        Kind::Event
    } else if has("from") && has("meal") {
        Kind::Bite
    } else if has("eater") {
        Kind::Chain
    } else if has("roster") && has("stats") {
        Kind::Result
    } else if has("type") {
        Kind::Action
    } else {
        Kind::Generic
    }
}
impl From<serde_json::Value> for Value {
    fn from(v: serde_json::Value) -> Self {
        match v {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(b) => Self::Bool(b),
            serde_json::Value::Number(n) => Self::Number(n.as_f64().unwrap_or(0.)),
            serde_json::Value::String(s) => Self::String(Arc::from(s)),
            serde_json::Value::Array(a) => Self::Array(a.into_iter().map(Self::from).collect()),
            serde_json::Value::Object(m) => {
                let mut out = Object::new(classify(&m));
                for (k, v) in m {
                    *out.entry(&k) = Self::from(v);
                }
                Self::Object(out)
            }
        }
    }
}
static NULL: Value = Value::Null;
impl Index<&str> for Value {
    type Output = Value;
    #[inline(always)]
    fn index(&self, k: &str) -> &Value {
        self.get(k).unwrap_or(&NULL)
    }
}
impl Index<String> for Value {
    type Output = Value;
    #[inline(always)]
    fn index(&self, k: String) -> &Value {
        self.get(&k).unwrap_or(&NULL)
    }
}
impl Index<usize> for Value {
    type Output = Value;
    #[inline(always)]
    fn index(&self, i: usize) -> &Value {
        self.as_array().and_then(|a| a.get(i)).unwrap_or(&NULL)
    }
}
impl IndexMut<&str> for Value {
    #[inline(always)]
    fn index_mut(&mut self, k: &str) -> &mut Value {
        if self.is_null() {
            *self = Value::Object(Object::new(Kind::Generic));
        }
        match self {
            Self::Object(o) => o.entry(k),
            _ => panic!("Expected object"),
        }
    }
}
impl IndexMut<usize> for Value {
    #[inline(always)]
    fn index_mut(&mut self, i: usize) -> &mut Value {
        match self {
            Self::Array(a) => &mut a[i],
            _ => panic!("Expected array"),
        }
    }
}
impl PartialEq<str> for Value {
    fn eq(&self, s: &str) -> bool {
        self.as_str() == Some(s)
    }
}
impl PartialEq<&str> for Value {
    fn eq(&self, s: &&str) -> bool {
        self.as_str() == Some(*s)
    }
}
impl PartialEq<String> for Value {
    fn eq(&self, s: &String) -> bool {
        self.as_str() == Some(s.as_str())
    }
}
impl PartialEq<bool> for Value {
    fn eq(&self, b: &bool) -> bool {
        matches!(self,Self::Bool(v) if v==b)
    }
}
impl Serialize for Value {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => s.serialize_unit(),
            Self::Bool(b) => s.serialize_bool(*b),
            Self::Number(n) => {
                if n.is_finite() && n.fract() == 0. && n.abs() <= 9007199254740991. {
                    s.serialize_i64(*n as i64)
                } else {
                    s.serialize_f64(*n)
                }
            }
            Self::String(v) => s.serialize_str(v),
            Self::Array(a) => {
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            Self::Object(o) => {
                let mut map = s.serialize_map(Some(o.len()))?;
                for (k, v) in o.iter() {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}
impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        serde_json::Value::deserialize(d).map(Self::from)
    }
}
impl From<&Value> for Value {
    fn from(v: &Value) -> Self {
        v.clone()
    }
}
impl From<&&Value> for Value {
    fn from(v: &&Value) -> Self {
        (**v).clone()
    }
}
impl From<&bool> for Value {
    fn from(v: &bool) -> Self {
        Self::Bool(*v)
    }
}
impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Self::String(Arc::from(v))
    }
}
impl From<&&str> for Value {
    fn from(v: &&str) -> Self {
        Self::String(Arc::from(*v))
    }
}
impl From<&String> for Value {
    fn from(v: &String) -> Self {
        Self::String(Arc::from(v.as_str()))
    }
}
impl From<&f64> for Value {
    fn from(v: &f64) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&f32> for Value {
    fn from(v: &f32) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&u32> for Value {
    fn from(v: &u32) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&u64> for Value {
    fn from(v: &u64) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&usize> for Value {
    fn from(v: &usize) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&i32> for Value {
    fn from(v: &i32) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&i64> for Value {
    fn from(v: &i64) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&isize> for Value {
    fn from(v: &isize) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&u8> for Value {
    fn from(v: &u8) -> Self {
        Self::Number(*v as f64)
    }
}
impl From<&Vec<Value>> for Value {
    fn from(v: &Vec<Value>) -> Self {
        Self::Array(v.iter().map(|x| Value::from(x)).collect())
    }
}
impl From<&Vec<usize>> for Value {
    fn from(v: &Vec<usize>) -> Self {
        Self::Array(v.iter().map(|x| Value::from(x)).collect())
    }
}
impl From<&Vec<i32>> for Value {
    fn from(v: &Vec<i32>) -> Self {
        Self::Array(v.iter().map(|x| Value::from(x)).collect())
    }
}
impl From<&Vec<f64>> for Value {
    fn from(v: &Vec<f64>) -> Self {
        Self::Array(v.iter().map(|x| Value::from(x)).collect())
    }
}
impl From<&Vec<String>> for Value {
    fn from(v: &Vec<String>) -> Self {
        Self::Array(v.iter().map(|x| Value::from(x)).collect())
    }
}
#[macro_export]
macro_rules! model_json{
 (null)=>{$crate::model::Value::Null};
 ([])=>{$crate::model::Value::Array(Vec::new())};
 ({$($tt:tt)*})=>{{let mut fields=Vec::new();$crate::model_object!(fields,$($tt)*,);$crate::model::Value::object(fields)}};
 ([$($e:expr),* $(,)?])=>{$crate::model::Value::Array(vec![$($crate::model::Value::from(&$e)),*])};
 ($e:expr)=>{$crate::model::Value::from(&$e)};
}

#[macro_export]
macro_rules! model_object{
 ($out:ident,)=>{};
 ($out:ident,,)=>{};
 ($out:ident,$k:literal:[$($v:tt)*],$($rest:tt)*)=>{$out.push(($k,$crate::model_json!([$($v)*])));$crate::model_object!($out,$($rest)*);};
 ($out:ident,$k:literal:{$($v:tt)*},$($rest:tt)*)=>{$out.push(($k,$crate::model_json!({$($v)*})));$crate::model_object!($out,$($rest)*);};
 ($out:ident,$k:literal:null,$($rest:tt)*)=>{$out.push(($k,$crate::model::Value::Null));$crate::model_object!($out,$($rest)*);};
 ($out:ident,$k:literal:$v:expr,$($rest:tt)*)=>{$out.push(($k,$crate::model_json!($v)));$crate::model_object!($out,$($rest)*);};
}
