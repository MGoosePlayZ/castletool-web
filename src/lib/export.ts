// Export one layer of a Drawing2 as a PNG, or as an APNG when the drawing has several frames.
import { zlibSync } from "fflate";
import { OpError, blankFrame, frameCount, layersOf, loadPng, makeCanvas, segPts } from "./drawing";

const VECTOR_PX_PER_UNIT = 32;      // vector-only layers have no pixel grid of their own
const STROKE_UNITS = 0.28;
const MAX_PIXELS = 64_000_000;

// ── PNG / APNG encoding ────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (...v: number[]) => { const b = new Uint8Array(v.length * 4), d = new DataView(b.buffer); v.forEach((x, i) => d.setUint32(i * 4, x >>> 0)); return b; };
const u16 = (v: number) => new Uint8Array([(v >> 8) & 255, v & 255]);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type);
  return cat(u32(data.length), t, data, u32(crc32(t, data)));
}
function compress(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);   // filter byte 0
  return zlibSync(raw, { level: 6 });
}

/** One frame → plain PNG; several → APNG that loops forever at `fps`. Every frame is full size (w×h RGBA). */
export function encodePng(frames: Uint8ClampedArray[], w: number, h: number, fps: number): Uint8Array {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), ihdr = chunk("IHDR", cat(u32(w, h), Uint8Array.from([8, 6, 0, 0, 0])));
  const parts: Uint8Array[] = [sig, ihdr];
  if (frames.length === 1) parts.push(chunk("IDAT", compress(frames[0], w, h)));
  else {
    const rate = Math.max(0.01, Math.min(60, fps || 4)), num = 100, den = Math.max(1, Math.min(65535, Math.round(rate * 100)));
    let seq = 0;
    parts.push(chunk("acTL", u32(frames.length, 0)));
    frames.forEach((f, i) => {
      parts.push(chunk("fcTL", cat(u32(seq++, w, h, 0, 0), u16(num), u16(den), Uint8Array.from([0, 0]))));   // dispose none, blend source
      const z = compress(f, w, h);
      parts.push(i === 0 ? chunk("IDAT", z) : chunk("fdAT", cat(u32(seq++), z)));
    });
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  return cat(...parts);
}

// ── rendering one layer ────────────────────────────────────────────────
const frameOf = (layer: any, i: number) => {
  const fs = layer.frames || [];
  let j = Math.min(i, fs.length - 1);
  if (j < 0) return blankFrame();
  while (j > 0 && fs[j]?.isLinked) j--;       // looping frames look like the frame before them
  return fs[j] || blankFrame();
};

export interface LayerExport { bytes: Uint8Array; frames: number; w: number; h: number; ext: "png" | "apng" }

export async function exportLayer(d2: any, layerId: string): Promise<LayerExport> {
  const layer = layersOf(d2).find((l) => l.id === layerId);
  if (!layer) throw new OpError("That layer no longer exists.");
  const n = Math.max(1, frameCount(d2)), ppu = +d2.drawData.fillPixelsPerUnit || 1;
  const picked = Array.from({ length: n }, (_, i) => frameOf(layer, i));
  const hasBitmap = picked.some((f) => f.fillPng);
  const k = hasBitmap ? ppu : VECTOR_PX_PER_UNIT;       // pixels per Castle unit
  // bounds of everything the layer draws, in output pixels (all frames share one canvas so an APNG lines up)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (a: number, b: number, c: number, d: number) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  for (const f of picked) {
    if (f.fillPng) { const b = f.fillImageBounds || {}; grow((b.minX || 0) * (k / ppu), (b.minY || 0) * (k / ppu), (b.maxX || 0) * (k / ppu), (b.maxY || 0) * (k / ppu)); }
    for (const s of f.pathDataList || []) for (const [a, b] of segPts(s)) { const r = (STROKE_UNITS / 2) * k; grow(a * k - r, b * k - r, a * k + r, b * k + r); }
  }
  if (!(x1 > x0) || !(y1 > y0)) throw new OpError("This layer is empty. Nothing to export.");
  const ox = Math.floor(x0), oy = Math.floor(y0), w = Math.max(1, Math.ceil(x1) - ox), h = Math.max(1, Math.ceil(y1) - oy);
  if (w * h > MAX_PIXELS) throw new OpError(`This layer is too large to export (${w}×${h}px).`);
  const out: Uint8ClampedArray[] = [], cv = makeCanvas(w, h), x = cv.getContext("2d", { willReadFrequently: true })!;
  for (const f of picked) {
    x.clearRect(0, 0, w, h);
    if (f.fillPng) {
      const im = await loadPng(f.fillPng), b = f.fillImageBounds || {};
      if (im) {
        x.imageSmoothingEnabled = false;
        const bx = (b.minX || 0) * (k / ppu) - ox, by = (b.minY || 0) * (k / ppu) - oy, bw = ((b.maxX || 0) - (b.minX || 0)) * (k / ppu), bh = ((b.maxY || 0) - (b.minY || 0)) * (k / ppu);
        x.drawImage(im, Math.round(bx), Math.round(by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
      }
    }
    x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = Math.max(1, STROKE_UNITS * k);
    for (const s of f.pathDataList || []) {
      const p = segPts(s);
      if (p.length < 2) continue;
      const c = s.c || [0, 0, 0, 1];
      x.strokeStyle = `rgba(${c.slice(0, 3).map((v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${c[3] ?? 1})`;
      x.beginPath();
      p.forEach(([a, b], j) => (j ? x.lineTo(a * k - ox, b * k - oy) : x.moveTo(a * k - ox, b * k - oy)));
      x.stroke();
    }
    out.push(new Uint8ClampedArray(x.getImageData(0, 0, w, h).data));
  }
  return { bytes: encodePng(out, w, h, +d2.framesPerSecond || 4), frames: out.length, w, h, ext: out.length > 1 ? "apng" : "png" };
}
