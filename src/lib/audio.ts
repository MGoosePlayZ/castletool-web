// Sound → MP3 parts of < 30 s (Castle's limit) → upload → play-on-create loop rule. (CTA's media_av / attach_audio.)
import { Mp3Encoder } from "@breezystack/lamejs";
import * as api from "./api";
import { OpError } from "./drawing";
import { Prog, NOOP, tick } from "./tasks";
import { extOf, stemOf } from "./imaging";

export const AUDIO_CHUNK_SECONDS = 30;
export const AUDIO_SEGMENT_SECONDS = 29.9;
export const canEncodeMp3 = () => typeof AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined";

async function decode(file: Blob): Promise<AudioBuffer> {
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  finally { void ctx.close(); }
}
async function resample44k(buf: AudioBuffer): Promise<Int16Array[]> {
  const len = Math.max(1, Math.ceil(buf.duration * 44100)), off = new OfflineAudioContext(2, len, 44100), src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering(), ch: Int16Array[] = [];
  for (let c = 0; c < 2; c++) {
    const f = out.getChannelData(c), i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    ch.push(i16);
  }
  return ch;
}
function encodeMp3(l: Int16Array, r: Int16Array): Blob {
  const enc = new Mp3Encoder(2, 44100, 96), chunks: Uint8Array[] = [];
  for (let i = 0; i < l.length; i += 1152) {
    const out = enc.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
    if (out.length) chunks.push(new Uint8Array(out));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}
async function mp3Duration(f: Blob): Promise<number | null> {
  return new Promise((res) => {
    const a = new Audio(), url = URL.createObjectURL(f);
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(isFinite(a.duration) ? a.duration : null); };
    a.onerror = () => { URL.revokeObjectURL(url); res(null); };
    a.src = url;
  });
}

export interface Part { blob: Blob; name: string }
/** Convert `file`'s sound to MP3 part(s) of at most ~30 s each, in playback order. A short MP3 is returned untouched. */
export async function splitAudioMp3(file: File, isVideo: boolean, prog: Prog = NOOP): Promise<Part[]> {
  const already = !isVideo && extOf(file.name) === ".mp3";
  if (already) { const d = await mp3Duration(file); if (d !== null && d <= AUDIO_CHUNK_SECONDS) return [{ blob: file, name: file.name }]; }
  let buf: AudioBuffer;
  try { buf = await decode(file); }
  catch { throw new OpError(already ? "Couldn't read that MP3." : "Couldn't read the sound. Does the file have a sound track?"); }
  const [l, r] = await resample44k(buf);
  return encodeSegments(l, r, isVideo ? "audio" : stemOf(file.name), prog);
}

/** Split 44.1 kHz stereo PCM into MP3 parts of < 30 s. */
async function encodeSegments(l: Int16Array, r: Int16Array, stem: string, prog: Prog): Promise<Part[]> {
  const seg = Math.floor(AUDIO_SEGMENT_SECONDS * 44100), n = Math.max(1, Math.ceil(l.length / seg)), parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    prog.step(i, n, `Encoding segment ${i + 1}/${n}`);
    parts.push({ blob: encodeMp3(l.subarray(i * seg, (i + 1) * seg), r.subarray(i * seg, (i + 1) * seg)), name: n === 1 ? `${stem}.mp3` : `${stem}_part${String(i + 1).padStart(3, "0")}.mp3` });
    await tick();
  }
  return parts;
}
const floatToI16 = (f: Float32Array) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))); return o; };

/** Mono 44.1 kHz floats (e.g. rendered Music) → one full-length MP3 (no 30 s limit). */
export function pcmToMp3(pcm: Float32Array): Blob { const i16 = floatToI16(pcm); return encodeMp3(i16, i16); }

