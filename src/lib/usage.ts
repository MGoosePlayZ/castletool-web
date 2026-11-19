// What fills a card's 50 MB: Scene (actors), Blueprints (without their Lua), Scripts (Lua code per blueprint), Other, Free Space.
import { DANGER, MAJOR, WARN } from "./theme";
import { SCENE_UPLOAD_LIMIT } from "./api";
import type { CardRec } from "./db";

export interface UsageItem { name: string; bytes: number; color: string }
export interface UsageCategory { key: "scene" | "blueprints" | "scripts" | "other" | "free"; name: string; bytes: number; color: string; items: UsageItem[] }
export interface Usage { total: number; limit: number; categories: UsageCategory[] }

/** Same color rule as the dial in the card bar: white under 50 %, yellow over 50 %, red over 75 %. */
export const sizeColor = (frac: number) => (frac > 0.75 ? DANGER : frac > 0.5 ? WARN : MAJOR);

/** "812.4 KB" / "3.07 MB": what the usage heading and the lists show. */
export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

/** UTF-8 byte length of a string without allocating a copy (scripts can be tens of MB). */
function utf8len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
const sizeOf = (v: unknown) => (v === undefined ? 0 : utf8len(JSON.stringify(v)));

/** A random vibrant color (any hue, saturation 70-100 %, lightness 30-70 %): the same rule imported MIDI tracks get their colors by. */
export function vibrantHex(): string {
  const h = Math.random() * 360, sat = 0.7 + Math.random() * 0.3, l = 0.3 + Math.random() * 0.4;
  const a = sat * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min((n + h / 30) % 12 - 3, Math.min(9 - ((n + h / 30) % 12), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

const MAX_ITEMS = 24;
/** Biggest first; everything past MAX_ITEMS is folded into one "N more" item so the pie stays readable. */
function tidy(items: UsageItem[]): UsageItem[] {
  const sorted = items.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  if (sorted.length <= MAX_ITEMS) return sorted;
  const rest = sorted.slice(MAX_ITEMS);
  return [...sorted.slice(0, MAX_ITEMS), { name: `${rest.length} more`, bytes: rest.reduce((s, i) => s + i.bytes, 0), color: vibrantHex() }];
}

/** Breaks a card's scene data down. `total` is the number the 50 MB limit applies to (cardBytes); parts are measured as JSON, so the pieces
 *  add up to a little less than the total (the wrapper and the keys between them land in Other). */
export function computeUsage(rc: CardRec, total: number): Usage {
  const snap = rc.scene?.snapshot || {}, library: Record<string, any> = snap.library || {}, actors = snap.actors;
  const sceneItems: UsageItem[] = [], bpItems: UsageItem[] = [], scriptItems: UsageItem[] = [];
  let scene = 0, blueprints = 0, scripts = 0;

  if (actors && typeof actors === "object") {
    scene = sizeOf(actors);
    for (const [k, a] of Object.entries<any>(actors)) {
      const label = (a?.entryId && library[a.entryId]?.title) || a?.name || a?.title || (typeof a?.actorId === "string" ? a.actorId : "") || `Actor ${k}`;
      sceneItems.push({ name: String(label), bytes: sizeOf(a), color: vibrantHex() });
    }
  }
  for (const [id, e] of Object.entries<any>(library)) {
    const name = String(e?.title || id), script = e?.actorBlueprint?.components?.Script?.code;
    const hasCode = typeof script === "string" && script.length > 0;
    const sBytes = hasCode ? sizeOf(script) : 0;
    const stripped = hasCode ? { ...e, actorBlueprint: { ...e.actorBlueprint, components: { ...e.actorBlueprint.components, Script: { ...e.actorBlueprint.components.Script, code: "" } } } } : e;
    const bBytes = sizeOf(stripped);
    blueprints += bBytes; scripts += sBytes;
    bpItems.push({ name, bytes: bBytes, color: vibrantHex() });
    if (hasCode) scriptItems.push({ name, bytes: sBytes, color: vibrantHex() });
  }
  const parts = scene + blueprints + scripts, other = Math.max(0, total - parts);
  const otherItems: UsageItem[] = [];
  let named = 0;
  for (const [k, v] of Object.entries<any>(snap)) {
    if (k === "actors" || k === "library") continue;
    const b = sizeOf(v); named += b;
    otherItems.push({ name: k, bytes: b, color: vibrantHex() });
  }
  if (other - named > 0) otherItems.push({ name: "Keys and wrapper", bytes: other - named, color: vibrantHex() });

  const limit = SCENE_UPLOAD_LIMIT;
  return {
    total, limit,
    categories: [
      { key: "scene", name: "Scene", bytes: scene, color: "#38BDF8", items: tidy(sceneItems) },
      { key: "blueprints", name: "Blueprints", bytes: blueprints, color: "#A78BFA", items: tidy(bpItems) },
      { key: "scripts", name: "Scripts", bytes: scripts, color: "#34D399", items: tidy(scriptItems) },
      { key: "other", name: "Other", bytes: other, color: "#888888", items: tidy(otherItems) },
      { key: "free", name: "Free Space", bytes: Math.max(0, limit - total), color: "#000000", items: [] },
    ],
  };
}
