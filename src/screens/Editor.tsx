// Art editor screen. The editor itself is src/editor/engine.ts (a port of the editor prototype); this file only connects it to the
// app: load the blueprint's drawing, save every finished edit as its own undo step, undo/redo, the file pickers, and the colour
// picker inside the dropdown.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/editor/editor.css";
import { createEditor, type EditorApi } from "@/editor/engine";
import { ColorPanel } from "@/components/widgets";
import { IMAGE_PICK, loadImgSrc, loadImgSrcs } from "@/editor/sources";
import { askImageImport } from "@/components/EditorImportDialog";
import { audioUrls } from "@/lib/audio";
import { registerFont } from "@/lib/fonts";
import { pickFile, pickFiles, saveBlob } from "@/lib/pick";
import { back, canRedo, canUndo, cardOf, editAsync, editQuick, ensureOnline, log, redo, toast, undo, useApp } from "@/lib/store";
import * as ops from "@/lib/ops";
import { OpError, d2Of, rehash } from "@/lib/drawing";

const ASSET = (n: string) => `${import.meta.env.BASE_URL}icons/${n}`;

/** An empty Drawing2 for a blueprint that has none yet (same defaults Castle uses: scale 10, 25.6 px per unit). */
const blankDrawing = () => ({
  initialFrame: 1, currentFrame: 1, framesPerSecond: 4, playMode: "still", loopStartFrame: -1, loopEndFrame: -1, opacity: 1, hash: "0", playing: false, loop: false,
  drawData: { color: [1, 1, 1, 1], lineColor: [0, 0, 0, 1], gridSize: 0.71428, scale: 10, version: 3, fillPixelsPerUnit: 25.6, numTotalLayers: 1, framesBounds: [], colors: [], selectedFrame: 1, layers: [] },
  physicsBodyData: { shapes: [], scale: 10, version: 2, zeroShapesInV1: false }, disabled: false,
});

export function EditorScreen({ deckId, cardId, entryId }: { deckId: string; cardId: string; entryId: string }) {
  useApp();                                   // redraw when the card's undo/redo availability changes
  const root = useRef<HTMLDivElement>(null), api = useRef<EditorApi | null>(null), [pickEl, setPickEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = root.current!;
    // Write the editor's layers into the blueprint: one card edit = one undo step. Nothing is written when nothing changed.
    const commit = async (E: EditorApi): Promise<boolean> => {
      if (!E.dirty()) return true;
      await E.ready();                         // imported pictures finish decoding first, or they would be lost
      const ok = await editQuick(deckId, cardId, (rc) => {
        const bp = ops.libraryOf(rc)[entryId];
        if (!bp) throw new OpError("This blueprint no longer exists.");
        let d2 = d2Of(bp);
        if (!d2) d2 = bp.actorBlueprint.components.Drawing2 = blankDrawing();
        E.toDraw(d2.drawData);
        const fps = E.fps();                     // an animated image / video was placed: the drawing plays at its speed
        if (fps) { d2.framesPerSecond = fps; d2.playMode = "loop"; d2.loop = true; }
        rehash(d2);
      });
      if (ok) E.clean();
      return ok;
    };
    let timer = 0, chain: Promise<boolean> = Promise.resolve(true);
    const flush = () => { clearTimeout(timer); return (chain = chain.then(() => commit(E))); };
    const load = (keep = false) => {
      const d2 = d2Of(ops.libraryOf(cardOf(deckId, cardId)!)[entryId]);
      log(`art editor: ${api.current!.loadDraw(structuredClone(d2?.drawData || { layers: [] }), keep)}`, 2);
    };
    const step = async (fn: typeof undo) => { if (!(await flush())) return; await fn(deckId, cardId); load(true); };
    const E = createEditor(el, {
      arrow1: ASSET("assets_images_arrow1.png"), arrow2: ASSET("assets_images_arrow2.png"),
      exit: () => { void flush().then((ok) => { if (ok) back(); }); },      // back goes to the blueprint, not the deck
      changed: () => { clearTimeout(timer); timer = window.setTimeout(() => void flush(), 120); },
      undo: () => void step(undo), redo: () => void step(redo),
      pickImages: async () => {
        const files = await pickFiles(IMAGE_PICK);
        if (!files.length) return null;
        try {
          const info = await ops.inspectMedia(files.length === 1 ? files[0] : files);
          if (info.category === "audio") { toast("That's audio. Use the Audio tab.", true); return null; }
          if (info.category === "font") { toast("Fonts are used from text layers.", true); return null; }
          if (info.unsupported) { toast(info.unsupported, true); return null; }
          const bp = ops.libraryOf(cardOf(deckId, cardId)!)[entryId];
          const o = await askImageImport(info, !!bp && audioUrls(bp).length > 0);       // every setting is chosen once, here
          if (!o) return null;
          const srcs = await loadImgSrcs(files, { every: o.every, found: { files: info.files, cat: info.category } });
          if (o.sound && info.category === "video" && info.files.length === 1) {
            if (!(await flush()) || !(await ensureOnline())) return null;                // the video's soundtrack becomes the blueprint's sound
            const done = await editAsync(deckId, cardId, "Importing sound", async (task, rc, rec) => { await ops.importVideoSound({ rc, rec, entryId }, info.files[0], task); return true; });
            if (done) toast("Sound imported.");
          }
          return Object.assign(srcs, { opts: { every: o.every, smooth: o.smooth, q: o.quantize, fps: o.fps } });
        } catch (e: any) { toast(e?.message || String(e), true); return null; }
      },
      reloadImage: async (src, every) => { try { return await loadImgSrc(src.file, src.cat, every); } catch (e: any) { toast(e?.message || String(e), true); return null; } },
      loadImage: async (r) => {
        try {
          const bin = atob(r.b64), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return await loadImgSrc(new File([bytes], r.name), r.cat as any, r.every || 1, !!r.single);
        } catch { return null; }
      },
      pickFont: async () => {
        const f = await pickFile(["ttf", "otf", "woff", "eot"]);
        if (!f) return null;
        try { return await registerFont(f); } catch { toast("Couldn't read that font.", true); return null; }
      },
      save: (name, blob) => saveBlob(name, blob),
      notify: (msg, bad) => toast(msg, bad),
      fps: () => +d2Of(ops.libraryOf(cardOf(deckId, cardId)!)[entryId])?.framesPerSecond || 4,
      pickHost: setPickEl,
    });
    api.current = E;
    load();
    return () => { clearTimeout(timer); api.current = null; if (E.dirty()) void chain.then(() => commit(E)); E.dispose(); };   // browser/phone back saves too
  }, [deckId, cardId, entryId]);

  useEffect(() => { api.current?.setHistory(canUndo(deckId, cardId), canRedo(deckId, cardId)); });

  return (
    <div ref={root} className="ae">
      {pickEl && createPortal(<ColorPanel current={api.current?.getColor() || "#000000"} onChange={(h) => api.current?.setColor(h)} />, pickEl)}
    </div>
  );
}