// ── rules ──────────────────────────────────────────────────────────────
const playSound = (uploadUrl: string) => ({
  name: "play sound", behaviorId: 16,
  params: { type: "library", playbackRate: 1, amplitude: 1, pan: 0, recordingUrl: "", uploadUrl, category: "random", seed: 1337, mutationSeed: 0, mutationAmount: 5, midiNote: 60, waveform: "square", attack: 0, release: 0.4, wait: true },
});
export function createAudioRule(urls: string[]) {
  let chain: any = null;
  for (const url of [...urls].reverse()) { const r = playSound(url); if (chain) r.params = { ...r.params, nextResponse: chain } as any; chain = r; }
  return { trigger: { name: "create", behaviorId: 16, params: {} }, response: { name: "infinite repeat", behaviorId: 16, params: { interval: 0.01666, body: chain } } };
}
export const isAudioLoopRule = (rule: any) => rule?.trigger?.name === "create" && rule?.response?.name === "infinite repeat" && rule?.response?.params?.body?.name === "play sound";
export function addOrReplaceAudioRule(actor: any, urls: string[]) {
  const comps = actor.actorBlueprint.components;
  const rc = (comps.Rules ||= { rules: [], disabled: false });
  rc.rules ||= []; rc.disabled = false;
  const rep = createAudioRule(urls), i = rc.rules.findIndex(isAudioLoopRule);
  if (i >= 0) rc.rules[i] = rep; else rc.rules.push(rep);
}
export function stripAudioRules(actor: any) {
  const r = actor?.actorBlueprint?.components?.Rules;
  if (r && Array.isArray(r.rules)) r.rules = r.rules.filter((x: any) => !isAudioLoopRule(x));
}
export function audioUrls(bp: any): string[] {
  const rules = bp?.actorBlueprint?.components?.Rules?.rules || [], urls: string[] = [];
  for (const rule of rules) {
    if (!isAudioLoopRule(rule)) continue;
    let node = rule.response.params.body;
    while (node && typeof node === "object" && node.name === "play sound") { if (node.params?.uploadUrl) urls.push(node.params.uploadUrl); node = node.params?.nextResponse; }
  }
  return urls;
}

async function uploadParts(actor: any, parts: Part[], up: Prog, log: (m: string) => void) {
  const urls: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    up.step(i, parts.length, `Uploading segment ${i + 1}/${parts.length}`);
    urls.push((await api.uploadAudio(parts[i].blob, parts[i].name)).url);
  }
  addOrReplaceAudioRule(actor, urls);
  log(urls.length > 1 ? `Audio added: ${urls.length} parts (each under ${AUDIO_CHUNK_SECONDS}s), played back to back` : `Audio added: ${urls[0]}`);
}
const failure = (e: any, log: (m: string) => void) => {
  if (e?.name === "Cancelled") throw e;
  log(`error: Audio upload failed: ${e?.message || e}`);
  return { ok: false, error: String(e?.message || e) };
};

/** Upload `src`'s sound and add a play-on-create loop rule to `actor`. Returns false (actor untouched) on failure. */
export async function attachAudio(actor: any, src: File, isVideo: boolean, prog: Prog, log: (m: string) => void): Promise<{ ok: boolean; error?: string }> {
  try {
    prog.say(isVideo ? "Extracting audio" : `Converting ${src.name}`, 0);
    const parts = await splitAudioMp3(src, isVideo, prog.sub(0, 0.5));
    await uploadParts(actor, parts, prog.sub(0.5, 1), log);
    return { ok: true };
  } catch (e: any) { return failure(e, log); }
}

/** Same as attachAudio, for already-rendered mono 44.1 kHz floats (Music → Sound). */
export async function attachPcm(actor: any, pcm: Float32Array, stem: string, prog: Prog, log: (m: string) => void): Promise<{ ok: boolean; error?: string }> {
  try {
    prog.say("Encoding sound", 0);
    const i16 = floatToI16(pcm), parts = await encodeSegments(i16, i16, stem, prog.sub(0, 0.5));
    await uploadParts(actor, parts, prog.sub(0.5, 1), log);
    return { ok: true };
  } catch (e: any) { return failure(e, log); }
}
