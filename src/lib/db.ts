// Decks live in this browser (IndexedDB), one record per deck. Same database as the prototype, so nothing is lost.
export interface CardRec {
  meta: any;                 // the card entry from Castle (cardId, title, backgroundColor, backgroundImage, ...)
  scene: any;                // scene data: { snapshot: { library, actors, sceneProperties, ... } }
  baseline?: string;         // snapshot of the last saved state; the card is unsaved when it differs
  coverFileId?: string | null;
  dirty?: boolean;
}
export interface DeckRec {
  deckId: string;
  deck: any;                 // deck.json equivalent
  cards: Record<string, CardRec>;
  opened?: number;
  cauldron?: boolean;
}

const idb: Promise<IDBDatabase> = new Promise((res, rej) => {
  const r = indexedDB.open("castletool", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("decks", { keyPath: "deckId" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await idb;
  return new Promise((res, rej) => {
    const r = f(d.transaction("decks", mode).objectStore("decks"));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const DB = {
  all: () => tx<DeckRec[]>("readonly", (s) => s.getAll()),
  get: (id: string) => tx<DeckRec | undefined>("readonly", (s) => s.get(id)),
  put: (v: DeckRec) => tx("readwrite", (s) => s.put(v)),
  del: (id: string) => tx("readwrite", (s) => s.delete(id)),
};
