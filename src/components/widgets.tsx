// Reusable controls, shadcn/ui flavoured with Castle's look (port of CTA's widgets.py / theme.py).
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CASTLE, MD } from "@/lib/icons";
import { BG, CARD_RATIO, DANGER, MAJOR, MINOR1, SEP, validHex } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { closeDialog, openDialog, ui, useApp, get } from "@/lib/store";
import { Task } from "@/lib/tasks";

// ── icons & text ───────────────────────────────────────────────────────
export function CI({ name, size = 22, color, className }: { name: string; size?: number; color?: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block shrink-0 text-center leading-none select-none", className)} style={{ fontFamily: "CastleIcons", fontSize: size, color, width: size, height: size, lineHeight: `${size}px` }}>{String.fromCodePoint(CASTLE[name] ?? 0x20)}</span>;
}
export function MI({ name, size = 22, color, filled }: { name: string; size?: number; color?: string; filled?: boolean }) {
  return <span aria-hidden className="inline-block shrink-0 select-none" style={{ fontFamily: filled ? "MSFilled" : "MSOutlined", fontSize: size, color, width: size, height: size, lineHeight: `${size}px`, fontFeatureSettings: '"liga"' }}>{String.fromCodePoint(MD[name] ?? 0x20)}</span>;
}
export const Minor = ({ children, size = 12, className, style }: { children: React.ReactNode; size?: number; className?: string; style?: React.CSSProperties }) =>
  <span className={className} style={{ fontSize: size, color: MINOR1, ...style }}>{children}</span>;
export const Title = ({ children, size = 22, className, style }: { children: React.ReactNode; size?: number; className?: string; style?: React.CSSProperties }) =>
  <span className={cn("font-title", className)} style={{ fontSize: size, ...style }}>{children}</span>;

export function IconButton({ children, onClick, tooltip, size = 40, disabled, className }: { children: React.ReactNode; onClick?: () => void; tooltip?: string; size?: number; disabled?: boolean; className?: string }) {
  return <Button variant="icon" title={tooltip} aria-label={tooltip} disabled={disabled} onClick={onClick} className={className} style={{ width: size, height: size }}>{children}</Button>;
}
export function CircleButton({ children, onClick, size = 30, disabled }: { children: React.ReactNode; onClick?: () => void; size?: number; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex shrink-0 items-center justify-center rounded-full border border-border hover:bg-accent disabled:opacity-30" style={{ width: size, height: size }}>{children}</button>;
}
/** Monochrome pill. Filled = white with black text. `busy` shows a throbber in place of the label. */
export function PillButton({ label, onClick, icon, disabled, filled, busy, width, color, className }: { label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; filled?: boolean; busy?: boolean; width?: number | string; color?: string; className?: string }) {
  const off = disabled || busy;
  return (
    <Button variant={filled ? "default" : "outline"} disabled={off} onClick={onClick} className={cn("font-medium", className)}
      style={{ width, ...(color && !filled ? { color } : {}), ...(filled && disabled && !busy ? { background: SEP } : {}), ...(busy ? { opacity: 1, pointerEvents: "none" } : {}) }}>
      {busy ? <Spinner size={16} color={filled ? BG : MAJOR} /> : <>{icon}{label}</>}
    </Button>
  );
}
export function Spinner({ size = 20, color = MAJOR, stroke = 2 }: { size?: number; color?: string; stroke?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" fill="none"><circle cx="12" cy="12" r="9" stroke={SEP} strokeWidth={stroke * 1.2} /><path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth={stroke * 1.2} strokeLinecap="round" /></svg>;
}
export function InfoNote({ children, size = 12 }: { children: React.ReactNode; size?: number }) {
  return <div className="flex items-start gap-2"><img src="icons/key-info.png" width={16} height={16} alt="" className="mt-px" /><Minor size={size} className="flex-1">{children}</Minor></div>;
}
export const Separator = () => <div className="h-px w-full shrink-0" style={{ background: SEP }} />;

// ── card / deck thumbnails ─────────────────────────────────────────────
export function Swatch({ bg, width, cover }: { bg: string; width: number; cover?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [cover]);
  return (
    <div className="relative shrink-0 overflow-hidden border" style={{ width, height: width * CARD_RATIO, background: validHex(bg), borderRadius: width * 0.12, borderColor: SEP }}>
      {cover && !broken && <img src={cover} alt="" draggable={false} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}
export function Avatar({ size = 36, ring = true }: { size?: number; ring?: boolean }) {
  const { avatarUrl, token, user } = useApp();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatarUrl]);
  const pad = ring ? 1 : 0, inner = size - 2 * (pad + (ring ? 1 : 0)), signed = !!token && !!user;
  const pic = (
    <img src={signed && avatarUrl && !broken ? avatarUrl : "icons/default-profile.png"} width={inner} height={inner} alt="" draggable={false}
      onError={() => setBroken(true)} className="rounded-full object-cover" style={{ width: inner, height: inner }} />
  );
  if (!ring) return pic;
  return <div className="flex items-center justify-center rounded-full border" style={{ width: size, height: size, padding: pad, borderColor: SEP }}>{pic}</div>;
}

// ── dialogs ────────────────────────────────────────────────────────────
/** Modal with a ✕ at the top left and the title to its right; confirm buttons go in `actions`. */
export function AppDialog({ heading, children, actions, onClose, closable = true, width }: { heading?: string | null; children?: React.ReactNode; actions?: React.ReactNode; onClose: () => void; closable?: boolean; width?: number }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={(e) => { if (!(e.currentTarget as HTMLElement).querySelector("input")) e.preventDefault(); }}
        className="overflow-y-auto" style={{ maxWidth: width ? width + 48 : undefined }}>
        <div className="flex items-center gap-1.5 pb-0 pl-2.5 pr-4 pt-2.5" style={{ display: closable || heading ? "flex" : "none" }}>
          {closable && <IconButton size={36} onClick={onClose} tooltip="Close"><CI name="close" size={22} /></IconButton>}
          {heading ? <DialogTitle className="min-w-0 flex-1 truncate text-lg font-bold">{heading}</DialogTitle> : <DialogTitle className="sr-only">Dialog</DialogTitle>}
        </div>
        <DialogDescription className="sr-only">Dialog</DialogDescription>
        <div className="px-6 pt-3" style={{ paddingBottom: actions ? 8 : 16 }}>{children}</div>
        {actions && <div className="flex justify-end gap-2 px-2 pb-2">{actions}</div>}
      </DialogContent>
    </Dialog>
  );
}
export const TextAction = ({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) =>
  <button type="button" onClick={onClick} className="rounded-lg px-3 py-2 text-sm font-bold hover:bg-accent" style={{ color: color || MAJOR }}>{label}</button>;

export function showDialog(heading: string | null, render: (close: () => void) => React.ReactNode, o: { actions?: (close: () => void) => React.ReactNode; onClose?: () => void; closable?: boolean; width?: number } = {}) {
  const id: number = openDialog((close) => (
    <AppDialog key={id} heading={heading} onClose={close} closable={o.closable} width={o.width} actions={o.actions?.(close)}>{render(close)}</AppDialog>
  ), o.onClose);
  return id;
}
export function confirmDialog(heading: string, body: string, okLabel: string, onOk: () => void | Promise<void>) {
  showDialog(heading, () => (body ? <p className="text-sm" style={{ color: MINOR1 }}>{body}</p> : <div />), {
    actions: (close) => <TextAction label={okLabel} onClick={() => { close(); void onOk(); }} />,
  });
}
export function infoDialog(heading: string, message: string) {
  showDialog(heading, () => (message ? <p className="text-sm" style={{ color: MINOR1 }}>{message}</p> : <div />), {
    closable: false, actions: (close) => <TextAction label="OK" onClick={close} />,
  });
}
ui.deckDeleted = () => infoDialog("This deck was deleted", "");

export function DialogHost() {
  const { dialogs } = useApp();
  return <>{dialogs.map((d) => <React.Fragment key={d.id}>{d.render(() => closeDialog(d.id))}</React.Fragment>)}</>;
}

/** Greyed-out screen with a circular meter, the percentage below it and a status line. */
export function ProgressOverlay() {
  const { progress } = useApp();
  return progress ? <ProgressView task={progress} /> : null;
}
function ProgressView({ task }: { task: Task }) {
  const [, force] = useState(0);
  useEffect(() => task.subscribe(() => force((n) => n + 1)), [task]);
  const f = task.frac, r = 44, c = 2 * Math.PI * r;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="flex w-[280px] flex-col items-center gap-3.5 p-5">
        <svg width={96} height={96} viewBox="0 0 96 96" className={f === null ? "animate-spin" : ""}>
          <circle cx="48" cy="48" r={r} fill="none" stroke={SEP} strokeWidth={6} />
          <circle cx="48" cy="48" r={r} fill="none" stroke={MAJOR} strokeWidth={6} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={f === null ? c * 0.75 : c * (1 - f)} transform="rotate(-90 48 48)" />
        </svg>
        <div className="text-xl font-bold" style={{ minHeight: 28 }}>{f !== null ? `${Math.round(f * 100)}%` : ""}</div>
        <div className="line-clamp-2 w-60 text-center text-[13px]" style={{ color: MINOR1 }}>{task.cancelled ? "Cancelling…" : task.message || task.label}</div>
        <PillButton label="Cancel" width={120} disabled={task.cancelled} onClick={() => task.cancel()} />
      </div>
    </div>
  );
}

// ── number box ─────────────────────────────────────────────────────────
export function NumberBox({ label, value, onChange, step = 1, minimum, maximum, decimals = 0, width = 170, enabled = true }: { label?: string; value: number | string; onChange: (v: string) => void; step?: number; minimum?: number; maximum?: number; decimals?: number; width?: number; enabled?: boolean }) {
  const fmt = (v: any) => (typeof v === "number" ? String(+v.toPrecision(12)) : String(v));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const num = () => { const n = parseFloat(text); return Number.isNaN(n) ? (minimum ?? 0) : n; };
  const clamp = (v: number) => Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, v));
  const bump = (dir: number) => { const v = clamp(+(num() + dir * step).toFixed(Math.max(decimals, 6))); const t = fmt(decimals ? v : Math.trunc(v)); setText(t); onChange(t); };
  const re = decimals ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;
  return (
    <div className="flex items-center gap-1.5" style={{ width }} onWheel={(e) => { if (enabled && document.activeElement === e.currentTarget.querySelector("input")) bump(e.deltaY > 0 ? -1 : 1); }}>
      <div className="relative min-w-0 flex-1">
        {label && <span className="pointer-events-none absolute -top-2 left-2 bg-black px-1 text-[12px]" style={{ color: MINOR1 }}>{label}</span>}
        <Input inputMode="decimal" disabled={!enabled} value={text} className="h-9" onChange={(e) => { if (re.test(e.target.value)) { setText(e.target.value); onChange(e.target.value); } }} />
      </div>
      <CircleButton disabled={!enabled} onClick={() => bump(-1)}><CI name="horizontal_line" size={16} /></CircleButton>
      <CircleButton disabled={!enabled} onClick={() => bump(1)}><CI name="add" size={16} /></CircleButton>
    </div>
  );
}

