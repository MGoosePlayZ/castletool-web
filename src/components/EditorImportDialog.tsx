// The art editor's upload dialog: every setting of the picked picture / animation / video is chosen here, once, before it is
// processed (frame skipping, smoothing, colour reduction, frame rate of several files, the video's soundtrack).
import { useState } from "react";
import { InfoNote, Minor, NumberBox, PillButton, showDialog } from "./widgets";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import * as ops from "@/lib/ops";

export interface ImageImportOpts { every: number; smooth: boolean; quantize: number; fps: number; sound: boolean }
type Vals = { every: string; fps: string; smooth: boolean; reduce: boolean; colors: string; sound: boolean };

const asInt = (s: string, d: number) => { const n = Math.trunc(parseFloat(s)); return Number.isFinite(n) ? n : d; };

function Body({ info, hasSound, cur }: { info: ops.MediaInfo; hasSound: boolean; cur: { v: Vals } }) {
  const cat = info.category, animated = cat === "animation" || cat === "video", stills = info.count > 1 && (cat === "image" || cat === "vector");
  const canSound = cat === "video" && info.count === 1 && info.has_audio;
  const [vals, setVals] = useState<Vals>({ every: "1", fps: "4", smooth: false, reduce: info.size > 500_000, colors: "256", sound: canSound && !info.audio_unsupported && !hasSound });
  cur.v = vals;
  const set = <K extends keyof Vals>(k: K, v: Vals[K]) => setVals((o) => ({ ...o, [k]: v }));
  const every = Math.max(1, asInt(vals.every, 1)), kept = ops.previewFrameCount(info, { every, layout: "frames" });
  return (
    <div className="flex flex-col gap-3.5" style={{ width: 280 }}>
      <Minor size={12}>{info.count > 1 ? `${info.count} files` : info.names[0] || "Picture"}{animated ? ` · ${info.frames} frame${info.frames === 1 ? "" : "s"}` : ""}</Minor>
      {animated && <>
        <NumberBox label="Every Nth frame" value={vals.every} onChange={(v) => set("every", v)} width={190} step={1} minimum={1} />
        <InfoNote>{every > 1 ? `${kept} of ${info.frames} frames are kept. The frames in between are skipped and never processed.` : `All ${info.frames} frames are kept.`}</InfoNote>
      </>}
      {stills && <>
        <NumberBox label="Frames per second" value={vals.fps} onChange={(v) => set("fps", v)} width={190} step={1} minimum={1} maximum={60} decimals={1} />
        <InfoNote>Every file becomes a frame.</InfoNote>
      </>}
      <div className="flex items-center gap-1.5"><Switch checked={vals.smooth} onCheckedChange={(v) => set("smooth", v)} /><span className="flex-1 text-sm">Smooth</span></div>
      <div className="flex items-center gap-1.5"><Switch checked={vals.reduce} onCheckedChange={(v) => set("reduce", v)} /><span className="flex-1 text-sm">Reduce colors</span></div>
      {vals.reduce && <NumberBox label="Colors" value={vals.colors} onChange={(v) => set("colors", v)} width={190} step={8} minimum={1} maximum={256} />}
      {canSound && (info.audio_unsupported
        ? <InfoNote>This device can't encode MP3, so this video's sound can't be uploaded.</InfoNote>
        : <>
          <label className="flex items-center gap-2.5 text-sm"><Checkbox checked={vals.sound} onCheckedChange={(v) => set("sound", v === true)} /><span className="flex-1">Import the soundtrack</span></label>
          {vals.sound && hasSound && <InfoNote>This blueprint already has a sound. It will be replaced.</InfoNote>}
        </>)}
    </div>
  );
}

/** Resolves with the chosen settings, or null when the dialog was closed. */
export function askImageImport(info: ops.MediaInfo, hasSound: boolean): Promise<ImageImportOpts | null> {
  return new Promise((resolve) => {
    const cur: { v: Vals } = { v: { every: "1", fps: "4", smooth: false, reduce: false, colors: "256", sound: false } };
    let answered = false;
    const answer = (v: ImageImportOpts | null) => { if (!answered) { answered = true; resolve(v); } };
    const read = (): ImageImportOpts => {
      const v = cur.v, fps = parseFloat(v.fps);
      return {
        every: Math.max(1, asInt(v.every, 1)), smooth: v.smooth, quantize: v.reduce ? Math.min(256, Math.max(1, asInt(v.colors, 256))) : 0,
        fps: Number.isFinite(fps) && fps > 0 ? Math.min(60, fps) : 4, sound: v.sound,
      };
    };
    showDialog("Upload", () => <Body info={info} hasSound={hasSound} cur={cur} />, {
      actions: (close) => <div className="pr-2"><PillButton label="Import" filled onClick={() => { answer(read()); close(); }} /></div>,
      onClose: () => answer(null),
    });
  });
}
