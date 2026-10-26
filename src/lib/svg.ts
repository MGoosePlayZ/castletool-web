// SVG → Castle vector data / bitmap (port of CTA's svg_to_castle logic). Flattens every shape to straight segments.
import { r5, makeCanvas, canvasPng } from "./drawing";

export const SVG_PPU = 25.6;
type Pt = [number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const quad = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => [
  (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
  (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]];
void lerp;

function arcToLines(x1: number, y1: number, rx: number, ry: number, xRot: number, large: number, sweep: number, x2: number, y2: number, steps: number): Pt[] {
  if (x1 === x2 && y1 === y2) return [];
  if (rx === 0 || ry === 0) return [[x1, y1], [x2, y2]];
  const phi = (xRot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  let rx2 = rx * rx, ry2 = ry * ry;
  const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const lam = x1p2 / rx2 + y1p2 / ry2;
  if (lam > 1) { const sq = Math.sqrt(lam); rx *= sq; ry *= sq; rx2 = rx * rx; ry2 = ry * ry; }
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2), den = rx2 * y1p2 + ry2 * x1p2;
  let sq = den ? Math.sqrt(num / den) : 0;
  if (large === sweep) sq = -sq;
  const cxp = (sq * rx * y1p) / ry, cyp = (-sq * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (n === 0) return 0;
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = t1 + (i / steps) * dt;
    pts.push([cp * rx * Math.cos(th) - sp * ry * Math.sin(th) + cx, sp * rx * Math.cos(th) + cp * ry * Math.sin(th) + cy]);
  }
  return pts;
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
export const parseNumbers = (s: string) => (s.match(NUM) || []).map(Number);
const NPARAMS: Record<string, number> = { M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1, C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, A: 7, a: 7 };

export function pathToPolylines(d: string, steps = 16): Pt[][] {
  const tokens = d.match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const isCmd = (t: string) => /^[MmZzLlHhVvCcSsQqTtAa]$/.test(t);
  let cmd: string | null = null, pos: Pt = [0, 0], start: Pt = [0, 0], lastCtrl: Pt | null = null;
  const polylines: Pt[][] = [];
  let current: Pt[] = [];
  const flush = () => { if (current.length >= 2) polylines.push(current); current = []; };
  const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (isCmd(t)) {
      cmd = t; i++;
      if (cmd === "Z" || cmd === "z") { if (current.length && !same(current[current.length - 1], start)) current.push(start); flush(); pos = start; cmd = null; }
      continue;
    }
    if (cmd === "Z" || cmd === "z" || cmd === null) { i++; continue; }
    const n = NPARAMS[cmd] || 0;
    if (!n) { i++; continue; }
    const args: number[] = [];
    while (args.length < n && i < tokens.length) { if (isCmd(tokens[i])) break; args.push(parseFloat(tokens[i])); i++; }
    if (args.length < n) continue;
    const rel = cmd === cmd.toLowerCase(), base: Pt = rel ? pos : [0, 0], C = cmd.toUpperCase();
    if (C === "M") { flush(); pos = [base[0] + args[0], base[1] + args[1]]; start = pos; current = [pos]; lastCtrl = null; cmd = rel ? "l" : "L"; }
    else if (C === "L") { pos = [base[0] + args[0], base[1] + args[1]]; current.push(pos); lastCtrl = null; }
    else if (C === "H") { pos = [(rel ? pos[0] : 0) + args[0], pos[1]]; current.push(pos); lastCtrl = null; }
    else if (C === "V") { pos = [pos[0], (rel ? pos[1] : 0) + args[0]]; current.push(pos); lastCtrl = null; }
    else if (C === "C") {
      const p1: Pt = [base[0] + args[0], base[1] + args[1]], p2: Pt = [base[0] + args[2], base[1] + args[3]], p3: Pt = [base[0] + args[4], base[1] + args[5]];
      for (let s = 1; s <= steps; s++) current.push(cubic(pos, p1, p2, p3, s / steps));
      lastCtrl = p2; pos = p3;
    } else if (C === "S") {
      const p1: Pt = lastCtrl ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
      const p2: Pt = [base[0] + args[0], base[1] + args[1]], p3: Pt = [base[0] + args[2], base[1] + args[3]];
      for (let s = 1; s <= steps; s++) current.push(cubic(pos, p1, p2, p3, s / steps));
      lastCtrl = p2; pos = p3;
    } else if (C === "Q") {
      const p1: Pt = [base[0] + args[0], base[1] + args[1]], p2: Pt = [base[0] + args[2], base[1] + args[3]];
      for (let s = 1; s <= steps; s++) current.push(quad(pos, p1, p2, s / steps));
      lastCtrl = p1; pos = p2;
    } else if (C === "T") {
      const p1: Pt = lastCtrl ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
      const p2: Pt = [base[0] + args[0], base[1] + args[1]];
      for (let s = 1; s <= steps; s++) current.push(quad(pos, p1, p2, s / steps));
      lastCtrl = p1; pos = p2;
    } else if (C === "A") {
      const ex = base[0] + args[5], ey = base[1] + args[6];
      const pts = arcToLines(pos[0], pos[1], args[0], args[1], args[2], Math.trunc(args[3]), Math.trunc(args[4]), ex, ey, steps);
      if (pts.length) current.push(...pts.slice(1));
      lastCtrl = null; pos = [ex, ey];
    }
  }
  flush();
  return polylines;
}

// ── colors / styles ────────────────────────────────────────────────────
const NAMED: Record<string, number[] | null> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.502, 0], blue: [0, 0, 1], yellow: [1, 1, 0],
  cyan: [0, 1, 1], magenta: [1, 0, 1], gray: [0.502, 0.502, 0.502], grey: [0.502, 0.502, 0.502], none: null,
};
let probe: CanvasRenderingContext2D | null = null;
function cssColor(s: string): number[] | null {
  probe ||= makeCanvas(1, 1).getContext("2d", { willReadFrequently: true })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#010203";
  probe.fillStyle = s;
  if (probe.fillStyle === "#010203" && !/010203/.test(s)) return null;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}