// ── color ──────────────────────────────────────────────────────────────
export const normHex = (v: string, d = "#000000") => {
  let t = (v || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(t)) t = [...t].map((c) => c + c).join("");
  return /^[0-9a-fA-F]{6}$/.test(t) ? "#" + t.toLowerCase() : d;
};
export function hsvToHex(h: number, s: number, v: number) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}
export function hexToHsv(hex: string): [number, number, number] {
  const c = normHex(hex), r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
export const contrastBg = (color: string) => {
  const c = normHex(color), lin = [1, 3, 5].map((i) => { const v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] < 0.179 ? "#ffffff" : "#000000";
};

/** Swatch with the hex number to its right. Tap for a picker. */
export function ColorField({ value, onChange, enabled = true }: { value: string; onChange: (v: string) => void; enabled?: boolean }) {
  const v = normHex(value);
  return (
    <button type="button" disabled={!enabled} onClick={() => openColorPicker(v, onChange)} className="flex items-center gap-2.5 rounded-lg py-1 hover:bg-accent" style={{ opacity: enabled ? 1 : 0.35 }}>
      <span className="block h-[30px] w-[30px] rounded-lg border" style={{ background: v, borderColor: SEP }} />
      <span className="text-sm">{v}</span>
    </button>
  );
}

const WHEEL = 240, RING = 24, DIAMOND = 120, KNOB = 24, TRACK_W = 156;

function GradientSlider({ label, max, value, onChange, colors }: { label: string; max: number; value: number; onChange: (v: number) => void; colors: string[] }) {
  const ref = useRef<HTMLDivElement>(null), drag = useRef(false);
  const touch = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); onChange(Math.max(0, Math.min(1, (e.clientX - r.left - KNOB / 2) / TRACK_W)) * max); };
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3.5 text-[13px]" style={{ color: MINOR1 }}>{label}</span>
      <div ref={ref} className="relative touch-none" style={{ width: TRACK_W + KNOB, height: KNOB }}
        onPointerDown={(e) => { drag.current = true; (e.target as Element).setPointerCapture(e.pointerId); touch(e); }}
        onPointerMove={(e) => { if (drag.current) touch(e); }} onPointerUp={() => { drag.current = false; }}>
        <div className="absolute rounded-[7px] border" style={{ top: (KNOB - 14) / 2, left: KNOB / 2, width: TRACK_W, height: 14, background: `linear-gradient(to right, ${colors.join(",")})`, borderColor: SEP }} />
        <div className="absolute top-0 rounded-full bg-white" style={{ width: KNOB, height: KNOB, left: max ? (value / max) * TRACK_W : 0, boxShadow: "0 0 3px rgba(0,0,0,.6)" }} />
      </div>
      <span className="w-[34px] text-right text-xs" style={{ color: MINOR1 }}>{Math.round(value)}</span>
    </div>
  );
}

