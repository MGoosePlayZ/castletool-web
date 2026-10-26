// Images, animations, video frames, color quantizing (the Pillow/ffmpeg half of CTA, done with browser APIs).
import { canvasPng, makeCanvas } from "./drawing";
import { Prog, NOOP, tick } from "./tasks";
import { OpError } from "./drawing";
import { GifReader } from "./gif";

export const IMAGE_EXTS = new Set([".png", ".apng", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".ico", ".heic", ".heif", ".gif", ".webp"]);
export const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".flv", ".m4v", ".3gp", ".ogv"]);
export const VECTOR_EXTS = new Set([".svg"]);
export const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".flac", ".aac"]);
export const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".eot"]);
export const ARCHIVE_SUFFIXES = [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz"];

export const extOf = (n: string) => { const i = n.lastIndexOf("."); return i < 0 ? "" : n.slice(i).toLowerCase(); };
export const stemOf = (n: string) => { const i = n.lastIndexOf("."); return i <= 0 ? n : n.slice(0, i); };
export const isArchive = (n: string) => ARCHIVE_SUFFIXES.some((s) => n.toLowerCase().endsWith(s));

export type Cat = "image" | "animation" | "video" | "vector" | "audio" | "font";
export const CATEGORY_LABELS: Record<Cat, string> = { image: "image", animation: "animated image", video: "video", vector: "vector graphic", audio: "audio", font: "font" };
export const ACTION_FOR: Record<Cat, string> = { image: "Add image", animation: "Add image", video: "Add image", vector: "Add image", audio: "Add audio", font: "Add Font" };

const MIME: Record<string, string> = { ".png": "image/png", ".apng": "image/apng", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".tif": "image/tiff", ".tiff": "image/tiff" };

export async function classifyFile(f: File): Promise<Cat | null> {
  const e = extOf(f.name);
  if (VIDEO_EXTS.has(e)) return "video";
  if (VECTOR_EXTS.has(e)) return "vector";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (FONT_EXTS.has(e)) return "font";
  if (IMAGE_EXTS.has(e)) {
    if ([".png", ".apng", ".gif", ".webp"].includes(e)) { try { if ((await animatedCount(f)) > 1) return "animation"; } catch { /* still image */ } }
    return "image";
  }
  return null;
}

// ── decoding ───────────────────────────────────────────────────────────
declare const ImageDecoder: any;
const hasImageDecoder = typeof (globalThis as any).ImageDecoder !== "undefined";

async function animatedCount(f: File): Promise<number> {
  const e = extOf(f.name);
  if (hasImageDecoder) {
    try {
      const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: MIME[e] || "image/png" });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      dec.close?.();
      return n;
    } catch { /* fall through */ }
  }
  if (e === ".gif") return new GifReader(new Uint8Array(await f.arrayBuffer())).frameCount();
  return 1;
}

export interface IcoSize { w: number; h: number; offset: number; bytes: number }
export async function icoSizes(f: Blob): Promise<IcoSize[]> {
  const v = new DataView(await f.arrayBuffer());
  if (v.byteLength < 6 || v.getUint16(2, true) !== 1) throw new Error("not an icon");
  const n = v.getUint16(4, true), out: IcoSize[] = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    out.push({ w: v.getUint8(o) || 256, h: v.getUint8(o + 1) || 256, bytes: v.getUint32(o + 8, true), offset: v.getUint32(o + 12, true) });
  }
  return out.sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w);
}
async function icoBitmap(f: Blob, size: IcoSize): Promise<ImageBitmap> {
  const buf = new Uint8Array(await f.arrayBuffer()), data = buf.subarray(size.offset, size.offset + size.bytes);
  const head = new Uint8Array(22);
  const hv = new DataView(head.buffer);
  hv.setUint16(2, 1, true); hv.setUint16(4, 1, true);
  head[6] = size.w === 256 ? 0 : size.w; head[7] = size.h === 256 ? 0 : size.h;
  hv.setUint32(14, data.length, true); hv.setUint32(18, 22, true);
  const one = new Uint8Array(22 + data.length);
  one.set(head); one.set(data, 22);
  return createImageBitmap(new Blob([one], { type: "image/x-icon" }));
}

