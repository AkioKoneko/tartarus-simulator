//! Versioned, interchangeable calculation core; no UI/capture/files/network.
pub mod api;
pub mod engine;
#[cfg(feature = "solver")]
pub mod job;
pub mod model;
#[cfg(feature = "solver")]
pub mod policy;
use std::{
    alloc::{alloc as allocate, dealloc as release, Layout},
    sync::Mutex,
};
static CORE: Mutex<api::Core> = Mutex::new(api::Core::new());
static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
#[no_mangle]
pub extern "C" fn core_contract() -> u32 {
    1
}
#[no_mangle]
pub unsafe extern "C" fn alloc(n: usize) -> *mut u8 {
    if n == 0 {
        return std::ptr::null_mut();
    }
    allocate(Layout::from_size_align(n, 8).unwrap())
}
#[no_mangle]
pub unsafe extern "C" fn dealloc(p: *mut u8, n: usize) {
    if n > 0 && !p.is_null() {
        release(p, Layout::from_size_align(n, 8).unwrap())
    }
}
#[no_mangle]
pub unsafe extern "C" fn request(p: *const u8, n: usize) -> usize {
    let response = if n > 32 * 1024 * 1024 {
        serde_json::json!({"error":"Request too large"})
    } else {
        match serde_json::from_slice(std::slice::from_raw_parts(p, n)) {
            Ok(v) => CORE.lock().unwrap().handle(v),
            Err(e) => serde_json::json!({"error":format!("Invalid JSON: {e}")}),
        }
    };
    let mut out = OUTPUT.lock().unwrap();
    *out = serde_json::to_vec(&response)
        .unwrap_or_else(|_| b"{\"error\":\"Serialization failed\"}".to_vec());
    out.len()
}
#[no_mangle]
pub extern "C" fn response() -> *const u8 {
    OUTPUT.lock().unwrap().as_ptr()
}
