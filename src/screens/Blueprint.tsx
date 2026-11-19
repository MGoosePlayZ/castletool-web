import { useEffect, useMemo, useRef, useState } from "react";
import { CI, ColorField, IconButton, InfoNote, MI, Minor, PillButton, TextAction, showDialog, contrastBg } from "@/components/widgets";
import { LogView } from "@/components/LogView";
import { openImportDialog } from "@/components/ImportDialog";
import { BlueprintIcon } from "./Card";
import { Slider } from "@/components/ui/slider";
import { BG, MAJOR, MINOR1, SEP } from "@/lib/theme";
import { useApp, cardOf, editQuick, editAsync, ensureOnline, toast, back, nav, useApp as _u, get } from "@/lib/store";
import * as ops from "@/lib/ops";
import { drawFrame, drawingInfo, frameCount, d2Of, makeCanvas, sceneBounds } from "@/lib/drawing";
import { IMAGE_EXTS, VIDEO_EXTS, VECTOR_EXTS, FONT_EXTS, AUDIO_EXTS } from "@/lib/imaging";
import { musicStats } from "@/lib/synth";
import { PianoRoller } from "@/components/PianoRoller";
import { AUDIO_SPEEDS, audioUrls } from "@/lib/audio";
import { VOLUME_OFFSET_MIN, VOLUME_OFFSET_MAX, clampVolumeOffset } from "@/lib/midi";
import { pickFile, pickFiles, saveBlob } from "@/lib/pick";
import { cn } from "@/lib/utils";

const ARCHIVES = ["zip", "tar", "gz", "tgz", "bz2", "xz", "tbz2", "txz"];
const ext = (s: Set<string>) => [...s].map((e) => e.replace(".", ""));
const MEDIA_EXTS = [...new Set([...ext(IMAGE_EXTS), ...ext(VIDEO_EXTS), ...ext(VECTOR_EXTS), ...ARCHIVES])].sort();
const AUDIO_PICK = [...new Set([...ext(AUDIO_EXTS), ...ARCHIVES])].sort();

type Tab = "media" | "music" | "audio";
interface P { deckId: string; cardId: string; entryId: string }

export function BlueprintView({ deckId, cardId, entryId }: P) {
  useApp();
  const rc = cardOf(deckId, cardId), bp = rc ? ops.libraryOf(rc)[entryId] : undefined;
  const [tab, setTab] = useState<Tab>("media");
  useEffect(() => { if (rc && !bp) back(); }, [rc, bp]);      // e.g. undo removed this blueprint
  if (!rc || !bp) return <div />;
  const isText = !!ops.textComponent(bp), name = ops.blueprintTitle(bp, entryId);
  const tabBtn = (key: Tab, label: string, icon: string) => {
    const active = tab === key;
    return (
      <button key={key} type="button" onClick={() => setTab(key)} className="flex flex-1 flex-col items-center gap-0.5 py-2 hover:bg-accent/40" style={{ borderBottom: `${active ? 2 : 1}px solid ${active ? MAJOR : SEP}` }}>
        <CI name={icon} size={24} color={active ? MAJOR : MINOR1} />
        <span className="text-xs" style={{ color: active ? MAJOR : MINOR1, fontWeight: active ? 700 : 400 }}>{label}</span>
      </button>
    );
  };
  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center gap-3.5 p-3.5">
        <BlueprintIcon bp={bp} size={72} holder={76} />
        <div className="line-clamp-2 min-w-0 flex-1 text-xl font-bold">{name}</div>
      </div>
      <div className="flex">{tabBtn("media", "Media", "pencil")}{tabBtn("music", "Music", "music")}{tabBtn("audio", "Audio", "unmuted")}</div>
      <div className="p-3.5">
        {tab === "media" ? (isText ? <TextPanel key={entryId} {...{ deckId, cardId, entryId }} /> : <MediaPanel {...{ deckId, cardId, entryId }} />)
          : tab === "music" ? <MusicPanel {...{ deckId, cardId, entryId }} /> : <AudioPanel {...{ deckId, cardId, entryId }} />}
      </div>
    </div>
  );
}

const LogBox = () => { const { devMode } = useApp(); return devMode ? <div className="mt-3.5 flex flex-col gap-1"><Minor size={11}>Activity</Minor><LogView height={110} /></div> : null; };

/** Pick media, inspect it, open the import dialog. `before` runs once a usable file is chosen (the art editor saves its edits there),
 *  `done` after the import went through. */
