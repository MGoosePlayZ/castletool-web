// Unpack .zip / .tar(.gz) in the browser, and turn what the user picked into (files, category).
import { unzipSync, gunzipSync } from "fflate";
import { OpError } from "./drawing";
import { log } from "./store";
import { classifyFile, extOf, isArchive, CATEGORY_LABELS, type Cat } from "./imaging";

export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const naturalKey = (s: string) => s.split(/(\d+)/).map((t) => (/^\d+$/.test(t) ? Number(t) : t.toLowerCase()));
function natCmp(a: string, b: string) {
  const x = naturalKey(a), y = naturalKey(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (typeof x[i] === typeof y[i]) return x[i] < y[i] ? -1 : 1;
    return typeof x[i] === "number" ? -1 : 1;
  }
  return x.length - y.length;
}
function safeName(name: string): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter((x) => x !== "" && x !== ".");
  if (!parts.length || parts.includes("..")) return null;
  if (parts.some((x) => x === "__MACOSX" || x === ".DS_Store" || x.startsWith("._"))) return null;
  return parts.join("/");
}
function untar(buf: Uint8Array): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [], td = new TextDecoder();
  let o = 0, longName: string | null = null;
  const str = (a: number, n: number) => td.decode(buf.subarray(o + a, o + a + n)).replace(/\0.*$/s, "");
  while (o + 512 <= buf.length) {
    if (buf.subarray(o, o + 512).every((b) => b === 0)) break;
    let name = str(0, 100);
    const size = parseInt(str(124, 12).trim() || "0", 8), type = String.fromCharCode(buf[o + 156] || 48), prefix = str(345, 155);
    if (prefix && str(257, 5) === "ustar") name = prefix + "/" + name;
    o += 512;
    const data = buf.subarray(o, o + size);
    if (type === "L") longName = td.decode(data).replace(/\0.*$/s, "");
    else if (type === "0" || type === "\0") { out.push({ name: longName || name, data }); longName = null; }
    else longName = null;
    o += Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function extractArchive(file: File): Promise<File[]> {
  const lower = file.name.toLowerCase(), raw = new Uint8Array(await file.arrayBuffer());
  let entries: { name: string; data: Uint8Array }[];
  if (lower.endsWith(".zip")) entries = Object.entries(unzipSync(raw)).filter(([n]) => !n.endsWith("/")).map(([name, data]) => ({ name, data }));
  else if (lower.endsWith(".tar")) entries = untar(raw);
  else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) entries = untar(gunzipSync(raw));
  else throw new Error("this browser can't open .tar.bz2 / .tar.xz archives (use .zip or .tar.gz)");
  let total = 0;
  const files: { path: string; f: File }[] = [];
  for (const e of entries) {
    const p = safeName(e.name);
    if (!p) continue;
    total += e.data.length;
    if (total > MAX_ARCHIVE_BYTES) throw new Error("archive is too large to unpack (limit 2 GiB)");
    files.push({ path: p, f: new File([e.data as BlobPart], p.split("/").pop()!) });
  }
  files.sort((a, b) => natCmp(a.path, b.path));
  return files.map((x) => x.f);
}

/** What the user picked (a file or an archive) → { files, cat }. Reasons for failure go to the log. */
export async function gatherMedia(file: File): Promise<{ files: File[]; cat: Cat } | null> {
  if (!isArchive(file.name)) {
    if (file.size === 0) { log(`error: ${file.name} is empty (0 bytes).`); return null; }
    const cat = await classifyFile(file);
    if (!cat) {
      const ext = extOf(file.name) || "(no extension)";
      log(`error: Unsupported file type: ${ext}`);
      log(`If you'd like ${ext} supported, please make an issue on GitHub: https://github.com/MGoosePlayZ/castletool/issues`);
      return null;
    }
    return { files: [file], cat };
  }
  log(`Reading archive: ${file.name}`);
  let files: File[];
  try { files = await extractArchive(file); } catch (e: any) { log(`error: Could not read archive: ${e.message || e}`); return null; }
  if (!files.length) { log("error: The archive doesn't contain any files."); return null; }
  const by = new Map<Cat, File[]>();
  let ignored = 0, empty = 0;
  for (const f of files) {
    if (f.size === 0) { empty++; continue; }
    const c = await classifyFile(f);
    if (!c) ignored++; else { if (!by.has(c)) by.set(c, []); by.get(c)!.push(f); }
  }
  if (empty) log(`warning: Ignored ${empty} empty file(s) in the archive.`);
  if (ignored) log(`warning: Ignored ${ignored} unsupported file(s) in the archive.`);
  if (!by.size) { log("error: No supported files were found in the archive."); return null; }
  if (by.size > 1) {
    log("error: Supported files are of different purpose");
    log("warning: Found: " + [...by].map(([c, v]) => `${v.length} ${CATEGORY_LABELS[c]}`).join(", "));
    return null;
  }
  const [cat, flist] = [...by][0];
  log(`Found ${flist.length} ${CATEGORY_LABELS[cat]} file(s).`);
  return { files: flist, cat };
}
export { OpError };
