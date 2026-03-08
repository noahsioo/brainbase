// 21.3: Comparator-Modell — Predict → Compare → Correct
// Bei jeder Context-Generierung: Vorhersage speichern
// Nach User-Reaktion: Vergleich + Korrektur

import { getDb, getNode, updateNode } from '../memory/store.js';

interface ContextPrediction {
  node_ids: string[];
  topic: string | undefined;
  timestamp: number;
}

function getContextPredictionKeys(sessionId?: string): string[] {
  return sessionId ? [`context_prediction_${sessionId}`, 'context_prediction'] : ['context_prediction'];
}

export function savePrediction(nodeIds: string[], topic?: string, sessionId?: string): void {
  const db = getDb();
  const prediction: ContextPrediction = {
    node_ids: nodeIds.slice(0, 30),
    topic,
    timestamp: Date.now(),
  };

  for (const key of getContextPredictionKeys(sessionId)) {
    db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(prediction), Date.now());
  }
}

export function compareAndCorrect(
  feedbackSignal: 'positive' | 'negative' | 'neutral',
  sessionId?: string,
): { corrected: number } {
  if (feedbackSignal === 'neutral') return { corrected: 0 };

  let corrected = 0;

  try {
    const db = getDb();
    let row: { value: string } | undefined;
    for (const key of getContextPredictionKeys(sessionId)) {
      row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (row) break;
    }
    if (!row) return { corrected: 0 };

    const prediction: ContextPrediction = JSON.parse(row.value);
    if (Date.now() - prediction.timestamp > 10 * 60 * 1000) return { corrected: 0 };

    for (const nodeId of prediction.node_ids) {
      const node = getNode(nodeId);
      if (!node) continue;

      if (feedbackSignal === 'positive') {
        const newImportance = Math.min(1.0, node.importance + 0.02);
        if (newImportance > node.importance) {
          updateNode(nodeId, { importance: newImportance });
          corrected++;
        }
      } else if (feedbackSignal === 'negative') {
        const newImportance = Math.max(0.1, node.importance - 0.03);
        if (newImportance < node.importance) {
          updateNode(nodeId, { importance: newImportance });
          corrected++;
        }
      }
    }
  } catch { /* non-fatal */ }

  return { corrected };
}
