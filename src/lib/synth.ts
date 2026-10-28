// Renders a blueprint's Music component to sound, straight from its JSON (port of CTA's synth.py / live_synth.py).
export const SAMPLE_RATE = 22050;
export const STEPS_PER_BEAT = 4;
const WAVE_GAIN: Record<string, number> = { sine: 0.55, square: 0.3, sawtooth: 0.34, noise: 0.38 };
const DEFAULT_MIDI_NOTE = 48, TAIL_SECONDS = 0.5, LOOP_GRID = 16, MAX_LOOP_NOTES = 200_000, DRUM_GAIN = 0.7;

// small seeded PRNG (so a given note always sounds the same)
function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const uni = (r: () => number) => r() * 2 - 1;
const freq = (key: number, rate = 1) => 440 * 2 ** ((key - 12 - 69) / 12) * rate;

function tone(wave: string, f: number, n: number, r: () => number, sr: number) {
  const out = new Float32Array(n);
  if (wave === "square") for (let i = 0; i < n; i++) out[i] = Math.sign(Math.sin((2 * Math.PI * f * i) / sr));
  else if (wave === "sawtooth") for (let i = 0; i < n; i++) out[i] = 2 * (((f * i) / sr) % 1) - 1;
  else if (wave === "noise") {
    const hold = Math.max(1, Math.floor(sr / Math.min(sr / 2, Math.max(60, f * 6))));
    let v = uni(r);
    for (let i = 0; i < n; i++) { if (i % hold === 0) v = uni(r); out[i] = v; }
  } else for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * f * i) / sr);
  return out;
}
function envelope(n: number, attack: number, release: number, sr: number) {
  const a = Math.floor(attack * sr), env = new Float32Array(n).fill(1);
  for (let i = 0; i < Math.min(a, n); i++) env[i] = i / a;
  const rn = Math.max(1, n - a);
  for (let i = a; i < n; i++) env[i] = (1 - (i - a) / rn) ** 2;
  return env;
}
const expEnv = (n: number, decay: number, sr: number) => { const e = new Float32Array(n), k = Math.max(0.005, decay) * sr / 5; for (let i = 0; i < n; i++) e[i] = Math.exp(-i / k); return e; };

const DRUM_KEYS: Record<number, [string, string]> = { 36: ["kick", "useKick"], 37: ["loTom", "useLoTom"], 38: ["hiTom", "useHiTom"], 39: ["snare", "useSnare"], 40: ["clap", "useClap"], 41: ["closedHat", "useClosedHat"], 42: ["openHat", "useOpenHat"] };

function diffNoise(r: () => number, n: number) { const raw = new Float32Array(n + 1); for (let i = 0; i <= n; i++) raw[i] = uni(r); const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = raw[i + 1] - raw[i]; return o; }

