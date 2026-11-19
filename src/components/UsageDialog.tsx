// Opens from the usage dial in the card bar: usage / 50 MB, a pie of what fills it, and a tap-to-drill-down list.
import { useMemo, useState } from "react";
import { showDialog, Minor } from "./widgets";
import { BG, MAJOR, MINOR1, SEP } from "@/lib/theme";
import { cardBytes, cardOf } from "@/lib/store";
import { computeUsage, fmtBytes, sizeColor, type UsageItem } from "@/lib/usage";

const R = 70, C = 80;
function Pie({ slices }: { slices: { name: string; bytes: number; color: string }[] }) {
  const sum = slices.reduce((s, x) => s + x.bytes, 0);
  if (sum <= 0) return <svg width={160} height={160} viewBox="0 0 160 160"><circle cx={C} cy={C} r={R} fill="none" stroke={SEP} strokeWidth={1.5} /></svg>;
  const visible = slices.filter((s) => s.bytes > 0);
  let a0 = -Math.PI / 2;
  return (
    <svg width={160} height={160} viewBox="0 0 160 160" role="img" aria-label="Usage pie chart">
      {visible.length === 1
        ? <circle cx={C} cy={C} r={R} fill={visible[0].color} stroke={visible[0].color === BG ? MAJOR : BG} strokeWidth={1.5} />
        : visible.map((s) => {
          const a1 = a0 + (s.bytes / sum) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${C} ${C} L${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A${R} ${R} 0 ${large} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`;
          a0 = a1;
          return <path key={s.name} d={d} fill={s.color} stroke={s.color === BG ? MAJOR : BG} strokeWidth={1.5} />;
        })}
    </svg>
  );
}

function Row({ name, bytes, total, color, onClick }: { name: string; bytes: number; total: number; color: string; onClick?: () => void }) {
  const pct = total > 0 ? (bytes / total) * 100 : 0;
  return (
    <button type="button" disabled={!onClick} onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:hover:bg-transparent">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color, border: color === BG ? `1px solid ${MAJOR}` : undefined }} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: MAJOR }}>{name}</span>
      <Minor size={12} className="shrink-0">{`${fmtBytes(bytes)} · ${pct < 0.1 && bytes > 0 ? "<0.1" : pct.toFixed(1)}%`}</Minor>
    </button>
  );
}

function Body({ deckId, cardId }: { deckId: string; cardId: string }) {
  const rc = cardOf(deckId, cardId)!;
  const total = cardBytes(deckId, cardId);
  const usage = useMemo(() => computeUsage(rc, total), []);   // measured once, when opened: the colors stay put while drilling in and out
  const [open, setOpen] = useState<string | null>(null);
  const cat = usage.categories.find((c) => c.key === open) || null;
  const frac = usage.total / usage.limit, color = sizeColor(frac);
  const slices: UsageItem[] = cat ? cat.items : usage.categories;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center text-xl font-bold" style={{ color }}>{`${fmtBytes(usage.total)}/${usage.limit / 1048576}MB`}</div>
      <Pie slices={slices} />
      <div className="flex w-full flex-col">
        {cat && <>
          <button type="button" onClick={() => setOpen(null)} className="rounded-lg px-2 py-1.5 text-left text-sm font-bold hover:bg-accent" style={{ color: MAJOR }}>{`‹ ${cat.name} · ${fmtBytes(cat.bytes)}`}</button>
          {cat.items.length ? cat.items.map((i) => <Row key={i.name} name={i.name} bytes={i.bytes} total={cat.bytes} color={i.color} />) : <Minor className="px-2 py-1.5">Nothing in here.</Minor>}
        </>}
        {!cat && usage.categories.map((c) => <Row key={c.key} name={c.name} bytes={c.bytes} total={usage.limit} color={c.color} onClick={c.items.length ? () => setOpen(c.key) : undefined} />)}
      </div>
      {!cat && <Minor size={11} className="text-center" style={{ color: MINOR1 }}>Tap a category to see what is inside it.</Minor>}
    </div>
  );
}

export function openUsageDialog(deckId: string, cardId: string) {
  showDialog("Usage", () => <Body deckId={deckId} cardId={cardId} />, { width: 340 });
}
