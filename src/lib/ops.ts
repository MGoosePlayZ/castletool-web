// Blueprint operations: import media / fonts / MIDI / audio, text props, card settings.
// Port of CTA's blueprint_ops.py + the conversion half of castletool_core.py, working on scene data in memory.
import type { CardRec, DeckRec } from "./db";
import { OpError, applyDrawing, d2Of, drawFrame, makeCanvas, sceneBounds, layersOf, frameCount } from "./drawing";
import * as img from "./imaging";
import { svgDims, svgToPathData, vectorDrawing, rasterizeSvg, needsFallbackColor, parseSvgFile, SVG_PPU } from "./svg";
import { gatherMedia } from "./archive";
import { loadFont, vectorFontFrames, renderFontBitmap, fontDrawing, fontCodepoints, fontHasGlyph, glyphToPathData } from "./fonts";
import { readMidi, buildMusic, midiBpm } from "./midi";
import { attachAudio, stripAudioRules, canEncodeMp3 } from "./audio";
import { Prog, NOOP } from "./tasks";
import { getToken } from "./api";
import { log } from "./store";

const uuid = () => crypto.randomUUID();
export const SVG_UNITS_PER_EM = 10;

// ── blueprint access ───────────────────────────────────────────────────
export const libraryOf = (rc: CardRec): Record<string, any> => (rc.scene?.snapshot?.library || {});
export const isBlueprint = (e: any) => e && (!e.entryType || e.entryType === "actorBlueprint");
export function blueprintsOf(rc: CardRec | undefined): any[] {
  if (!rc) return [];
  return Object.values(libraryOf(rc)).filter(isBlueprint).sort((a: any, b: any) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
}
export const blueprintTitle = (bp: any, fallback = "") => (bp?.title || "").trim() || fallback;
export const components = (bp: any) => bp?.actorBlueprint?.components || {};
export function ensureComponents(bp: any) {
  bp.actorBlueprint ||= {};
  return (bp.actorBlueprint.components ||= {});
}
export function textComponent(bp: any) {
  const t = components(bp).Text;
  return t && typeof t === "object" && !t.disabled ? t : null;
}
export const TEXT_FONTS: [string, string][] = [
  ["Bore", "font_bore"], ["CourierPrime", "font_courier_prime"], ["Glacier", "font_glacier"], ["HelicoCentrica", "font_helico_centrica"],
  ["DMSans", "font_overlay"], ["Piazzolla", "font_piazzolla"], ["Synco", "font_synco"], ["Tektur", "font_tektur"], ["YatraOne", "font_yatra_one"],
];
export const TEXT_H_ALIGN = ["left", "center", "right"];
export const TEXT_V_ALIGN = ["top", "middle", "bottom"];

export function parseColor(text: string, def: number[] | null = null): number[] | null {
  const t = (text || "").trim().replace(/^#/, "");
  if (!t) return def;
  if (!/^[0-9a-fA-F]{6}$/.test(t)) throw new OpError("Colors are 6-digit hex like #ff8800.");
  return [0, 2, 4].map((i) => Math.round((parseInt(t.slice(i, i + 2), 16) / 255) * 1e5) / 1e5).concat([1]);
}
export const textColorHex = (c: any) => {
  try { return "#" + ["r", "g", "b"].map((k) => Math.max(0, Math.min(255, Math.round(+c[k] * 255))).toString(16).padStart(2, "0")).join(""); } catch { return "#ffffff"; }
};
export function setTextProps(bp: any, props: Record<string, any>) {
  const t = textComponent(bp);
  if (!t) throw new OpError("This blueprint isn't a text actor.");
  props = { ...props };
  if ("fontName" in props && !TEXT_FONTS.some(([n]) => n === props.fontName)) throw new OpError("Unknown font.");
  if ("alignment" in props && !TEXT_H_ALIGN.includes(props.alignment)) throw new OpError("Unknown alignment.");
  if ("verticalAlignment" in props && !TEXT_V_ALIGN.includes(props.verticalAlignment)) throw new OpError("Unknown alignment.");
  if ("color" in props) {
    const rgba = parseColor(props.color);
    if (!rgba) throw new OpError("Unknown color.");
    delete props.color;
    t.color = { r: rgba[0], g: rgba[1], b: rgba[2], a: (t.color || {}).a ?? 1 };
  }
  Object.assign(t, props);
}

// ── layers ─────────────────────────────────────────────────────────────
export const drawingOf = (bp: any) => d2Of(bp);
function putDrawing(actor: any, d2: any, layer: string | null) {
  const comps = actor.actorBlueprint.components;
  return applyDrawing(comps.Drawing2, d2, layer).then((r) => { comps.Drawing2 = r; });
}

// ── forking extra actors ───────────────────────────────────────────────
function forkActor(rc: CardRec, base: any, name: string) {
  const nw = structuredClone(base);
  nw.entryId = uuid();
  nw.title = name;
  if (nw.library && typeof nw.library === "object") nw.library.blueprintAssetId = uuid();
  libraryOf(rc)[nw.entryId] = nw;
  return nw;
}
/** The first successful file goes into the selected actor; each one after that goes into a fresh fork of the actor as it was before. */
function nextTarget(rc: CardRec, actor: any, base: any, used: boolean, name: string): [any, boolean] {
  return used ? [forkActor(rc, base, name), false] : [actor, true];
}

// ── media ──────────────────────────────────────────────────────────────
export interface MediaOpts {
  layout: "frames" | "separate"; no_scale: boolean; scale: number; smooth: boolean; every: number; quantize: number;
  svg_style: "vector" | "bitmap"; svg_scale: number; steps: number; color: number[] | null; fallback_color: number[] | null; fps: number; want_audio: boolean;
  fixed_px: boolean; pixel_size: number;      // Fixed Pixel Size: every image pixel is `pixel_size` Castle units wide, never resampled
}
export const DEFAULT_MEDIA_OPTS: MediaOpts = {
  layout: "frames", no_scale: false, scale: 1, smooth: false, every: 1, quantize: 0, svg_style: "vector", svg_scale: 1, steps: 16, color: null, fallback_color: null, fps: 4, want_audio: true, fixed_px: false, pixel_size: 0.1,
};

export interface MediaInfo { category: img.Cat; count: number; names: string[]; unsupported: string; has_audio: boolean; audio_unsupported: boolean; size: number; frames: number; files: File[] }

export async function inspectMedia(file: File): Promise<MediaInfo> {
  const found = await gatherMedia(file);
  if (!found) throw new OpError("No usable files found (see log).");
  const { files, cat } = found;
  let hasAudio = false;
  if (cat === "video") hasAudio = (await Promise.all(files.map((f) => img.probeHasAudio(f)))).some(Boolean);
  let unsupported = "";
  if (cat === "audio" && !canEncodeMp3() && !files.every((f) => img.extOf(f.name) === ".mp3")) unsupported = "Only .mp3 files can be added on this device.";
  return {
    category: cat, count: files.length, names: files.map((f) => f.name).slice(0, 50), unsupported, has_audio: hasAudio,
    audio_unsupported: hasAudio && !canEncodeMp3(), size: Math.max(...files.map((f) => f.size)), frames: await img.framesIn(files[0], cat), files,
  };
}

async function icoSizesFor(files: File[]): Promise<Map<File, img.IcoSize>> {
  const m = new Map<File, img.IcoSize>();
  for (const f of files) if (img.extOf(f.name) === ".ico") {
    try { m.set(f, (await img.icoSizes(f))[0]); } catch (e: any) { throw new OpError(`Could not read ${f.name}: ${e?.message || e}`); }
  }
  return m;
}

interface State { scale: number; every: number; quantize: number; svg_scale: number; steps: number; color: number[] | null; smooth: boolean; bitmap: boolean; fallback_color: number[] | null; no_scale: boolean; fixed_scale: number | null }

async function fixedDensityScale(files: File[], ico: Map<File, img.IcoSize>, cat: img.Cat, svgScale: number): Promise<number | null> {
  const dims: [number, number][] = [];
  for (const f of files) {
    try {
      if (cat === "vector") { const [, , vw, vh] = svgDims(await parseSvgFile(f)); dims.push(img.scaledSize([vw, vh], svgScale)); }
      else dims.push(await img.nativeSize(f, "image", ico.get(f)));
    } catch { /* skip */ }
  }
  return dims.length ? Math.max(1, Math.round(Math.max(...dims.map((d) => Math.max(...d))) / 20)) : null;
}

async function mediaState(o: MediaOpts, cat: img.Cat, files: File[], ico: Map<File, img.IcoSize>, multi: boolean): Promise<State> {
  const bitmap = cat === "vector" && o.svg_style === "bitmap";
  const fixedPx = !!o.fixed_px && (cat !== "vector" || bitmap) && cat !== "audio" && cat !== "font";
  if (fixedPx && !(+o.pixel_size > 0)) throw new OpError("Pixel size must be greater than 0.");
  const st: State = {
    // Fixed Pixel Size keeps pictures at their own pixel size (a vector drawn as bitmap is still rasterized at its Scale)
    scale: cat !== "vector" || bitmap ? (fixedPx && cat !== "vector" ? 1 : +o.scale) : 1, every: Math.max(1, Math.trunc(+o.every) || 1), quantize: Math.trunc(+o.quantize) || 0,
    svg_scale: +o.svg_scale * SVG_UNITS_PER_EM, steps: Math.max(2, Math.trunc(+o.steps) || 16), color: o.color, smooth: !!o.smooth, bitmap,
    fallback_color: o.fallback_color, fixed_scale: null,
    // several pictures of different sizes keep their own sizes, so they all end up with the same pixel size
    no_scale: (!!o.no_scale || fixedPx) && multi && (cat === "image" || cat === "vector") && (cat === "image" || bitmap),
  };
  if (!(st.scale > 0) || !(+o.svg_scale > 0)) throw new OpError("Scale must be greater than 0.");
  if (cat === "vector" && !st.color && !st.fallback_color) {
    for (const f of files) if (needsFallbackColor(await parseSvgFile(f), st.bitmap)) { st.fallback_color = [0, 0, 0, 1]; break; }
  }
  if (st.no_scale) st.fixed_scale = await fixedDensityScale(files, ico, cat, st.scale);
  if (fixedPx) st.fixed_scale = 1 / +o.pixel_size;       // pixels per Castle unit
  return st;
}

async function renderVisual(f: File, cat: img.Cat, st: State, ico: img.IcoSize | undefined, prog: Prog) {
  if (cat === "vector" && st.bitmap) {
    const { png, w, h } = await rasterizeSvg(await parseSvgFile(f), st.scale, st.smooth, st.color, st.fallback_color);
    let frames = [png];
    if (st.quantize) frames = await img.quantizeFrames(frames, st.quantize, prog);
    return { d2: img.buildDrawing2(frames, 1, w, h, "still", null, st.fixed_scale), summary: `SVG ready: bitmap, ${w}×${h}px` };
  }
  if (cat === "vector") {
    const v = svgToPathData(await parseSvgFile(f), st.steps, st.svg_scale, SVG_PPU, st.color, st.fallback_color);
    return { d2: vectorDrawing([v]), summary: `SVG ready: ${v.pathData.length} line segments` };
  }
  const [w, h] = img.scaledSize(await img.nativeSize(f, cat, ico), st.scale), loadEnd = st.quantize ? 0.8 : 1;
  let r: { frames: string[]; fps: number };
  if (cat === "video") r = await img.extractVideoFrames(f, w, h, st.every, st.smooth, prog.sub(0, loadEnd));
  else {
    r = await img.loadImageFrames(f, w, h, ico, st.smooth, prog.sub(0, loadEnd));
    if (st.every > 1) { r = { frames: r.frames.filter((_, i) => i % st.every === 0), fps: r.fps / st.every }; }
  }
  if (st.quantize) r.frames = await img.quantizeFrames(r.frames, st.quantize, prog.sub(loadEnd, 1));
  const mode = cat === "animation" || cat === "video" || r.frames.length > 1 ? "loop" : "still";
  return { d2: img.buildDrawing2(r.frames, r.fps, w, h, mode, null, st.fixed_scale), summary: `Image ready: ${r.frames.length} frame(s), ${r.fps} FPS, ${w}×${h}px` };
}

async function renderFramesActor(files: File[], st: State, ico: Map<File, img.IcoSize>, fps: number, prog: Prog) {
  const frames: string[] = []; let sizes: [number, number][] | null = null, width = 0, height = 0;
  const loadEnd = st.quantize ? 0.85 : 1, lp = prog.sub(0, loadEnd);
  if (st.no_scale) {
    sizes = [];
    for (let i = 0; i < files.length; i++) {
      lp.step(i, files.length, `Processing image ${i + 1}/${files.length}`);
      try {
        const [w, h] = await img.nativeSize(files[i], "image", ico.get(files[i])), got = await img.loadImageFrames(files[i], w, h, ico.get(files[i]));
        frames.push(...got.frames); sizes.push(...got.frames.map(() => [w, h] as [number, number]));
      } catch (e: any) { log(`warning: Skipping ${files[i].name}: ${e?.message || e}`); }
    }
    if (!frames.length) throw new Error("none of the images could be read");
    width = Math.max(...sizes.map((s) => s[0])); height = Math.max(...sizes.map((s) => s[1]));
  } else {
    let have = false;
    for (let i = 0; i < files.length; i++) {
      lp.step(i, files.length, `Processing image ${i + 1}/${files.length}`);
      try {
        if (!have) { [width, height] = img.scaledSize(await img.nativeSize(files[i], "image", ico.get(files[i])), st.scale); have = true; }
        frames.push(...(await img.loadImageFrames(files[i], width, height, ico.get(files[i]), st.smooth)).frames);
      } catch (e: any) { log(`warning: Skipping ${files[i].name}: ${e?.message || e}`); }
    }
    if (!frames.length) throw new Error("none of the images could be read");
  }
  let out = frames;
  if (st.quantize) out = await img.quantizeFrames(frames, st.quantize, prog.sub(loadEnd, 1));
  const mode = out.length > 1 ? "loop" : "still";
  return { d2: img.buildDrawing2(out, fps, width, height, mode, sizes, st.fixed_scale), summary: `Image ready: ${out.length} frame(s), ${fps} FPS, ${st.no_scale ? "sizes kept" : `${width}×${height}px`}` };
}

async function renderSvgFramesActor(files: File[], st: State, fps: number, prog: Prog) {
  if (!st.bitmap) {
    const items: any[] = [];
    for (let i = 0; i < files.length; i++) {
      prog.step(i, files.length, `Processing SVG ${i + 1}/${files.length}`);
      try { items.push(svgToPathData(await parseSvgFile(files[i]), st.steps, st.svg_scale, SVG_PPU, st.color, st.fallback_color)); }
      catch (e: any) { log(`warning: Skipping ${files[i].name}: ${e?.message || e}`); }
    }
    if (!items.length) throw new Error("none of the SVGs could be read");
    return { d2: vectorDrawing(items, fps, items.length > 1 ? "loop" : "still"), summary: `SVG ready: ${items.length} frame(s), ${fps} FPS` };
  }
  const rendered: { png: string; w: number; h: number }[] = [];
  for (let i = 0; i < files.length; i++) {
    prog.step(i, files.length, `Processing SVG ${i + 1}/${files.length}`);
    try { rendered.push(await rasterizeSvg(await parseSvgFile(files[i]), st.scale, st.smooth, st.color, st.fallback_color)); }
    catch (e: any) { log(`warning: Skipping ${files[i].name}: ${e?.message || e}`); }
  }
  if (!rendered.length) throw new Error("none of the SVGs could be read");
  let frames: string[], sizes: [number, number][] | null = null, width: number, height: number;
  if (st.no_scale) { frames = rendered.map((r) => r.png); sizes = rendered.map((r) => [r.w, r.h]); width = Math.max(...sizes.map((s) => s[0])); height = Math.max(...sizes.map((s) => s[1])); }
  else {
    width = rendered[0].w; height = rendered[0].h; frames = [];
    for (const r of rendered) {
      if (r.w !== width || r.h !== height) {
        const im = await new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + r.png; });
        frames.push(await (await import("./drawing")).canvasPng(img.resizeTo(im, width, height, st.smooth)));
      } else frames.push(r.png);
    }
  }
  if (st.quantize) frames = await img.quantizeFrames(frames, st.quantize);
  return { d2: img.buildDrawing2(frames, fps, width, height, frames.length > 1 ? "loop" : "still", sizes, st.fixed_scale), summary: `SVG ready: bitmap, ${frames.length} frame(s), ${fps} FPS, ${st.no_scale ? "sizes kept" : `${width}×${height}px`}` };
}

