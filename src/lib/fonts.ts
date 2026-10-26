// Fonts → Drawing2 (one frame per glyph), via opentype.js (port of CTA's font import).
import * as opentype from "opentype.js";
import { canvasPng, makeCanvas, r5, OpError } from "./drawing";
import { pathToPolylines } from "./svg";
import { Prog, NOOP, tick } from "./tasks";
import { extOf } from "./imaging";

export const FONT_CHARSETS: Record<string, () => number[]> = {
  "Standard (0-255, no control chars)": () => { const a: number[] = []; for (let c = 0; c < 256; c++) if (!(c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f))) a.push(c); return a; },
  ASCII: () => range(0x20, 0x7f),
  Alphanumeric: () => [...range(0x30, 0x3a), ...range(0x41, 0x5b), ...range(0x61, 0x7b)],
  Numeric: () => range(0x30, 0x3a),
  "Currency Symbols": () => range(0x20a0, 0x20d0),
  "Greek Characters": () => range(0x391, 0x3ca),
  "Fraction Symbols": () => range(0x2150, 0x2160),
  Arrows: () => range(0x2190, 0x2200),
  "Mathematical Operators": () => range(0x2200, 0x2300),
  "Miscellaneous Technical": () => range(0x2300, 0x2400),
  "Box Drawing": () => range(0x2500, 0x2580),
  "Block Elements": () => range(0x2580, 0x25a0),
  Dingbats: () => range(0x2700, 0x27c0),
  "Braille Patterns": () => range(0x2800, 0x2900),
  "Musical Symbols": () => range(0x1d100, 0x1d200),
};
function range(a: number, b: number) { const o: number[] = []; for (let i = a; i < b; i++) o.push(i); return o; }
export const charsetNames = () => Object.keys(FONT_CHARSETS);

// ── character spec ("abc U+1F600") ─────────────────────────────────────
export function parseCharspec(text: string) {
  const words = text.split(/\s+/).filter(Boolean), tokens: { word: string; kind: string; cps: number[] | null }[] = [], seen = new Map<number, number>();
  for (const word of words) {
    if (word.toLowerCase().includes("u+")) {
      const m = word.match(/^[Uu]\+([0-9A-Fa-f]+)$/);
      if (m) { const cp = parseInt(m[1], 16); tokens.push({ word, kind: "codepoint", cps: [cp] }); seen.set(cp, (seen.get(cp) || 0) + 1); }
      else tokens.push({ word, kind: "malformed", cps: null });
    } else {
      const cps = [...word].map((c) => c.codePointAt(0)!);
      tokens.push({ word, kind: "chars", cps });
      cps.forEach((cp) => seen.set(cp, (seen.get(cp) || 0) + 1));
    }
  }
  const valid = words.length > 0 && !tokens.some((t) => t.kind === "malformed") && ![...seen.values()].some((c) => c > 1);
  return { tokens, seen, valid };
}
export const charspecCodepoints = (text: string) => [...parseCharspec(text).seen.keys()].sort((a, b) => a - b);
export function charspecParts(text: string): [string, "blue" | "red" | null][] {
  const { tokens, seen } = parseCharspec(text), out: [string, "blue" | "red" | null][] = [];
  tokens.forEach((t, i) => {
    if (i > 0) out.push([" ", null]);
    if (t.kind === "malformed") out.push([t.word, "red"]);
    else if (t.kind === "codepoint") out.push([t.word, seen.get(t.cps![0])! > 1 ? "red" : "blue"]);
    else [...t.word].forEach((ch) => out.push([ch, seen.get(ch.codePointAt(0)!)! > 1 ? "red" : "blue"]));
  });
  return out;
}
export function fontCodepoints(opts: { charsets?: string[]; custom?: string }): number[] {
  const cps = new Set<number>();
  for (const n of opts.charsets || []) { if (!FONT_CHARSETS[n]) throw new OpError(`Unknown character set: ${n}`); FONT_CHARSETS[n]().forEach((c) => cps.add(c)); }
  const custom = (opts.custom || "").trim();
  if (custom) {
    if (!parseCharspec(custom).valid) throw new OpError("Characters/codepoints are duplicated or malformed.");
    charspecCodepoints(custom).forEach((c) => cps.add(c));
  }
  return [...cps].sort((a, b) => a - b);
}

