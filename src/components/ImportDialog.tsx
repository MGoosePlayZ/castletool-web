// Settings for a picked media file, with a preview that follows the settings (port of CTA's ImportDialog).
import { useEffect, useRef, useState } from "react";
import { CI, ColorField, InfoNote, Minor, NumberBox, PillButton, TextAction, showDialog } from "./widgets";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OpError, drawFrame, makeCanvas, sceneBounds } from "@/lib/drawing";
import * as ops from "@/lib/ops";
import { charsetNames } from "@/lib/fonts";
import { editAsync, cardOf, toast, log } from "@/lib/store";
import { Task } from "@/lib/tasks";

type Vals = Record<string, any>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="relative" style={{ width: 260 }}><span className="pointer-events-none absolute -top-2 left-2 z-10 bg-black px-1 text-xs" style={{ color: "#888" }}>{label}</span>{children}</div>;
}
function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}
function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center gap-1.5"><Switch checked={value} onCheckedChange={onChange} /><span className="flex-1 text-sm">{label}</span></div>;
}

function Body({ deckId, cardId, entryId, file, info, layer, close }: { deckId: string; cardId: string; entryId: string; file: File; info: ops.MediaInfo; layer: string | null; close: () => void }) {
  const cat = info.category;
  const [vals, setVals] = useState<Vals>({ charsets: ["ASCII"], quantize_on: info.size > 500_000 });
  const [frame, setFrame] = useState(0), [dragFrame, setDragFrame] = useState<number | null>(null), [ready, setReady] = useState(false), busy = useRef(false);
  const cv = useRef<HTMLCanvasElement>(null), token = useRef(0);
  const set = (k: string, v: any) => setVals((o) => ({ ...o, [k]: v }));
  const g = (k: string, d: any) => (k in vals ? vals[k] : d);

  const frameTotal = () => {
    if (cat === "font" || cat === "audio") return 1;
    let every = 1;
    try { every = Math.max(1, Math.trunc(parseFloat(String(g("every", 1)) || "1")) || 1); } catch { every = 1; }
    return ops.previewFrameCount(info, { every, layout: g("layout", "frames") });
  };
  const n = frameTotal(), shown = Math.min(frame, n - 1);

  const num = (key: string, def: number, cast: (s: string) => number = parseFloat) => {
    const r = cast(String(g(key, def)).trim());
    if (Number.isNaN(r)) throw new OpError("Enter a number.");
    return r;
  };
  const collect = (): { kind: "font" | "media"; opts: any } => {
    if (cat === "font") {
      return { kind: "font", opts: { charsets: [...(vals.charsets || [])].sort(), custom: g("custom", ""), bitmap: g("font_style", "vector") === "bitmap", scale: num("font_scale", 1), steps: num("steps", 16, (s) => parseInt(s, 10)), px: num("px", 64, (s) => parseInt(s, 10)), smooth: !!vals.smooth, color: ops.parseColor(g("color", "#ffffff")) } };
    }
    const quant = g("quantize_on", false) ? num("quantize_colors", 256, (s) => parseInt(s, 10)) : 0;
    if (quant && !(quant >= 1 && quant <= 256)) throw new OpError("Colors must be between 1 and 256.");
    return { kind: "media", opts: {
      layout: g("layout", "frames"), no_scale: !!vals.no_scale, scale: num("scale", 1), smooth: !!vals.smooth, every: num("every", 1, (s) => parseInt(s, 10)), quantize: quant,
      svg_style: g("svg_style", "vector"), svg_scale: num("svg_scale", 1), steps: num("steps", 16, (s) => parseInt(s, 10)),
      color: g("color_on", false) ? ops.parseColor(g("color", "#ffffff")) : null, fps: num("fps", 4),
      want_audio: g("want_audio", true) && !info.audio_unsupported,
      fixed_px: !!g("fixed_px", false), pixel_size: num("pixel_size", 0.1),
    } };
  };

  // live preview, debounced; a newer setting makes the running render pointless
  useEffect(() => {
    const t = ++token.current;
    const h = window.setTimeout(async () => {
      let c;
      try { c = collect(); } catch { return; }
      setReady(false);
      try {
        const d2 = c.kind === "font" ? await ops.previewFont(file, c.opts) : await ops.previewMedia(info, c.opts, shown);
        if (t !== token.current) return;
        if (d2) {
          const canvas = cv.current!;
          await drawFrame(canvas, d2, 0, sceneBounds(d2, [0]));
          if (t === token.current) setReady(true);
        }
      } catch (e: any) { log(`preview: ${e?.message || e}`, 2); }
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(vals), shown]);
  useEffect(() => () => { token.current++; }, []);

  const askOverwriteSound = () => new Promise<boolean | null>((resolve) => {
    let answered = false;
    const answer = (v: boolean | null, close2?: () => void) => { if (!answered) { answered = true; resolve(v); } close2?.(); };
    showDialog("Overwrite sound?", () => <p className="text-sm" style={{ color: "#888" }}>This blueprint already plays a sound. Replace it with this video's sound?</p>, {
      actions: (c2) => <><TextAction label="Keep current" onClick={() => answer(false, c2)} /><TextAction label="Overwrite" onClick={() => answer(true, c2)} /></>,
      onClose: () => answer(null),
    });
  });

  const doImport = async () => {
    if (busy.current) return;
    let c;
    try { c = collect(); } catch (e: any) { toast(e.message, true); return; }
    if (c.kind === "media" && c.opts.want_audio && cat === "video" && info.has_audio) {
      const bp = ops.libraryOf(cardOf(deckId, cardId)!)[entryId];
      if (bp && (await import("@/lib/audio")).audioUrls(bp).length) {
        busy.current = true;
        const choice = await askOverwriteSound();
        busy.current = false;
        if (choice === null) return;
        c.opts.want_audio = choice;
      }
    }
    busy.current = true;
    token.current++;
    const res = await editAsync<ops.ImportResult>(deckId, cardId, "Importing", (task: Task, rc, rec) => {
      const ctx = { rc, rec, entryId };
      return c.kind === "font" ? ops.importFont(ctx, info, c.opts, task, layer) : ops.importMedia(ctx, info, c.opts, task, layer);
    });
    busy.current = false;
    if (res) {
      close();
      let msg = res.written.length === 1 ? "Imported." : `Imported ${res.written.length} actors.`;
      if (res.warnings.length) { msg = `Imported, but ${res.warnings.join("; ")}.`; log("warning: " + msg); }
      toast(msg);
    } else setVals((o) => ({ ...o }));       // cancelled or failed: the dialog stays, settings kept
  };
  (Body as any).doImport = doImport;

  const multi = info.count > 1, vector = cat === "vector", bitmapLike = !vector || g("svg_style", "vector") === "bitmap";
  const N = (key: string, label: string, def: number, o: { step?: number; minimum?: number; maximum?: number; decimals?: number }) =>
    <NumberBox key={key} label={label} value={g(key, def)} onChange={(v) => set(key, v)} width={190} {...o} />;
  const color = (key: string, enabled = true) => <ColorField value={g(key, "#ffffff")} enabled={enabled} onChange={(v) => set(key, v)} />;

  const options: React.ReactNode[] = [];
  if (cat === "font") {
    const chosen: string[] = vals.charsets || [];
    options.push(
      <div key="cs" className="flex flex-col">{charsetNames().map((name) => (
        <label key={name} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[13px]">
          <Checkbox checked={chosen.includes(name)} onCheckedChange={(c) => set("charsets", c ? [...chosen, name] : chosen.filter((x) => x !== name))} />{name}
        </label>))}</div>,
      <Field key="chars" label="Characters"><Input value={g("custom", "")} onChange={(e) => set("custom", e.target.value)} /></Field>,
      <Choice key="fs" label="Draw as" value={g("font_style", "vector")} options={[["vector", "Vector"], ["bitmap", "Bitmap"]]} onChange={(v) => set("font_style", v)} />,
    );
    if (g("font_style", "vector") === "bitmap") options.push(N("px", "Pixels per em", 64, { step: 8, minimum: 4, maximum: 512 }), <SwitchRow key="sm" label="Smooth" value={!!vals.smooth} onChange={(v) => set("smooth", v)} />);
    else options.push(N("font_scale", "Scale", 1, { step: 0.1, minimum: 0.01, decimals: 2 }), N("steps", "Curve steps", 16, { step: 1, minimum: 2, maximum: 64 }));
    options.push(<div key="col">{color("color")}</div>);
  } else {
    if (vector) options.push(<Choice key="ss" label="Draw as" value={g("svg_style", "vector")} options={[["vector", "Vector"], ["bitmap", "Bitmap"]]} onChange={(v) => set("svg_style", v)} />);
    const fixedPx = bitmapLike && !!g("fixed_px", false);
    if (!(fixedPx && !vector)) options.push(N(bitmapLike ? "scale" : "svg_scale", "Scale", 1, { step: 0.1, minimum: 0.01, decimals: 2 }));
    if (bitmapLike) {
      options.push(<SwitchRow key="fp" label="Fixed Pixel Size" value={fixedPx} onChange={(v) => set("fixed_px", v)} />);
      if (fixedPx) options.push(N("pixel_size", "Pixel size (Castle units)", 0.1, { step: 0.05, minimum: 0.001, decimals: 3 }), <InfoNote key="fpn">Every pixel is drawn this wide and never resampled. Adding to a drawing that has another pixel size resizes the new image to match it.</InfoNote>);
    }
    if (!bitmapLike) options.push(N("steps", "Curve steps", 16, { step: 1, minimum: 2, maximum: 64 }));
    if (bitmapLike) options.push(<SwitchRow key="sm" label="Smooth" value={!!vals.smooth} onChange={(v) => set("smooth", v)} />);
    if (cat === "animation" || cat === "video") options.push(N("every", "Every Nth frame", 1, { step: 1, minimum: 1 }));
    if (multi && (cat === "image" || cat === "vector")) {
      if (layer === null) {
        options.push(<Choice key="lay" label="Several files" value={g("layout", "frames")} options={[["frames", "Frames of one actor"], ["separate", "Separate actors"]]} onChange={(v) => set("layout", v)} />,
          <InfoNote key="ln">{g("layout", "frames") === "frames" ? "Every file becomes a frame of this blueprint." : "Every file becomes its own blueprint."}</InfoNote>);
      } else options.push(<InfoNote key="ln">Every file becomes a frame of this layer.</InfoNote>);
      if (g("layout", "frames") === "frames") options.push(N("fps", "Frames per second", 4, { step: 1, minimum: 1, maximum: 60, decimals: 1 }));
      if (bitmapLike && cat === "image") options.push(<SwitchRow key="ns" label="Keep original sizes" value={!!vals.no_scale} onChange={(v) => set("no_scale", v)} />);
    }
    if (vector) {
      const on = !!g("color_on", false);
      options.push(<SwitchRow key="co" label="Override color" value={on} onChange={(v) => set("color_on", v)} />, <div key="cc">{color("color", on)}</div>);
    }
    if (bitmapLike) {
      options.push(<SwitchRow key="qo" label="Reduce colors" value={!!g("quantize_on", false)} onChange={(v) => set("quantize_on", v)} />);
      if (g("quantize_on", false)) options.push(N("quantize_colors", "Colors", 256, { step: 8, minimum: 1, maximum: 256 }));
    }
    if (cat === "video" && info.has_audio) {
      if (info.audio_unsupported) options.push(<InfoNote key="au">This device can't encode MP3, so this video's sound can't be uploaded.</InfoNote>);
      else options.push(<SwitchRow key="wa" label="Sound" value={g("want_audio", true)} onChange={(v) => set("want_audio", v)} />);
    }
  }

  return (
    <div className="flex flex-col gap-3.5 overflow-y-auto" style={{ width: 300, maxHeight: "min(520px, 66vh)" }}>
      <div className="flex justify-center"><div className="flex items-center justify-center" style={{ width: 220, height: 220, opacity: ready ? 1 : 0.4 }}><canvas ref={cv} width={400} height={400} style={{ width: 200, height: 200 }} /></div></div>
      {n > 1 && (
        <div className="flex items-center gap-2">
          <Slider min={1} max={n} step={1} value={[dragFrame ?? shown + 1]} onValueChange={(v) => setDragFrame(v[0])} onValueCommit={(v) => { setDragFrame(null); setFrame(v[0] - 1); }} />
          <Minor className="w-16 text-right">{`${dragFrame ?? shown + 1} / ${n}`}</Minor>
        </div>
      )}
      <div className="flex flex-col gap-2.5">{options}</div>
    </div>
  );
}

export function openImportDialog(a: { deckId: string; cardId: string; entryId: string; file: File; info: ops.MediaInfo; layer: string | null }) {
  // the Import button lives in the dialog's action row, so the body exposes its handler through a ref-like hook
  const handle: { go?: () => void } = {};
  showDialog("Upload", (close) => <BodyWithAction {...a} close={close} handle={handle} />, {
    actions: () => <div className="pr-2"><PillButton label="Import" filled onClick={() => handle.go?.()} /></div>,
  });
}
function BodyWithAction(p: { deckId: string; cardId: string; entryId: string; file: File; info: ops.MediaInfo; layer: string | null; close: () => void; handle: { go?: () => void } }) {
  const { handle, ...rest } = p;
  useEffect(() => { handle.go = () => (Body as any).doImport?.(); return () => { handle.go = undefined; }; }, [handle]);
  return <Body {...rest} />;
}
void CI;
