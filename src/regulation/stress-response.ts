// 21.5: Stress-Response — Graceful Degradation
// 3 Modi: NORMAL (voll), STRESSED (fokussiert), RECOVERY (vorsichtig hochfahren)

import { getDb } from '../memory/store.js';
import { getSystemHealth } from '../senses/interoception.js';

export type StressLevel = 'normal' | 'stressed' | 'recovery';

export function calculateStressLevel(): StressLevel {
  const db = getDb();
  const health = getSystemHealth();

  let stressScore = 0;

  if (health.energy < 0.3) stressScore += 0.3;
  if (health.garbageRatio > 0.4) stressScore += 0.2;

  try {
    const moodRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_mood'")
      .get() as { value: string } | undefined;
    if (moodRow?.value === 'frustrated') stressScore += 0.3;
  } catch {}

  try {
    const contradictions = (db.prepare(`
      SELECT COUNT(*) as c FROM edges WHERE type = 'contradicts'
      AND source_id IN (SELECT id FROM nodes WHERE activation > 0.1)
    `).get() as { c: number }).c;
    if (contradictions > 3) stressScore += 0.2;
  } catch {}

  // Recovery-Check: war vorher stressed, jetzt besser
  try {
    const prevRow = db.prepare("SELECT value FROM system_state WHERE key = 'stress_level'")
      .get() as { value: string } | undefined;
    if (prevRow?.value === 'stressed' && stressScore < 0.4) {
      db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('stress_level', 'recovery', Date.now());
      return 'recovery';
    }
    if (prevRow?.value === 'recovery' && stressScore < 0.3) {
      db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('stress_level', 'normal', Date.now());
      return 'normal';
    }
  } catch {}

  const level: StressLevel = stressScore >= 0.5 ? 'stressed' : 'normal';

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('stress_level', level, Date.now());

  return level;
}

export function getStressLevel(): StressLevel {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'stress_level'")
      .get() as { value: string } | undefined;
    if (row?.value === 'stressed' || row?.value === 'recovery') return row.value as StressLevel;
  } catch {}
  return 'normal';
}
