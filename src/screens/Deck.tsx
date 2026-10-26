import { Minor, Swatch } from "@/components/widgets";
import { cn } from "@/lib/utils";
import { useApp, requestNav } from "@/lib/store";
import { coverOf } from "@/components/CardBar";
import { validHex } from "@/lib/theme";

export function cardIds(rec: any): string[] {
  const ids: string[] = (rec.deck.cards || []).map((c: any) => c.cardId).filter(Boolean);
  for (const k of Object.keys(rec.cards).sort()) if (!ids.includes(k)) ids.push(k);
  return ids;
}

/** Grid of cards. */
export function DeckBody({ deckId, selectedCardId }: { deckId: string; selectedCardId?: string | null }) {
  const app = useApp(), rec = app.local[deckId];
  if (!rec) return <div className="flex h-full items-center justify-center"><Minor size={13}>No cards</Minor></div>;
  if (rec.cauldron) return <div className="flex h-full items-center justify-center"><Minor size={13}>This deck uses cauldron</Minor></div>;   // nothing to do with the cards of a cauldron deck
  const ids = cardIds(rec);
  if (!ids.length) return <div className="flex h-full items-center justify-center"><Minor size={13}>No cards</Minor></div>;
  return (
    <div className="h-full overflow-auto p-3.5">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-3.5">
        {ids.map((cid) => {
          const rc = rec.cards[cid], meta = rc?.meta || (rec.deck.cards || []).find((c: any) => c.cardId === cid) || {};
          return (
            <button key={cid} type="button" onClick={() => requestNav({ cardId: cid, bpId: null })} className={cn("flex flex-col items-center gap-1 rounded-xl hover:bg-accent/60", selectedCardId === cid && "bg-accent")} style={{ width: 104 }}>
              <Swatch bg={validHex(meta.backgroundColor)} width={104} cover={coverOf({ meta })} />
              <Minor size={10} className="line-clamp-2 w-[104px] break-all text-center">{cid}</Minor>
            </button>
          );
        })}
      </div>
    </div>
  );
}
