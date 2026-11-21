// Castletool tickets: blocklist check + "Need help?" hand-off to the ticket site.
import * as api from "./api";

export const TICKETS = {
  workerUrl: "https://castletool-tickets-auth.juniorboy62011.workers.dev",
  /** Ticket site address. Leave empty to hide the "Need help?" link until the site is live. */
  siteUrl: "",
  firebaseProject: "castletool-70b7f",
  firebaseKey: "AIzaSyCq0GAXA9rae8_xuO4UHfn3Mr8Td7dxDnE",
};

/** true = blocked, false = fine. Any error (offline, Firebase down) counts as fine, so an outage never locks everyone out. */
export async function isBlocked(userId: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${TICKETS.firebaseProject}/databases/(default)/documents/blocklist/${encodeURIComponent(userId)}?key=${TICKETS.firebaseKey}`;
    return (await fetch(url)).status === 200;
  } catch { return false; }
}

export function cachedUserId(): string | null {
  try { return JSON.parse(localStorage.getItem("ctw.user") || "null")?.userId ?? null; } catch { return null; }
}

/** Opens the ticket site. When signed in, the Castle token is traded for a 2-minute Firebase token that goes in the #fragment (never the Castle token itself). */
export async function openTicketSite(): Promise<void> {
  const site = TICKETS.siteUrl;
  if (!site) return;
  const token = api.getToken();
  if (!token) { window.open(site, "_blank"); return; }
  const w = window.open("about:blank", "_blank"); // opened inside the tap, before any await, so popup blockers allow it
  let dest = site;
  try {
    const r = await fetch(`${TICKETS.workerUrl}/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const j = await r.json();
    if (j?.firebaseToken) dest = `${site}#signin=${j.firebaseToken}`;
  } catch { /* open the site signed out */ }
  if (w) { w.opener = null; w.location.href = dest; } else window.location.href = dest;
}