export function parseColor(s: string, opacity = 1): number[] | null {
  if (!s || s === "none") return null;
  s = s.trim().toLowerCase();
  if (s in NAMED) { const c = NAMED[s]; return c ? [...c, opacity] : null; }
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    if ([r, g, b].some(Number.isNaN)) return [0, 0, 0, opacity];
    if (h.length === 8) opacity *= parseInt(h.slice(6, 8), 16) / 255;
    return [r, g, b, opacity];
  }
  const m = s.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, opacity];
  const c = cssColor(s);
  return c ? [...c, opacity] : [0, 0, 0, opacity];
}

export const UNSET = Symbol("unset");
const SHAPES = new Set(["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"]);
const HIDDEN = new Set(["defs", "clippath", "mask", "symbol", "pattern", "marker", "metadata", "title", "desc", "style", "script", "lineargradient", "radialgradient", "filter"]);
const STYLE_KEYS = ["fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "fill-rule", "color"];
type Style = Record<string, any>;

const tagOf = (el: Element) => (el.localName || el.tagName).replace(/^.*:/, "");
function styleOf(el: Element, inherited: Style): Style {
  const props: Record<string, string> = {};
  for (const k of [...STYLE_KEYS, "opacity", "display"]) { const v = el.getAttribute(k); if (v !== null) props[k] = v.trim(); }
  for (const decl of (el.getAttribute("style") || "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) props[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  const st: Style = { ...inherited };
  for (const k of STYLE_KEYS) if (k in props && props[k].toLowerCase() !== "inherit") st[k] = props[k];
  const op = parseFloat(props.opacity ?? "1");
  st._opacity = (inherited._opacity ?? 1) * (Number.isNaN(op) ? 1 : op);
  if ((props.display || "").toLowerCase() === "none") st._hidden = true;
  return st;
}
function* walk(el: Element, inherited: Style = { _opacity: 1 }, skipHidden = false): Generator<[Element, string, Style]> {
  const st = styleOf(el, inherited), t = tagOf(el);
  if (skipHidden && (HIDDEN.has(t.toLowerCase()) || st._hidden)) return;
  yield [el, t, st];
  for (const child of Array.from(el.children)) yield* walk(child, st, skipHidden);
}
function paint(st: Style, kind: "fill" | "stroke"): number[] | null | typeof UNSET {
  let raw = st[kind];
  if (raw === undefined) return UNSET;
  raw = String(raw).trim().toLowerCase();
  if (raw === "" || raw === "inherit" || raw.startsWith("url(")) return UNSET;
  if (raw === "none") return null;
  if (raw === "currentcolor") { raw = String(st.color || "").trim().toLowerCase(); if (!raw || raw === "currentcolor") return UNSET; }
  const op = parseFloat(st[kind + "-opacity"] ?? "1");
  return parseColor(raw, (Number.isNaN(op) ? 1 : op) * (st._opacity ?? 1));
}
const num = (s: string | null, d = 0) => { const m = (s || "").match(/^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/); return m ? parseFloat(m[1]) : d; };

function parseSvg(text: string): Element {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) throw new Error("That SVG can't be read.");
  return doc.documentElement;
}
export const parseSvgFile = async (f: File) => parseSvg(await f.text());

export function svgDims(root: Element): [number, number, number, number] {
  const vb = root.getAttribute("viewBox");
  if (vb) { const p = parseNumbers(vb); if (p.length === 4 && p[2] > 0 && p[3] > 0) return p as any; }
  const w = num(root.getAttribute("width"), 100), h = num(root.getAttribute("height"), 100);
  return [0, 0, w > 0 ? w : 100, h > 0 ? h : 100];
}

function elementPolylines(el: Element, t: string, steps: number): Pt[][] {
  const g = (k: string, d = 0) => num(el.getAttribute(k), d);
  if (t === "path") return pathToPolylines(el.getAttribute("d") || "", steps);
  if (t === "line") return [[[g("x1"), g("y1")], [g("x2"), g("y2")]]];
  if (t === "polyline" || t === "polygon") {
    const raw = parseNumbers(el.getAttribute("points") || ""), pts: Pt[] = [];
    for (let i = 0; i < raw.length - 1; i += 2) pts.push([raw[i], raw[i + 1]]);
    if (t === "polygon" && pts.length) pts.push(pts[0]);
    return [pts];
  }
  if (t === "rect") { const x = g("x"), y = g("y"), w = g("width"), h = g("height"); return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]; }
  if (t === "circle" || t === "ellipse") {
    const cx = g("cx"), cy = g("cy"), rx = t === "circle" ? g("r", 1) : g("rx", 1), ry = t === "circle" ? g("r", 1) : g("ry", 1), pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) pts.push([cx + rx * Math.cos((2 * Math.PI * i) / steps), cy + ry * Math.sin((2 * Math.PI * i) / steps)]);
    return [pts];
  }
  return [];
}

