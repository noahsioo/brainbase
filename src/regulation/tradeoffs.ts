// 21.4: Tradeoff-Manager — Dynamische Balance
// 4 Achsen: Speed↔Accuracy, Stability↔Plasticity, Compression↔Detail, Sensitivity↔Specificity

import { getDb } from '../memory/store.js';
import { getSystemHealth } from '../senses/interoception.js';
import { getDevelopmentPhase } from '../memory/cold-start.js';

export interface TradeoffState {
  speed_accuracy: number;
  stability_plasticity: number;
  compression_detail: number;
  sensitivity_specificity: number;
}

export function calculateTradeoffs(
  mood?: string,
  taskMode?: string,
  messageCount?: number,
): TradeoffState {
  const devPhase = getDevelopmentPhase();

  let speed_accuracy = 0.5;
  if (taskMode === 'urgent') speed_accuracy = 0.2;
  else if (taskMode === 'learning') speed_accuracy = 0.8;
  else if (taskMode === 'debugging') speed_accuracy = 0.7;

  let stability_plasticity = devPhase.plasticity;
  if (taskMode === 'exploring') stability_plasticity = Math.min(1.0, stability_plasticity + 0.2);

  let compression_detail = 0.5;
  if (messageCount && messageCount > 15) compression_detail = 0.8;
  else if (messageCount && messageCount < 5) compression_detail = 0.3;

  let sensitivity_specificity = 1.0 - devPhase.stability;
  if (mood === 'frustrated') sensitivity_specificity = Math.max(0.2, sensitivity_specificity - 0.2);

  return {
    speed_accuracy: Math.round(speed_accuracy * 100) / 100,
    stability_plasticity: Math.round(stability_plasticity * 100) / 100,
    compression_detail: Math.round(compression_detail * 100) / 100,
    sensitivity_specificity: Math.round(sensitivity_specificity * 100) / 100,
  };
}

export function getTradeoffState(): TradeoffState {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'tradeoff_state'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch {}
  return { speed_accuracy: 0.5, stability_plasticity: 0.5, compression_detail: 0.5, sensitivity_specificity: 0.5 };
}

export function updateTradeoffState(state: TradeoffState): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('tradeoff_state', JSON.stringify(state), Date.now());
}
