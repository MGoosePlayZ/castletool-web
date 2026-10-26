// Card bar (undo / redo / settings, Save) shared by the card screen and the blueprint screen, plus the card dialogs.
import { useEffect } from "react";
import { CI, ColorField, IconButton, NumberBox, PillButton, Swatch, TextAction, showDialog } from "./widgets";
import { DANGER, MAJOR, MINOR1, SEP, WARN } from "@/lib/theme";
import { useApp, undo, redo, canUndo, canRedo, cardBytes, cardDirty, saveCard, isSaving, editQuick, editAsync, cardOf, discardCard, toast, ensureOnline, setLeaveGuard, requestBack, back } from "@/lib/store";
import { cardBackground, cardTempo, setCardBackground, setCardTempo } from "@/lib/ops";
import { pickFile } from "@/lib/pick";
import { UPLOAD_LIMIT } from "@/lib/api";
import * as api from "@/lib/api";

const SIDE = 88;

/** How full the card is against Castle's 10 MB upload limit: white under 50%, yellow over 50%, red over 75%. */
function SizeMeter({ deckId, cardId }: { deckId: string; cardId: string }) {
  const bytes = cardBytes(deckId, cardId), frac = bytes / UPLOAD_LIMIT, pct = Math.round(frac * 100);
  const color = frac > 0.75 ? DANGER : frac > 0.5 ? WARN : MAJOR, size = 32, stroke = 3, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const label = `${(bytes / 1048576).toFixed(2)} MB of ${UPLOAD_LIMIT / 1048576} MB`;
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: 36, height: 40 }} title={label} aria-label={label} role="img">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SEP} strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, frac))} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-bold leading-none" style={{ color, fontSize: pct > 99 ? 8 : 9 }}>{`${Math.min(pct, 999)}%`}</span>
      </div>
    </div>
  );
}

export function CardBar({ deckId, cardId, mode, className }: { deckId: string; cardId: string; mode: "card" | "blueprint"; className?: string }) {
  useApp();
  const rc = cardOf(deckId, cardId), dirty = rc ? cardDirty(rc) : false, saving = isSaving(deckId, cardId);
  return (
    <div className={"flex shrink-0 items-center px-1.5 py-1 " + (className || "")}>
      <div style={{ width: SIDE }} className="flex justify-start">
        <IconButton onClick={() => (mode === "card" ? requestBack() : back())} tooltip={mode === "card" ? "Back" : "Close"}><CI name={mode === "card" ? "left_arrow" : "close"} size={22} /></IconButton>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <SizeMeter deckId={deckId} cardId={cardId} />
        <IconButton disabled={!canUndo(deckId, cardId)} tooltip="Undo" onClick={() => void undo(deckId, cardId)}><CI name="undo" size={22} /></IconButton>
        <IconButton disabled={!canRedo(deckId, cardId)} tooltip="Redo" onClick={() => void redo(deckId, cardId)}><CI name="redo" size={22} /></IconButton>
        <IconButton tooltip="Card settings" onClick={() => cardSettingsDialog(deckId, cardId)}><CI name="settings" size={22} /></IconButton>
      </div>
      <div style={{ width: SIDE }} className="flex justify-end">
        <PillButton label="Save" filled disabled={!dirty} busy={saving} onClick={() => void saveCard(deckId, cardId)} />
      </div>
    </div>
  );
}

export function coverOf(rc: any): string {
  const img = rc?.meta?.backgroundImage;
  return img && typeof img === "object" ? img.smallUrl || img.url || "" : "";
}

export function cardSettingsDialog(deckId: string, cardId: string) {
  const rc = cardOf(deckId, cardId);
  if (!rc) return;
  const v = { bg: cardBackground(rc), tempo: `${+cardTempo(rc).toPrecision(12)}` };
  let dlg = 0;
  // Writes the dialog's values into the card (not to Castle). Does nothing when nothing differs.
  const apply = (quiet = false) => {
    const cur = cardOf(deckId, cardId)!;
    let t = parseFloat(v.tempo);
    if (Number.isNaN(t)) { if (!quiet) toast("Tempo must be a number.", true); t = cardTempo(cur); }
    if (v.bg === cardBackground(cur) && Math.abs(t - cardTempo(cur)) <= 1e-9) return;
    void editQuick(deckId, cardId, (c) => { setCardBackground(c, v.bg); setCardTempo(c, t); });
  };
  const Body = ({ close }: { close: () => void }) => (
    <div className="flex flex-col gap-3.5" style={{ width: 280 }}>
      <Row icon="bucket"><ColorField value={v.bg} onChange={(c) => { v.bg = c; apply(); }} /></Row>
      <Row icon="drums"><NumberBox value={v.tempo} onChange={(t) => { v.tempo = t; }} step={1} minimum={1} maximum={999} decimals={2} width={200} /></Row>
      <Row icon="picture">
        <button type="button" className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-accent" onClick={async () => {
          const f = await pickFile(["png", "jpg", "jpeg"]);
          if (!f) return;
          if (!(await ensureOnline())) return;
          close();
          const ok = await editAsync(deckId, cardId, "Uploading cover", async (task, c) => {
            task.say("Uploading image", 0.2);
            const r = await api.uploadImage(f, f.name);
            c.coverFileId = r.fileId;
            c.meta.backgroundImage = { url: r.url, smallUrl: r.url, largeCardUrl: r.url };
            return true;
          });
          if (ok) toast("Cover changed. Save to apply it.");
        }}>
          <Swatch bg={v.bg} width={28} cover={coverOf(rc)} />
          <span className="text-sm font-bold">Cover image</span>
        </button>
      </Row>
    </div>
  );
  void dlg;
  dlg = showDialog("Card", (close) => <Body close={close} />, {
    actions: (close) => <TextAction label="OK" onClick={() => { close(); }} />,
    onClose: () => apply(true),
  });
}
const Row = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
  <div className="flex items-center"><div style={{ width: 34 }}><CI name={icon} size={22} color={MINOR1} /></div>{children}</div>
);

/** "Save Changes?" when leaving a card that has unsaved edits. Returns true when it asked (then runs `then` after the answer). */
export function askSaveChanges(deckId: string, cardId: string, then: () => void): boolean {
  const rc = cardOf(deckId, cardId);
  if (!rc || !cardDirty(rc)) return false;
  showDialog("Save Changes?", (close) => (
    <div className="flex flex-col items-center gap-2.5 pt-2" style={{ width: 260 }}>
      <PillButton label="Save" filled width={260} onClick={async () => { close(); if (await saveCard(deckId, cardId)) then(); }} />
      <PillButton label="Discard" width={260} color={DANGER} onClick={async () => { close(); await discardCard(deckId, cardId); then(); }} />
    </div>
  ));
  return true;
}

/** While a card is open, leaving it (back, another card, another deck) goes through the Save Changes? prompt. */
export function useLeaveGuard(deckId: string | null, cardId: string | null) {
  useEffect(() => {
    if (!deckId || !cardId) return;
    setLeaveGuard((then) => askSaveChanges(deckId, cardId, then));
    return () => setLeaveGuard(null);
  }, [deckId, cardId]);
}
void MAJOR; void SEP;
