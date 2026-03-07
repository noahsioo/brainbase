// 25.8: Communication Learner — Context-Effektivitaet tracken
import { getDb } from '../memory/store.js';

interface ContextEffectiveness {
  context_mode: string;
  context_length: number;
  positive_responses: number;
  negative_responses: number;
  total_uses: number;
}

export function recordContextDelivery(mode: string, length: number): void {
  const db = getDb();
  let stats: Record<string, ContextEffectiveness> = {};
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'context_effectiveness'")
      .get() as { value: string } | undefined;
    if (row) stats = JSON.parse(row.value);
  } catch {}

  if (!stats[mode]) {
    stats[mode] = { context_mode: mode, context_length: length, positive_responses: 0, negative_responses: 0, total_uses: 0 };
  }
  stats[mode].total_uses++;
  stats[mode].context_length = Math.round(
    (stats[mode].context_length * (stats[mode].total_uses - 1) + length) / stats[mode].total_uses
  );

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('context_effectiveness', JSON.stringify(stats), Date.now());
}

export function recordContextFeedback(mode: string, positive: boolean): void {
  const db = getDb();
  let stats: Record<string, ContextEffectiveness> = {};
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'context_effectiveness'")
      .get() as { value: string } | undefined;
    if (row) stats = JSON.parse(row.value);
  } catch {}

  if (!stats[mode]) return;
  if (positive) stats[mode].positive_responses++;
  else stats[mode].negative_responses++;

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('context_effectiveness', JSON.stringify(stats), Date.now());
}

export function getBestContextMode(): string | null {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'context_effectiveness'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    const stats: Record<string, ContextEffectiveness> = JSON.parse(row.value);

    let best: string | null = null;
    let bestScore = -1;

    for (const [mode, data] of Object.entries(stats)) {
      if (data.total_uses < 5) continue;
      const score = (data.positive_responses + 1) / (data.positive_responses + data.negative_responses + 2);
      if (score > bestScore) {
        bestScore = score;
        best = mode;
      }
    }
    return best;
  } catch { return null; }
}
