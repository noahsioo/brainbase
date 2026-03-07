// 21.6: Neurofeedback — Closed-Loop Self-Regulation
// System beobachtet eigene Metriken und korrigiert bei Verschlechterung

import { getDb } from '../memory/store.js';

interface MetricSnapshot {
  garbage_rate: number;
  feedback_score: number;
  context_nodes_avg: number;
  timestamp: number;
}

export function recordMetricSnapshot(garbageRate: number, positiveFeedbacks: number, negativeFeedbacks: number): void {
  const db = getDb();
  const total = positiveFeedbacks + negativeFeedbacks;
  const feedbackScore = total > 0 ? positiveFeedbacks / total : 0.5;

  let contextNodesAvg = 10;
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'last_context_node_ids'")
      .get() as { value: string } | undefined;
    if (row) contextNodesAvg = JSON.parse(row.value).length;
  } catch {}

  const snapshot: MetricSnapshot = {
    garbage_rate: garbageRate,
    feedback_score: feedbackScore,
    context_nodes_avg: contextNodesAvg,
    timestamp: Date.now(),
  };

  let history: MetricSnapshot[] = [];
  try {
    const histRow = db.prepare("SELECT value FROM system_state WHERE key = 'neurofeedback_history'")
      .get() as { value: string } | undefined;
    if (histRow) history = JSON.parse(histRow.value);
  } catch {}
  history.push(snapshot);
  if (history.length > 20) history.shift();

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('neurofeedback_history', JSON.stringify(history), Date.now());
}

export function detectMetricDegradation(): { metric: string; action: string } | null {
  const db = getDb();
  let history: MetricSnapshot[] = [];
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'neurofeedback_history'")
      .get() as { value: string } | undefined;
    if (row) history = JSON.parse(row.value);
  } catch {}

  if (history.length < 5) return null;

  const recent = history.slice(-3);
  const older = history.slice(-8, -3);
  if (older.length < 3) return null;

  const recentGarbage = recent.reduce((s, h) => s + h.garbage_rate, 0) / recent.length;
  const olderGarbage = older.reduce((s, h) => s + h.garbage_rate, 0) / older.length;

  if (recentGarbage > olderGarbage + 0.1) {
    return { metric: 'garbage_rate', action: 'tighten_quality_threshold' };
  }

  const recentFeedback = recent.reduce((s, h) => s + h.feedback_score, 0) / recent.length;
  const olderFeedback = older.reduce((s, h) => s + h.feedback_score, 0) / older.length;

  if (recentFeedback < olderFeedback - 0.15) {
    return { metric: 'feedback_score', action: 'increase_context_quality' };
  }

  return null;
}
