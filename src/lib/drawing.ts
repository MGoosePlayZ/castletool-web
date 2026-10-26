// Drawing2 helpers: layers, preview rendering (ports of CTA's layers.py / drawing.py).
export const NEW = "new";
export class OpError extends Error {}

export const d2Of = (bp: any) => bp?.actorBlueprint?.components?.Drawing2;
export const layersOf = (d2: any): any[] => d2?.drawData?.layers || [];
export const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
export const blankFrame = () => ({
  isLinked: false, pathDataList: [], fillImageBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  avatarX: 0, avatarY: 0, avatarRadius: 5,
});

export function frameCount(d2: any): number {
  let n = (d2?.drawData?.framesBounds || []).length;
  for (const l of layersOf(d2)) n = Math.max(n, (l.frames || []).length);
  return n;
}

export function layerSummary(d2: any) {
  return layersOf(d2).map((l) => ({ id: l.id, title: l.title || "", bitmap: !!l.isBitmap }));
}

export function rehash(d2: any) {
  const s = JSON.stringify(layersOf(d2));
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  d2.hash = String(Math.abs(h)) + s.length;
}

// ── PNG helpers ────────────────────────────────────────────────────────
const IMGS = new Map<string, Promise<HTMLImageElement | null>>();
export function loadPng(b64: string): Promise<HTMLImageElement | null> {
  let p = IMGS.get(b64);
  if (!p) {
    p = new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = "data:image/png;base64," + b64;
    });
    if (IMGS.size > 300) IMGS.clear();
    IMGS.set(b64, p);
  }
  return p;
}
export const canvasPng = (c: HTMLCanvasElement | OffscreenCanvas): Promise<string> => {
  if ("toDataURL" in c) return Promise.resolve((c as HTMLCanvasElement).toDataURL("image/png").split(",")[1]);
  return (c as OffscreenCanvas).convertToBlob({ type: "image/png" }).then(blobToB64);
};
export const blobToB64 = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
export const makeCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

// ── layer edits (pure, on the Drawing2 dict) ───────────────────────────
function indexOfLayer(d2: any, id: string) {
  const i = layersOf(d2).findIndex((l) => l.id === id);
  if (i < 0) throw new OpError("That layer no longer exists.");
  return i;
}
export function renameLayer(d2: any, id: string, name: string) {
  name = (name || "").trim();
  if (!name) throw new OpError("A layer needs a name.");
  layersOf(d2)[indexOfLayer(d2, id)].title = name;
  rehash(d2);
}
export function deleteLayer(d2: any, id: string) {
  const L = layersOf(d2);
  const i = indexOfLayer(d2, id);
  if (L.length <= 1) throw new OpError("A drawing needs at least one layer.");
  L.splice(i, 1);
  rehash(d2);
}
export function moveLayer(d2: any, from: number, to: number) {
  const L = layersOf(d2);
  if (from < 0 || from >= L.length || to < 0 || to >= L.length) throw new OpError("That layer can't go there.");
  L.splice(to, 0, L.splice(from, 1)[0]);
  rehash(d2);
}

function unitBounds(f: any, ppu: number) {
  const xs: number[] = [], ys: number[] = [];
  for (const s of f.pathDataList || []) {
    const p = s.p || [];
    if (p.length >= 4) { xs.push(p[0], p[2]); ys.push(p[1], p[3]); }
  }
  const b = f.fillImageBounds;
  if (f.fillPng && b && ppu) { xs.push(b.minX / ppu, b.maxX / ppu); ys.push(b.minY / ppu, b.maxY / ppu); }
  return xs.length ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } : null;
}
const union = (a: any, b: any) => ({
  minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
  minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
});

async function rescaleFrames(frames: any[], f: number) {
  for (const fr of frames) {
    const b = fr.fillImageBounds;
    if (!fr.fillPng || !b) continue;
    const w = Math.max(1, Math.round((b.maxX - b.minX) * f)), h = Math.max(1, Math.round((b.maxY - b.minY) * f));
    const cx = ((b.minX + b.maxX) / 2) * f, cy = ((b.minY + b.maxY) / 2) * f;
    const im = await loadPng(fr.fillPng);
    const c = makeCanvas(w, h), x = c.getContext("2d")!;
    x.imageSmoothingEnabled = false;
    if (im) x.drawImage(im, 0, 0, w, h);
    fr.fillPng = await canvasPng(c);
    fr.fillImageBounds = { minX: r5(cx - w / 2), maxX: r5(cx + w / 2), minY: r5(cy - h / 2), maxY: r5(cy + h / 2) };
  }
}