export async function startMediaImport(deckId: string, cardId: string, entryId: string, target: string, hooks: { before?: () => Promise<boolean>; done?: () => void } = {}) {
  const picked = await pickFiles(MEDIA_EXTS);
  if (!picked.length) return;
  const f = picked[0];
  let info: ops.MediaInfo;
  try { info = await ops.inspectMedia(picked.length === 1 ? f : picked); } catch (e: any) { toast(e?.message || String(e), true); return; }
  if (info.category === "audio") { toast("That's audio. Use the Audio tab.", true); return; }
  if (info.category === "font") { toast("Fonts are used from text layers in the art editor.", true); return; }
  if (info.unsupported) { toast(info.unsupported, true); return; }
  if (hooks.before && !(await hooks.before())) return;
  openImportDialog({ deckId, cardId, entryId, file: f, info, layer: target, onImported: hooks.done });
}

// ── MEDIA ──────────────────────────────────────────────────────────────
function MediaPanel({ deckId, cardId, entryId }: P) {
  const rc = cardOf(deckId, cardId)!, bp = ops.libraryOf(rc)[entryId], d2 = d2Of(bp), has = !!d2 && frameCount(d2) > 0;
  return (
    <div className="flex flex-col gap-2.5">
      {has ? <PreviewBlock d2={d2} /> : <div className="flex h-[140px] items-center justify-center"><CI name="pencil" size={30} color={MINOR1} /></div>}
      <div className="flex"><PillButton label="Open Editor" filled icon={<CI name="pencil" size={18} color={BG} />} onClick={() => nav({ editor: true })} /></div>
      <LogBox />
    </div>
  );
}

function PreviewBlock({ d2 }: { d2: any }) {
  const info = drawingInfo(d2), n = info.frames, cv = useRef<HTMLCanvasElement>(null);
  const [i, setI] = useState(0), [playing, setPlaying] = useState(info.playMode !== "still");
  const bounds = useMemo(() => sceneBounds(d2, Array.from({ length: n }, (_, k) => k)), [d2, n]);
  useEffect(() => { setI((x) => Math.min(x, Math.max(0, n - 1))); }, [n]);
  useEffect(() => { void drawFrame(cv.current!, d2, i, bounds); }, [d2, i, bounds]);
  useEffect(() => {
    if (n <= 1 || !playing) return;
    const h = window.setInterval(() => setI((x) => (x + 1) % n), 1000 / Math.max(1, Math.min(60, +info.fps || 4)));
    return () => clearInterval(h);
  }, [n, playing, info.fps, d2]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[250px] items-center justify-center"><canvas ref={cv} width={480} height={480} style={{ width: 240, height: 240 }} /></div>
      {n > 1 && (
        <div className="flex items-center">
          <IconButton size={36} onClick={() => setPlaying(!playing)} tooltip={playing ? "Pause" : "Play"}><CI name={playing ? "pause" : "play"} size={22} /></IconButton>
          <Slider min={1} max={n} step={1} value={[i + 1]} onValueChange={(v) => setI(v[0] - 1)} className="mx-2" />
          <Minor className="w-14 text-right">{`${i + 1} / ${n}`}</Minor>
        </div>
      )}
    </div>
  );
}

