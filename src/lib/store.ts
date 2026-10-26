// App state: account, decks, navigation, undo sessions, saving. (Port of CTA's app.py / session.py / deck_store.py.)
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { toast as sonner } from "sonner";
import * as api from "./api";
import { DB, type CardRec, type DeckRec } from "./db";
import { Cancelled, Task } from "./tasks";
import { OpError } from "./drawing";

/** UI hooks the store calls (registered by the dialogs module). */
export const ui: { deckDeleted?: () => void } = {};

export const GLOBAL_LIMIT = 100;
export const GLOBAL_MAX_AGE = 120_000;
export const LOG_LEVELS: [number, string][] = [[0, "Errors only"], [1, "Normal"], [2, "Verbose"]];
export const TABS = ["RECENT", "PUBLIC", "UNLISTED", "PRIVATE", "LOCAL", "GLOBAL"];

export interface Nav { deckId: string | null; cardId: string | null; bpId: string | null; profile: boolean }
export interface DialogEntry { id: number; render: (close: () => void) => ReactNode; onClose?: () => void }

interface State {
  token: string | null;
  user: { userId: string; username: string } | null;
  avatarUrl: string | null;
  online: boolean;
  local: Record<string, DeckRec>;
  loaded: boolean;
  globalDecks: any[];
  tab: string;
  devMode: boolean;
  logLevel: number;
  logs: { t: number; level: number; msg: string }[];
  nav: Nav;
  progress: Task | null;
  dialogs: DialogEntry[];
  rev: number;               // bumps on every card edit so open screens redraw
}

const settings = (() => { try { return JSON.parse(localStorage.getItem("ctw.settings") || "{}"); } catch { return {}; } })();
const saveSettings = () => { try { localStorage.setItem("ctw.settings", JSON.stringify(settings)); } catch { /* ignore */ } };
const cachedUser = (() => { try { return JSON.parse(localStorage.getItem("ctw.user") || "null"); } catch { return null; } })();
const cachedGlobal = (() => { try { return JSON.parse(localStorage.getItem("ctw.global") || "[]"); } catch { return []; } })();