/** Preview: the Drawing2 an import would draw, for ONE frame (never the whole video / animation). */
export async function previewMedia(info: MediaInfo, optsIn: Partial<MediaOpts>, frame = 0): Promise<any | null> {
  const o = { ...DEFAULT_MEDIA_OPTS, ...optsIn }, cat = info.category;
  if (cat === "audio" || cat === "font") return null;
  const byFile = info.files.length > 1 && (cat === "image" || cat === "vector") && o.layout === "frames";
  const f = byFile ? info.files[Math.min(frame, info.files.length - 1)] : info.files[0], ico = await icoSizesFor([f]);
  const st = await mediaState(o, cat, [f], ico, false);
  if (cat === "vector") return (await renderVisual(f, cat, st, ico.get(f), NOOP)).d2;
  const [w, h] = img.scaledSize(await img.nativeSize(f, cat, ico.get(f)), st.scale);
  let png = await img.oneFramePng(f, cat, w, h, byFile ? 0 : frame, st.every, st.smooth, ico.get(f));
  if (st.quantize) png = await img.quantizeFrame(png, st.quantize);
  return img.buildDrawing2([png], 1, w, h, "still", null, st.fixed_scale);
}
export function previewFrameCount(info: MediaInfo, o: Partial<MediaOpts>): number {
  const cat = info.category, every = Math.max(1, Math.trunc(+(o.every || 1)));
  if ((cat === "image" || cat === "vector") && info.count > 1 && (o.layout || "frames") === "frames") return info.count;
  if (cat === "animation" || cat === "video") return Math.max(1, Math.ceil((info.frames || 1) / every));
  return 1;
}

