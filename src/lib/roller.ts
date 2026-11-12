// Piano roller model + drawing for the Music tab (read-only, scrolls horizontally; port of CTA's piano_roller.py).
import { collectNotes, stepSeconds, trackColors, voicesFromMusic } from "./synth";

export const SM = 11;            // side margin: the needle handle may poke out of the box
export const HM = 14;            // top margin: the handle sits half outside the box
export const RATIO = 1.4;        // box height / width (7:5)
const MAX_CELL = 48, BLACK = new Set([1, 3, 6, 8, 10]);

export interface RollerModel {
  steps: Float64Array;           // note start in steps, ascending
  rows: Int32Array;              // row of every note
  tracks: Int32Array;            // track of every note
  colors: string[];              // per track
  hi: number; tonal: number; hasDrums: boolean; rowCount: number;
  end: number;                   // step of the last note
  sec: number;                   // seconds per step
}

export function buildModel(music: any, bpm: number): RollerModel | null {
  const notes = collectNotes(music, bpm);
  if (!notes.length) return null;
  const { voices } = voicesFromMusic(music), sec = stepSeconds(bpm), colors = trackColors(music);
  let hi = -Infinity, lo = Infinity, dhi = -1, dlo = 99, hasDrums = false;
  const drum: boolean[] = [], key: number[] = [];
  for (const n of notes) {
    const d = !!voices[n.track]?.drums;
    let k = Math.round(n.key);
    if (d) { hasDrums = true; k = Math.max(36, Math.min(42, k)); dlo = Math.min(dlo, k); dhi = Math.max(dhi, k); }
    else { lo = Math.min(lo, k); hi = Math.max(hi, k); }
    drum.push(d); key.push(k);
  }
  const tonal = hi >= lo ? hi - lo + 1 : 0, drumTop = tonal + (tonal && hasDrums ? 1 : 0);
  const m: RollerModel = {
    steps: new Float64Array(notes.length), rows: new Int32Array(notes.length), tracks: new Int32Array(notes.length), colors,
    hi: tonal ? hi : 0, tonal, hasDrums, rowCount: hasDrums ? drumTop + (dhi - dlo + 1) : tonal, end: notes[notes.length - 1].t / sec, sec,
  };
  notes.forEach((n, i) => { m.steps[i] = n.t / sec; m.tracks[i] = n.track; m.rows[i] = drum[i] ? drumTop + (dhi - key[i]) : hi - key[i]; });
  return m;
}

export const cellOf = (m: RollerModel, boxH: number) => Math.min(boxH / Math.max(1, m.rowCount), MAX_CELL);
export const maxScroll = (m: RollerModel, boxW: number, boxH: number) => Math.max(0, (m.end + 1) * cellOf(m, boxH) - boxW * 0.5);

function lowerBound(a: Float64Array, v: number) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }

/** Rounded polygon (corners cut with arcTo), used for the needle handle. */
function rpoly(g: CanvasRenderingContext2D, pts: number[][], r: number) {
  g.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    if (i === 0) g.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    g.arcTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2, r);
  }
  g.closePath();
}

/** One frame on a canvas of (boxW + 2*SM) x (boxH + HM) CSS px, already scaled by the device pixel ratio. */
export function drawRoller(g: CanvasRenderingContext2D, m: RollerModel, boxW: number, boxH: number, ox: number, needle: number, dpr: number) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, boxW + 2 * SM, boxH + HM);
  g.save(); g.translate(SM, HM);
  g.strokeStyle = "#888"; g.lineWidth = 1; g.beginPath(); g.roundRect(0.5, 0.5, boxW - 1, boxH - 1, 12); g.stroke();
  const c = cellOf(m, boxH), yo = (boxH - m.rowCount * c) / 2, X = (s: number) => s * c - ox, Y = (r: number) => yo + r * c, nx = X(needle);
  g.save(); g.beginPath(); g.roundRect(1, 1, boxW - 2, boxH - 2, 11); g.clip();
  g.fillStyle = "#000"; g.fillRect(0, 0, boxW, boxH);
  const pc = (r: number) => (((m.hi - r - 12) % 12) + 12) % 12;
  for (let r = 0; r < m.tonal; r++) if (BLACK.has(pc(r))) { g.fillStyle = "rgba(136,136,136,.10)"; g.fillRect(0, Y(r), boxW, c); }
  g.strokeStyle = "rgba(136,136,136,.7)"; g.beginPath();
  for (let r = 1; r < m.tonal; r++) if (pc(r) === 0) { const y = Math.round(Y(r)) + 0.5; g.moveTo(0, y); g.lineTo(boxW, y); }
  if (m.hasDrums && m.tonal) { const y = Math.round(Y(m.tonal + 0.5)) + 0.5; g.moveTo(0, y); g.lineTo(boxW, y); }
  g.stroke();
  const a0 = Math.max(0, Math.floor(ox / c)), a1 = Math.ceil((ox + boxW) / c);
  for (const [every, al, on] of [[1, 0.1, c >= 8], [4, 0.22, c * 4 >= 10], [16, 0.45, true]] as [number, number, boolean][]) {
    if (!on) continue;
    g.strokeStyle = `rgba(136,136,136,${al})`; g.beginPath();
    for (let s = Math.ceil(a0 / every) * every; s <= a1; s += every) { const x = Math.round(X(s)) + 0.5; g.moveTo(x, 0); g.lineTo(x, boxH); }
    g.stroke();
  }
  const sz = Math.max(2, c - 1);                                       // notes: plain squares, track color
  for (let i = lowerBound(m.steps, a0 - 1); i < m.steps.length; i++) {
    if (m.steps[i] > a1) break;
    g.fillStyle = m.colors[m.tracks[i]] || "#fff"; g.fillRect(X(m.steps[i]), Y(m.rows[i]), sz, sz);
  }
  g.fillStyle = "#fff"; g.fillRect(Math.round(nx) - 0.75, 10, 1.5, boxH - 10);   // needle
  g.restore();
  if (nx >= -SM && nx <= boxW + SM) {                                  // handle: half outside the box, tip on the needle
    rpoly(g, [[nx - 11, -13], [nx + 11, -13], [nx + 11, 0], [nx, 13], [nx - 11, 0]], 4);
    g.fillStyle = "#fff"; g.fill();
  }
  g.restore();
}