let state: State = {
  token: api.getToken(),
  user: cachedUser,
  avatarUrl: (() => { try { return localStorage.getItem("ctw.avatar"); } catch { return null; } })(),
  online: true,
  local: {},
  loaded: false,
  globalDecks: cachedGlobal,
  tab: settings.tab || "RECENT",
  devMode: !!settings.dev_mode,
  logLevel: settings.log_level ?? 1,
  logs: [],
  nav: { deckId: null, cardId: null, bpId: null, profile: false },
  progress: null,
  dialogs: [],
  rev: 0,
};
const listeners = new Set<() => void>();
export function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export const get = () => state;
export function useApp(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
export const signedIn = () => !!state.token && !!state.user;

// ── small helpers ──────────────────────────────────────────────────────
/** level 0 = errors/warnings, 1 = normal, 2 = verbose. Everything is recorded; Developer settings choose what the log shows. */
export function log(msg: string, level = 1) {
  const add = String(msg).split("\n").map((line) => {
    const low = line.toLowerCase();
    return { t: Date.now(), level: /^(error|warning|failed)/.test(low) ? 0 : level, msg: line };
  });
  set({ logs: [...state.logs, ...add].slice(-1000) });
}
export const visibleLogs = (limit = 120) => state.logs.filter((l) => l.level <= state.logLevel).slice(-limit);
export function toast(msg: string, error = false) { void error; sonner(msg); }
export const getSetting = (key: string) => settings[key];
export function setSetting(key: string, value: any) {
  settings[key] = value;
  saveSettings();
  if (key === "dev_mode") set({ devMode: !!value });
  if (key === "log_level") set({ logLevel: value });
  if (key === "tab") set({ tab: value });
}

export const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

// ── dialogs ────────────────────────────────────────────────────────────
let dialogId = 1;
export function openDialog(render: (close: () => void) => ReactNode, onClose?: () => void): number {
  const id = dialogId++;
  set({ dialogs: [...state.dialogs, { id, render, onClose }] });
  return id;
}
export function closeDialog(id: number) {
  const d = state.dialogs.find((x) => x.id === id);
  if (!d) return;
  set({ dialogs: state.dialogs.filter((x) => x.id !== id) });
  try { d.onClose?.(); } catch { /* ignore */ }
}

// ── work with progress ─────────────────────────────────────────────────
const active = new Set<Task>();
export let lastWorkCancelled = false;
export function cancelAllTasks() { active.forEach((t) => t.cancel()); }

export function errorMessage(e: any): string {
  if (e instanceof api.OfflineError) return "No Wi-Fi.";
  return String(e?.message || e);
}

/** Runs fn(task) with a cancellable greyed-out progress overlay. null = failed or cancelled (errors are toasted). */
export async function work<T>(label: string, fn: (t: Task) => Promise<T>, opts: { progress?: boolean; task?: Task } = {}): Promise<T | null> {
  const task = opts.task || new Task(label, (m) => log(`[${label}] ${m}`, 2));
  active.add(task);
  const t0 = performance.now();
  log(`${label}: started`, 2);
  if (opts.progress !== false) set({ progress: task });
  let result: T | null = null;
  try {
    result = await fn(task);
  } catch (e: any) {
    if (e instanceof Cancelled || task.cancelled) { /* cancelled */ }
    else {
      if (e instanceof api.OfflineError) set({ online: false });
      log(`error: ${e?.message || e}`);
      toast(errorMessage(e), true);
    }
  } finally {
    active.delete(task);
    if (state.progress === task) set({ progress: null });
  }
  const took = ((performance.now() - t0) / 1000).toFixed(1);
  lastWorkCancelled = task.cancelled;
  if (task.cancelled) { log(`${label}: cancelled after ${took}s`); return null; }
  log(`${label}: ${result !== null ? "done" : "failed"} in ${took}s`, 2);
  return result;
}

// ── account ────────────────────────────────────────────────────────────
function persistUser() {
  try { state.user ? localStorage.setItem("ctw.user", JSON.stringify(state.user)) : localStorage.removeItem("ctw.user"); } catch { /* ignore */ }
}
function clearSession() {
  api.setToken(null);
  try { localStorage.removeItem("ctw.avatar"); localStorage.removeItem("ctw.global"); } catch { /* ignore */ }
  set({ token: null, user: null, avatarUrl: null, globalDecks: [], online: true });
  persistUser();
  globalAt = 0;
}

export async function refreshProfile() {
  if (!api.getToken()) return;
  let user: any;
  try { user = await api.me(); }
  catch (e) { if (e instanceof api.OfflineError) { set({ online: false }); return; } log(`error: profile: ${errorMessage(e)}`); return; }
  if (user === null) { log("Castle no longer accepts the saved sign-in."); clearSession(); return; }
  const photo = user.photo || {};
  const url = photo.avatarUrl || photo.smallAvatarUrl || null;
  set({ online: true, user: { userId: user.userId, username: user.username || "" }, avatarUrl: url || state.avatarUrl });
  persistUser();
  try { url ? localStorage.setItem("ctw.avatar", url) : null; } catch { /* ignore */ }
}

export async function ensureOnline(): Promise<boolean> {
  if (!api.getToken()) { toast("Sign in first.", true); return false; }
  if (!state.online) {
    await refreshProfile();
    if (!state.online) { toast("No Wi-Fi.", true); return false; }
  }
  return true;
}

let loginCancel = false;
export const cancelLogin = () => { loginCancel = true; };
export async function signInPassword(username: string, password: string): Promise<boolean> {
  loginCancel = false;
  try {
    const user = await api.loginPassword(username.trim(), password);
    if (loginCancel) { api.setToken(null); return false; }
    set({ token: api.getToken(), user: { userId: user.userId, username: user.username || "" },
      avatarUrl: user.photo?.avatarUrl || user.photo?.smallAvatarUrl || null, online: true });
    persistUser();
    try { state.avatarUrl ? localStorage.setItem("ctw.avatar", state.avatarUrl) : null; } catch { /* ignore */ }
    globalAt = 0;
    void refreshProfile();
    void refreshGlobal(true);
    return true;
  } catch (e) {
    if (e instanceof api.OfflineError) set({ online: false });
    log(`error: ${errorMessage(e)}`);
    toast(errorMessage(e), true);
    return false;
  }
}
export function signOut() { clearSession(); nav({ deckId: null, cardId: null, bpId: null, profile: false }, { replace: true }); }

let globalAt = 0;
export async function refreshGlobal(force = false): Promise<boolean> {
  if (!api.getToken() || !state.user?.userId) return false;
  if (!force && globalAt && Date.now() - globalAt < GLOBAL_MAX_AGE) return false;
  globalAt = Date.now();
  try {
    const decks = await api.decksForUser(state.user.userId, GLOBAL_LIMIT);
    set({ online: true, globalDecks: decks });
    try { localStorage.setItem("ctw.global", JSON.stringify(decks)); } catch { /* ignore */ }
    log(`Deck list refreshed: ${decks.length} decks`, 2);
    return true;
  } catch (e) {
    if (e instanceof api.OfflineError) set({ online: false });
    else log(`error: decks: ${errorMessage(e)}`);
    return false;
  }
}
export const resetGlobalAge = () => { globalAt = 0; };

// ── local decks ────────────────────────────────────────────────────────
export function snapOf(rc: CardRec): string {
  return JSON.stringify({ s: rc.scene, bg: rc.meta?.backgroundColor ?? null, img: rc.meta?.backgroundImage ?? null, f: rc.coverFileId ?? null });
}
/** Bytes of the scene data Castle receives for this card (the number its 10 MB upload limit applies to). Cached per edit. */
const bytesCache = new Map<string, { rev: number; bytes: number }>();
export function cardBytes(deckId: string, cardId: string): number {
  const rc = state.local[deckId]?.cards[cardId];
  if (!rc) return 0;
  const key = deckId + "/" + cardId, hit = bytesCache.get(key);
  if (hit && hit.rev === state.rev) return hit.bytes;
  let bytes = 0;
  try { bytes = new Blob([JSON.stringify({ snapshot: rc.scene?.snapshot || {} })]).size; } catch { /* leave 0 */ }
  bytesCache.set(key, { rev: state.rev, bytes });
  return bytes;
}
export const cardDirty = (rc: CardRec) => (rc.baseline ? snapOf(rc) !== rc.baseline : !!rc.dirty);
export const deckHasUnsaved = (rec?: DeckRec) => !!rec && Object.values(rec.cards).some(cardDirty);

export async function loadLocal() {
  const all = await DB.all();
  const local: Record<string, DeckRec> = {};
  for (const r of all) {
    for (const rc of Object.values(r.cards || {})) if (!rc.baseline && !rc.dirty) rc.baseline = snapOf(rc);
    local[r.deckId] = r;
  }
  set({ local, loaded: true });
}

function syncDeckCard(rec: DeckRec, cardId: string, rc: CardRec) {
  const apply = (c: any) => {
    if (c && c.cardId === cardId) {
      c.backgroundColor = rc.meta.backgroundColor;
      c.backgroundImage = rc.meta.backgroundImage ?? null;
      if (rc.meta.title !== undefined) c.title = rc.meta.title;
    }
  };
  (rec.deck.cards || []).forEach(apply);
  apply(rec.deck.initialCard);
}

async function persist(rec: DeckRec) {
  await DB.put(rec);
  set({ local: { ...state.local, [rec.deckId]: rec }, rev: state.rev + 1 });
}

// per-card undo / redo (in memory, like CTA's CardSession)
interface Session { undo: string[]; redo: string[] }
const sessions = new Map<string, Session>();
const sess = (d: string, c: string) => { const k = d + "/" + c; if (!sessions.has(k)) sessions.set(k, { undo: [], redo: [] }); return sessions.get(k)!; };
export const clearSessions = (deckId: string) => { for (const k of [...sessions.keys()]) if (k.startsWith(deckId + "/")) sessions.delete(k); };
export const canUndo = (d: string, c: string) => (sessions.get(d + "/" + c)?.undo.length || 0) > 0;
export const canRedo = (d: string, c: string) => (sessions.get(d + "/" + c)?.redo.length || 0) > 0;

function restore(rec: DeckRec, cardId: string, snap: string) {
  const rc = rec.cards[cardId], v = JSON.parse(snap);
  rc.scene = v.s;
  rc.meta.backgroundColor = v.bg;
  rc.meta.backgroundImage = v.img;
  rc.coverFileId = v.f;
  syncDeckCard(rec, cardId, rc);
  rc.dirty = rc.baseline ? snap !== rc.baseline : true;
}

/** Run an edit on a card with an undo checkpoint. A thrown error puts the card back exactly as it was. */
export async function editCard<T>(deckId: string, cardId: string, fn: (rc: CardRec, rec: DeckRec) => T | Promise<T>): Promise<T> {
  const rec = state.local[deckId], rc = rec.cards[cardId];
  const before = snapOf(rc);
  let result: T;
  try { result = await fn(rc, rec); }
  catch (e) { restore(rec, cardId, before); throw e; }
  const after = snapOf(rc);
  if (after !== before) {
    const s = sess(deckId, cardId);
    s.undo.push(before);
    if (s.undo.length > 25) s.undo.shift();
    s.redo = [];
  }
  rc.dirty = rc.baseline ? after !== rc.baseline : true;
  syncDeckCard(rec, cardId, rc);
  await persist(rec);
  return result;
}

export async function undo(deckId: string, cardId: string) {
  const s = sess(deckId, cardId), rec = state.local[deckId], rc = rec.cards[cardId];
  const prev = s.undo.pop();
  if (prev === undefined) return;
  s.redo.push(snapOf(rc));
  restore(rec, cardId, prev);
  await persist(rec);
}
export async function redo(deckId: string, cardId: string) {
  const s = sess(deckId, cardId), rec = state.local[deckId], rc = rec.cards[cardId];
  const next = s.redo.pop();
  if (next === undefined) return;
  s.undo.push(snapOf(rc));
  restore(rec, cardId, next);
  await persist(rec);
}
export async function discardCard(deckId: string, cardId: string) {
  const rec = state.local[deckId], rc = rec.cards[cardId];
  if (rc.baseline) restore(rec, cardId, rc.baseline);
  rc.dirty = false;
  sessions.delete(deckId + "/" + cardId);
  await persist(rec);
}

// ── clone / open / delete ──────────────────────────────────────────────
export async function freshClone(deckId: string, task: Task): Promise<DeckRec> {
  task.say("Downloading deck…", 0);
  const deck = await api.getDeck(deckId);
  if (!deck) throw new api.CastleAPIError(`Deck not found: ${deckId}`);
  const cards = deck.cards?.length ? deck.cards : deck.initialCard ? [deck.initialCard] : [];
  const rec: DeckRec = { deckId: deck.deckId, deck: { ...deck, cards }, cards: {}, opened: Date.now() };
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!c.cardId || !c.sceneDataUrl) continue;
    task.step(i, cards.length, `Downloading card ${i + 1}/${cards.length}`);
    log(`getting ${c.cardId}...`);
    const scene = await api.downloadJSON(c.sceneDataUrl);
    const rc: CardRec = { meta: c, scene, coverFileId: null, dirty: false };
    rc.baseline = snapOf(rc);
    rec.cards[c.cardId] = rc;
  }
  const topId = deck.initialCard?.cardId || cards[0]?.cardId;
  rec.cauldron = topId && rec.cards[topId] ? api.sceneUsesCauldron(rec.cards[topId].scene) : false;
  task.say("Finishing up", 0.98);
  task.check();
  await DB.put(rec);
  clearSessions(deck.deckId);
  set({ local: { ...state.local, [rec.deckId]: rec } });
  log(`Got ${deck.deckId}`);
  return rec;
}