export interface ImportResult { written: string[]; warnings: string[] }
export interface Ctx { rc: CardRec; rec: DeckRec; entryId: string }

export async function importMedia(ctx: Ctx, info: MediaInfo, optsIn: Partial<MediaOpts>, prog: Prog, layer: string | null = null): Promise<ImportResult> {
  const o = { ...DEFAULT_MEDIA_OPTS, ...optsIn }, warnings: string[] = [];
  if (layer !== null) o.layout = "frames";
  const actor = libraryOf(ctx.rc)[ctx.entryId];
  ensureComponents(actor);
  let files = info.files; const cat = info.category;
  if (cat === "audio" || cat === "font") throw new OpError(`That is a ${img.CATEGORY_LABELS[cat]} file; use the matching section.`);
  if (layer !== null && files.length > 1 && cat !== "image" && cat !== "vector") { log("warning: a layer holds one file, so only the first one was used."); files = files.slice(0, 1); }
  const multi = files.length > 1, ico = await icoSizesFor(files), framesMode = multi && (cat === "image" || cat === "vector") && o.layout === "frames";
  const st = await mediaState(o, cat, files, ico, multi), fps = framesMode ? +o.fps : 4;
  if (framesMode && !(fps > 0)) throw new OpError("FPS must be greater than 0.");
  let audioFiles = new Set<File>(), wantAudio = false;
  if (cat === "video" && o.want_audio) {
    for (const f of files) if (await img.probeHasAudio(f)) audioFiles.add(f);
    wantAudio = audioFiles.size > 0;
    if (wantAudio && !canEncodeMp3()) { warnings.push("this device can't encode MP3, so the sound was skipped"); wantAudio = false; }
  }
  const base = structuredClone(actor), written: string[] = [];
  if (framesMode) {
    let r;
    try { r = cat === "vector" ? await renderSvgFramesActor(files, st, fps, prog.sub(0, 0.95)) : await renderFramesActor(files, st, ico, fps, prog.sub(0, 0.95)); }
    catch (e: any) { if (e?.name === "Cancelled") throw e; throw new OpError(`Could not import: ${e?.message || e}`); }
    await putDrawing(actor, r.d2, layer);
    log(r.summary);
    prog.say("Saving blueprint", 0.97);
    return { written: [ctx.entryId], warnings };
  }
  let used = false, lastErr = "";
  for (let fi = 0; fi < files.length; fi++) {
    prog.check();
    const f = files[fi], hasAud = wantAudio && audioFiles.has(f), lo = fi / files.length, hi = (fi + 1) / files.length;
    let r;
    try { r = await renderVisual(f, cat, st, ico.get(f), prog.sub(lo, lo + (hi - lo) * (hasAud ? 0.5 : 0.95))); }
    catch (e: any) { if (e?.name === "Cancelled") throw e; log(`error: ${f.name}: ${e?.message || e}`); lastErr = String(e?.message || e); continue; }
    const [target, isSel] = nextTarget(ctx.rc, actor, base, used, img.stemOf(f.name));
    used = true;
    if (!isSel) stripAudioRules(target);
    await putDrawing(target, r.d2, isSel ? layer : null);
    log(r.summary);
    if (hasAud) {
      const res = await attachAudio(target, f, true, prog.sub(lo + (hi - lo) * 0.5, hi), (m) => log(m));
      if (!res.ok) { log("warning: continuing with silent video."); warnings.push(`the sound wasn't uploaded (${(res.error || "unknown error").split("\n")[0].slice(0, 120)})`); }
    }
    if (!isSel) log(`New actor created: ${target.title}`);
    written.push(target.entryId);
  }
  void lastErr;
  if (!written.length) throw new OpError("Nothing was added.");
  return { written, warnings };
}