function drumBuffer(voice: any, key: number, sr: number, seed = 1337): Float32Array {
  const gf = DRUM_KEYS[key], params = voice.params || {};
  if (!gf || params[gf[1]] === false) return new Float32Array(Math.floor(0.05 * sr));
  const [group] = gf, p = params[group] || {}, decay = +(p.decay ?? 0.2), n = Math.max(Math.floor(0.05 * sr), Math.floor(decay * 1.3 * sr)), r = rng(seed + key);
  const sig = new Float32Array(n), env = expEnv(n, decay, sr);
  if (group === "kick") {
    const f0 = +(p.freq ?? 80), sweep = +(p.sweep ?? 0.6), punch = +(p.punch ?? 0.9);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += (f0 * (1 + sweep * 4 * Math.exp(-t * 40))) / sr; sig[i] = Math.sin(2 * Math.PI * ph) * env[i] + uni(r) * Math.exp(-t * 400) * punch * 0.4; }
  } else if (group === "loTom" || group === "hiTom") {
    let f0 = 60 + +(p.freq ?? 0.75) * 220; if (group === "hiTom") f0 *= 1.5;
    let ph = 0;
    for (let i = 0; i < n; i++) { ph += (f0 * (1 + 0.5 * Math.exp(-(i / sr) * 25))) / sr; sig[i] = Math.sin(2 * Math.PI * ph) * env[i]; }
  } else if (group === "snare") {
    const tam = +(p.tambre ?? 0.5), rat = diffNoise(r, n), fr = 140 + +(p.freq ?? 0.5) * 180;
    for (let i = 0; i < n; i++) sig[i] = (Math.sin((2 * Math.PI * fr * i) / sr) * (1 - tam * 0.5) * 0.6 + rat[i] * (0.3 + tam * 0.5)) * env[i];
  } else if (group === "clap") {
    const raw = diffNoise(r, n);
    for (const off of [0, 0.011, 0.022]) { const s = Math.floor(off * sr); for (let i = s; i < Math.min(n, s + Math.floor(0.008 * sr)); i++) env[i] += 0.8; }
    for (let i = 0; i < n; i++) sig[i] = raw[i] * env[i] * 0.5;
  } else {
    const hiss = diffNoise(r, n), f = 3000 + +(p.freq ?? 0.9) * 5000, body = +(p.body ?? 0.1);
    for (let i = 0; i < n; i++) {
      const t = i / sr; let metal = 0;
      for (const m of [1, 1.4, 1.71]) metal += Math.sign(Math.sin(2 * Math.PI * f * m * t));
      sig[i] = (hiss[i] * 0.5 + (metal / 3) * body * 2) * env[i];
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(sig[i]));
  for (let i = 0; i < n; i++) sig[i] = (peak > 1 ? sig[i] / peak : sig[i]) * DRUM_GAIN;
  return sig;
}

export function stepSeconds(bpm: number) { return 60 / (Math.max(1, bpm) * STEPS_PER_BEAT); }