function HueRing() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, x = cv.getContext("2d")!, n = cv.width, id = x.createImageData(n, n), c = (n - 1) / 2, ro = n / 2, ri = (WHEEL - 2 * RING) * (n / WHEEL) / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const dx = i - c, dy = j - c, r = Math.hypot(dx, dy), a = Math.max(0, Math.min(1, ro - r)) * Math.max(0, Math.min(1, r - ri));
      if (a <= 0) continue;
      const hex = hsvToHex((Math.atan2(dy, dx) * 180) / Math.PI, 1, 1), o = (j * n + i) * 4;
      id.data[o] = parseInt(hex.slice(1, 3), 16); id.data[o + 1] = parseInt(hex.slice(3, 5), 16); id.data[o + 2] = parseInt(hex.slice(5, 7), 16); id.data[o + 3] = Math.round(a * 255);
    }
    x.putImageData(id, 0, 0);
  }, []);
  return <canvas ref={ref} width={WHEEL * 2} height={WHEEL * 2} className="absolute inset-0" style={{ width: WHEEL, height: WHEEL }} />;
}

function ColorPicker({ current, onPick, close }: { current: string; onPick: (v: string) => void; close: () => void }) {
  const [h0, s0, v0] = hexToHsv(current);
  const [hsv, setHsv] = useState({ h: h0, s: s0 * 100, v: v0 * 100 }), [tab, setTab] = useState<"rgb" | "hsv">("rgb"), grab = useRef<null | "ring" | "sv">(null);
  const [hexText, setHexText] = useState(hsvToHex(h0, s0, v0));
  const hex = hsvToHex(hsv.h, hsv.s / 100, hsv.v / 100), hueHex = hsvToHex(hsv.h, 1, 1);
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const apply = (n: Partial<typeof hsv>) => { const m = { ...hsv, ...n }; setHsv(m); setHexText(hsvToHex(m.h, m.s / 100, m.v / 100)); };
  const setRgb = (r: number, g: number, b: number) => { const [h, s, v] = hexToHsv("#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")); apply({ h: s > 0 && v > 0 ? h : hsv.h, s: s * 100, v: v * 100 }); };
  const touch = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect(), dx = e.clientX - r.left - WHEEL / 2, dy = e.clientY - r.top - WHEEL / 2;
    if (grab.current === null) grab.current = Math.hypot(dx, dy) >= WHEEL / 2 - RING - 6 ? "ring" : "sv";
    if (grab.current === "ring") apply({ h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 });
    else { const c = Math.SQRT1_2, ux = dx * c + dy * c, uy = -dx * c + dy * c; apply({ s: Math.max(0, Math.min(1, ux / DIAMOND + 0.5)) * 100, v: Math.max(0, Math.min(1, 0.5 - uy / DIAMOND)) * 100 }); }
  };
  const mid = WHEEL / 2 - RING / 2, a = (hsv.h * Math.PI) / 180, ringX = WHEEL / 2 + mid * Math.cos(a) - 9, ringY = WHEEL / 2 + mid * Math.sin(a) - 9;
  const ux = (hsv.s / 100 - 0.5) * DIAMOND, uy = (0.5 - hsv.v / 100) * DIAMOND, c = Math.SQRT1_2, svX = WHEEL / 2 + ux * c - uy * c - 9, svY = WHEEL / 2 + ux * c + uy * c - 9;
  const ok = () => { close(); onPick(normHex(hexText, hex)); };
  const sh = { boxShadow: "0 0 3px rgba(0,0,0,.6)" };
  return (
    <AppDialog heading={null} onClose={ok} closable={false} width={WHEEL + 16}>
      <div className="flex flex-col items-center gap-3" style={{ width: WHEEL + 16 }}>
        <div className="flex w-full items-center justify-between">
          <IconButton size={36} onClick={ok}><CI name="close" size={22} /></IconButton>
          <div className="h-9 w-9 rounded-md border" style={{ background: hex, borderColor: SEP }} />
        </div>
        <div className="relative touch-none" style={{ width: WHEEL, height: WHEEL }} onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); touch(e); }}
          onPointerMove={(e) => { if (grab.current) touch(e); }} onPointerUp={() => { grab.current = null; }} onPointerCancel={() => { grab.current = null; }}>
          <HueRing />
          <div className="absolute overflow-hidden" style={{ left: (WHEEL - DIAMOND) / 2, top: (WHEEL - DIAMOND) / 2, width: DIAMOND, height: DIAMOND, transform: "rotate(45deg)", background: `linear-gradient(to right,#fff,${hueHex})` }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom,rgba(0,0,0,0),#000)" }} />
          </div>
          <div className="pointer-events-none absolute h-[18px] w-[18px] rounded-full border-2 border-white" style={{ left: ringX, top: ringY, background: hueHex, ...sh }} />
          <div className="pointer-events-none absolute h-[18px] w-[18px] rounded-full border-2 border-white" style={{ left: svX, top: svY, background: hex, ...sh }} />
        </div>
        <div className="flex w-full">
          {(["rgb", "hsv"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="flex-1 py-2 text-[13px]" style={{ color: tab === k ? MAJOR : MINOR1, fontWeight: tab === k ? 700 : 400, borderBottom: `${tab === k ? 2 : 1}px solid ${tab === k ? MAJOR : SEP}` }}>{k.toUpperCase()}</button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {tab === "rgb" ? <>
            <GradientSlider label="R" max={255} value={rgb[0]} colors={["#000000", "#ff0000"]} onChange={(v) => setRgb(v, rgb[1], rgb[2])} />
            <GradientSlider label="G" max={255} value={rgb[1]} colors={["#000000", "#00ff00"]} onChange={(v) => setRgb(rgb[0], v, rgb[2])} />
            <GradientSlider label="B" max={255} value={rgb[2]} colors={["#000000", "#0000ff"]} onChange={(v) => setRgb(rgb[0], rgb[1], v)} />
          </> : <>
            <GradientSlider label="H" max={360} value={hsv.h} colors={[0, 60, 120, 180, 240, 300, 360].map((h) => hsvToHex(h, 1, 1))} onChange={(v) => apply({ h: v })} />
            <GradientSlider label="S" max={100} value={hsv.s} colors={[hsvToHex(hsv.h, 0, hsv.v / 100), hsvToHex(hsv.h, 1, hsv.v / 100)]} onChange={(v) => apply({ s: v })} />
            <GradientSlider label="V" max={100} value={hsv.v} colors={["#000000", "#ffffff"]} onChange={(v) => apply({ v })} />
          </>}
        </div>
        <div className="flex w-full items-center justify-between">
          <Input value={hexText} className="h-9 w-[118px]" onChange={(e) => {
            if (!/^#?[0-9a-fA-F]{0,6}$/.test(e.target.value)) return;
            setHexText(e.target.value);
            const n = normHex(e.target.value, "");
            if (n) { const [h, s, v] = hexToHsv(n); setHsv({ h: s > 0 && v > 0 ? h : hsv.h, s: s * 100, v: v * 100 }); }
          }} />
          <PillButton label="OK" filled onClick={ok} />
        </div>
      </div>
    </AppDialog>
  );
}
export function openColorPicker(current: string, onPick: (v: string) => void) {
  const id: number = openDialog((close) => <ColorPicker key={id} current={current} onPick={onPick} close={close} />);
}
void DANGER; void get; void MI;
