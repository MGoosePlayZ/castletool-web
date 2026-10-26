// Castle GraphQL API: same calls castle-cli / CTA make, straight from the browser.
export class CastleAPIError extends Error { code?: string; }
export class OfflineError extends CastleAPIError {}
export class DeckDeleted extends CastleAPIError {}
export class UploadTooLarge extends CastleAPIError {}

const API = "https://api.castle.xyz/graphql";
export const UPLOAD_LIMIT = 10 * 1048576;
export const TOO_LARGE = "This card is over Castle's 10 MB upload limit. Remove some media and try again.";
const DECK_GONE = "permission to view this deck";
const USER_FIELDS = "userId username token isAnonymous photo{avatarUrl smallAvatarUrl}";

const CLI_HEADERS: Record<string, string> = {
  "X-OS": "cli",
  "X-CLI-API-Version": "4",
  "X-Scene-Creator-Version": "latest",
  Accept: "application/json",
};

export const FLAGS = {
  bloodOrGuns: false, profanity: false, sexuallySuggestive: false, horrorOrFear: false,
  alcoholOrDrugs: false, loudSounds: false, flashingLights: false,
};

export const DECK_QUERY = `query($deckId: ID!) { deck(deckId: $deckId) { deckId title caption visibility lastModified playCount variables
  initialCard { cardId title sceneDataUrl backgroundColor backgroundImage { url smallUrl largeCardUrl } }
  cards { cardId title sceneDataUrl backgroundColor backgroundImage { url smallUrl largeCardUrl } } } }`;

let token: string | null = (() => { try { return localStorage.getItem("ctw.token"); } catch { return null; } })();
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try { t ? localStorage.setItem("ctw.token", t) : localStorage.removeItem("ctw.token"); } catch { /* private mode */ }
}

function httpMessage(status: number, body = "") {
  const text = body.trim();
  if (status === 413 || text.includes("EntityTooLarge") || text.includes("Request Entity Too Large")) return TOO_LARGE;
  if (!text || text.startsWith("<") || text.slice(0, 200).toLowerCase().includes("<html")) return `Castle returned an error (HTTP ${status}).`;
  return `Castle returned HTTP ${status}: ${text.slice(0, 200)}`;
}

async function post(init: RequestInit): Promise<any> {
  let r: Response;
  try { r = await fetch(API, { method: "POST", ...init }); }
  catch (e: any) { throw new OfflineError(String(e?.message || e)); }
  const raw = await r.text();
  let b: any;
  try { b = JSON.parse(raw); } catch { throw new CastleAPIError(httpMessage(r.status, raw)); }
  if (b?.error) throw new CastleAPIError(b.error.message || String(b.error));
  if (b?.errors?.length) {
    const e = new CastleAPIError(b.errors[0].message || String(b.errors[0]));
    e.code = b.errors[0].extensions?.code;
    throw e;
  }
  if (!r.ok) throw new CastleAPIError(httpMessage(r.status));
  return b.data;
}

export async function gql(query: string, variables: Record<string, any> = {}) {
  const headers: Record<string, string> = { ...CLI_HEADERS, "Content-Type": "application/json" };
  if (token) headers["X-Auth-Token"] = token;
  return post({ headers, body: JSON.stringify({ query, variables }) });
}

async function multipart(query: string, field: string, blob: Blob, name: string) {
  const form = new FormData();
  form.append("operations", JSON.stringify({ query, variables: { file: null } }));
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append("0", blob, name);
  const headers: Record<string, string> = { ...CLI_HEADERS, "Apollo-Require-Preflight": "true" };
  if (token) headers["X-Auth-Token"] = token;
  const data = await post({ headers, body: form });
  return data?.[field];
}

export async function loginPassword(usernameOrEmail: string, password: string) {
  const d = await gql(`mutation($u: String!, $p: String!) { loginV2(usernameOrEmail: $u, password: $p) { ${USER_FIELDS} } }`,
    { u: usernameOrEmail, p: password });
  const user = d.loginV2;
  if (!user?.token) throw new CastleAPIError("Sign-in didn't return a token.");
  setToken(user.token);
  return user;
}

/** Current user; null when not signed in or the token is rejected. Throws OfflineError when Castle can't be reached. */
export async function me() {
  if (!token) return null;
  try {
    const u = (await gql(`query { me { ${USER_FIELDS} } }`)).me;
    return !u || u.isAnonymous ? null : u;
  } catch (e) {
    if (e instanceof OfflineError) throw e;
    return null;
  }
}

export async function downloadBlob(url: string): Promise<Blob> {
  let r: Response;
  try { r = await fetch(url); } catch (e: any) { throw new OfflineError(String(e?.message || e)); }
  if (!r.ok) throw new CastleAPIError(`Download failed (HTTP ${r.status}).`);
  return r.blob();
}

export async function downloadJSON(url: string) {
  let r: Response;
  try { r = await fetch(url); } catch (e: any) { throw new OfflineError(String(e?.message || e)); }
  if (!r.ok) throw new CastleAPIError(`Download failed (HTTP ${r.status}).`);
  return r.json();
}

