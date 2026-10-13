// Minimal PNG decode/encode for 8-bit RGB/RGBA, non-interlaced images, plus
// crop and scale helpers. Images are { width, height, data: Uint8Array RGBA }.
const zlib = require('zlib');
const fs = require('fs');

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2)) throw new Error(`unsupported PNG: depth ${depth}, color ${color}`);
  const channels = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels];
      out[o + 1] = line[x * channels + 1];
      out[o + 2] = line[x * channels + 2];
      out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

function encode(img) {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img, x0, y0, w, h) {
  x0 = Math.max(0, Math.round(x0));
  y0 = Math.max(0, Math.round(y0));
  w = Math.min(img.width - x0, Math.round(w));
  h = Math.min(img.height - y0, Math.round(h));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

// Nearest-neighbour scale by an integer factor, for viewing.
function zoom(img, f) {
  const w = img.width * f;
  const h = img.height * f;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / f) * img.width) + Math.floor(x / f)) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Resizes by a factor: box-averaging when shrinking, bilinear when growing.
function resize(img, f) {
  const w = Math.round(img.width * f);
  const h = Math.round(img.height * f);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (f < 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let yy = Math.floor(y / f); yy < Math.ceil((y + 1) / f); yy++) {
          for (let xx = Math.floor(x / f); xx < Math.ceil((x + 1) / f); xx++) {
            const i = (Math.min(img.height - 1, yy) * img.width + Math.min(img.width - 1, xx)) * 4;
            r += img.data[i];
            g += img.data[i + 1];
            b += img.data[i + 2];
            n += 1;
          }
        }
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
      } else {
        const fx = Math.min(img.width - 1.001, x / f);
        const fy = Math.min(img.height - 1.001, y / f);
        const x0 = fx | 0;
        const y0 = fy | 0;
        const ax = fx - x0;
        const ay = fy - y0;
        for (let c = 0; c < 3; c++) {
          const i = (y0 * img.width + x0) * 4 + c;
          out[o + c] = (img.data[i] * (1 - ax) + img.data[i + 4] * ax) * (1 - ay) + (img.data[i + img.width * 4] * (1 - ax) + img.data[i + img.width * 4 + 4] * ax) * ay;
        }
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

const read = (file) => decode(fs.readFileSync(file));
const write = (file, img) => fs.writeFileSync(file, encode(img));

module.exports = { decode, encode, crop, zoom, resize, read, write };
