import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PillButton, Minor, Title } from "@/components/widgets";
import { CASTLE_LINKS, DISCLAIMER, MAJOR } from "@/lib/theme";
import { signInPassword, cancelLogin, setSetting, get } from "@/lib/store";

export function FooterLinks() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap justify-center">
        {CASTLE_LINKS.map(([label, url]) => (
          <a key={label} href={url} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-2 text-[13px] font-medium hover:bg-accent" style={{ color: MAJOR }}>{label}</a>
        ))}
      </div>
      <Minor size={11} className="text-center">{DISCLAIMER}</Minor>
    </div>
  );
}

const Eye = ({ off }: { off: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{off && <path d="M3 3l18 18" />}
  </svg>
);

/** Username / password / Sign in. Shared by the first-run screen and Profile. */
export function SignInForm({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState(""), [pass, setPass] = useState(""), [show, setShow] = useState(false), [busy, setBusy] = useState(false);
  const go = async () => {
    if (!user || !pass) return;
    setBusy(true);
    const ok = await signInPassword(user, pass);
    setBusy(false);
    setPass("");
    if (ok) onDone();
  };
  return (
    <form className="flex flex-col items-center gap-2.5" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <Input placeholder="Username or email" autoCapitalize="none" autoCorrect="off" autoComplete="username" style={{ width: 280 }} value={user} onChange={(e) => setUser(e.target.value)} />
      <div className="relative" style={{ width: 280 }}>
        <Input placeholder="Password" type={show ? "text" : "password"} autoComplete="current-password" className="pr-10" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button type="button" tabIndex={-1} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" onClick={() => setShow(!show)} aria-label="Show password"><Eye off={show} /></button>
      </div>
      <PillButton label="Sign in" filled busy={busy} width={280} onClick={() => void go()} />
      {busy && <PillButton label="Cancel" width={280} onClick={() => { cancelLogin(); setBusy(false); }} />}
    </form>
  );
}

/** Shown instead of Decks until the first sign-in: nothing else reachable. */
export function SignInScreen() {
  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 overflow-auto py-4">
        <Title size={28} className="text-center">Welcome to Castletool!</Title>
        <SignInForm onDone={() => setSetting("onboarded", true)} />
      </div>
      <div className="px-4 pb-4 pt-2"><FooterLinks /></div>
    </div>
  );
}
void get;