export async function cloneRef(text: string): Promise<DeckRec | null> {
  if (!(await ensureOnline())) return null;
  let id: string | null = null;
  try { id = await api.resolveDeckRef(text); } catch { id = null; }
  if (!id) { toast("That isn't a deck link.", true); return null; }
  const rec = await work("Cloning deck", (t) => freshClone(id!, t));
  if (rec) resetGlobalAge();
  return rec;
}

const opening = new Set<string>();
export async function openDeck(deckId: string) {
  if (opening.has(deckId)) return;
  // an open card with unsaved edits: ask first (desktop can pick another deck while a card is open)
  if (state.nav.cardId && askLeave && askLeave(() => { void openDeck(deckId); })) return;
  const local = state.local[deckId];
  const hasLocal = !!local;
  if (hasLocal && deckHasUnsaved(local)) { nav({ deckId, cardId: null, bpId: null, profile: false }); return; }
  opening.add(deckId);
  const task = new Task("Opening deck", (m) => log(`[Opening deck] ${m}`, 2));
  set({ progress: task });
  task.say("Loading…", null);
  try {
    if (api.getToken() && (state.online || !hasLocal)) {
      if (!state.online) await refreshProfile();
      if (task.cancelled) return;
      if (state.online) {
        let gone = false;
        const rec = await work<DeckRec | null>("Opening deck", async (t) => {
          try { return await freshClone(deckId, t); }
          catch (e) { if (e instanceof api.DeckDeleted) { gone = true; return null; } throw e; }
        }, { task });
        if (gone) { await deckWasDeleted(deckId); return; }
        if (rec) { nav({ deckId: rec.deckId, cardId: null, bpId: null, profile: false }); return; }
        if (!hasLocal || lastWorkCancelled) return;
      }
    }
    if (hasLocal) nav({ deckId, cardId: null, bpId: null, profile: false });
    else if (!api.getToken()) toast("Sign in first.", true);
    else toast("No Wi-Fi.", true);
  } finally {
    if (state.progress === task) set({ progress: null });
    opening.delete(deckId);
  }
}

