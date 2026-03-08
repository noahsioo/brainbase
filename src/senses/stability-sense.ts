// Phase 10.5: Stabilitaets-Sinn ("Vestibular")
// Vestibular = "stehe ich gerade?" Fuer uns: "ist mein Wissensgraph konsistent?"
// Prueft: Widersprueche, verwaiste Nodes, zirkulaere Beziehungen

import { getDb } from '../memory/store.js';

export interface StabilitySignal {
  stable: boolean;
  contradictions: number;   // count of contradicts edges
  orphanRatio: number;      // 0-1: isolated nodes
  conflictEntities: string[]; // entities with contradictions
  needsAttention: boolean;  // should the system slow down and verify?
}

export function measureStability(): StabilitySignal {
  const db = getDb();

  // Count contradictions
  const contradictRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE type = 'contradicts'"
  ).get() as { cnt: number };
  const contradictions = contradictRow.cnt;

  // Orphan ratio
  const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as { cnt: number };
  const totalNodes = totalRow.cnt;

  let orphanRatio = 0;
  if (totalNodes > 0) {
    const orphanRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM nodes n
      WHERE NOT EXISTS (SELECT 1 FROM edges WHERE source_id = n.id OR target_id = n.id)
      AND type != 'auto_topic'
    `).get() as { cnt: number };
    orphanRatio = orphanRow.cnt / totalNodes;
  }

  // Find entities involved in contradictions
  const conflictEntities: string[] = [];
  if (contradictions > 0) {
    const conflictEdges = db.prepare(`
      SELECT DISTINCT n.content FROM edges e
      JOIN nodes n ON n.id = e.source_id OR n.id = e.target_id
      WHERE e.type = 'contradicts'
      AND n.type = 'entity'
      LIMIT 5
    `).all() as Array<{ content: string }>;
    conflictEntities.push(...conflictEdges.map(r => r.content));
  }

  // replaced_by edges also indicate instability (outdated info)
  const replacedRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE type = 'replaced_by'"
  ).get() as { cnt: number };
  const replacedCount = replacedRow.cnt;

  const instabilityScore = (contradictions * 0.3) + (orphanRatio * 0.3) + (replacedCount * 0.1);
  const needsAttention = instabilityScore > 0.5 || contradictions > 3;
  const stable = instabilityScore < 0.3;

  return { stable, contradictions, orphanRatio, conflictEntities, needsAttention };
}

// Cached version
export function getStability(readOnly = false): StabilitySignal {
  const db = getDb();
  if (readOnly) {
    return measureStability();
  }
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'stability_signal'")
      .get() as { value: string } | undefined;
    if (row) {
      const cached = JSON.parse(row.value) as StabilitySignal & { _ts?: number };
      if (cached._ts && Date.now() - cached._ts < 5 * 60 * 1000) {
        return cached;
      }
    }
  } catch { /* recalculate */ }

  const signal = measureStability();

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('stability_signal', JSON.stringify({ ...signal, _ts: Date.now() }), Date.now());

  return signal;
}
