// 21.5: Stress-Response — Graceful Degradation
// 3 Modi: NORMAL (voll), STRESSED (fokussiert), RECOVERY (vorsichtig hochfahren)

import { getDb } from '../memory/store.js';
import { getActivatedNodes } from '../memory/activation.js';
import { getSystemState, setSystemState } from '../memory/cold-start.js';
import { getSessionMood } from '../memory/session-runtime-state.js';
import { getSystemHealth } from '../senses/interoception.js';

export type StressLevel = 'normal' | 'stressed' | 'recovery';

function getStressLevelKey(sessionId?: string): string {
  return sessionId ? `stress_level_${sessionId}` : 'stress_level';
}

function getActiveContradictionCount(sessionId?: string): number {
  if (!sessionId) {
    const db = getDb();
    return (db.prepare(`
      SELECT COUNT(*) as c FROM edges WHERE type = 'contradicts'
      AND source_id IN (SELECT id FROM nodes WHERE activation > 0.1)
    `).get() as { c: number }).c;
  }

  const activeNodes = getActivatedNodes(20, sessionId).filter(node => node.activation > 0.1);
  if (activeNodes.length === 0) return 0;

  const activeIds = new Set(activeNodes.map(node => node.id));
  const contradictionKeys = new Set<string>();

  for (const node of activeNodes) {
    const edges = getDb().prepare(
      'SELECT source_id, target_id, type FROM edges WHERE source_id = ? OR target_id = ?',
    ).all(node.id, node.id) as Array<{ source_id: string; target_id: string; type: string }>;

    for (const edge of edges) {
      if (edge.type !== 'contradicts') continue;
      const otherId = edge.source_id === node.id ? edge.target_id : edge.source_id;
      if (!activeIds.has(otherId)) continue;
      contradictionKeys.add([node.id, otherId].sort().join('::'));
    }
  }

  return contradictionKeys.size;
}

export function calculateStressLevel(sessionId?: string): StressLevel {
  const health = getSystemHealth();
  const key = getStressLevelKey(sessionId);

  let stressScore = 0;

  if (health.energy < 0.3) stressScore += 0.3;
  if (health.garbageRatio > 0.4) stressScore += 0.2;

  const mood = sessionId ? getSessionMood(sessionId) : getSystemState('current_mood');
  if (mood === 'frustrated') stressScore += 0.3;

  try {
    const contradictions = getActiveContradictionCount(sessionId);
    if (contradictions > 3) stressScore += 0.2;
  } catch {}

  // Recovery-Check: war vorher stressed, jetzt besser
  try {
    const previousLevel = getSystemState(key) ?? (!sessionId ? null : getSystemState('stress_level'));
    if (previousLevel === 'stressed' && stressScore < 0.4) {
      setSystemState(key, 'recovery');
      return 'recovery';
    }
    if (previousLevel === 'recovery' && stressScore < 0.3) {
      setSystemState(key, 'normal');
      return 'normal';
    }
  } catch {}

  const level: StressLevel = stressScore >= 0.5 ? 'stressed' : 'normal';

  setSystemState(key, level);

  return level;
}

export function getStressLevel(sessionId?: string): StressLevel {
  const stored = getSystemState(getStressLevelKey(sessionId));
  if (stored === 'stressed' || stored === 'recovery') return stored;

  if (sessionId) {
    const legacy = getSystemState('stress_level');
    if (legacy === 'stressed' || legacy === 'recovery') return legacy;
  }

  return 'normal';
}
