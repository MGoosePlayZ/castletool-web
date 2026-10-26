import { useEffect } from "react";
import { Avatar, Minor, PillButton, Separator, Title, TextAction } from "@/components/widgets";
import { LogView } from "@/components/LogView";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FooterLinks, SignInForm } from "./SignIn";
import { useApp, signOut, refreshProfile, setSetting, LOG_LEVELS, back, nav, get, set } from "@/lib/store";
import { saveText } from "@/lib/pick";
import { toast } from "@/lib/store";
import { APP_VERSION } from "@/lib/theme";

function logText() {
  const s = get(), head = [`Castletool ${APP_VERSION}`, `platform: ${navigator.userAgent}`, ""];
  const lines = s.logs.map((l) => `${new Date(l.t).toISOString().slice(11, 19)} ${l.msg}`);
  return head.concat(lines).join("\n");
}

export function ProfileScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const app = useApp(), signed = !!app.token && !!app.user;
  useEffect(() => { void refreshProfile(); }, []);
  const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  return (
    <div className="h-full overflow-auto">
      <div className="px-4 pb-4 pt-5">
        <div className="flex flex-col items-center gap-3.5">
          <div className="flex w-full items-start gap-4">
            <button type="button" onClick={() => { if (signed && !app.online) void refreshProfile(); }}><Avatar size={88} ring={false} /></button>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <Title size={22} className="max-w-full truncate">{signed ? app.user?.username || "" : "Not signed in"}</Title>
              <Minor size={13}>{signed && !app.online ? "No Wi-Fi" : ""}</Minor>
              {signed && <PillButton label="Sign out" width={120} onClick={() => signOut()} />}
            </div>
          </div>
          {!signed && <SignInForm onDone={() => { onSignedIn ? onSignedIn() : nav({ deckId: null, cardId: null, bpId: null, profile: false }); }} />}
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-center"><span className="flex-1 text-sm">Developer mode</span><Switch checked={app.devMode} onCheckedChange={(v) => setSetting("dev_mode", v)} /></div>
        {app.devMode && <>
          <div className="relative w-[260px]">
            <span className="absolute -top-2 left-2 z-10 bg-black px-1 text-xs" style={{ color: "#888" }}>Log verbosity</span>
            <Select value={String(app.logLevel)} onValueChange={(v) => setSetting("log_level", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LOG_LEVELS.map(([k, t]) => <SelectItem key={k} value={String(k)}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <PillButton label="Save all logs" onClick={() => { saveText(`castletool-logs-${stamp()}.txt`, logText()); toast("Logs saved."); }} />
            <PillButton label="Clear" onClick={() => set({ logs: [] })} />
          </div>
          <Minor size={11}>Log</Minor>
          <LogView height={240} />
        </>}
      </div>
      <Separator />
      <div className="px-4 pb-7 pt-3"><FooterLinks /></div>
    </div>
  );
}
void back; void TextAction;
