import { useEffect, useState } from "react";
import { CI, Minor } from "@/components/widgets";
import { MINOR1, SEP } from "@/lib/theme";
import { useApp, nav } from "@/lib/store";
import { blueprintsOf, blueprintTitle } from "@/lib/ops";
import { frameCount, iconUrl, d2Of } from "@/lib/drawing";

export function BlueprintIcon({ bp, size = 48, holder = 52 }: { bp: any; size?: number; holder?: number }) {
  const d2 = d2Of(bp), has = !!d2 && frameCount(d2) > 0, [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (has) iconUrl(d2, 128).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [d2?.hash, has]);
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: holder, height: holder }}>
      {has ? (url ? <img src={url} width={size} height={size} alt="" draggable={false} style={{ objectFit: "contain" }} /> : null) : <CI name="brick" size={holder === 52 ? 22 : 28} color={MINOR1} />}
    </div>
  );
}

/** List of blueprints in a card. */
export function CardBody({ deckId, cardId, selectedId, onOpen }: { deckId: string; cardId: string; selectedId?: string | null; onOpen?: (id: string) => void }) {
  const app = useApp(), rc = app.local[deckId]?.cards[cardId], bps = blueprintsOf(rc);
  if (!bps.length) return <div className="flex h-full items-center justify-center"><Minor size={13}>No blueprints</Minor></div>;
  return (
    <div className="h-full overflow-auto">
      {bps.map((bp: any) => (
        <button key={bp.entryId} type="button" onClick={() => (onOpen ? onOpen(bp.entryId) : nav({ bpId: bp.entryId }))}
          className="flex w-full items-center gap-3 border-b px-3.5 py-2 text-left hover:bg-accent active:bg-accent" style={{ borderColor: SEP, background: selectedId === bp.entryId ? "#1a1a1a" : undefined }}>
          <BlueprintIcon bp={bp} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{blueprintTitle(bp, bp.entryId)}</span>
        </button>
      ))}
    </div>
  );
}
