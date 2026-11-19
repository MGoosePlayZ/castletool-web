// Art editor exports: PNG, GIF and lossless MP4. Pure byte-level encoders, no dependencies.
//  GIF: LZW with one local palette per frame (so only a single frame with more than 256 colours makes it lossy).
//  MP4: H.264 "High 4:4:4 Predictive" made only of I_PCM macroblocks, with RGB stored as GBR (matrix_coefficients 0, full range):
//       no transform, no prediction, no rounding, so every decoded pixel equals the original. Big files; plays in ffmpeg/VLC/mpv.
import { quantizeData } from "@/lib/imaging";

class Bytes {
  a = new Uint8Array(1 << 16); n = 0;
  b(v: number) { if (this.n >= this.a.length) { const t = new Uint8Array(this.a.length * 2); t.set(this.a); this.a = t; } this.a[this.n++] = v & 255; }
  w16(v: number) { this.b(v); this.b(v >> 8); }
  s(str: string) { for (let i = 0; i < str.length; i++) this.b(str.charCodeAt(i)); }
  put(u: Uint8Array) { for (let i = 0; i < u.length; i++) this.b(u[i]); }
  done() { return this.a.slice(0, this.n); }
}

// ── PNG ────────────────────────────────────────────────────────────────
export const pngBlob = (cv: HTMLCanvasElement): Promise<Blob> => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the PNG."))), "image/png"));

// ── GIF ────────────────────────────────────────────────────────────────
/** Colours in one RGBA frame the way a GIF sees them: alpha < 128 is "transparent" (one slot), everything else is opaque. */
export function gifColors(d: Uint8ClampedArray): number {
  const s = new Set<number>();
  let tr = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) tr = 1; else { s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (s.size > 256) break; }
  }
  return s.size + tr;
}
export const gifLossy = (frames: Uint8ClampedArray[]) => frames.some((f) => gifColors(f) > 256);

function lzw(idx: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1, out = new Bytes();
  let size = minCode + 1, next = eoi + 1, cur = 0, bits = 0, dict = new Map<number, number>();
  const sub: number[] = [];
  const emit = (c: number) => {
    cur |= c << bits; bits += size;
    while (bits >= 8) { sub.push(cur & 255); cur >>>= 8; bits -= 8; if (sub.length === 255) { out.b(255); sub.forEach((v) => out.b(v)); sub.length = 0; } }
  };
  emit(clear);
  let p = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (p << 8) | k, v = dict.get(key);
    if (v !== undefined) { p = v; continue; }
    emit(p);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; dict = new Map(); }
    else { if (next >= 1 << size) size++; dict.set(key, next++); }
    p = k;
  }
  emit(p); emit(eoi);
  if (bits > 0) sub.push(cur & 255);
  while (sub.length) { const n = Math.min(255, sub.length); out.b(n); for (let i = 0; i < n; i++) out.b(sub[i]); sub.splice(0, n); }
  out.b(0);
  return out.done();
}

/** Animated GIF, looping forever. Frames are w×h RGBA. More than 256 colours in a frame are reduced (median cut) for that frame only. */
export function encodeGif(frames: Uint8ClampedArray[], w: number, h: number, fps: number): Uint8Array {
  const o = new Bytes(), delay = Math.max(2, Math.round(100 / Math.max(0.1, fps || 4)));
  o.s("GIF89a"); o.w16(w); o.w16(h); o.b(0x70); o.b(0); o.b(0);
  if (frames.length > 1) { o.b(0x21); o.b(0xff); o.b(11); o.s("NETSCAPE2.0"); o.b(3); o.b(1); o.w16(0); o.b(0); }
  for (const f of frames) {
    const d = new Uint8ClampedArray(f);
    let tr = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) { tr = true; break; }
    if (gifColors(d) > 256) quantizeData(d, tr ? 255 : 256, true);
    const map = new Map<number, number>(), pal: number[] = [], idx = new Uint8Array(w * h);
    if (tr) pal.push(0, 0, 0);
    for (let i = 0, q = 0; i < idx.length; i++, q += 4) {
      if (d[q + 3] < 128) { idx[i] = 0; continue; }
      const key = (d[q] << 16) | (d[q + 1] << 8) | d[q + 2];
      let v = map.get(key);
      if (v === undefined) { v = pal.length / 3; map.set(key, v); pal.push(d[q], d[q + 1], d[q + 2]); }
      idx[i] = v;
    }
    const n = pal.length / 3;
    let bitsN = 1;
    while (1 << bitsN < n) bitsN++;
    while (pal.length < (3 << bitsN)) pal.push(0);
    o.b(0x21); o.b(0xf9); o.b(4); o.b((2 << 2) | (tr ? 1 : 0)); o.w16(delay); o.b(0); o.b(0);   // restore to background after each frame
    o.b(0x2c); o.w16(0); o.w16(0); o.w16(w); o.w16(h); o.b(0x80 | (bitsN - 1));
    pal.forEach((v) => o.b(v));
    const minCode = Math.max(2, bitsN);
    o.b(minCode); o.put(lzw(idx, minCode));
  }
  o.b(0x3b);
  return o.done();
}

