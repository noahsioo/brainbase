import { getDb } from '../memory/store.js';

export interface SignalAccumulator {
  set(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  flush(): void;
}

export function createSignalAccumulator(): SignalAccumulator {
  const pending = new Map<string, string>();

  return {
    set(key: string, value: unknown): void {
      pending.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },

    get(key: string): unknown | undefined {
      const raw = pending.get(key);
      if (raw === undefined) return undefined;
      try { return JSON.parse(raw); } catch { return raw; }
    },

    flush(): void {
      if (pending.size === 0) return;
      const db = getDb();
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)',
      );
      const now = Date.now();
      db.transaction(() => {
        for (const [key, value] of pending) {
          stmt.run(key, value, now);
        }
      })();
      pending.clear();
    },
  };
}
