export const MAJOR = "#ffffff", MINOR1 = "#888888", SEP = "#444444", BG = "#000000", DANGER = "#F87171", WARN = "#FACC15";
export const CARD_RATIO = 7 / 5;     // height / width (5:7 cards)
export const APP_VERSION = "0.5.0";
export const CASTLE_LINKS: [string, string][] = [
  ["Colophon", "https://castle.xyz/colophon"],
  ["Terms", "https://castle.xyz/terms"],
  ["Privacy", "https://castle.xyz/privacy_policy"],
  ["Github", "https://github.com/MGoosePlayZ/castletool-web"],
];
// Same wording as CTA, except for how it refers to itself: CTA is an app, CTW is part of the Castletool suite.
export const DISCLAIMER = "Castletool is an independent, unofficial suite. It is not affiliated with, endorsed by, or sponsored by Castle or Montarey's Coast, Inc.";

export const validHex = (v: any, d = "#000000") => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
export function timestamp(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number" || /^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}
export function fmtDate(v: any): string {
  const t = timestamp(v);
  if (!t) return "--/--/--";
  const d = new Date(t), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear() % 100)}`;
}
