import { useEffect, useRef, useState } from "react";
import { CI, MI, Minor, PillButton, Spinner, Swatch, confirmDialog, showDialog } from "@/components/widgets";
import { Input } from "@/components/ui/input";
import { MAJOR, MINOR1, SEP, fmtDate, timestamp, validHex } from "@/lib/theme";
import { TABS, useApp, setSetting, refreshProfile, refreshGlobal, openDeck, deleteDeck, deckHasUnsaved, cloneRef, toast, cancelAllTasks, get, signedIn } from "@/lib/store";

interface DeckItem { deckId: string; title: string; caption: string; visibility: string; lastModified: any; playCount: number; bg: string; cover: string; local: boolean }
const coverOf = (c: any) => { const i = c?.backgroundImage; return i && typeof i === "object" ? i.smallUrl || i.url || "" : ""; };

export function tabDecks(tab: string): DeckItem[] {
  const s = get(), local = new Map<string, DeckItem>();
  for (const rec of Object.values(s.local)) {
    const d = rec.deck, initial = d.initialCard || {};
    local.set(rec.deckId, { deckId: rec.deckId, title: (d.title || "").trim(), caption: String(d.caption || "").split(/\s+/).join(" "), visibility: String(d.visibility || "").toLowerCase(), lastModified: d.lastModified, playCount: d.playCount || 0, bg: validHex(initial.backgroundColor), cover: coverOf(initial), local: true });
  }
  const remote: DeckItem[] = s.globalDecks.filter((d: any) => !local.has(d.deckId)).map((d: any) => ({
    deckId: d.deckId, title: d.title === "(untitled)" ? "" : (d.title || "").trim(), caption: String(d.caption || "").split(/\s+/).join(" "), visibility: String(d.visibility || "").toLowerCase(),
    lastModified: d.lastModified, playCount: d.playCount || 0, bg: validHex(d.initialCard?.backgroundColor ?? d.bg), cover: coverOf(d.initialCard) || d.cover || "", local: false,
  }));
  let items: DeckItem[];
  if (tab === "LOCAL") items = [...local.values()];
  else if (tab === "GLOBAL") items = remote;
  else {
    items = [...local.values(), ...remote];
    if (["PUBLIC", "UNLISTED", "PRIVATE"].includes(tab)) items = items.filter((i) => i.visibility === tab.toLowerCase());
  }
  return items.sort((a, b) => timestamp(b.lastModified) - timestamp(a.lastModified));
}

export function askDeleteDeck(deckId: string, name: string) {
  const unsaved = deckHasUnsaved(get().local[deckId]);
  confirmDialog(`Delete "${name}"?`, "Only the copy on this device is removed." + (unsaved ? " Unsaved changes will be lost." : ""), "Delete", () => deleteDeck(deckId));
}

export function cloneDialog() {
  const Body = ({ close }: { close: () => void }) => {
    const [v, setV] = useState("");
    const go = async () => { if (!v) return; const rec = await cloneRef(v); if (rec) { close(); toast("Deck cloned."); } };
    return (
      <div className="flex flex-col gap-3" style={{ width: 280 }}>
        <Input autoFocus placeholder="Deck ID or link" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
        <PillButton label="Clone" filled width={280} onClick={() => void go()} />
      </div>
    );
  };
  showDialog("Clone a deck", (close) => <Body close={close} />, { onClose: cancelAllTasks });
}

function DeckRow({ d, selected, onOpen }: { d: DeckItem; selected?: boolean; onOpen: () => void }) {
  const label = d.title || d.caption || d.deckId, timer = useRef<number | null>(null), fired = useRef(false);
  const startPress = () => { if (!d.local) return; fired.current = false; timer.current = window.setTimeout(() => { fired.current = true; askDeleteDeck(d.deckId, label); }, 550); };
  const endPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return (
    <div role="button" tabIndex={0} onClick={() => { if (!fired.current) onOpen(); }} onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
      onContextMenu={(e) => { e.preventDefault(); if (d.local) askDeleteDeck(d.deckId, label); }}
      className="flex cursor-pointer select-none items-center gap-2.5 border-b px-3.5 py-2.5 hover:bg-accent active:bg-accent" style={{ borderColor: SEP, background: selected ? "#1a1a1a" : undefined, WebkitTouchCallout: "none" }}>
      <Swatch bg={d.bg} width={36} cover={d.cover} />
      <div className="line-clamp-2 min-w-0 flex-1 text-[15px] font-medium">{label}</div>
      <div className="flex shrink-0 items-center gap-1" style={{ width: 82 }}><MI name="calendar_today" size={14} color={MINOR1} /><Minor>{fmtDate(d.lastModified)}</Minor></div>
      <div className="flex shrink-0 items-center justify-end gap-1" style={{ width: 52 }}><CI name="play" size={14} color={MINOR1} /><Minor>{d.playCount.toLocaleString("en-US")}</Minor></div>
    </div>
  );
}

/** The six tabs and the deck list under them. */
export function HomeBody({ selectedDeckId }: { selectedDeckId?: string | null }) {
  const app = useApp(), [busy, setBusy] = useState(false), scroller = useRef<HTMLDivElement>(null), pull = useRef<{ y: number; dist: number } | null>(null);
  useEffect(() => { void refreshGlobal(); }, []);
  const items = tabDecks(app.tab), signed = signedIn();
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    if (signed) { await refreshProfile(); if (!(await refreshGlobal(true)) && !get().online) toast("No Wi-Fi.", true); }
    setBusy(false);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0">
        {TABS.map((t) => {
          const sel = t === app.tab;
          return <button key={t} type="button" onClick={() => setSetting("tab", t)} className="flex-1 whitespace-nowrap px-px py-2.5 text-center text-[11px] hover:bg-accent/50"
            style={{ color: sel ? MAJOR : MINOR1, fontWeight: sel ? 700 : 400, borderBottom: `${sel ? 2 : 1}px solid ${sel ? MAJOR : SEP}` }}>{t}</button>;
        })}
      </div>
      {busy && <div className="flex h-9 shrink-0 items-center justify-center"><Spinner size={20} /></div>}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto"
        onTouchStart={(e) => { if ((scroller.current?.scrollTop || 0) <= 0) pull.current = { y: e.touches[0].clientY, dist: 0 }; }}
        onTouchMove={(e) => { const p = pull.current; if (!p) return; p.dist = e.touches[0].clientY - p.y; if (p.dist >= 80) { pull.current = null; void refresh(); } }}
        onTouchEnd={() => { pull.current = null; }}>
        {items.length ? <>{items.map((d) => <DeckRow key={d.deckId} d={d} selected={selectedDeckId === d.deckId} onOpen={() => void openDeck(d.deckId)} />)}<div style={{ height: 2 }} /></>
          : <div className="flex h-[200px] items-center justify-center"><Minor size={13}>{signed ? "No decks" : "You are not signed in"}</Minor></div>}
      </div>
    </div>
  );
}
