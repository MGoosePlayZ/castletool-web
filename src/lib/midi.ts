// MIDI → Castle music (port of CTA's collect_midi_tracks / build_music).
import { parseMidi } from "midi-file";
import { r5 } from "./drawing";
import { Prog, NOOP } from "./tasks";

const DEFAULT_TEMPO = 500000;
export const beatKey = (b: number) => b.toFixed(6);
const makeColor = () => ({ r: 0.19607, g: 0.16862, b: 0.15681, a: 1.0 });
const uuid = () => crypto.randomUUID();

export const CASTLE_DRUMS: Record<number, number> = {
  35: 36, 36: 36, 37: 39, 38: 39, 40: 39, 39: 40, 41: 37, 43: 37, 45: 37, 47: 38, 48: 38, 50: 38, 42: 41, 44: 41, 46: 42,
  49: 42, 52: 42, 55: 42, 57: 42, 51: 41, 59: 41, 53: 42, 54: 41, 69: 41, 70: 41, 60: 38, 61: 38, 62: 38, 63: 38, 64: 37,
};
const GM_FAMILIES: [number, string, number, number][] = [
  [7, "sine", 0, 0.35], [15, "sine", 0, 0.2], [23, "square", 0, 0.1], [31, "sawtooth", 0, 0.3], [39, "square", 0, 0.3],
  [47, "sawtooth", 0.08, 0.45], [55, "sawtooth", 0.1, 0.45], [63, "square", 0.02, 0.25], [71, "square", 0.02, 0.2],
  [79, "sine", 0.03, 0.2], [87, "sawtooth", 0, 0.15], [95, "sine", 0.3, 0.6], [103, "sine", 0.15, 0.4], [111, "sawtooth", 0, 0.3],
  [119, "noise", 0, 0.1], [127, "noise", 0, 0.2],
];
function programTone(program: number, isDrum: boolean): [string, number, number] {
  if (isDrum) return ["noise", 0, 0.12];
  program = Math.max(0, Math.min(127, program));
  for (const [up, w, a, r] of GM_FAMILIES) if (program <= up) return [w, a, r];
  return ["sawtooth", 0, 0.4];
}

export function drumInstrument() {
  return {
    type: "drums", props: { name: "drums", muted: false, volume: 1 },
    params: {
      useKick: true, kick: { decay: 0.3, punch: 0.89999, freq: 80, sweep: 0.6 },
      useClosedHat: true, closedHat: { decay: 0.1, freq: 0.89999, body: 0.1 },
      useOpenHat: true, openHat: { decay: 0.1, freq: 0.89999, body: 0.1 },
      useSnare: true, snare: { decay: 0.2, freq: 0.5, tambre: 0.5 },
      useClap: true, clap: { decay: 0.3, freq: 0.5 },
      useHiTom: true, hiTom: { decay: 0.2, freq: 0.75 },
      useLoTom: true, loTom: { decay: 0.2, freq: 0.75 },
    },
  };
}

interface Midi { header: { ticksPerBeat?: number }; tracks: any[][] }
/** `song.mid.smf` is a normal MIDI file: read it as plain .mid first, and only if that fails look for the `MThd`
 *  header further in (a RIFF/RMID wrapper, say) and read it as a Standard MIDI File from there. */
function parseMidiBytes(bytes: Uint8Array): any {
  try { return parseMidi(bytes); }
  catch (first) {
    let at = -1;
    for (let i = 1; i + 4 <= bytes.length && at < 0; i++) if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) at = i;
    if (at < 0) throw first;
    return parseMidi(bytes.subarray(at));
  }
}
export const readMidi = (bytes: Uint8Array): Midi => {
  const m: any = parseMidiBytes(bytes);
  if (!m.header.ticksPerBeat) throw new Error("SMPTE-timed MIDI files aren't supported.");
  return m;
};

function tempoMap(mid: Midi): [number, number][] {
  const ev: [number, number][] = [];
  for (const tr of mid.tracks) { let t = 0; for (const m of tr) { t += m.deltaTime; if (m.type === "setTempo") ev.push([t, m.microsecondsPerBeat]); } }
  if (!ev.length) return [[0, DEFAULT_TEMPO]];
  ev.sort((a, b) => a[0] - b[0]);
  const dd: [number, number][] = [];
  for (const e of ev) { if (dd.length && dd[dd.length - 1][0] === e[0]) dd[dd.length - 1] = e; else dd.push(e); }
  if (dd[0][0] !== 0) dd.unshift([0, DEFAULT_TEMPO]);
  return dd;
}
function tickScaler(map: [number, number][]) {
  const ref = map[0][1], ticks = map.map((m) => m[0]), cum = [0];
  for (let i = 1; i < map.length; i++) cum.push(cum[i - 1] + (map[i][0] - map[i - 1][0]) * (map[i - 1][1] / ref));
  return (abs: number) => {
    let idx = 0;
    for (let i = 0; i < ticks.length; i++) if (ticks[i] <= abs) idx = i;
    return cum[idx] + (abs - map[idx][0]) * (map[idx][1] / ref);
  };
}
export const midiBpm = (mid: Midi) => 60_000_000 / tempoMap(mid)[0][1];