// ── loading ────────────────────────────────────────────────────────────
function eotToSfnt(raw: Uint8Array): Uint8Array {
  if (raw.length < 82) throw new Error("file is too small to be an EOT font");
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), eotSize = v.getUint32(0, true), fontSize = v.getUint32(4, true), flags = v.getUint32(12, true);
  if (flags & 0x4) throw new Error("this EOT uses MTX compression, which isn't supported (convert it to TTF or WOFF first)");
  const end = eotSize > 0 && eotSize <= raw.length ? eotSize : raw.length;
  if (fontSize <= 0 || fontSize > end) throw new Error("EOT header is corrupt");
  const data = raw.slice(end - fontSize, end);
  if (flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  return data;
}
export interface LoadedFont { font: opentype.Font; bytes: ArrayBuffer; file: File; name: string }
export async function loadFont(file: File): Promise<LoadedFont> {
  let bytes: ArrayBuffer = await file.arrayBuffer();
  if (extOf(file.name) === ".eot") bytes = eotToSfnt(new Uint8Array(bytes)).buffer as ArrayBuffer;
  const font = opentype.parse(bytes);
  return { font, bytes, file, name: file.name };
}
export const fontHasGlyph = (f: opentype.Font, cp: number) => { const g = f.charToGlyph(String.fromCodePoint(cp)); return !!g && g.index > 0; };

function glyphD(g: any): string {
  const out: string[] = [];
  for (const c of g.path.commands) {
    if (c.type === "M") out.push(`M${c.x} ${c.y}`);
    else if (c.type === "L") out.push(`L${c.x} ${c.y}`);
    else if (c.type === "Q") out.push(`Q${c.x1} ${c.y1} ${c.x} ${c.y}`);
    else if (c.type === "C") out.push(`C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}`);
    else if (c.type === "Z") out.push("Z");
  }
  return out.join(" ");
}

export function glyphToPathData(d: string, steps: number, ppu: number, scale: number, color: number[]) {
  const polylines = pathToPolylines(d, steps), pathData: any[] = [], xs: number[] = [], ys: number[] = [];
  for (const poly of polylines) {
    if (poly.length < 2) continue;
    const pts = poly.map(([x, y]) => [(x / ppu) * scale, (-y / ppu) * scale]);
    for (let j = 0; j < pts.length - 1; j++) {
      const [x1, y1] = pts[j], [x2, y2] = pts[j + 1];
      pathData.push({ p: [r5(x1), r5(y1), r5(x2), r5(y2)], s: 1, f: false, c: color.map(r5) });
      xs.push(x1, x2); ys.push(y1, y2);
    }
  }
  const bounds = xs.length ? { minX: r5(Math.min(...xs)), maxX: r5(Math.max(...xs)), minY: r5(Math.min(...ys)), maxY: r5(Math.max(...ys)) } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { pathData, bounds };
}

export function fontDrawing(frames: { cp: number; pathData: any[]; bounds: any }[], ppu: number, scale = 10) {
  const fb = frames.map((f) => f.bounds);
  const cf = frames.map((f) => ({ isLinked: false, pathDataList: f.pathData, fillImageBounds: f.bounds, avatarX: 0, avatarY: 0, avatarRadius: 5 }));
  const ov = {
    minX: Math.min(...fb.map((b) => b.minX), -5 + 0 * 1), maxX: Math.max(...fb.map((b) => b.maxX)), minY: Math.min(...fb.map((b) => b.minY)), maxY: Math.max(...fb.map((b) => b.maxY)),
  };
  const ovl = { minX: Math.min(...fb.map((b) => b.minX)), maxX: ov.maxX, minY: ov.minY, maxY: ov.maxY };
  const src = JSON.stringify(frames.map((f) => [f.cp, f.pathData.length]));
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  return {
    initialFrame: 1, currentFrame: 1, framesPerSecond: 4, playMode: "still", loopStartFrame: -1, loopEndFrame: -1, opacity: 1,
    hash: String(Math.abs(h)) + frames.length, playing: false, loop: false,
    drawData: {
      color: [1, 1, 1, 1], lineColor: [0, 0, 0, 1], gridSize: 0.71428, scale, version: 3, fillPixelsPerUnit: ppu, numTotalLayers: 1,
      framesBounds: fb, colors: [], selectedFrame: 1,
      layers: [{ title: "Layer 1", id: "layer1", isVisible: true, isBitmap: false, isAvatar: false, frames: cf }],
    },
    physicsBodyData: {
      shapes: [{ p1: { x: ovl.maxX, y: ovl.maxY }, p2: { x: ovl.minX, y: ovl.minY }, p3: { x: 0, y: 0 }, radius: 0, x: 0, y: 0, type: "rectangle" }],
      scale, version: 2, zeroShapesInV1: false,
    },
    disabled: false,
  };
}