// ── fonts ──────────────────────────────────────────────────────────────
export interface FontOpts { charsets: string[]; custom: string; bitmap: boolean; scale: number; steps: number; px: number; smooth: boolean; color: number[] | null }
export const DEFAULT_FONT_OPTS: FontOpts = { charsets: [], custom: "", bitmap: false, scale: 1, steps: 16, px: 64, smooth: false, color: null };

export async function previewFont(file: File, o: Partial<FontOpts>): Promise<any | null> {
  const opts = { ...DEFAULT_FONT_OPTS, ...o }, cps = fontCodepoints(opts);
  if (!cps.length) return null;
  const lf = await loadFont(file), sample = [cps[0]], color = opts.color || [1, 1, 1, 1];
  if (opts.bitmap) {
    const r = await renderFontBitmap(lf, sample, Math.trunc(+opts.px) || 64, !!opts.smooth, color);
    return r.frames.length ? img.buildDrawing2(r.frames, 4, r.w, r.h, "still") : null;
  }
  if (!fontHasGlyph(lf.font, sample[0])) return null;
  const { frames, ppu } = vectorFontFrames(lf, sample, Math.max(2, Math.trunc(+opts.steps) || 16), +opts.scale || 1, color);
  void glyphToPathData;
  return fontDrawing(frames, ppu, 10);
}