// ── TEXT ACTOR ─────────────────────────────────────────────────────────
function useWidth() {
  const ref = useRef<HTMLDivElement>(null), [w, setW] = useState(360);
  useEffect(() => { const el = ref.current; if (!el) return; const o = new ResizeObserver(() => setW(el.clientWidth)); o.observe(el); setW(el.clientWidth); return () => o.disconnect(); }, []);
  return [ref, w] as const;
}
const ALIGN_ICON: Record<string, string> = { "top,left": "arrow_insert", "top,center": "arrow_upward", "top,right": "arrow_outward", "middle,left": "arrow_back", "middle,center": "center_focus_weak", "middle,right": "arrow_forward", "bottom,left": "arrow_insert", "bottom,center": "arrow_downward", "bottom,right": "arrow_outward" };
function AlignIcon({ v, h, color }: { v: string; h: string; color: string }) {
  const flip = v === "bottom" && (h === "left" || h === "right");     // mirrored upside down
  return <span style={{ display: "inline-block", transform: flip ? "scaleY(-1)" : undefined }}><MI name={ALIGN_ICON[`${v},${h}`]} size={26} color={color} /></span>;
}
const title1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function TextPanel({ deckId, cardId, entryId }: P) {
  useApp();
  const rc = cardOf(deckId, cardId)!, t = ops.textComponent(ops.libraryOf(rc)[entryId]) || {};
  const stored = t.content || "", [content, setContent] = useState<string>(stored), timer = useRef<number | null>(null), area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (document.activeElement !== area.current) setContent(stored); }, [stored]);
  const commit = (props: Record<string, any>) => editQuick(deckId, cardId, (c) => { const bp = ops.libraryOf(c)[entryId]; ops.setTextProps(bp, props); });
  const saveContent = (value: string) => { if (timer.current) clearTimeout(timer.current); if (value !== (ops.textComponent(ops.libraryOf(cardOf(deckId, cardId)!)[entryId])?.content || "")) void commit({ content: value }); };
  const curColor = ops.textColorHex(t.color), fontName = t.fontName, [fontsRef, width] = useWidth();
  const gap = 4, nF = ops.TEXT_FONTS.length, iconPx = Math.max(12, Math.min(28, ((width - gap * (nF - 1)) / nF) * 0.6));
  const curH = ops.TEXT_H_ALIGN.includes(t.alignment) ? t.alignment : "center", curV = ops.TEXT_V_ALIGN.includes(t.verticalAlignment) ? t.verticalAlignment : "top";
  const openAlign = () => showDialog(null, (close) => (
    <div className="flex flex-col gap-2">{ops.TEXT_V_ALIGN.map((v) => (
      <div key={v} className="flex gap-2">{ops.TEXT_H_ALIGN.map((h) => {
        const on = v === curV && h === curH;
        return <button key={h} type="button" onClick={() => { close(); void commit({ alignment: h, verticalAlignment: v }); }} className="flex items-center justify-center rounded-[10px] border hover:bg-accent" style={{ width: 56, height: 56, borderColor: on ? MAJOR : SEP }}><AlignIcon v={v} h={h} color={on ? MAJOR : MINOR1} /></button>;
      })}</div>))}</div>
  ));
  return (
    <div className="flex flex-col gap-3.5">
      <textarea ref={area} rows={3} value={content} onChange={(e) => { setContent(e.target.value); if (timer.current) clearTimeout(timer.current); const v = e.target.value; timer.current = window.setTimeout(() => saveContent(v), 800); }} onBlur={() => saveContent(content)}
        className="max-h-[220px] min-h-[84px] w-full resize-none rounded-lg border p-3 outline-none" style={{ fontFamily: `"${fontName || "DMSans"}", sans-serif`, color: curColor, caretColor: curColor, background: contrastBg(curColor), fontSize: 16, borderColor: SEP }} />
      <div ref={fontsRef} className="flex" style={{ gap }}>
        {ops.TEXT_FONTS.map(([name, icon]) => (
          <button key={name} type="button" onClick={() => void commit({ fontName: name })} className="flex flex-1 items-center justify-center rounded-lg border hover:bg-accent" style={{ aspectRatio: "1", borderColor: name === fontName ? MAJOR : SEP }}>
            <CI name={icon} size={iconPx} color={name === fontName ? MAJOR : MINOR1} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={openAlign} className="flex items-center justify-center rounded-[10px] border hover:bg-accent" style={{ width: 48, height: 48, borderColor: SEP }}><AlignIcon v={curV} h={curH} color={MAJOR} /></button>
        <span className="text-sm">{`${title1(curV)} ${title1(curH)}`}</span>
      </div>
      <div><ColorField value={curColor} onChange={(v) => void commit({ color: v })} /></div>
      <LogBox />
    </div>
  );
}

// ── MUSIC ──────────────────────────────────────────────────────────────
/** Volume offset slider of the MIDI import dialog: -127..127, 0 = the file's own velocities. */
function MidiVolume({ onChange }: { onChange: (v: number) => void }) {
  const [v, setV] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm" style={{ color: MINOR1 }}>{v ? `Volume offset: ${v > 0 ? "+" : ""}${v}` : "Volume offset: 0"}</div>
      <Slider min={VOLUME_OFFSET_MIN} max={VOLUME_OFFSET_MAX} step={1} value={[v]} onValueChange={(x) => { const n = clampVolumeOffset(x[0]); setV(n); onChange(n); }} />
    </div>
  );
}

function MusicPanel({ deckId, cardId, entryId }: P) {
  const rc = cardOf(deckId, cardId)!, bp = ops.libraryOf(rc)[entryId], music = ops.components(bp).Music, bpm = ops.cardTempo(rc);
  const upload = async () => {
    const f = await pickFile(["mid", "midi", "smf"]);
    if (!f) return;
    const run = async (volumeOffset: number) => {
      const res = await editAsync(deckId, cardId, "Importing MIDI", (task, c, rec) => ops.importMidi({ rc: c, rec, entryId }, f, task, volumeOffset));
      if (res) toast("MIDI imported.");
    };
    const chosen = { v: 0 };
    showDialog("Import MIDI", () => <MidiVolume onChange={(v) => { chosen.v = v; }} />, {
      actions: (close) => <TextAction label="Import" onClick={() => { close(); void run(clampVolumeOffset(chosen.v)); }} />,
    });
  };
  const download = () => {
    try {
      const base = ((bp.title || "music") + "-music").replace(/[\\/:*?"<>|]+/g, "_").trim() || "music";
      saveBlob(`${base}.mp3`, ops.exportMusicMp3(rc, entryId));
      toast("Saved MP3.");
    } catch (e: any) { toast(e?.message || String(e), true); }
  };
  const toSound = async () => {
    if (!(await ensureOnline())) return;
    const res = await editAsync(deckId, cardId, "Converting music", (task, c, rec) => ops.musicToSound({ rc: c, rec, entryId }, task));
    if (res) toast("Music converted to sound.");
  };
  const askToSound = () => {
    const hasSound = audioUrls(bp).length > 0;
    showDialog("Convert Music to Sound?", () => (
      <div className="flex flex-col gap-2.5 text-sm" style={{ color: MINOR1 }}>
        <p>The music is rendered to an MP3 and uploaded to Castle as this blueprint's sound. The music data is deleted in favor of the sound data, so it can't be edited or played as music afterwards.</p>
        {hasSound && <p>This blueprint already has a sound uploaded. It will be overwritten.</p>}
      </div>
    ), { actions: (close) => <TextAction label="Convert" onClick={() => { close(); void toSound(); }} /> });
  };
  const st = music ? musicStats(music, bpm) : null;
  return (
    <div className="flex flex-col gap-2">
      {music && st ? <>
        <Minor size={12}>{`${st.tracks} track${st.tracks !== 1 ? "s" : ""} · ${st.notes.toLocaleString("en-US")} notes · ${+bpm.toPrecision(12)} BPM`}</Minor>
        <PianoRoller music={music} bpm={bpm} />
        <InfoNote>Non-tonal samples aren't implemented</InfoNote>
      </> : <div className="flex h-[120px] items-center justify-center"><CI name="music" size={30} color={MINOR1} /></div>}
      <div className="mt-3.5 flex"><PillButton label="Upload" filled icon={<CI name="upload" size={18} color={BG} />} onClick={() => void upload()} /></div>
      {music && ops.hasMusic(bp) && (
        <div className="flex flex-wrap gap-2">
          <PillButton label="Download MP3" icon={<CI name="download2" size={18} />} onClick={download} />
          <PillButton label="Music to Sound" onClick={askToSound} />
        </div>
      )}
      <LogBox />
    </div>
  );
}

// ── AUDIO ──────────────────────────────────────────────────────────────
function AudioPanel({ deckId, cardId, entryId }: P) {
  const rc = cardOf(deckId, cardId)!, urls = audioUrls(ops.libraryOf(rc)[entryId]), [speed, setSpeed] = useState(0);
  const upload = async () => {
    if (!(await ensureOnline())) return;
    const f = await pickFile(AUDIO_PICK);
    if (!f) return;
    let info: ops.MediaInfo;
    try { info = await ops.inspectMedia(f); } catch (e: any) { toast(e?.message || String(e), true); return; }
    const res = await editAsync(deckId, cardId, "Uploading audio", (task, c, rec) => ops.importAudio({ rc: c, rec, entryId }, info, task, speed));
    if (res) toast(res.length === 1 ? "Audio added." : `Added ${res.length} actors.`);
  };
  return (
    <div className="flex flex-col gap-2">
      {urls.length ? urls.map((u, i) => (
        <div key={i} className="flex items-center rounded-lg border px-2.5 py-1.5" style={{ borderColor: SEP }}>
          <Minor className="w-5">{i + 1}</Minor>
          <span className="min-w-0 flex-1 select-text break-all text-xs">{u.replace(/\?.*$/, "").replace(/\/+$/, "").split("/").pop()}</span>
        </div>
      )) : <div className="flex h-[120px] items-center justify-center"><CI name="unmuted" size={30} color={MINOR1} /></div>}
      <div className="mt-3.5 flex flex-col gap-1.5">
        <Minor>Speed up</Minor>
        <div className="flex gap-1.5">{AUDIO_SPEEDS.map((k, i) => <PillButton key={k} label={`${k}x`} filled={speed === i} onClick={() => setSpeed(i)} className="min-w-0 flex-1 px-0" />)}</div>
      </div>
      <div className="mt-2 flex"><PillButton label="Upload" filled icon={<CI name="upload" size={18} color={BG} />} onClick={() => void upload()} /></div>
      <InfoNote>Audio is split into 30 second segments</InfoNote>
      {speed > 0 && <InfoNote>{`The sound is sped up ${AUDIO_SPEEDS[speed]}x (samples are dropped, which bit-crushes it), then played back at 1/${AUDIO_SPEEDS[speed]} speed. Each 30 second segment holds ${AUDIO_SPEEDS[speed]}x more of the sound, so fewer segments are needed.`}</InfoNote>}
      <LogBox />
    </div>
  );
}
void cn; void _u; void get; void makeCanvas;