/** Put a freshly built drawing `nw` into `ex`: replace everything (target null), add a layer (NEW) or overwrite one. */
export async function applyDrawing(ex: any, nw: any, target: string | null): Promise<any> {
  if (target == null || !layersOf(ex).length || !layersOf(nw).length) return structuredClone(nw);
  const exL = layersOf(ex);
  const idx = target === NEW ? -1 : exL.findIndex((l) => l.id === target);
  if (target !== NEW && idx < 0) throw new OpError("That layer no longer exists.");
  if (idx >= 0 && exL.length === 1) {
    const out = structuredClone(nw), keep = exL[0], fresh = layersOf(out)[0];
    for (const k of ["title", "id", "isVisible"]) if (k in keep) fresh[k] = keep[k];
    rehash(out);
    return out;
  }
  const out = structuredClone(ex), dd = out.drawData, src = structuredClone(layersOf(nw)[0]);
  const ppu = +dd.fillPixelsPerUnit || +nw.drawData.fillPixelsPerUnit || 1, ppuN = +nw.drawData.fillPixelsPerUnit || ppu;
  if (src.isBitmap && Math.abs(ppu - ppuN) > 1e-6) await rescaleFrames(src.frames, ppu / ppuN);
  const oldN = frameCount(ex), newN = src.frames.length, total = Math.max(oldN, newN);
  const frames = src.frames.concat(Array.from({ length: total - newN }, blankFrame));
  const layers = dd.layers;
  let pos: number;
  if (idx < 0) {
    let n = (+dd.numTotalLayers || layers.length) + 1;
    const taken = new Set(layers.map((l: any) => l.id));
    while (taken.has("layer" + n)) n++;
    layers.push({ title: "Layer " + n, id: "layer" + n, isVisible: true, isBitmap: !!src.isBitmap, isAvatar: false, frames });
    dd.numTotalLayers = n;
    pos = layers.length - 1;
  } else {
    layers[idx] = { ...layers[idx], isBitmap: !!src.isBitmap, isAvatar: false, frames };
    pos = idx;
  }
  layers.forEach((l: any, i: number) => {
    if (i !== pos) { const f = l.frames || []; l.frames = f.concat(Array.from({ length: total - f.length }, blankFrame)); }
  });
  const bounds = [...(dd.framesBounds || [])];
  while (bounds.length < total) bounds.push({ minX: -5, maxX: 5, minY: -5, maxY: 5 });
  frames.forEach((fr: any, i: number) => { const ub = unitBounds(fr, ppu); if (ub) bounds[i] = union(bounds[i], ub); });
  dd.framesBounds = bounds;
  if (newN > oldN && oldN <= 1) for (const k of ["framesPerSecond", "playMode", "loop"]) if (k in nw) out[k] = nw[k];
  rehash(out);
  return out;
}

