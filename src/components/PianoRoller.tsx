// Piano roller of the Music tab: read-only, scrolls horizontally, needle follows the song (port of CTA's piano_roller.py).
import { useEffect, useMemo, useRef, useState } from "react";
import { CI, InfoNote, Minor } from "@/components/widgets";
import { Button } from "@/components/ui/button";
import { BG, MAJOR, MINOR1 } from "@/lib/theme";
import { LiveSynth } from "@/lib/synth";
import { HM, RATIO, SM, buildModel, cellOf, drawRoller, maxScroll } from "@/lib/roller";
import { cn } from "@/lib/utils";

const MAX_W = 560;

/** Castle's toggle look on a shadcn Button: dark with gray outline when off, white with black icon when on. */
function BoxButton({ on, label, onClick, top, children }: { on: boolean; label: string; onClick: () => void; top: number; children: React.ReactNode }) {
  return (
    <Button variant="icon" title={label} aria-label={label} onClick={onClick}
      className={cn("absolute h-10 w-10 rounded-xl border", on ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-muted-foreground bg-background text-muted-foreground")}
      style={{ top: HM + top, right: SM + 8 }}>{children}</Button>
  );
}

export function PianoRoller({ music, bpm }: { music: any; bpm: number }) {
  const eng = useMemo(() => { try { const e = new LiveSynth(music, bpm); e.loop = false; return e; } catch { return null; } }, [music, bpm]);
  const model = useMemo(() => buildModel(music, bpm), [music, bpm]);
  const host = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0), [playing, setPlaying] = useState(false), [follow, setFollow] = useState(true);
  const S = useRef({ ox: 0, needle: 0, follow: true, mode: null as null | "pan" | "needle", wasPlaying: false, lastX: 0, dirty: true });

  useEffect(() => () => eng?.close(), [eng]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_W, el.clientWidth)));
    ro.observe(el); setWidth(Math.min(MAX_W, el.clientWidth));
    return () => ro.disconnect();
  }, [eng, model]);

  const boxW = Math.max(140, width - 2 * SM), boxH = boxW / RATIO;
  useEffect(() => { S.current.dirty = true; if (model) S.current.ox = Math.min(S.current.ox, maxScroll(model, boxW, boxH)); }, [boxW, boxH, model]);

  useEffect(() => {
    if (!eng || !model || !cv.current || width <= 0) return;
    const canvas = cv.current, g = canvas.getContext("2d")!, s = S.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round((boxW + 2 * SM) * dpr); canvas.height = Math.round((boxH + HM) * dpr);
    eng.onEnd = () => { s.needle = 0; s.ox = 0; s.dirty = true; setPlaying(false); };
    let raf = 0, wasPlaying = false;
    const frame = () => {
      const lim = maxScroll(model, boxW, boxH), c = cellOf(model, boxH), p = eng.playing;
      if (s.mode === "needle") {                                       // edge auto-scroll while scrubbing
        if (s.lastX > SM + boxW - 28) { s.ox = Math.min(lim, s.ox + 8); s.needle = Math.max(0, (s.lastX - SM + s.ox) / c); s.dirty = true; }
        else if (s.lastX < SM + 28 && s.ox > 0) { s.ox = Math.max(0, s.ox - 8); s.needle = Math.max(0, (s.lastX - SM + s.ox) / c); s.dirty = true; }
      } else if (p) {
        s.needle = eng.position / model.sec;
        if (s.follow) { const edge = boxW * 0.4, nx = s.needle * c - s.ox; if (nx > edge || nx < 0) s.ox = Math.max(0, Math.min(lim, s.needle * c - edge)); }
        s.dirty = true;
      }
      if (p !== wasPlaying) { wasPlaying = p; setPlaying(p); s.dirty = true; }
      if (s.dirty) { s.dirty = false; drawRoller(g, model, boxW, boxH, s.ox, s.needle, dpr); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [eng, model, width, boxW, boxH]);

  if (!eng) return <Minor>Couldn't prepare the player.</Minor>;
  if (!eng.notes.length || !model) return <Minor>No notes</Minor>;

  const toggle = () => {
    const s = S.current;
    if (eng.playing) { eng.stop(); s.needle = 0; s.ox = 0; setPlaying(false); } else { eng.play(); setPlaying(true); }
    s.dirty = true;
  };
  const toggleFollow = () => { S.current.follow = !S.current.follow; setFollow(S.current.follow); };
  const handleHit = (x: number, y: number) => {
    const nx = SM + S.current.needle * cellOf(model, boxH) - S.current.ox;
    return Math.abs(x - nx) <= 22 && y >= HM - 26 && y <= HM + 20 && x >= 0 && x <= boxW + 2 * SM;
  };
  const needleTo = (x: number) => { const s = S.current; s.needle = Math.max(0, Math.min(model.end + 1, (x - SM + s.ox) / cellOf(model, boxH))); s.lastX = x; s.dirty = true; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = S.current, r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId); s.lastX = x;
    if (handleHit(x, y)) { s.mode = "needle"; s.wasPlaying = eng.playing; if (s.wasPlaying) eng.pause(); needleTo(x); } else s.mode = "pan";
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = S.current, x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (s.mode === "needle") needleTo(x);
    else if (s.mode === "pan") {
      const dx = x - s.lastX;
      s.ox = Math.max(0, Math.min(maxScroll(model, boxW, boxH), s.ox - dx));
      if (eng.playing && s.follow && Math.abs(dx) > 2) { s.follow = false; setFollow(false); }
      s.lastX = x; s.dirty = true;
    }
  };
  const up = () => {
    const s = S.current;
    if (s.mode === "needle") { eng.seek(s.needle * model.sec); if (s.wasPlaying) eng.play(); }
    s.mode = null;
  };
  const wheel = (e: React.WheelEvent) => { const s = S.current; s.ox = Math.max(0, Math.min(maxScroll(model, boxW, boxH), s.ox + (e.deltaX || e.deltaY))); s.dirty = true; };

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={host} className="mx-auto w-full" style={{ maxWidth: MAX_W }}>
        {width > 0 && (
          <div className="relative mx-auto" style={{ width: boxW + 2 * SM, height: boxH + HM }}>
            <canvas ref={cv} style={{ width: boxW + 2 * SM, height: boxH + HM, touchAction: "none", display: "block" }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
            <BoxButton on={playing} label={playing ? "Stop" : "Play"} onClick={toggle} top={8}><CI name={playing ? "stop" : "play_music"} size={20} color={playing ? BG : MINOR1} /></BoxButton>
            <BoxButton on={follow} label="Follow needle" onClick={toggleFollow} top={56}><CI name="follow_needle" size={20} color={follow ? BG : MINOR1} /></BoxButton>
          </div>
        )}
      </div>
      {eng.warnings.length > 0 && <InfoNote>{eng.warnings.join("\n")}</InfoNote>}
    </div>
  );
}