export async function importFont(ctx: Ctx, info: MediaInfo, o: Partial<FontOpts>, prog: Prog, layer: string | null = null): Promise<ImportResult> {
  const opts = { ...DEFAULT_FONT_OPTS, ...o }, actor = libraryOf(ctx.rc)[ctx.entryId];
  ensureComponents(actor);
  const cps = fontCodepoints(opts);
  if (!cps.length) throw new OpError("No characters were selected.");
  const bitmap = !!opts.bitmap, scale = +opts.scale || 1, steps = Math.max(2, Math.trunc(+opts.steps) || 16), px = Math.trunc(+opts.px) || 64, smooth = !!opts.smooth, color = opts.color || [0, 0, 0, 1];
  if (!(scale > 0)) throw new OpError("Scale must be greater than 0.");
  if (bitmap && !(px >= 4 && px <= 512)) throw new OpError("Pixels per em must be between 4 and 512.");
  if (info.category !== "font") throw new OpError(`That is a ${img.CATEGORY_LABELS[info.category]} file; use the matching section.`);
  let fonts = [];
  for (const f of info.files) {
    try { const lf = await loadFont(f); if (!lf.font.numGlyphs) throw new Error("no usable character map."); fonts.push(lf); }
    catch (e: any) { log(`error: could not read font ${f.name}: ${e?.message || e}`); }
  }
  if (!fonts.length) throw new OpError("No readable fonts.");
  if (layer !== null && fonts.length > 1) { log("warning: a layer holds one font, so only the first one was used."); fonts = fonts.slice(0, 1); }
  const base = structuredClone(actor), written: string[] = [], warnings: string[] = [];
  let used = false;
  for (let fi = 0; fi < fonts.length; fi++) {
    prog.check();
    const lf = fonts[fi], lo = fi / fonts.length, hi = (fi + 1) / fonts.length, sub = prog.sub(lo, lo + (hi - lo) * 0.95);
    log(`Rendering ${cps.length} glyph(s) from ${lf.name}...`);
    let count = 0, missing = 0, d2: any = null;
    if (bitmap) {
      try { const r = await renderFontBitmap(lf, cps, px, smooth, color, sub); count = r.frames.length; missing = r.missing; if (count) d2 = img.buildDrawing2(r.frames, 4, r.w, r.h, "still"); }
      catch (e: any) { if (e?.name === "Cancelled") throw e; log(`error: ${lf.name}: ${e?.message || e}`); continue; }
    } else {
      const r = vectorFontFrames(lf, cps, steps, scale, color, sub);
      count = r.frames.length; missing = r.missing;
      if (count) d2 = fontDrawing(r.frames, r.ppu, 10);
    }
    if (!count) { log(`error: no requested codepoints have a glyph in ${lf.name}.`); continue; }
    const [target, isSel] = nextTarget(ctx.rc, actor, base, used, img.stemOf(lf.name));
    used = true;
    await putDrawing(target, d2, isSel ? layer : null);
    if (missing) log(`warning: ${missing} codepoint(s) have no glyph in this font and were skipped.`);
    log(`Font added: ${count} frame(s), one per glyph.`);
    if (!isSel) log(`New actor created: ${target.title}`);
    written.push(target.entryId);
  }
  if (!written.length) throw new OpError("Nothing was added.");
  return { written, warnings };
}

