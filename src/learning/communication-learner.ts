// 25.8: Communication Learner — Context-Effektivitaet tracken
import { getDb } from '../memory/store.js';

interface ContextEffectiveness {
  context_mode: string;
  context_length: number;
  positive_responses: number;
  negative_responses: number;
  total_uses: number;
}

function getContextEffectivenessKey(sessionId?: string): string {
  return sessionId ? `context_effectiveness_${sessionId}` : 'context_effectiveness';
}

function loadContextEffectiveness(sessionId?: string): Record<string, ContextEffectiveness> {
  const db = getDb();
  const keys = sessionId
    ? [getContextEffectivenessKey(sessionId), getContextEffectivenessKey()]
    : [getContextEffectivenessKey()];

  for (const key of keys) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;
      const parsed = JSON.parse(row.value) as Record<string, ContextEffectiveness>;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      continue;
    }
  }

  return {};
}

function saveContextEffectiveness(
  stats: Record<string, ContextEffectiveness>,
  sessionId?: string,
): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(getContextEffectivenessKey(sessionId), JSON.stringify(stats), Date.now());
}

export function recordContextModeDelivery(mode: string, length: number, sessionId?: string): void {
  const stats = loadContextEffectiveness(sessionId);

  if (!stats[mode]) {
    stats[mode] = { context_mode: mode, context_length: length, positive_responses: 0, negative_responses: 0, total_uses: 0 };
  }
  stats[mode].total_uses++;
  stats[mode].context_length = Math.round(
    (stats[mode].context_length * (stats[mode].total_uses - 1) + length) / stats[mode].total_uses
  );

  saveContextEffectiveness(stats, sessionId);
}

export function recordContextFeedback(mode: string, positive: boolean, sessionId?: string): void {
  const stats = loadContextEffectiveness(sessionId);

  if (!stats[mode]) return;
  if (positive) stats[mode].positive_responses++;
  else stats[mode].negative_responses++;

  saveContextEffectiveness(stats, sessionId);
}

export function getBestContextMode(sessionId?: string): string | null {
  try {
    const stats = loadContextEffectiveness(sessionId);

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