// ── preview rendering ──────────────────────────────────────────────────
function arcPts([x1, y1]: number[], [xb, yb]: number[], [x2, y2]: number[]): number[][] {
  const d = 2 * (x1 * (yb - y2) + xb * (y2 - y1) + x2 * (y1 - yb)), ch = Math.hypot(x2 - x1, y2 - y1);
  if (ch < 1e-9 || Math.abs(d) < 1e-7 * Math.max(1, ch * ch)) return [[x1, y1], [x2, y2]];
  const s1 = x1 * x1 + y1 * y1, s2 = xb * xb + yb * yb, s3 = x2 * x2 + y2 * y2;
  const ux = (s1 * (yb - y2) + s2 * (y2 - y1) + s3 * (y1 - yb)) / d, uy = (s1 * (x2 - xb) + s2 * (x1 - x2) + s3 * (xb - x1)) / d;
  const r = Math.hypot(x1 - ux, y1 - uy), a1 = Math.atan2(y1 - uy, x1 - ux), ab = Math.atan2(yb - uy, xb - ux), a2 = Math.atan2(y2 - uy, x2 - ux);
  const T = 2 * Math.PI, m = (a: number, b: number) => (((a - b) % T) + T) % T;
  const cb = m(ab, a1), c2 = m(a2, a1), sw = cb <= c2 ? c2 : -m(a1, a2);
  const n = Math.max(6, Math.min(96, Math.floor((Math.abs(sw) * r) / 0.15) + 2)), pts: number[][] = [];
  for (let i = 0; i <= n; i++) pts.push([ux + r * Math.cos(a1 + (sw * i) / n), uy + r * Math.sin(a1 + (sw * i) / n)]);
  pts[0] = [x1, y1]; pts[n] = [x2, y2];
  return pts;
}
const segPts = (s: any): number[][] => {
  const p = s.p || [];
  if (p.length < 4) return [];
  return s.bp && "x" in s.bp ? arcPts([p[0], p[1]], [s.bp.x, s.bp.y], [p[2], p[3]]) : [[p[0], p[1]], [p[2], p[3]]];
};
function frameItems(d2: any, i: number) {
  const out: any[] = [];
  for (const l of layersOf(d2)) {
    if (l.isVisible === false) continue;
    const fs = l.frames || [];
    if (i >= 0 && i < fs.length) { let j = i; while (j > 0 && fs[j]?.isLinked) j--; out.push(fs[j]); }
  }
  return out;
}
export function sceneBounds(d2: any, idxs: number[]): number[] | null {
  const ppu = +d2.drawData.fillPixelsPerUnit || 1, xs: number[] = [], ys: number[] = [];
  for (const i of idxs) for (const fr of frameItems(d2, i)) {
    if (fr.fillPng) { const b = fr.fillImageBounds || {}; xs.push((b.minX || 0) / ppu, (b.maxX || 0) / ppu); ys.push((b.minY || 0) / ppu, (b.maxY || 0) / ppu); }
    for (const s of fr.pathDataList || []) for (const [a, b] of segPts(s)) { xs.push(a - 0.14, a + 0.14); ys.push(b - 0.14, b + 0.14); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}

/** Draw frame `i` of a Drawing2 onto a square canvas (transparent background). */
export async function drawFrame(cv: HTMLCanvasElement, d2: any, i: number, bd: number[] | null) {
  const x = cv.getContext("2d")!, Z = cv.width;
  x.clearRect(0, 0, Z, Z);
  if (!bd) return;
  const [mnx, mny, mxx, mxy] = bd, w = Math.max(mxx - mnx, 1e-6), h = Math.max(mxy - mny, 1e-6);
  const k = (Z * 0.88) / Math.max(w, h), ox = (Z - w * k) / 2 - mnx * k, oy = (Z - h * k) / 2 - mny * k, ppu = +d2.drawData.fillPixelsPerUnit || 1;
  for (const fr of frameItems(d2, i)) {
    if (fr.fillPng) {
      const im = await loadPng(fr.fillPng), b = fr.fillImageBounds || {};
      if (im) {
        const x0 = ((b.minX || 0) / ppu) * k + ox, y0 = ((b.minY || 0) / ppu) * k + oy, x1 = ((b.maxX || 0) / ppu) * k + ox, y1 = ((b.maxY || 0) / ppu) * k + oy;
        x.imageSmoothingEnabled = x1 - x0 < im.width;
        x.drawImage(im, x0, y0, x1 - x0, y1 - y0);
      }
    }
    x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = Math.max(1, 0.28 * k);
    for (const s of fr.pathDataList || []) {
      const p = segPts(s);
      if (p.length < 2) continue;
      const c = s.c || [0, 0, 0, 1];
      x.strokeStyle = `rgba(${c.slice(0, 3).map((v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${c[3] ?? 1})`;
      x.beginPath();
      p.forEach(([a, b], j) => (j ? x.lineTo(a * k + ox, b * k + oy) : x.moveTo(a * k + ox, b * k + oy)));
      x.stroke();
    }
  }
}

/** Small preview icon (first frame) as a data URL; cached by the drawing's hash. */
const ICONS = new Map<string, string>();
export async function iconUrl(d2: any, size = 128): Promise<string | null> {
  if (!d2 || !frameCount(d2)) return null;
  const key = `${size}:${d2.hash}:${frameCount(d2)}`;
  const hit = ICONS.get(key);
  if (hit) return hit;
  const cv = makeCanvas(size, size);
  const first = Math.max(0, Math.min(frameCount(d2) - 1, (+d2.initialFrame || 1) - 1));
  await drawFrame(cv, d2, first, sceneBounds(d2, [first]));
  const url = cv.toDataURL("image/png");
  if (ICONS.size > 500) ICONS.clear();
  ICONS.set(key, url);
  return url;
}
export function drawingInfo(d2: any) {
  return { frames: frameCount(d2), fps: d2.framesPerSecond || 4, playMode: d2.playMode || "still" };
}