// ── MP4 (lossless) ─────────────────────────────────────────────────────
class Bits {
  a: Uint8Array; pos = 0;
  constructor(n: number) { this.a = new Uint8Array(n); }
  put(v: number, n: number) { for (let i = n - 1; i >= 0; i--) { if ((v >>> i) & 1) this.a[this.pos >> 3] |= 0x80 >> (this.pos & 7); this.pos++; } }
  ue(v: number) { v += 1; let l = 0; while (v >> (l + 1)) l++; this.put(0, l); this.put(v, l + 1); }
  se(v: number) { this.ue(v <= 0 ? -2 * v : 2 * v - 1); }
  align() { this.pos = (this.pos + 7) & ~7; }
  trailing() { this.put(1, 1); this.align(); }
  bytes() { return this.a.subarray(0, this.pos >> 3); }
}
/** NAL → length-less escaped bytes (emulation prevention) with its header byte. */
function nal(type: number, rbsp: Uint8Array): Uint8Array {
  const o: number[] = [0x60 | type];
  let z = 0;
  for (let i = 0; i < rbsp.length; i++) {
    const v = rbsp[i];
    if (z >= 2 && v <= 3) { o.push(3); z = 0; }
    o.push(v);
    z = v === 0 ? z + 1 : 0;
  }
  return Uint8Array.from(o);
}
const box = (type: string, ...parts: Uint8Array[]) => {
  const n = parts.reduce((s, p) => s + p.length, 8), o = new Uint8Array(n), v = new DataView(o.buffer);
  v.setUint32(0, n); for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i);
  let p = 8; for (const x of parts) { o.set(x, p); p += x.length; }
  return o;
};
const u8 = (...v: number[]) => Uint8Array.from(v);
const u32 = (...v: number[]) => { const o = new Uint8Array(v.length * 4), d = new DataView(o.buffer); v.forEach((x, i) => d.setUint32(i * 4, x >>> 0)); return o; };
const u16 = (v: number) => u8(v >> 8, v & 255);
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

function sps(w: number, h: number, mbw: number, mbh: number) {
  const b = new Bits(128);
  b.put(244, 8); b.put(0, 8); b.put(51, 8);
  b.ue(0); b.ue(3); b.put(0, 1); b.ue(0); b.ue(0); b.put(0, 1); b.put(0, 1);        // id, 4:4:4, no separate planes, 8 bit, no bypass, no scaling lists
  b.ue(0); b.ue(2); b.ue(1); b.put(0, 1);                                            // 4-bit frame_num, poc type 2, 1 ref frame
  b.ue(mbw - 1); b.ue(mbh - 1); b.put(1, 1); b.put(1, 1);
  const cr = mbw * 16 - w, cb = mbh * 16 - h;
  if (cr || cb) { b.put(1, 1); b.ue(0); b.ue(cr); b.ue(0); b.ue(cb); } else b.put(0, 1);
  b.put(1, 1);                                                                        // VUI
  b.put(0, 1); b.put(0, 1);                                                           // no aspect ratio, no overscan
  b.put(1, 1); b.put(5, 3); b.put(1, 1); b.put(1, 1); b.put(2, 8); b.put(2, 8); b.put(0, 8);   // full range, matrix_coefficients 0 = GBR (RGB)
  b.put(0, 6);                                                                        // chroma loc, timing, hrd x2, pic struct, restriction
  b.trailing();
  return nal(7, b.bytes());
}
function pps() {
  const b = new Bits(32);
  b.ue(0); b.ue(0); b.put(0, 1); b.put(0, 1); b.ue(0); b.ue(0); b.ue(0); b.put(0, 1); b.put(0, 2); b.se(0); b.se(0); b.se(0);
  b.put(1, 1); b.put(0, 1); b.put(0, 1);                                              // deblocking control present, no constrained intra, no redundant pics
  b.trailing();
  return nal(8, b.bytes());
}
function slice(d: Uint8ClampedArray, w: number, h: number, mbw: number, mbh: number, n: number) {
  const b = new Bits(64 + mbw * mbh * 770 + 8);
  b.ue(0); b.ue(7); b.ue(0); b.put(0, 4); b.ue(n & 1); b.put(0, 1); b.put(0, 1); b.se(0); b.ue(1);   // header: IDR, I slice, no deblocking
  for (let my = 0; my < mbh; my++) for (let mx = 0; mx < mbw; mx++) {
    b.ue(25); b.align();                                                              // mb_type I_PCM + pcm alignment
    let p = b.pos >> 3;
    for (const c of [1, 2, 0]) for (let y = 0; y < 16; y++) {                         // G (luma), B (Cb), R (Cr)
      const py = Math.min(h - 1, my * 16 + y) * w;
      for (let x = 0; x < 16; x++) b.a[p++] = d[(py + Math.min(w - 1, mx * 16 + x)) * 4 + c];
    }
    b.pos = p << 3;
  }
  b.trailing();
  return nal(5, b.bytes());
}

