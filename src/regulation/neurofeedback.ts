// 21.6: Neurofeedback - Closed-Loop Self-Regulation
// System beobachtet eigene Metriken und korrigiert bei Verschlechterung

import { getDb } from '../memory/store.js';

interface MetricSnapshot {
  garbage_rate: number;
  feedback_score: number;
  context_nodes_avg: number;
  timestamp: number;
}

function getMetricHistoryKey(sessionId?: string): string {
  return sessionId ? `neurofeedback_history_${sessionId}` : 'neurofeedback_history';
}

function getContextNodeCount(sessionId?: string): number {
  const db = getDb();
  const keys = sessionId
    ? [`last_context_node_ids_${sessionId}`, 'last_context_node_ids']
    : ['last_context_node_ids'];

  for (const key of keys) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;

      const parsed = JSON.parse(row.value) as unknown;
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      continue;
    }
  }

  return 10;
}

function getSessionFeedbackScore(sessionId?: string, fallback = 0.5): number {
  if (!sessionId) return fallback;

  const db = getDb();
  try {
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
      .get(`context_effectiveness_${sessionId}`) as { value: string } | undefined;
    if (!row) return fallback;

    const parsed = JSON.parse(row.value) as Record<string, {
      positive_responses: number;
      negative_responses: number;
    }>;

    let positive = 0;
    let negative = 0;
    for (const value of Object.values(parsed)) {
      positive += value?.positive_responses || 0;
      negative += value?.negative_responses || 0;
    }

    const total = positive + negative;
    return total > 0 ? positive / total : fallback;
  } catch {
    return fallback;
  }
}

function loadMetricHistory(sessionId?: string): MetricSnapshot[] {
  const db = getDb();
  const keys = sessionId
    ? [getMetricHistoryKey(sessionId), getMetricHistoryKey()]
    : [getMetricHistoryKey()];

  for (const key of keys) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;
      const parsed = JSON.parse(row.value) as MetricSnapshot[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      continue;
    }
  }

  return [];
}

function saveMetricHistory(history: MetricSnapshot[], sessionId?: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(getMetricHistoryKey(sessionId), JSON.stringify(history), Date.now());
}

function appendMetricSnapshot(snapshot: MetricSnapshot, sessionId?: string): void {
  const history = loadMetricHistory(sessionId);
  history.push(snapshot);
  if (history.length > 20) history.shift();
  saveMetricHistory(history, sessionId);
}

function getActiveSessionIds(limit = 8): string[] {
  const db = getDb();
  return db.prepare(
    'SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT ?',
  ).all(limit).map((row) => (row as { id: string }).id);
}

export function recordMetricSnapshot(
  garbageRate: number,
  positiveFeedbacks: number,
  negativeFeedbacks: number,
  sessionId?: string,
): void {
  const total = positiveFeedbacks + negativeFeedbacks;
  const fallbackFeedbackScore = total > 0 ? positiveFeedbacks / total : 0.5;

  const snapshot: MetricSnapshot = {
    garbage_rate: garbageRate,
    feedback_score: getSessionFeedbackScore(sessionId, fallbackFeedbackScore),
    context_nodes_avg: getContextNodeCount(sessionId),
    timestamp: Date.now(),
  };

  appendMetricSnapshot(snapshot, sessionId);

  if (sessionId) return;

  for (const activeSessionId of getActiveSessionIds()) {
    appendMetricSnapshot({
      garbage_rate: garbageRate,
      feedback_score: getSessionFeedbackScore(activeSessionId, fallbackFeedbackScore),
      context_nodes_avg: getContextNodeCount(activeSessionId),
      timestamp: snapshot.timestamp,
    }, activeSessionId);
  }
}

export function detectMetricDegradation(sessionId?: string): { metric: string; action: string } | null {
  const history = loadMetricHistory(sessionId);
  if (history.length < 5) return null;

  const recent = history.slice(-3);
  const older = history.slice(-8, -3);
  if (older.length < 3) return null;

  const recentGarbage = recent.reduce((sum, item) => sum + item.garbage_rate, 0) / recent.length;
  const olderGarbage = older.reduce((sum, item) => sum + item.garbage_rate, 0) / older.length;
  if (recentGarbage > olderGarbage + 0.1) {
    return { metric: 'garbage_rate', action: 'tighten_quality_threshold' };
  }

  const recentFeedback = recent.reduce((sum, item) => sum + item.feedback_score, 0) / recent.length;
  const olderFeedback = older.reduce((sum, item) => sum + item.feedback_score, 0) / older.length;
  if (recentFeedback < olderFeedback - 0.15) {
    return { metric: 'feedback_score', action: 'increase_context_quality' };
  }

  return null;
}