async function bitmapOf(f: File, ico?: IcoSize): Promise<ImageBitmap> {
  const e = extOf(f.name);
  if (e === ".heic" || e === ".heif") {
    try { return await createImageBitmap(f); } catch { throw new OpError("This browser can't read HEIC/HEIF pictures."); }
  }
  if (e === ".ico" && ico) return icoBitmap(f, ico);
  try { return await createImageBitmap(f); }
  catch {
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Couldn't read ${f.name}.`)); i.src = url; });
      return await createImageBitmap(img);
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function nativeSize(f: File, cat: Cat, ico?: IcoSize): Promise<[number, number]> {
  if (cat === "video") { const v = await openVideo(f); const r: [number, number] = [v.videoWidth, v.videoHeight]; releaseVideo(v); return r; }
  if (ico) return [ico.w, ico.h];
  const b = await bitmapOf(f);
  const r: [number, number] = [b.width, b.height];
  b.close();
  return r;
}
export const scaledSize = (n: [number, number], s: number): [number, number] => [Math.max(1, Math.round(n[0] * s)), Math.max(1, Math.round(n[1] * s))];

function resizeTo(src: CanvasImageSource, w: number, h: number, smooth: boolean) {
  const cv = makeCanvas(w, h), x = cv.getContext("2d")!;
  x.imageSmoothingEnabled = smooth;
  if (smooth) x.imageSmoothingQuality = "medium";
  x.drawImage(src, 0, 0, w, h);
  return cv;
}

/** Every frame of an image/animation as base64 PNG, resized to w×h. `smooth` = bilinear; off = crisp nearest-neighbour. */
export async function loadImageFrames(f: File, w: number, h: number, ico?: IcoSize, smooth = false, prog: Prog = NOOP): Promise<{ frames: string[]; fps: number }> {
  const e = extOf(f.name);
  if (!ico && [".png", ".apng", ".gif", ".webp"].includes(e)) {
    const got = await animatedFrames(f, w, h, smooth, prog);
    if (got) return got;
  }
  const bm = await bitmapOf(f, ico);
  try { return { frames: [await canvasPng(resizeTo(bm, w, h, smooth))], fps: 1 }; } finally { bm.close(); }
}

async function animatedFrames(f: File, w: number, h: number, smooth: boolean, prog: Prog): Promise<{ frames: string[]; fps: number } | null> {
  const e = extOf(f.name), frames: string[] = [], durs: number[] = [];
  if (hasImageDecoder) {
    try {
      const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: MIME[e] || "image/png" });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      if (n <= 1) { dec.close?.(); return null; }
      for (let i = 0; i < n; i++) {
        prog.step(i, n, `Processing frame ${i + 1}/${n}`);
        const { image } = await dec.decode({ frameIndex: i });
        durs.push(Math.max((image.duration || 100000) / 1000, 1));
        frames.push(await canvasPng(resizeTo(image, w, h, smooth)));
        image.close();
        await tick();
      }
      dec.close?.();
      return { frames, fps: Math.round((1000 / (durs.reduce((a, b) => a + b, 0) / durs.length)) * 100) / 100 };
    } catch (err) { if (frames.length) throw err; }
  }
  if (e === ".gif") {
    const g = new GifReader(new Uint8Array(await f.arrayBuffer()));
    if (g.frameCount() <= 1) return null;
    const total = g.frameCount();
    let i = 0;
    for await (const fr of g.compose()) {
      prog.step(i, total, `Processing frame ${i + 1}/${total}`);
      frames.push(await canvasPng(resizeTo(fr.canvas, w, h, smooth)));
      durs.push(Math.max(fr.delay, 1));
      i++;
      await tick();
    }
    return { frames, fps: Math.round((1000 / (durs.reduce((a, b) => a + b, 0) / durs.length)) * 100) / 100 };
  }
  return null;
}

// ── video ──────────────────────────────────────────────────────────────
export async function openVideo(f: Blob): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.playsInline = true;
  (v as any)._url = URL.createObjectURL(f);
  v.src = (v as any)._url;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new OpError("This browser can't read that video.")); });
  return v;
}
export const releaseVideo = (v: HTMLVideoElement) => { try { URL.revokeObjectURL((v as any)._url); } catch { /* ignore */ } v.removeAttribute("src"); v.load(); };

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
async function detectFps(v: HTMLVideoElement): Promise<number> {
  const rvfc = (v as any).requestVideoFrameCallback?.bind(v);
  if (!rvfc) return 30;
  const times: number[] = [];
  v.currentTime = 0;
  await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 500); });
  const done = new Promise<void>((res) => {
    const cb = (_: number, meta: any) => { times.push(meta.mediaTime); if (times.length >= 12 || v.ended) res(); else rvfc(cb); };
    rvfc(cb);
    setTimeout(res, 1500);
  });
  try { await v.play(); } catch { return 30; }
  await done;
  v.pause();
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (!d.length) return 30;
  d.sort((a, b) => a - b);
  const fps = 1 / d[Math.floor(d.length / 2)];
  const near = COMMON_FPS.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
  return Math.abs(near - fps) / near < 0.06 ? near : Math.round(fps * 100) / 100;
}

