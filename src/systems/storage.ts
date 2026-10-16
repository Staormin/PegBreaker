// systems/storage.ts — abstraction du stockage (localStorage en jeu, mémoire en test).
// Toutes les opérations sont « silencieuses » : quota dépassé, navigation privée ou
// SecurityError ne doivent jamais casser le jeu.

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Stockage en mémoire (tests Node, ou repli si localStorage est inaccessible). */
export function createMemoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

export function safeGet(s: StorageLike, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}

/** Renvoie false si l'écriture a échoué (quota, accès refusé). */
export function safeSet(s: StorageLike, k: string, v: string): boolean {
  try {
    s.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(s: StorageLike, k: string): void {
  try {
    s.removeItem(k);
  } catch {
    /* silencieux */
  }
}