interface Track { events: [number, number, number][]; program: number; isDrum: boolean }
function collectTracks(mid: Midi): Track[] {
  const tpb = mid.header.ticksPerBeat!, scale = tickScaler(tempoMap(mid)), out: Track[] = [];
  for (const tr of mid.tracks) {
    const events: Track["events"] = [], drums: Track["events"] = [], programs: Record<number, number> = {}, usage = new Map<string, number>();
    let abs = 0;
    for (const m of tr) {
      abs += m.deltaTime;
      if (m.type === "programChange") programs[m.channel] = m.programNumber;
      else if (m.type === "noteOn" && m.velocity > 0) {
        const ev: [number, number, number] = [(scale(abs) / tpb) * 4, m.noteNumber, m.velocity];
        if (m.channel === 9) drums.push(ev);
        else { events.push(ev); const k = m.channel + ":" + (programs[m.channel] ?? 0); usage.set(k, (usage.get(k) || 0) + 1); }
      }
    }
    if (events.length) {
      let best = "", n = -1;
      for (const [k, c] of usage) if (c > n) { n = c; best = k; }
      out.push({ events, program: +best.split(":")[1], isDrum: false });
    }
    if (drums.length) out.push({ events: drums, program: 0, isDrum: true });
  }
  return out;
}

export function buildMusic(mid: Midi, prog: Prog = NOOP) {
  const tracks = collectTracks(mid), patterns: Record<string, any> = {}, castle: any[] = [];
  tracks.forEach((track, ti) => {
    prog.step(ti, tracks.length, `Converting track ${ti + 1}/${tracks.length}`);
    const pid = uuid();
    if (track.isDrum) {
      const by = new Map<number, number[]>();
      for (const [beat, note] of track.events) {
        const key = CASTLE_DRUMS[note];
        if (key === undefined) continue;
        const b = Math.round(beat * 1e9) / 1e9;
        if (!by.has(b)) by.set(b, []);
        if (!by.get(b)!.includes(key)) by.get(b)!.push(key);
      }
      if (!by.size) return;
      const notes: Record<string, any> = {};
      [...by.entries()].sort((a, b) => a[0] - b[0]).forEach(([b, ks]) => { notes[beatKey(b)] = ks.sort((x, y) => x - y).map((k) => ({ key: k })); });
      patterns[pid] = { patternId: pid, name: `t${ti}`, color: makeColor(), loop: "nextBar", loopLength: 0, notes };
      castle.push({ instrument: drumInstrument(), sequence: { [beatKey(0)]: { patternId: pid, loop: false } } });
      return;
    }
    const [waveform, attack, release] = programTone(track.program, false), by = new Map<number, [number, number][]>();
    for (const [beat, note, vel] of track.events) {
      const b = Math.round(beat * 1e9) / 1e9;
      if (!by.has(b)) by.set(b, []);
      by.get(b)!.push([Math.min(127, note + 12), vel]);
    }
    const notes: Record<string, any> = {};
    [...by.entries()].sort((a, b) => a[0] - b[0]).forEach(([b, ns]) => { notes[beatKey(b)] = ns.map(([key, vel]) => ({ key, vel })); });
    patterns[pid] = { patternId: pid, name: `t${ti}`, color: makeColor(), loop: "nextBar", loopLength: 0, notes };
    castle.push({
      instrument: {
        type: "sampler", props: { name: "tone", muted: false, volume: 1 },
        sample: { type: "tone", playbackRate: { value: 1 }, amplitude: { value: 1 }, pan: { value: 0 }, recordingUrl: "", uploadUrl: "", category: "random", seed: 1337, mutationSeed: 0, mutationAmount: 5, midiNote: 48, waveform, attack, release, wait: false },
      },
      sequence: { [beatKey(0)]: { patternId: pid, loop: false } },
    });
  });
  void r5;
  return { song: { patterns, tracks: castle }, autoplay: "loop", disabled: false };
}