export async function extractVideoFrames(f: File, w: number, h: number, every = 1, smooth = false, prog: Prog = NOOP): Promise<{ frames: string[]; fps: number }> {
  const v = await openVideo(f);
  try {
    const fps = await detectFps(v), dur = v.duration, total = Math.max(1, Math.floor(dur * fps)), picks: number[] = [];
    for (let i = 0; i < total; i += every) picks.push(i);
    const frames: string[] = [];
    const cv = makeCanvas(w, h), x = cv.getContext("2d")!;
    x.imageSmoothingEnabled = smooth;
    for (let k = 0; k < picks.length; k++) {
      prog.step(k, picks.length, `Extracting frame ${k + 1}/${picks.length}`);
      const t = Math.min(dur - 0.001, (picks[k] + 0.5) / fps);
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.max(0, t); });
      x.clearRect(0, 0, w, h);
      x.drawImage(v, 0, 0, w, h);
      frames.push(await canvasPng(cv));
    }
    if (!frames.length) throw new OpError("No frames came out of that video. Is it a valid video?");
    return { frames, fps: fps / every };
  } finally { releaseVideo(v); }
}

// ── quantize (median cut, like PIL's default) ──────────────────────────
export async function quantizeFrame(b64: string, colors: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + b64; });
  const cv = makeCanvas(img.width, img.height), x = cv.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, cv.width, cv.height), d = id.data;
  const counts = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  if (counts.size <= colors) return b64;
  type Box = { cols: number[]; n: number };
  let boxes: Box[] = [{ cols: [...counts.keys()], n: img.width * img.height }];
  const range = (b: Box) => {
    let mn = [255, 255, 255], mx = [0, 0, 0];
    for (const k of b.cols) for (let c = 0; c < 3; c++) { const v = (k >> (16 - 8 * c)) & 255; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
    return mx.map((m, c) => m - mn[c]);
  };
  while (boxes.length < colors) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, i) => { if (b.cols.length < 2) return; const r = range(b), m = Math.max(...r); if (m > best) { best = m; bi = i; ch = r.indexOf(m); } });
    if (bi < 0) break;
    const b = boxes[bi], shift = 16 - 8 * ch;
    b.cols.sort((p, q) => ((p >> shift) & 255) - ((q >> shift) & 255));
    let acc = 0, cut = 0;
    for (; cut < b.cols.length - 1; cut++) { acc += counts.get(b.cols[cut])!; if (acc >= b.n / 2) { cut++; break; } }
    cut = Math.max(1, Math.min(b.cols.length - 1, cut));
    const a = b.cols.slice(0, cut), c = b.cols.slice(cut), na = a.reduce((s, k) => s + counts.get(k)!, 0);
    boxes.splice(bi, 1, { cols: a, n: na }, { cols: c, n: b.n - na });
  }
  const map = new Map<number, number>();
  for (const b of boxes) {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const k of b.cols) { const c = counts.get(k)!; r += ((k >> 16) & 255) * c; g += ((k >> 8) & 255) * c; bl += (k & 255) * c; n += c; }
    const p = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n);
    for (const k of b.cols) map.set(k, p);
  }
  for (let i = 0; i < d.length; i += 4) { const p = map.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])!; d[i] = p >> 16; d[i + 1] = (p >> 8) & 255; d[i + 2] = p & 255; }
  x.putImageData(id, 0, 0);
  return canvasPng(cv);
}
export async function quantizeFrames(frames: string[], colors: number, prog: Prog = NOOP): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < frames.length; i++) { prog.step(i, frames.length, `Reducing colors ${i + 1}/${frames.length}`); out.push(await quantizeFrame(frames[i], colors)); await tick(); }
  return out;
}

