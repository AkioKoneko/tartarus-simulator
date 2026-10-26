use std::io::{self, BufRead, Write};
fn main() {
    let mut core = tartarus_core::api::Core::new();
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str(&line) {
                Ok(v) => core.handle(v),
                Err(e) => serde_json::json!({"error":e.to_string()}),
            },
            Err(_) => break,
        };
        if writeln!(out, "{}", response).is_err() || out.flush().is_err() {
            break;
        }
    }
}
