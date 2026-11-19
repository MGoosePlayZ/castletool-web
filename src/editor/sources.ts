// Pictures for the art editor's image layers: a file (or archive, or several files) → decoded sources the editor can draw at any
// position / scale / rotation. Decoding reuses the importer's code; nothing is resized here (that is the editor's job).
import { gatherMedia } from "@/lib/archive";
import { loadPng } from "@/lib/drawing";
import { IMAGE_EXTS, VECTOR_EXTS, VIDEO_EXTS, CATEGORY_LABELS, bitmapOf, extOf, extractVideoFrames, icoSizes, loadImageFrames, nativeSize, type Cat } from "@/lib/imaging";
import { parseSvgFile, svgDims } from "@/lib/svg";

export interface ImgSrc {
  name: string; file: File; cat: Cat;
  w: number; h: number;                       // native size
  frames: CanvasImageSource[];                // several for animated images and video, one otherwise
  fps: number;
  svg: boolean;                               // vector: drawn at full quality at any scale until it is saved
  multi: boolean;                             // animated image / video (the same transform on every frame)
  single?: boolean;                           // one frame of an archive / multi-file pick
  b64?: string;                               // the file itself, kept in drawData.artEditor (absent above 8 MB: such a layer is saved as plain paint)
}
const KEEP_MAX = 8_000_000;
const fileB64 = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

const ext = (s: Set<string>) => [...s].map((e) => e.replace(".", ""));
export const IMAGE_PICK = [...new Set([...ext(IMAGE_EXTS), ...ext(VIDEO_EXTS), ...ext(VECTOR_EXTS), "zip", "tar", "gz", "tgz", "bz2", "xz", "tbz2", "txz"])].sort();

const decoded = async (b64s: string[]): Promise<CanvasImageSource[]> =>
  (await Promise.all(b64s.map(loadPng))).map((i) => { if (!i) throw new Error("Couldn't decode a frame."); return i; });

async function svgImage(f: File): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const root = await parseSvgFile(f), [vx, vy, vw, vh] = svgDims(root), clone = root.cloneNode(true) as Element;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(vw)); clone.setAttribute("height", String(vh));
  clone.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`); clone.setAttribute("preserveAspectRatio", "none");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That SVG can't be drawn.")); i.src = url; });
    return { img, w: Math.max(1, Math.round(vw)), h: Math.max(1, Math.round(vh)) };
  } finally { URL.revokeObjectURL(url); }
}

/** One file. `single` = use just the first picture of an animation / video (files of an archive each fill one frame of the layer). */
export async function loadImgSrc(f: File, cat: Cat, every = 1, single = false): Promise<ImgSrc> {
  const s = await decodeSrc(f, cat, every, single);
  s.single = single;
  if (f.size <= KEEP_MAX) s.b64 = await fileB64(f);
  return s;
}
async function decodeSrc(f: File, cat: Cat, every: number, single: boolean): Promise<ImgSrc> {
  const base = { name: f.name, file: f, cat };
  if (cat === "vector") { const { img, w, h } = await svgImage(f); return { ...base, w, h, frames: [img], fps: 1, svg: true, multi: false }; }
  if (cat === "video") {
    const [w, h] = await nativeSize(f, cat), r = await extractVideoFrames(f, w, h, single ? 1e9 : Math.max(1, every), false);
    return { ...base, w, h, frames: await decoded(r.frames), fps: r.fps, svg: false, multi: !single };
  }
  if (cat === "animation" && !single) {
    const [w, h] = await nativeSize(f, cat), r = await loadImageFrames(f, w, h, undefined, false, undefined, Math.max(1, every));
    return { ...base, w, h, frames: await decoded(r.frames), fps: r.fps, svg: false, multi: true };
  }
  const bm = extOf(f.name) === ".ico" ? await bitmapOf(f, (await icoSizes(f))[0]) : await bitmapOf(f);
  return { ...base, w: bm.width, h: bm.height, frames: [bm], fps: 1, svg: false, multi: false };
}

/** What the person picked → one source per picture. An archive or a multi-file pick gives one source per file (each one frame of the layer). */
export async function loadImgSrcs(picked: File[]): Promise<ImgSrc[]> {
  const found = await gatherMedia(picked.length === 1 ? picked[0] : picked);
  if (!found) throw new Error("No usable files found.");
  if (found.cat === "audio" || found.cat === "font") throw new Error(`That is a ${CATEGORY_LABELS[found.cat]} file, not a picture.`);
  const single = found.files.length > 1, out: ImgSrc[] = [];
  for (const f of found.files) out.push(await loadImgSrc(f, found.cat, 1, single));
  return out;
}