/** Lossless MP4 from opaque RGBA frames. */
export function encodeMp4(frames: Uint8ClampedArray[], w: number, h: number, fps: number): Uint8Array {
  const mbw = Math.ceil(w / 16), mbh = Math.ceil(h / 16), S = sps(w, h, mbw, mbh), P = pps(), samples: Uint8Array[] = [];
  frames.forEach((f, i) => {
    const s = slice(f, w, h, mbw, mbh, i), o = new Uint8Array(4 + s.length);
    new DataView(o.buffer).setUint32(0, s.length); o.set(s, 4); samples.push(o);
  });
  const total = samples.reduce((n, s) => n + s.length, 0);
  if (total > 4_000_000_000) throw new Error("This video would be too large to export as a lossless MP4.");
  const TS = 90000, dur = Math.max(1, Math.round(TS / Math.max(0.1, fps || 4))), all = dur * samples.length;
  const avcC = box("avcC", u8(1, 244, 0, 51, 0xff, 0xe1), u16(S.length), S, u8(1), u16(P.length), P, u8(0xff, 0xf8, 0xf8, 0));
  const colr = box("colr", Uint8Array.from([..."nclx"].map((c) => c.charCodeAt(0))), u16(2), u16(2), u16(0), u8(0x80));
  const name = zeros(32);
  const avc1 = box("avc1", zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x480000, 0x480000), zeros(4), u16(1), name, u16(0x18), u8(0xff, 0xff), avcC, colr);
  const ftyp = box("ftyp", Uint8Array.from([..."isom"].map((c) => c.charCodeAt(0))), u32(512), Uint8Array.from([..."isomiso2avc1mp41"].map((c) => c.charCodeAt(0))));
  const moov = (offset: number) => box("moov",
    box("mvhd", u32(0, 0, 0, TS, all, 0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box("trak",
      box("tkhd", u32(3, 0, 0, 1, 0, all), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w << 16, h << 16)),
      box("mdia",
        box("mdhd", u32(0, 0, 0, TS, all), u16(0x55c4), u16(0)),
        box("hdlr", u32(0, 0), Uint8Array.from([..."vide"].map((c) => c.charCodeAt(0))), zeros(12), Uint8Array.from([..."VideoHandler"].map((c) => c.charCodeAt(0))), u8(0)),
        box("minf",
          box("vmhd", u32(1), zeros(8)),
          box("dinf", box("dref", u32(0, 1), box("url ", u32(1)))),
          box("stbl",
            box("stsd", u32(0, 1), avc1),
            box("stts", u32(0, 1, samples.length, dur)),
            box("stsc", u32(0, 1, 1, samples.length, 1)),
            box("stsz", u32(0, 0, samples.length, ...samples.map((s) => s.length))),
            box("stco", u32(0, 1, offset)))))));
  const moovLen = moov(0).length, mdatAt = ftyp.length + moovLen + 8, M = moov(mdatAt);
  const out = new Uint8Array(ftyp.length + M.length + 8 + total), v = new DataView(out.buffer);
  out.set(ftyp, 0); out.set(M, ftyp.length);
  let p = ftyp.length + M.length;
  v.setUint32(p, total + 8); out.set([0x6d, 0x64, 0x61, 0x74], p + 4); p += 8;
  for (const s of samples) { out.set(s, p); p += s.length; }
  return out;
}