export async function getDeck(deckId: string) {
  try { return (await gql(DECK_QUERY, { deckId })).deck; }
  catch (e: any) {
    if (!(e instanceof OfflineError) && String(e.message).toLowerCase().includes(DECK_GONE)) throw new DeckDeleted(e.message);
    throw e;
  }
}

export async function decksForUser(userId: string, limit = 100) {
  const d = await gql(`query($userId: ID!, $limit: Int) { decksForUser(userId: $userId, limit: $limit, filter: recent_edited) {
    deckId title visibility caption lastModified playCount playTime
    initialCard { cardId title backgroundColor backgroundImage { url smallUrl } }
    cards { cardId title } } }`, { userId, limit });
  return d.decksForUser || [];
}

export async function cardInfo(cardId: string) {
  const d = await gql(`query($cardId: ID!) { card(cardId: $cardId) { cardId deckId } }`, { cardId });
  return d.card && d.card.cardId === cardId ? d.card : null;
}

/** Presigned S3 POST. Returns the uploadId for updateCardAndDeckV2. */
export async function uploadSceneData(cardId: string, scene: any, onStage?: (s: string) => void): Promise<string> {
  const payload = JSON.stringify(scene);
  if (new TextEncoder().encode(payload).length > UPLOAD_LIMIT) throw new UploadTooLarge(TOO_LARGE);
  const cfg = (await gql(`mutation($c: [ID!]!) { createSceneDataUploadConfig(cardIds: $c) { cardId uploadId postUrl postFields } }`, { c: [cardId] }))
    .createSceneDataUploadConfig?.[0];
  if (!cfg) throw new CastleAPIError("Failed to get scene data upload config.");
  onStage?.("upload");
  const f = new FormData();
  f.append("Content-Type", "application/json");
  for (const [k, v] of Object.entries(cfg.postFields || {})) f.append(k, String(v));
  f.append("file", new Blob([payload], { type: "application/json" }), "blob");
  try { await fetch(cfg.postUrl, { method: "POST", mode: "no-cors", body: f }); }   // reply is opaque: Castle checks it in the next call
  catch { throw new OfflineError("Can't reach Castle's upload server."); }
  return cfg.uploadId;
}

export async function updateCardAndDeckV2(deck: any, card: any) {
  const run = () => gql(`mutation($deck: DeckInput!, $card: CardInput!) { updateCardAndDeckV2(deck: $deck, card: $card) { deck { deckId visibility } card { cardId } } }`,
    { deck, card });
  try { return (await run()).updateCardAndDeckV2; }
  catch (e: any) {
    if (e.code !== "NO_UPLOAD_FOUND") throw e;
    await new Promise((r) => setTimeout(r, 1500));          // S3 can lag behind the reply
    try { return (await run()).updateCardAndDeckV2; }
    catch (e2: any) {
      throw e2.code === "NO_UPLOAD_FOUND" ? new CastleAPIError("The upload did not reach Castle. Nothing was saved. Try again.") : e2;
    }
  }
}

export async function uploadImage(file: Blob, name: string): Promise<{ fileId: string; url: string }> {
  if (file.size > UPLOAD_LIMIT) throw new UploadTooLarge(`That image is ${(file.size / 1048576).toFixed(1)} MB, over Castle's 10 MB upload limit.`);
  const r = await multipart("mutation UploadFile($file: Upload!) { uploadFile(file: $file) { fileId url } }", "uploadFile", file, name);
  if (!r?.fileId) throw new CastleAPIError("Castle didn't accept the image.");
  return r;
}

export async function uploadAudio(file: Blob, name: string): Promise<{ fileId: string; url: string }> {
  const r = await multipart("mutation UploadCastleAudio($file: Upload!) { uploadAudioFile(file: $file) { fileId url } }", "uploadAudioFile", file, name);
  if (!r?.url) throw new CastleAPIError("Castle returned no audio URL.");
  return r;
}

// ── deck references ────────────────────────────────────────────────────
const DECK_ID = /^[A-Za-z0-9_-]{10,14}$/;
export function deckIdFromText(text: string): string | null {
  const t = text.trim();
  if (DECK_ID.test(t)) return t;
  const m = t.match(/castle\.xyz\/(?:d|deck|play)\/([A-Za-z0-9_-]{8,20})/i);
  return m ? m[1] : null;
}
/** Any deck reference → deckId. Follows s.castle.xyz share-link redirects when the browser allows it. */
export async function resolveDeckRef(text: string): Promise<string | null> {
  const direct = deckIdFromText(text);
  if (direct) return direct;
  const m = text.trim().match(/^(?:https?:\/\/)?s\.castle\.xyz\/([A-Za-z0-9_-]+)/i);
  if (!m) return null;
  try {
    const r = await fetch(`https://s.castle.xyz/${m[1]}`, { redirect: "follow" });
    return deckIdFromText(r.url) || deckIdFromText(await r.text());
  } catch { return null; }
}

export function sceneUsesCauldron(data: any): boolean {
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node.filter((v) => v && typeof v === "object"));
    else if (node && typeof node === "object") {
      if (node.experimentalWeb?.enabled === true) return true;
      stack.push(...Object.values(node).filter((v) => v && typeof v === "object"));
    }
  }
  return false;
}