function patternLength(pat: any): number {
  let last = -1;
  for (const k of Object.keys(pat.notes || {})) { const v = parseFloat(k); if (!Number.isNaN(v)) last = Math.max(last, v); }
  return Math.max(1, Math.ceil((last + 1) / LOOP_GRID)) * LOOP_GRID;
}
function clipsOf(track: any, patterns: any) {
  const out: [number, any, boolean][] = [];
  for (const [k, ref] of Object.entries<any>(track.sequence || {})) {
    const pat = patterns[ref?.patternId], start = parseFloat(k);
    if (!pat || Number.isNaN(start)) continue;
    out.push([start, pat, !!ref?.loop]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export interface NoteEv { t: number; key: number; vel: number; track: number }
export function collectNotes(music: any, bpm: number): NoteEv[] {
  const song = music?.song || {}, patterns = song.patterns || {}, sec = stepSeconds(bpm);
  const tracks = (song.tracks || []).map((t: any) => clipsOf(t, patterns));
  let songEnd = 0;
  for (const clips of tracks) for (const [s, p] of clips) songEnd = Math.max(songEnd, s + patternLength(p));
  const out: NoteEv[] = [];
  const emit = (ti: number, pat: any, at: number, until = Infinity) => {
    for (const [k, notes] of Object.entries<any>(pat.notes || {})) {
      const step = parseFloat(k);
      if (Number.isNaN(step) || at + step >= until) continue;
      for (const nt of notes || []) out.push({ t: (at + step) * sec, key: nt.key ?? 60, vel: nt.vel ?? 100, track: ti });
    }
  };
  tracks.forEach((clips: any[], ti: number) => clips.forEach(([start, pat, loops]: any, ci: number) => {
    emit(ti, pat, start);
    if (!loops) return;
    const len = patternLength(pat), limit = ci + 1 < clips.length ? clips[ci + 1][0] : songEnd;
    for (let at = start + len; at < limit && out.length < MAX_LOOP_NOTES; at += len) emit(ti, pat, at, limit);
  }));
  return out.sort((a, b) => a.t - b.t);
}

export function musicStats(music: any, bpm: number) {
  const notes = collectNotes(music, bpm), song = music?.song || {};
  return { tracks: (song.tracks || []).length, patterns: Object.keys(song.patterns || {}).length, notes: notes.length, seconds: notes.length ? notes[notes.length - 1].t : 0, bpm };
}

export function voicesFromMusic(music: any): { voices: any[]; warnings: string[] } {
  const voices: any[] = [], warnings: string[] = [];
  ((music?.song || {}).tracks || []).forEach((track: any, ti: number) => {
    const inst = track.instrument || {}, sample = inst.sample || {}, props = inst.props || {};
    if (inst.type === "drums") { voices.push({ drums: true, params: inst.params || {}, vol: +(props.volume ?? 1), muted: !!props.muted }); return; }
    if (sample.type != null && sample.type !== "tone") warnings.push(`Track ${ti + 1}: '${sample.type}' samples can't be previewed; using a sine tone.`);
    voices.push({
      wave: sample.waveform || "sine", attack: +(sample.attack || 0), release: +(sample.release ?? 0.3),
      amp: +(sample.amplitude?.value ?? 1), rate: +(sample.playbackRate?.value ?? 1),
      shift: (+(sample.midiNote ?? DEFAULT_MIDI_NOTE) || DEFAULT_MIDI_NOTE) - DEFAULT_MIDI_NOTE, vol: +(props.volume ?? 1), muted: !!props.muted,
    });
  });
  return { voices, warnings };
}

export function noteBuffer(voice: any, key: number, sr: number, seed = 1337): Float32Array {
  if (voice.drums) { const b = drumBuffer(voice, Math.trunc(key), sr, seed); for (let i = 0; i < b.length; i++) b[i] *= voice.vol; return b; }
  const n = Math.floor(Math.max(0.05, voice.attack + voice.release) * sr), r = rng(seed + Math.trunc(key));
  const sig = tone(voice.wave, freq(key + (voice.shift || 0), voice.rate), n, r, sr), env = envelope(n, voice.attack, voice.release, sr);
  const g = (WAVE_GAIN[voice.wave] ?? 0.4) * voice.amp * voice.vol;
  for (let i = 0; i < n; i++) sig[i] *= env[i] * g;
  return sig;
}

/** Whole song mixed offline with the same voices, velocity scaling and soft limiter as LiveSynth.
 *  Mono floats in [-1, 1] at `sr`, or null when nothing is audible. */
export function renderMusic(music: any, bpm: number, sr = 44100): Float32Array | null {
  const { voices } = voicesFromMusic(music);
  const notes = collectNotes(music, bpm).filter((n) => n.track < voices.length && !voices[n.track].muted);
  if (!notes.length) return null;
  const bufs = new Map<string, Float32Array>();
  const bufOf = (n: NoteEv) => {
    const k = n.track + ":" + n.key;
    let b = bufs.get(k);
    if (!b) { b = noteBuffer(voices[n.track], n.key, sr); bufs.set(k, b); }
    return b;
  };
  let end = 0;
  for (const n of notes) end = Math.max(end, Math.round(n.t * sr) + bufOf(n).length);
  const mix = new Float32Array(end + Math.round(TAIL_SECONDS * sr));
  for (const n of notes) {
    const b = bufOf(n), at = Math.round(n.t * sr), g = n.vel / 127;
    for (let i = 0; i < b.length; i++) mix[at + i] += b[i] * g;
  }
  for (let i = 0; i < mix.length; i++) mix[i] = Math.tanh(mix[i] * 0.9);
  return mix;
}

/** Plays the song through Web Audio, scheduling notes just ahead of the playhead. */
export class LiveSynth {
  warnings: string[];
  notes: NoteEv[];
  duration = 0;
  loop = true;
  playing = false;
  onEnd?: () => void;
  private voices: any[];
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private bufs = new Map<string, AudioBuffer>();
  private startedAt = 0;       // ctx time when position was `base`
  private base = 0;
  private timer: number | null = null;
  private nextIdx = 0;
  private live = new Set<AudioBufferSourceNode>();
  private closed = false;

  constructor(music: any, bpm: number, onEnd?: () => void) {
    const v = voicesFromMusic(music);
    this.voices = v.voices; this.warnings = v.warnings; this.onEnd = onEnd;
    this.notes = collectNotes(music, bpm).filter((n) => n.track < this.voices.length && !this.voices[n.track].muted);
    let maxLen = 0;
    for (const n of this.notes) { const l = this.rawLen(n); maxLen = Math.max(maxLen, l); }
    this.duration = this.notes.length ? this.notes[this.notes.length - 1].t + maxLen + TAIL_SECONDS : 0;
  }
  private rawLen(n: NoteEv) { const v = this.voices[n.track]; return v.drums ? Math.max(0.05, +(v.params?.[DRUM_KEYS[n.key]?.[0]]?.decay ?? 0.2) * 1.3) : Math.max(0.05, v.attack + v.release); }

  get position(): number {
    if (!this.ctx || !this.playing) return this.base;
    return Math.min(this.duration, this.base + (this.ctx.currentTime - this.startedAt));
  }
  private ensureCtx() {
    if (this.ctx) return;
    const ctx = new AudioContext(), shaper = ctx.createWaveShaper(), g = ctx.createGain();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 3 * 0.9) / 3;   // soft limiter
    shaper.curve = curve; g.gain.value = 3;
    shaper.connect(g); g.connect(ctx.destination);
    this.ctx = ctx; this.out = shaper;
  }
  private bufFor(n: NoteEv): AudioBuffer {
    const k = n.track + ":" + n.key;
    let b = this.bufs.get(k);
    if (!b) {
      const data = noteBuffer(this.voices[n.track], n.key, SAMPLE_RATE);
      b = this.ctx!.createBuffer(1, Math.max(1, data.length), SAMPLE_RATE);
      b.copyToChannel(data as any, 0);
      this.bufs.set(k, b);
    }
    return b;
  }
  play() {
    if (this.closed || !this.notes.length) return;
    this.ensureCtx();
    void this.ctx!.resume();
    if (this.base >= this.duration) this.base = 0;
    this.playing = true;
    this.startedAt = this.ctx!.currentTime;
    this.nextIdx = this.notes.findIndex((n) => n.t >= this.base);
    if (this.nextIdx < 0) this.nextIdx = this.notes.length;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 40);
  }
  private pump() {
    if (!this.playing || !this.ctx) return;
    const pos = this.position, horizon = pos + 0.3;
    while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].t < horizon) {
      const n = this.notes[this.nextIdx++];
      const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      src.buffer = this.bufFor(n); gain.gain.value = n.vel / 127;
      src.connect(gain); gain.connect(this.out!);
      src.start(this.startedAt + (n.t - this.base));
      this.live.add(src); src.onended = () => this.live.delete(src);
    }
    if (pos >= this.duration) {
      if (this.loop) { this.halt(); this.base = 0; this.play(); }
      else { this.halt(); this.base = 0; this.onEnd?.(); }
    }
  }
  private halt() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.live.forEach((s) => { try { s.stop(); } catch { /* ignore */ } });
    this.live.clear();
    this.playing = false;
  }
  pause() { if (!this.playing) return; const p = this.position; this.halt(); this.base = p; }
  stop() { this.halt(); this.base = 0; }
  seek(sec: number) {
    const was = this.playing;
    this.halt();
    this.base = Math.max(0, Math.min(sec, Math.max(0, this.duration - 0.001)));
    if (was) this.play();
  }
  close() { this.closed = true; this.halt(); void this.ctx?.close(); this.ctx = null; }
}
