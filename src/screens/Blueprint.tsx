import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CI, ColorField, IconButton, InfoNote, MI, Minor, PillButton, TextAction, confirmDialog, showDialog, contrastBg } from "@/components/widgets";
import { LogView } from "@/components/LogView";
import { openImportDialog } from "@/components/ImportDialog";
import { BlueprintIcon } from "./Card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { BG, MAJOR, MINOR1, SEP } from "@/lib/theme";
import { useApp, cardOf, editQuick, editAsync, ensureOnline, toast, back, useApp as _u, get } from "@/lib/store";
import * as ops from "@/lib/ops";
import { OpError, drawFrame, drawingInfo, frameCount, layerSummary, layersOf, d2Of, deleteLayer, moveLayer, renameLayer, makeCanvas, sceneBounds, NEW } from "@/lib/drawing";
import { IMAGE_EXTS, VIDEO_EXTS, VECTOR_EXTS, FONT_EXTS, AUDIO_EXTS } from "@/lib/imaging";
import { LiveSynth, musicStats } from "@/lib/synth";
import { audioUrls } from "@/lib/audio";
import { pickFile, saveBlob } from "@/lib/pick";
import { exportLayer } from "@/lib/export";
import { cn } from "@/lib/utils";

const ARCHIVES = ["zip", "tar", "gz", "tgz", "bz2", "xz", "tbz2", "txz"];
const ext = (s: Set<string>) => [...s].map((e) => e.replace(".", ""));
const MEDIA_EXTS = [...new Set([...ext(IMAGE_EXTS), ...ext(VIDEO_EXTS), ...ext(VECTOR_EXTS), ...ext(FONT_EXTS), ...ARCHIVES])].sort();
const AUDIO_PICK = [...new Set([...ext(AUDIO_EXTS), ...ARCHIVES])].sort();
const LAYER_ROW_H = 48;
const clock = (s: number) => { const t = Math.max(0, Math.trunc(s)); return `${Math.trunc(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

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

// ── MEDIA ──────────────────────────────────────────────────────────────
function MediaPanel({ deckId, cardId, entryId }: P) {
  const rc = cardOf(deckId, cardId)!, bp = ops.libraryOf(rc)[entryId], d2 = d2Of(bp), has = !!d2 && frameCount(d2) > 0;
  const pick = async (target: string) => {
    const f = await pickFile(MEDIA_EXTS);
    if (!f) return;
    let info: ops.MediaInfo;
    try { info = await ops.inspectMedia(f); } catch (e: any) { toast(e?.message || String(e), true); return; }
    if (info.category === "audio") { toast("That's audio. Use the Audio tab.", true); return; }
    if (info.unsupported) { toast(info.unsupported, true); return; }
    openImportDialog({ deckId, cardId, entryId, file: f, info, layer: target });
  };
  return (
    <div className="flex flex-col gap-2.5">
      {has ? <PreviewBlock d2={d2} /> : <div className="flex h-[140px] items-center justify-center"><CI name="pencil" size={30} color={MINOR1} /></div>}
      <div className="flex"><PillButton label="New Layer" filled icon={<CI name="add" size={18} color={BG} />} onClick={() => void pick(NEW)} /></div>
      <LayerList {...{ deckId, cardId, entryId }} onPick={pick} />
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

function LayerRow({ layer, deckId, cardId, entryId, onPick }: { layer: any; onPick: (id: string) => void } & P) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id });
  const run = (fn: (d2: any) => void) => editQuick(deckId, cardId, (rc) => { const d2 = d2Of(ops.libraryOf(rc)[entryId]); if (!d2 || !layersOf(d2).length) throw new OpError("This blueprint has no drawing."); fn(d2); });
  const rename = () => {
    const Body = ({ close }: { close: () => void }) => {
      const [v, setV] = useState(layer.title);
      const save = () => { const name = v.trim(); if (!name) { toast("A layer needs a name.", true); return; } close(); if (name !== layer.title) void run((d2) => renameLayer(d2, layer.id, name)); };
      (Body as any).save = save;
      return <div style={{ width: 260 }}><Input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></div>;
    };
    showDialog("Rename layer", (close) => <Body close={close} />, { actions: () => <TextAction label="Save" onClick={() => (Body as any).save?.()} /> });
  };
  const exportIt = async () => {
    try {
      const d2 = d2Of(ops.libraryOf(cardOf(deckId, cardId)!)[entryId]);
      const r = await exportLayer(d2, layer.id);
      const base = `${ops.blueprintTitle(ops.libraryOf(cardOf(deckId, cardId)!)[entryId], entryId)}-${layer.title || "Layer"}`.replace(/[\\/:*?"<>|]+/g, "_").trim() || "layer";
      saveBlob(`${base}.png`, new Blob([r.bytes as BlobPart], { type: "image/png" }));   // an APNG is a PNG that animates, so .png opens everywhere
      toast(r.frames > 1 ? `Exported ${r.frames} frames as APNG.` : "Exported PNG.");
    } catch (e: any) { toast(e?.message || String(e), true); }
  };
  return (
    <div ref={setNodeRef} className="flex items-center border-b bg-black" style={{ height: LAYER_ROW_H, borderColor: SEP, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, position: "relative", zIndex: isDragging ? 5 : 0 }}>
      <div {...attributes} {...listeners} className="flex cursor-grab touch-none items-center justify-center" style={{ width: 40, height: LAYER_ROW_H }}><MI name="menu" size={22} color={MINOR1} /></div>
      <button type="button" onClick={rename} className="h-full min-w-0 flex-1 truncate text-left text-sm hover:bg-accent/40">{layer.title || "Layer"}</button>
      <IconButton size={40} tooltip={frameCount(d2Of(ops.libraryOf(cardOf(deckId, cardId)!)[entryId])) > 1 ? "Export layer as APNG" : "Export layer as PNG"} onClick={exportIt}><CI name="download2" size={20} /></IconButton>
      <IconButton size={40} tooltip="Overwrite layer" onClick={() => onPick(layer.id)}><CI name="upload" size={20} /></IconButton>
      <IconButton size={40} tooltip="Delete layer" onClick={() => confirmDialog(`Delete "${layer.title || "Layer"}"?`, "", "Delete", () => void run((d2) => deleteLayer(d2, layer.id)))}><CI name="delete" size={20} /></IconButton>
    </div>
  );
}

/** Top layer first (like Castle's own layer list). Drag a layer's menu icon to move it. */
function LayerList({ deckId, cardId, entryId, onPick }: P & { onPick: (id: string) => void }) {
  const rc = cardOf(deckId, cardId)!, d2 = d2Of(ops.libraryOf(rc)[entryId]), layers = layerSummary(d2), shown = [...layers].reverse();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (!layers.length) return null;
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const n = layers.length, from = shown.findIndex((l) => l.id === e.active.id), to = shown.findIndex((l) => l.id === e.over!.id);
    // the list shows the top layer first: display index i is storage index n - 1 - i
    void editQuick(deckId, cardId, (c) => moveLayer(d2Of(ops.libraryOf(c)[entryId]), n - 1 - from, n - 1 - to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
      <SortableContext items={shown.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div>{shown.map((l) => <LayerRow key={l.id} layer={l} {...{ deckId, cardId, entryId, onPick }} />)}</div>
      </SortableContext>
    </DndContext>
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
function Player({ music, bpm }: { music: any; bpm: number }) {
  const eng = useMemo(() => { try { const e = new LiveSynth(music, bpm); e.loop = false; return e; } catch { return null; } }, [music, bpm]);
  const [pos, setPos] = useState(0), [playing, setPlaying] = useState(false), [drag, setDrag] = useState<number | null>(null);
  useEffect(() => () => eng?.close(), [eng]);
  useEffect(() => {
    if (!eng) return;
    eng.onEnd = () => { setPlaying(false); setPos(0); };
    const h = window.setInterval(() => { setPos(eng.position); setPlaying(eng.playing); }, 100);
    return () => clearInterval(h);
  }, [eng]);
  if (!eng) return <Minor>Couldn't prepare the player.</Minor>;
  if (!eng.notes.length) return <Minor>No notes</Minor>;
  const durMs = Math.max(1, Math.trunc(eng.duration * 1000));
  const row = (
    <div className="flex items-center gap-0.5">
      <IconButton size={44} onClick={() => { if (eng.playing) { eng.stop(); setPos(0); setPlaying(false); } else { eng.play(); setPlaying(true); } }}><CI name={playing ? "stop" : "play_music"} size={26} /></IconButton>
      <div className="w-10 text-right text-xs" style={{ color: MINOR1 }}>{clock(drag !== null ? drag / 1000 : pos)}</div>
      <Slider min={0} max={durMs} step={1} className="mx-2" value={[drag ?? Math.min(pos * 1000, durMs)]} onValueChange={(v) => setDrag(v[0])} onValueCommit={(v) => { setDrag(null); eng.seek(v[0] / 1000); }} />
      <div className="w-10 text-left text-xs" style={{ color: MINOR1 }}>{clock(eng.duration)}</div>
    </div>
  );
  return eng.warnings.length ? <div className="flex flex-col gap-1.5">{row}<InfoNote>{eng.warnings.join("\n")}</InfoNote></div> : row;
}

function MusicPanel({ deckId, cardId, entryId }: P) {
  const rc = cardOf(deckId, cardId)!, bp = ops.libraryOf(rc)[entryId], music = ops.components(bp).Music, bpm = ops.cardTempo(rc);
  const upload = async () => {
    const f = await pickFile(["mid", "midi", "smf"]);
    if (!f) return;
    const res = await editAsync(deckId, cardId, "Importing MIDI", (task, c, rec) => ops.importMidi({ rc: c, rec, entryId }, f, task));
    if (res) toast("MIDI imported.");
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
        <Player music={music} bpm={bpm} />
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
  const rc = cardOf(deckId, cardId)!, urls = audioUrls(ops.libraryOf(rc)[entryId]);
  const upload = async () => {
    if (!(await ensureOnline())) return;
    const f = await pickFile(AUDIO_PICK);
    if (!f) return;
    let info: ops.MediaInfo;
    try { info = await ops.inspectMedia(f); } catch (e: any) { toast(e?.message || String(e), true); return; }
    const res = await editAsync(deckId, cardId, "Uploading audio", (task, c, rec) => ops.importAudio({ rc: c, rec, entryId }, info, task));
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
      <div className="mt-3.5 flex"><PillButton label="Upload" filled icon={<CI name="upload" size={18} color={BG} />} onClick={() => void upload()} /></div>
      <InfoNote>Audio is split into 30 second segments</InfoNote>
      <LogBox />
    </div>
  );
}
void cn; void _u; void get; void makeCanvas;