/** True when some shapes never say what color to use (so the user should pick one). */
export function needsFallbackColor(root: Element, bitmap: boolean): boolean {
  for (const [, t, st] of walk(root, { _opacity: 1 }, bitmap)) {
    if (!SHAPES.has(t)) continue;
    const fill = paint(st, "fill"), stroke = paint(st, "stroke");
    if (bitmap) { if (t === "line" ? stroke === UNSET : fill === UNSET) return true; }
    else if ((fill === UNSET || fill === null) && (stroke === UNSET || stroke === null)) return true;
  }
  return false;
}

export interface VectorOut { pathData: any[]; bounds: any; fillBounds: any }
export function svgToPathData(root: Element, steps = 16, scale = 1, ppu = SVG_PPU, color: number[] | null = null, fallback: number[] | null = null): VectorOut {
  const pathData: any[] = [], defaultColor = fallback || [0, 0, 0, 1], xs: number[] = [], ys: number[] = [];
  const getColor = (st: Style) => {
    if (color) return color;
    for (const kind of ["stroke", "fill"] as const) { const c = paint(st, kind); if (c !== UNSET && c !== null) return c as number[]; }
    return defaultColor;
  };
  for (const [el, t, st] of walk(root)) {
    const c = getColor(st);
    for (const poly of elementPolylines(el, t, steps)) {
      if (poly.length < 2) continue;
      const pts = poly.map(([x, y]) => [(x / ppu) * scale, (-y / ppu) * scale] as Pt);
      for (let j = 0; j < pts.length - 1; j++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[j + 1];
        pathData.push({ p: [r5(x1), r5(y1), r5(x2), r5(y2)], s: 1, f: false, c: c.map(r5) });
        xs.push(x1, x2); ys.push(y1, y2);
      }
    }
  }
  if (!xs.length) return { pathData, bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, fillBounds: { minX: -32, maxX: 32, minY: -32, maxY: 32 } };
  const mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  for (const s of pathData) { s.p[0] = r5(s.p[0] - mid[0]); s.p[1] = r5(s.p[1] - mid[1]); s.p[2] = r5(s.p[2] - mid[0]); s.p[3] = r5(s.p[3] - mid[1]); }
  const X = xs.map((x) => x - mid[0]), Y = ys.map((y) => y - mid[1]);
  const mnx = Math.min(...X), mxx = Math.max(...X), mny = Math.min(...Y), mxy = Math.max(...Y);
  return {
    pathData,
    bounds: { minX: r5(mnx), maxX: r5(mxx), minY: r5(mny), maxY: r5(mxy) },
    fillBounds: { minX: Math.round((mnx * ppu) / scale), maxX: Math.round((mxx * ppu) / scale), minY: Math.round((-mxy * ppu) / scale), maxY: Math.round((-mny * ppu) / scale) },
  };
}

