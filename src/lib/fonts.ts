// Fonts for the art editor's text layers. The bundled fonts are plain @font-face rules (index.css); a font file the person uploads is
// registered with the browser under a fresh family name. (The old vector/bitmap "font to frames" importer is gone: text layers replace it.)
import { extOf } from "./imaging";

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
let faceN = 0;
/** Register an uploaded .ttf / .otf / .woff / .eot with the browser. Throws when the file isn't a usable font. */
export async function registerFont(file: File): Promise<{ family: string; label: string }> {
  let bytes: ArrayBuffer = await file.arrayBuffer();
  if (extOf(file.name) === ".eot") bytes = eotToSfnt(new Uint8Array(bytes)).buffer as ArrayBuffer;
  const family = "ctwupload" + faceN++, face = new FontFace(family, bytes);
  await face.load();
  (document.fonts as any).add(face);
  return { family, label: file.name.replace(/\.[^.]+$/, "") || "Font" };
}