// ── MIDI → Music ───────────────────────────────────────────────────────
export async function importMidi(ctx: Ctx, file: File, prog: Prog) {
  let mid;
  try { mid = readMidi(new Uint8Array(await file.arrayBuffer())); } catch (e: any) { throw new OpError(`Could not read MIDI: ${e?.message || e}`); }
  const music = buildMusic(mid, prog.sub(0, 0.95));
  log(`MIDI ready: ${Object.keys(music.song.patterns).length} patterns, ${music.song.tracks.length} tracks`);
  const actor = libraryOf(ctx.rc)[ctx.entryId];
  ensureComponents(actor).Music = music;
  const bpm = midiBpm(mid);
  setCardTempo(ctx.rc, bpm);
  log(`Card tempo set to ${bpm.toFixed(2)} BPM.`);
  return music;
}

// ── audio ──────────────────────────────────────────────────────────────
export async function importAudio(ctx: Ctx, info: MediaInfo, prog: Prog): Promise<string[]> {
  if (!getToken()) throw new OpError("Sign in first: audio is uploaded to Castle.");
  const actor = libraryOf(ctx.rc)[ctx.entryId];
  ensureComponents(actor);
  if (info.category !== "audio") throw new OpError(`That is a ${img.CATEGORY_LABELS[info.category]} file; use the matching section.`);
  if (!canEncodeMp3() && !info.files.every((f) => img.extOf(f.name) === ".mp3")) throw new OpError("Only .mp3 files can be added on this device.");
  const base = structuredClone(actor), written: string[] = [];
  let used = false;
  for (let fi = 0; fi < info.files.length; fi++) {
    prog.check();
    const f = info.files[fi], target = used ? forkActor(ctx.rc, base, img.stemOf(f.name)) : actor, isSel = !used;
    if (!isSel) stripAudioRules(target);
    const res = await attachAudio(target, f, false, prog.sub(fi / info.files.length, (fi + 1) / info.files.length), (m) => log(m));
    if (!res.ok) { if (!isSel) delete libraryOf(ctx.rc)[target.entryId]; continue; }
    used = true;
    if (!isSel) log(`New actor created: ${target.title}`);
    written.push(target.entryId);
  }
  if (!written.length) throw new OpError("Nothing was added (see log).");
  return written;
}