async function deckWasDeleted(deckId: string) {
  log(`Deck ${deckId} is gone from Castle; removing the local copy`);
  const globalDecks = state.globalDecks.filter((d) => d.deckId !== deckId);
  set({ globalDecks });
  try { localStorage.setItem("ctw.global", JSON.stringify(globalDecks)); } catch { /* ignore */ }
  if (state.local[deckId]) await deleteDeck(deckId);
  ui.deckDeleted?.();
}

export async function deleteDeck(deckId: string) {
  await DB.del(deckId);
  clearSessions(deckId);
  const local = { ...state.local };
  delete local[deckId];
  set({ local });
  if (state.nav.deckId === deckId) nav({ deckId: null, cardId: null, bpId: null, profile: false }, { replace: true });
}

// ── saving ─────────────────────────────────────────────────────────────
const saving = new Set<string>();
export const isSaving = (d: string, c: string) => saving.has(d + "/" + c);

export async function saveCard(deckId: string, cardId: string): Promise<boolean> {
  const key = deckId + "/" + cardId;
  if (saving.has(key)) return false;
  if (!(await ensureOnline())) return false;
  saving.add(key);
  set({ rev: state.rev + 1 });
  const ok = await work("Saving card", async (task) => {
    const rec = state.local[deckId], rc = rec.cards[cardId];
    if (!rec.deck.deckId) throw new OpError("This deck has no deck ID; clone it from Castle first.");
    const cards = rec.deck.cards?.length ? rec.deck.cards : rec.deck.initialCard ? [rec.deck.initialCard] : [];
    const card = cards.find((c: any) => c.cardId === cardId);
    if (!card) throw new OpError(`Card ${cardId} isn't in this deck.`);
    task.say("Checking size", 0.05);
    const snap = structuredClone(rc.scene?.snapshot || {});
    if (snap.sceneProperties?.backgroundColor) snap.sceneProperties.backgroundColor.a = 1;   // the CLI forces a = 1
    const payload = { snapshot: snap };
    task.say("Preparing card", 0.1);
    try { // refuse to save a card that belongs to another deck
      const ex = await api.cardInfo(cardId);
      if (ex && ex.deckId && ex.deckId !== deckId) throw new OpError(`Refusing to save card ${cardId} into deck ${deckId}: it already belongs to deck ${ex.deckId}.`);
    } catch (e) { if (e instanceof OpError) throw e; }
    task.say("Uploading card", 0.3);
    const uploadId = await api.uploadSceneData(cardId, payload);
    task.say("Updating deck", 0.85);
    task.check();                                  // last point where Cancel still applies
    const initialId = rec.deck.initialCard?.cardId || cards[0].cardId;
    const isInitial = cardId === initialId;
    const deckInput: any = { deckId: rec.deck.deckId, title: rec.deck.title || deckId, visibility: rec.deck.visibility || "unlisted" };
    if (isInitial) { deckInput.initialCardId = cardId; deckInput.variables = rec.deck.variables || []; }
    const cardInput: any = { cardId, title: card.title || rc.meta.title || "Card", blocks: [], uploadId, makeInitialCard: isInitial };
    if (rc.coverFileId) cardInput.backgroundImageFileId = rc.coverFileId;
    const res = await api.updateCardAndDeckV2(deckInput, cardInput);
    if (res.deck.deckId !== rec.deck.deckId || res.card.cardId !== cardId) throw new api.CastleAPIError("Server returned unexpected ids.");
    rc.coverFileId = null;
    rc.baseline = snapOf(rc);
    rc.dirty = false;
    sessions.delete(deckId + "/" + cardId);
    await persist(rec);
    log(`Saved card ${cardId}.`);
    return true;
  });
  saving.delete(key);
  set({ rev: state.rev + 1 });
  return !!ok;
}

