import { useEffect, useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";
import { DialogHost, ProgressOverlay, CI, Minor, Title, Separator } from "@/components/widgets";
import { TopBar, BackButton, CloneButton, ProfileButton } from "@/components/TopBar";
import { CardBar, useLeaveGuard } from "@/components/CardBar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HomeBody } from "@/screens/Home";
import { DeckBody } from "@/screens/Deck";
import { CardBody } from "@/screens/Card";
import { BlueprintView } from "@/screens/Blueprint";
import { ProfileScreen } from "@/screens/Profile";
import { SignInScreen } from "@/screens/SignIn";
import { useApp, loadLocal, initNavigation, refreshProfile, getSetting, nav, requestNav, signedIn } from "@/lib/store";
import { SEP } from "@/lib/theme";
import { IconButton, Avatar } from "@/components/widgets";
import { cloneDialog } from "@/screens/Home";

const mq = typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)") : null;
function useIsDesktop() {
  return useSyncExternalStore((cb) => { mq?.addEventListener("change", cb); return () => mq?.removeEventListener("change", cb); }, () => !!mq?.matches);
}

// ── mobile: the same screens, in the same order, as CTA ────────────────
function Mobile() {
  const { nav: n } = useApp();
  useLeaveGuard(n.deckId, n.cardId);
  let bar: React.ReactNode, body: React.ReactNode;
  if (n.profile) { bar = <TopBar title="Profile" left={<BackButton />} />; body = <ProfileScreen />; }
  else if (n.deckId && n.cardId && n.bpId) { bar = <CardBar deckId={n.deckId} cardId={n.cardId} mode="blueprint" />; body = <BlueprintView deckId={n.deckId} cardId={n.cardId} entryId={n.bpId} />; }
  else if (n.deckId && n.cardId) { bar = <CardBar deckId={n.deckId} cardId={n.cardId} mode="card" />; body = <CardBody deckId={n.deckId} cardId={n.cardId} />; }
  else if (n.deckId) { bar = <TopBar title="Deck" left={<BackButton />} />; body = <DeckBody deckId={n.deckId} />; }
  else { bar = <TopBar title="Decks" left={<CloneButton />} right={<ProfileButton />} />; body = <HomeBody />; }
  return (
    <div className="flex h-full flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {bar}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

// ── desktop: decks | cards | blueprints + editor ───────────────────────
function PaneHeader({ title, left, right }: { title?: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center px-1.5">
      <div className="flex w-14 justify-start">{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{title && <Title size={20} className="truncate">{title}</Title>}</div>
      <div className="flex w-14 justify-end">{right}</div>
    </div>
  );
}
const Empty = ({ icon }: { icon: string }) => <div className="flex h-full items-center justify-center opacity-60"><CI name={icon} size={30} color="#888" /></div>;

function Desktop() {
  const { nav: n } = useApp();
  useLeaveGuard(n.deckId, n.cardId);
  const hasCard = !!(n.deckId && n.cardId);
  return (
    <div className="flex h-full">
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-r xl:w-[340px]" style={{ borderColor: SEP }}>
        <PaneHeader title="Decks" left={<IconButton onClick={cloneDialog} tooltip="Clone a deck"><CI name="download2" size={22} /></IconButton>}
          right={<IconButton size={44} tooltip="Profile" onClick={() => nav({ profile: true })}><Avatar size={36} /></IconButton>} />
        <div className="min-h-0 flex-1"><HomeBody selectedDeckId={n.deckId} /></div>
      </aside>
      <section className="flex h-full w-[300px] shrink-0 flex-col border-r xl:w-[340px]" style={{ borderColor: SEP }}>
        <PaneHeader title={n.deckId ? "Deck" : undefined} />
        <Separator />
        <div className="min-h-0 flex-1">{n.deckId ? <DeckBody deckId={n.deckId} selectedCardId={n.cardId} /> : <Empty icon="snapshot" />}</div>
      </section>
      <main className="flex h-full min-w-0 flex-1 flex-col">
        {hasCard ? <>
          <CardBar deckId={n.deckId!} cardId={n.cardId!} mode="card" className="h-12" />
          <Separator />
          <div className="flex min-h-0 flex-1">
            <div className="h-full w-[260px] shrink-0 border-r xl:w-[300px]" style={{ borderColor: SEP }}>
              <CardBody deckId={n.deckId!} cardId={n.cardId!} selectedId={n.bpId} onOpen={(id) => nav({ bpId: id })} />
            </div>
            <div className="h-full min-w-0 flex-1">{n.bpId ? <BlueprintView key={n.bpId} deckId={n.deckId!} cardId={n.cardId!} entryId={n.bpId} /> : <Empty icon="brick" />}</div>
          </div>
        </> : <Empty icon="pencil" />}
      </main>
      <Dialog open={n.profile} onOpenChange={(o) => { if (!o) nav({ profile: false }); }}>
        <DialogContent aria-describedby={undefined} className="h-[80vh] max-w-[460px] overflow-hidden">
          <DialogTitle className="sr-only">Profile</DialogTitle>
          <div className="flex h-12 shrink-0 items-center px-1.5">
            <IconButton onClick={() => nav({ profile: false })} tooltip="Close"><CI name="close" size={22} /></IconButton>
            <div className="flex flex-1 justify-center"><Title size={20}>Profile</Title></div><div className="w-10" />
          </div>
          <div className="min-h-0 flex-1"><ProfileScreen onSignedIn={() => nav({ profile: false })} /></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function App() {
  const app = useApp(), desktop = useIsDesktop();
  useEffect(() => { initNavigation(); void loadLocal(); void refreshProfile(); }, []);
  const needSignIn = !getSetting("onboarded") && !signedIn();
  return (
    <div className="h-full w-full bg-black">
      {!app.loaded ? null : needSignIn ? <SignInScreen /> : desktop ? <Desktop /> : <Mobile />}
      <DialogHost />
      <ProgressOverlay />
      <Toaster />
    </div>
  );
}
void Minor; void requestNav;