export function vectorDrawing(items: VectorOut[], fps = 4, playMode = "still", scale = 10, ppu = SVG_PPU) {
  const frames = items.map((it) => ({ isLinked: false, pathDataList: it.pathData, fillImageBounds: it.fillBounds, avatarX: 0, avatarY: 0, avatarRadius: 5 }));
  const src = JSON.stringify(items.map((i) => i.pathData));
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  return {
    initialFrame: 1, currentFrame: 1, framesPerSecond: fps, playMode, loopStartFrame: -1, loopEndFrame: -1, opacity: 1,
    hash: String(Math.abs(h)) + src.length, playing: false, loop: playMode !== "still",
    drawData: {
      color: [1, 1, 1, 1], lineColor: [0, 0, 0, 1], gridSize: 0.71428, scale, version: 3, fillPixelsPerUnit: ppu, numTotalLayers: 1,
      framesBounds: items.map((i) => i.bounds), colors: [], selectedFrame: 1,
      layers: [{ title: "Layer 1", id: "layer1", isVisible: true, isBitmap: false, isAvatar: false, frames }],
    },
    physicsBodyData: {
      shapes: [{ p1: { x: 5, y: 5 }, p2: { x: -5, y: -5 }, p3: { x: 0, y: 0 }, radius: 0, x: 0, y: 0, type: "rectangle" }],
      scale, version: 2, zeroShapesInV1: false,
    },
    disabled: false,
  };
}

const rgba = (c: number[]) => `rgba(${c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${c[3] ?? 1})`;

/** Rasterize with the browser's own renderer. `color` recolors every shape; `fallback` colors shapes that don't say. */
export async function rasterizeSvg(root: Element, scale = 1, smooth = false, color: number[] | null = null, fallback: number[] | null = null) {
  const [vx, vy, vw, vh] = svgDims(root);
  const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
  const clone = root.cloneNode(true) as Element;
  const orig = Array.from(root.querySelectorAll("*")), copy = Array.from(clone.querySelectorAll("*"));
  const styles = new Map<Element, Style>();
  for (const [el, , st] of walk(root)) styles.set(el, st);
  copy.forEach((cel, i) => {
    const el = orig[i], t = tagOf(el);
    if (!SHAPES.has(t)) return;
    const st = styles.get(el) || {}, fill = paint(st, "fill"), stroke = paint(st, "stroke");
    const dec: string[] = [];
    if (color) {
      if (t !== "line" && fill !== null) dec.push(`fill:${rgba(color)}`);
      if (stroke !== null && stroke !== UNSET) dec.push(`stroke:${rgba(color)}`);
      if (t === "line") dec.push(`stroke:${rgba(color)}`);
    } else if (fallback) {
      if (t === "line" ? stroke === UNSET : fill === UNSET) dec.push(t === "line" ? `stroke:${rgba(fallback)}` : `fill:${rgba(fallback)}`);
    }
    if (dec.length) cel.setAttribute("style", (cel.getAttribute("style") || "") + ";" + dec.join(";"));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h));
  clone.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  clone.setAttribute("preserveAspectRatio", "none");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That SVG can't be drawn.")); i.src = url; });
    const cv = makeCanvas(w, h), x = cv.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    if (!smooth) {                                  // hard pixels: no anti-aliased edges
      const id = x.getImageData(0, 0, w, h), d = id.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
      x.putImageData(id, 0, 0);
    }
    return { png: await canvasPng(cv), w, h };
  } finally { URL.revokeObjectURL(url); }
}