// ── card settings ──────────────────────────────────────────────────────
export function rgbaOfHex(hex: string) {
  const h = hex.trim().replace(/^#/, "");
  return { r: Math.round((parseInt(h.slice(0, 2), 16) / 255) * 1e5) / 1e5, g: Math.round((parseInt(h.slice(2, 4), 16) / 255) * 1e5) / 1e5, b: Math.round((parseInt(h.slice(4, 6), 16) / 255) * 1e5) / 1e5, a: 1 };
}
export function setCardBackground(rc: CardRec, hex: string): string {
  let raw = hex.trim();
  if (!raw.startsWith("#")) raw = "#" + raw;
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) throw new OpError("Enter a hex color like #09101a.");
  rc.meta.backgroundColor = raw;
  const snap = (rc.scene.snapshot ||= {});
  (snap.sceneProperties ||= {}).backgroundColor = rgbaOfHex(raw);
  return raw;
}
export function setCardTempo(rc: CardRec, bpm: number) {
  if (!(bpm > 0)) throw new OpError("Tempo must be greater than 0.");
  const snap = (rc.scene.snapshot ||= {}), sp = (snap.sceneProperties ||= {}), clock = (sp.clock ||= { beatsPerBar: 4, stepsPerBeat: 4 });
  clock.tempo = Math.round(bpm * 100) / 100;
}
export function cardTempo(rc: CardRec): number {
  const t = parseFloat(rc?.scene?.snapshot?.sceneProperties?.clock?.tempo);
  return Number.isFinite(t) ? t : 120;
}
export function cardBackground(rc: CardRec): string {
  const v = rc?.meta?.backgroundColor;
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000";
}
export { drawFrame, makeCanvas, sceneBounds, layersOf, frameCount };
