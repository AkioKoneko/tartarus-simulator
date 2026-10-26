//! Independently authored pixel primitives for the existing JS reader.
//! JS owns recognition, references, thresholds and result construction.
use std::alloc::{alloc as allocate, dealloc as release, Layout};

#[no_mangle]
pub extern "C" fn kernel_contract() -> u32 {
    1
}
#[no_mangle]
pub unsafe extern "C" fn alloc(bytes: usize) -> *mut u8 {
    if bytes == 0 {
        return std::ptr::null_mut();
    }
    allocate(Layout::from_size_align(bytes, 8).unwrap())
}
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, bytes: usize) {
    if bytes != 0 && !ptr.is_null() {
        release(ptr, Layout::from_size_align(bytes, 8).unwrap());
    }
}

#[no_mangle]
pub unsafe extern "C" fn gray(rgba: *const u8, output: *mut f32, n: usize) {
    for i in 0..n {
        let d = rgba.add(i * 4);
        *output.add(i) =
            (0.299 * *d as f64 + 0.587 * *d.add(1) as f64 + 0.114 * *d.add(2) as f64) as f32;
    }
}
#[no_mangle]
pub unsafe extern "C" fn blur(
    input: *const f32,
    temp: *mut f32,
    output: *mut f32,
    w: usize,
    h: usize,
    radius: usize,
) {
    let r = radius as isize;
    let span = (2 * radius + 1) as f64;
    for y in 0..h {
        let mut sum = 0.0f64;
        for x in -r..=r {
            sum += *input.add(y * w + x.clamp(0, w as isize - 1) as usize) as f64;
        }
        for x in 0..w {
            *temp.add(y * w + x) = (sum / span) as f32;
            sum += *input.add(y * w + (x + radius + 1).min(w - 1)) as f64
                - *input.add(y * w + (x as isize - r).max(0) as usize) as f64;
        }
    }
    for x in 0..w {
        let mut sum = 0.0f64;
        for y in -r..=r {
            sum += *temp.add(y.clamp(0, h as isize - 1) as usize * w + x) as f64;
        }
        for y in 0..h {
            *output.add(y * w + x) = (sum / span) as f32;
            sum += *temp.add((y + radius + 1).min(h - 1) * w + x) as f64
                - *temp.add((y as isize - r).max(0) as usize * w + x) as f64;
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn half(input: *const f32, output: *mut f32, w: usize, h: usize) {
    let nw = w / 2;
    let nh = h / 2;
    for y in 0..nh {
        for x in 0..nw {
            let i = 2 * y * w + 2 * x;
            *output.add(y * nw + x) = ((*input.add(i) as f64
                + *input.add(i + 1) as f64
                + *input.add(i + w) as f64
                + *input.add(i + w + 1) as f64)
                / 4.0) as f32;
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn text_mask(
    rgba: *const u8,
    image_width: usize,
    x0: usize,
    y0: usize,
    w: usize,
    h: usize,
    radius: usize,
    saturation: f64,
    min_luminance: f64,
    min_contrast: f64,
    relative_contrast: f64,
    lum: *mut f32,
    temp: *mut f32,
    around: *mut f32,
    mask: *mut u8,
) {
    for y in 0..h {
        for x in 0..w {
            let p = rgba.add(((y0 + y) * image_width + x0 + x) * 4);
            *lum.add(y * w + x) =
                (0.299 * *p as f64 + 0.587 * *p.add(1) as f64 + 0.114 * *p.add(2) as f64) as f32;
        }
    }
    blur(lum, temp, around, w, h, radius);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let l = *lum.add(i) as f64;
            let a = *around.add(i) as f64;
            let mut pass = l >= min_luminance && l - a >= min_contrast.max(relative_contrast * a);
            if pass {
                let p = rgba.add(((y0 + y) * image_width + x0 + x) * 4);
                let r = *p as f64;
                let g = *p.add(1) as f64;
                let b = *p.add(2) as f64;
                let max = r.max(g).max(b);
                let min = r.min(g).min(b);
                let sat = if max != 0.0 { (max - min) / max } else { 0.0 };
                pass = sat < saturation;
            }
            *mask.add(i) = if pass { 1 } else { 0 };
        }
    }
}
unsafe fn sample(g: *const f32, w: usize, h: usize, mut x: f64, mut y: f64) -> f64 {
    x = x.max(0.0).min(w as f64 - 1.001);
    y = y.max(0.0).min(h as f64 - 1.001);
    let xi = x as usize;
    let yi = y as usize;
    let fx = x - xi as f64;
    let fy = y - yi as f64;
    let i = yi * w + xi;
    // Keep the JS order of operations (Float32 samples, Float64 arithmetic).
    (*g.add(i) as f64 * (1.0 - fx) + *g.add(i + 1) as f64 * fx) * (1.0 - fy)
        + (*g.add(i + w) as f64 * (1.0 - fx) + *g.add(i + w + 1) as f64 * fx) * fy
}
#[no_mangle]
pub unsafe extern "C" fn score(
    g: *const f32,
    w: usize,
    h: usize,
    xy: *const f64,
    tv: *const f32,
    n: usize,
    k: f64,
    ox: f64,
    oy: f64,
    nearest: u32,
) -> f64 {
    let (mut sum, mut squares, mut dot) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let x = ox + *xy.add(i * 2) * k;
        let y = oy + *xy.add(i * 2 + 1) * k;
        let v = if nearest != 0 {
            *g.add(
                (y.max(0.0).min(h as f64 - 1.0) as usize) * w
                    + x.max(0.0).min(w as f64 - 1.0) as usize,
            ) as f64
        } else {
            sample(g, w, h, x, y)
        };
        sum += v;
        squares += v * v;
        dot += v * *tv.add(i) as f64;
    }
    let variance = squares - sum * sum / n as f64;
    if variance > 1e-6 {
        dot / variance.sqrt()
    } else {
        -1.0
    }
}
#[no_mangle]
pub unsafe extern "C" fn coarse_search(
    g: *const f32,
    w: usize,
    h: usize,
    xs: *const f64,
    ys: *const f64,
    tv: *const f32,
    n: usize,
    ox0: i32,
    ox1: i32,
    oy0: i32,
    oy1: i32,
    out: *mut f64,
) {
    let (mut best, mut bx, mut by) = (-f64::INFINITY, ox0, oy0);
    for oy in oy0..=oy1 {
        for ox in ox0..=ox1 {
            let (mut sum, mut squares, mut dot) = (0.0, 0.0, 0.0);
            for j in 0..n {
                // JS |0 truncates before clamping; offsets are always small here.
                let xi = ((ox as f64 + *xs.add(j)) as i32).clamp(0, w as i32 - 1) as usize;
                let yi = ((oy as f64 + *ys.add(j)) as i32).clamp(0, h as i32 - 1) as usize;
                let v = *g.add(yi * w + xi) as f64;
                sum += v;
                squares += v * v;
                dot += v * *tv.add(j) as f64;
            }
            let variance = squares - sum * sum / n as f64;
            let value = if variance > 1e-6 {
                dot / variance.sqrt()
            } else {
                -1.0
            };
            if value > best {
                best = value;
                bx = ox;
                by = oy;
            }
        }
    }
    *out = bx as f64;
    *out.add(1) = by as f64;
    *out.add(2) = best;
}