export function vectorFontFrames(lf: LoadedFont, cps: number[], steps: number, scale: number, color: number[], prog: Prog = NOOP) {
  const ppu = lf.font.unitsPerEm / 10, frames: { cp: number; pathData: any[]; bounds: any }[] = [];
  let missing = 0;
  cps.forEach((cp, i) => {
    prog.step(i, cps.length, `Rendering glyph ${i + 1}/${cps.length}`);
    if (!fontHasGlyph(lf.font, cp)) { missing++; return; }
    const g = lf.font.charToGlyph(String.fromCodePoint(cp)), { pathData, bounds } = glyphToPathData(glyphD(g), steps, ppu, scale, color);
    frames.push({ cp, pathData, bounds });
  });
  return { frames, missing, ppu };
}

let faceN = 0;
/** Filled bitmap glyphs on one shared canvas / pen origin. */
export async function renderFontBitmap(lf: LoadedFont, cps: number[], px: number, smooth: boolean, color: number[], prog: Prog = NOOP) {
  const present = cps.filter((cp) => fontHasGlyph(lf.font, cp)), missing = cps.length - present.length;
  if (!present.length) return { frames: [] as string[], w: 0, h: 0, missing };
  const family = "ctwfont" + faceN++, face = new FontFace(family, lf.bytes.slice(0));
  await face.load();
  (document.fonts as any).add(face);
  try {
    const m = makeCanvas(8, 8).getContext("2d")!;
    m.font = `${px}px "${family}"`; m.textBaseline = "alphabetic";
    const boxes = present.map((cp) => { const t = m.measureText(String.fromCodePoint(cp)); return [Math.floor(-t.actualBoundingBoxLeft), Math.floor(-t.actualBoundingBoxAscent), Math.ceil(t.actualBoundingBoxRight), Math.ceil(t.actualBoundingBoxDescent)]; });
    const pad = 1, minX = Math.min(...boxes.map((b) => b[0])), minY = Math.min(...boxes.map((b) => b[1])), maxX = Math.max(...boxes.map((b) => b[2])), maxY = Math.max(...boxes.map((b) => b[3]));
    const w = Math.max(1, maxX - minX + 2 * pad), h = Math.max(1, maxY - minY + 2 * pad), ox = pad - minX, oy = pad - minY;
    const rgb = color.slice(0, 3).map((c) => Math.round(c * 255)), alpha = color[3] ?? 1, frames: string[] = [];
    for (let i = 0; i < present.length; i++) {
      prog.step(i, present.length, `Rendering glyph ${i + 1}/${present.length}`);
      const cv = makeCanvas(w, h), x = cv.getContext("2d", { willReadFrequently: true })!;
      x.font = `${px}px "${family}"`; x.textBaseline = "alphabetic"; x.fillStyle = "#fff";
      x.fillText(String.fromCodePoint(present[i]), ox, oy);
      const id = x.getImageData(0, 0, w, h), d = id.data;
      for (let k = 0; k < d.length; k += 4) {
        let a = d[k + 3];
        if (!smooth) a = a >= 128 ? 255 : 0;
        d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = Math.round(a * alpha);
      }
      x.putImageData(id, 0, 0);
      frames.push(await canvasPng(cv));
      if (i % 20 === 19) await tick();
    }
    return { frames, w, h, missing };
  } finally { (document.fonts as any).delete(face); }
}
