// 21.3: Comparator-Modell — Predict → Compare → Correct
// Bei jeder Context-Generierung: Vorhersage speichern
// Nach User-Reaktion: Vergleich + Korrektur

import { getDb, getNode, updateNode } from '../memory/store.js';

interface ContextPrediction {
  node_ids: string[];
  topic: string | undefined;
  timestamp: number;
}

export function savePrediction(nodeIds: string[], topic?: string): void {
  const db = getDb();
  const prediction: ContextPrediction = {
    node_ids: nodeIds.slice(0, 30),
    topic,
    timestamp: Date.now(),
  };
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('context_prediction', JSON.stringify(prediction), Date.now());
}

export function compareAndCorrect(feedbackSignal: 'positive' | 'negative' | 'neutral'): { corrected: number } {
  if (feedbackSignal === 'neutral') return { corrected: 0 };

  let corrected = 0;

  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'context_prediction'")
      .get() as { value: string } | undefined;
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