// ── navigation ─────────────────────────────────────────────────────────
let navPrev: Nav = state.nav;
export function nav(next: Partial<Nav>, opts: { replace?: boolean } = {}) {
  const n: Nav = { ...state.nav, ...next };
  if (!isDesktop()) {
    try { opts.replace ? history.replaceState(n, "") : history.pushState(n, ""); } catch { /* ignore */ }
  }
  navPrev = state.nav;
  set({ nav: n });
}

/** Back, one level: browser history on mobile, direct state on desktop. */
export function back() {
  if (!isDesktop()) { history.back(); return; }
  const n = state.nav;
  if (n.profile) set({ nav: { ...n, profile: false } });
  else if (n.bpId) set({ nav: { ...n, bpId: null } });
  else if (n.cardId) set({ nav: { ...n, cardId: null } });
  else if (n.deckId) set({ nav: { ...n, deckId: null } });
}

let askLeave: ((then: () => void) => boolean) | null = null;
/** The card screen registers its "Save Changes?" prompt here. Returns true when it took over. */
export function setLeaveGuard(fn: typeof askLeave) { askLeave = fn; }

export function requestBack() {
  const n = state.nav;
  if (n.cardId && !n.bpId && !n.profile && askLeave && askLeave(back)) return;
  back();
}
/** Selecting something else while the open card has unsaved edits. */
export function requestNav(next: Partial<Nav>, opts: { replace?: boolean } = {}) {
  const n = state.nav;
  const leavingCard = n.cardId && (next.cardId !== undefined ? next.cardId !== n.cardId : false || next.deckId !== undefined && next.deckId !== n.deckId);
  if (leavingCard && askLeave && askLeave(() => nav(next, opts))) return;
  nav(next, opts);
}