/** build_drawing2: bitmap frames → Drawing2 component */
export function buildDrawing2(frames: string[], fps: number, width: number, height: number, playMode = "loop", sizes?: [number, number][] | null, scale?: number | null) {
  const sc = scale ?? Math.max(1, Math.round(Math.max(width, height) / 20));
  const bnd = (w: number, h: number) => ({ minX: -w / 2, maxX: w / 2, minY: -h / 2, maxY: h / 2 });
  const fb = sizes ? sizes.map(([w, h]) => bnd(w, h)) : frames.map(() => bnd(width, height));
  const cf = frames.map((p, i) => ({ isLinked: false, pathDataList: [], fillImageBounds: fb[i], fillPng: p, avatarX: 0, avatarY: 0, avatarRadius: 5 }));
  let hs = 0;
  for (let i = 0; i < Math.min(frames[0].length, 4000); i++) hs = (hs * 31 + frames[0].charCodeAt(i)) | 0;
  return {
    initialFrame: 1, currentFrame: 1, framesPerSecond: fps, playMode, loopStartFrame: -1, loopEndFrame: -1, opacity: 1,
    hash: String(Math.abs(hs)) + frames.length, playing: false, loop: playMode !== "still",
    drawData: {
      color: [1, 1, 1, 1], lineColor: [0, 0, 0, 1], gridSize: 0.71428, scale: sc, version: 3, fillPixelsPerUnit: sc, numTotalLayers: 1,
      framesBounds: fb, colors: [], selectedFrame: 1,
      layers: [{ title: "Layer 1", id: "layer1", isVisible: true, isBitmap: true, isAvatar: false, frames: cf }],
    },
    physicsBodyData: {
      shapes: [{ p1: { x: width / 2 / sc, y: height / 2 / sc }, p2: { x: -width / 2 / sc, y: -height / 2 / sc }, p3: { x: 0, y: 0 }, radius: 0, x: 0, y: 0, type: "rectangle" }],
      scale: sc, version: 2, zeroShapesInV1: false,
    },
    disabled: false,
  };
}

// ── single-frame access (import preview) ───────────────────────────────
export { detectFps };
export async function framesIn(f: File, cat: Cat): Promise<number> {
  try {
    if (cat === "video") { const v = await openVideo(f); try { const fps = await detectFps(v); return Math.max(1, Math.floor(v.duration * fps)); } finally { releaseVideo(v); } }
    if (cat === "animation") return Math.max(1, await animatedCount(f));
  } catch { /* unreadable: treat as one */ }
  return 1;
}
/** Decode ONLY frame `index` (after keeping every Nth), scaled to w×h. */
export async function oneFramePng(f: File, cat: Cat, w: number, h: number, index: number, every: number, smooth: boolean, ico?: IcoSize): Promise<string> {
  if (cat === "video") {
    const v = await openVideo(f);
    try {
      const fps = await detectFps(v), t = Math.min(v.duration - 0.001, (index * every + 0.5) / fps);
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.max(0, t); });
      return await canvasPng(resizeTo(v, w, h, smooth));
    } finally { releaseVideo(v); }
  }
  if (cat === "animation") {
    const e = extOf(f.name);
    if (hasImageDecoder) {
      const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: MIME[e] || "image/png" });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      const { image } = await dec.decode({ frameIndex: Math.min(index * every, n - 1) });
      const p = await canvasPng(resizeTo(image, w, h, smooth));
      image.close(); dec.close?.();
      return p;
    }
    if (e === ".gif") {
      const g = new GifReader(new Uint8Array(await f.arrayBuffer()));
      let i = 0;
      for await (const fr of g.compose()) { if (i === index * every || i === g.frameCount() - 1) return canvasPng(resizeTo(fr.canvas, w, h, smooth)); i++; }
    }
  }
  const bm = await bitmapOf(f, ico);
  try { return await canvasPng(resizeTo(bm, w, h, smooth)); } finally { bm.close(); }
}
export async function probeHasAudio(f: File): Promise<boolean> {
  const v = await openVideo(f);
  try {
    const a: any = v;
    if (a.audioTracks && typeof a.audioTracks.length === "number") return a.audioTracks.length > 0;
    if (typeof a.mozHasAudio === "boolean") return a.mozHasAudio;
    if (typeof a.webkitAudioDecodedByteCount === "number") {
      v.currentTime = 0;
      try { await v.play(); } catch { return true; }
      await new Promise((r) => setTimeout(r, 450));
      v.pause();
      return a.webkitAudioDecodedByteCount > 0;
    }
    return true;
  } catch { return false; } finally { releaseVideo(v); }
}
export { resizeTo, bitmapOf };
