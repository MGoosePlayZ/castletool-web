import { useEffect, useRef } from "react";
import { CI, IconButton } from "./widgets";
import { SEP, MINOR1 } from "@/lib/theme";
import { useApp, visibleLogs, toast } from "@/lib/store";

/** Scrolling log text box with a copy button at its top right. Hidden unless Developer mode is on. */
export function LogView({ height = 140 }: { height?: number }) {
  const app = useApp(), ref = useRef<HTMLDivElement>(null);
  const lines = app.devMode ? visibleLogs(300) : [];
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines.length]);
  if (!app.devMode) return null;
  return (
    <div className="relative rounded-[10px] border pb-2 pl-2.5 pr-1 pt-1" style={{ height, borderColor: SEP }}>
      <div ref={ref} className="h-full overflow-auto pr-9">
        {lines.map((l, i) => <div key={i} className="select-text break-words text-[11px] leading-snug" style={{ color: MINOR1 }}>{l.msg}</div>)}
      </div>
      <div className="absolute right-0 top-0">
        <IconButton size={32} tooltip="Copy logs" onClick={async () => { try { await navigator.clipboard.writeText(lines.map((l) => l.msg).join("\n")); toast("Logs copied."); } catch { toast("Couldn't copy the logs.", true); } }}>
          <CI name="copy" size={18} color={MINOR1} />
        </IconButton>
      </div>
    </div>
  );
}