export function initNavigation() {
  if (!isDesktop()) {
    try { history.replaceState(state.nav, ""); } catch { /* ignore */ }
  }
  window.addEventListener("popstate", (e) => {
    if (isDesktop()) return;
    const target: Nav = (e.state && typeof e.state === "object" && "deckId" in e.state) ? e.state : { deckId: null, cardId: null, bpId: null, profile: false };
    const cur = state.nav;
    // leaving a card (not into its blueprint) with unsaved edits → ask first. A card with nothing to save
    // falls straight through to the navigation below (it used to bounce between history entries before it gave in).
    if (cur.cardId && !cur.bpId && !target.cardId && askLeave) {
      if (askLeave(() => { history.back(); })) {
        history.pushState(cur, "");                            // stay on the card until the person answers
        return;
      }
    }
    navPrev = cur;
    set({ nav: target });
  });
  window.addEventListener("beforeunload", (e) => {
    if (Object.values(state.local).some(deckHasUnsaved)) { /* edits are kept in this browser; no prompt needed */ }
    void e;
  });
}
export const _navPrev = () => navPrev;

// ── editing helpers used by the screens ────────────────────────────────
/** Quick edit with an undo checkpoint. Failures are toasted; returns false when the edit didn't happen. */
export async function editQuick(deckId: string, cardId: string, fn: (rc: CardRec, rec: DeckRec) => void | Promise<void>): Promise<boolean> {
  try { await editCard(deckId, cardId, fn); return true; }
  catch (e: any) {
    if (e instanceof OpError) { toast(e.message, true); return false; }
    log(`error: ${e?.message || e}`); toast(errorMessage(e), true); return false;
  }
}
/** Long edit with progress + Cancel + undo checkpoint; the card goes back exactly as it was if it fails or is cancelled. */
export async function editAsync<T>(deckId: string, cardId: string, label: string, fn: (task: Task, rc: CardRec, rec: DeckRec) => Promise<T>): Promise<T | null> {
  return work(label, (task) => editCard(deckId, cardId, (rc, rec) => fn(task, rc, rec)));
}
export const cardOf = (deckId: string | null, cardId: string | null): CardRec | undefined => (deckId && cardId ? state.local[deckId]?.cards[cardId] : undefined);
