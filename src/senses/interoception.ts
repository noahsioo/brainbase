// Phase 10.4: System-Gesundheit ("Interozeption")
// Das Gehirn fuehlt sich selbst: muede, hungrig, gestresst, energiegeladen
// Unser System: Node-Dichte, Garbage-Rate, Activation-Levels, Edge-Dichte, Consolidation-Status

import { getDb } from '../memory/store.js';

export interface SystemHealth {
  energy: number;        // 0-1: hoch = mehr speichern, niedrig = nur Wichtiges
  saturation: number;    // 0-1: wie voll ist das System
  fragmentation: number; // 0-1: hoch = viele isolierte Nodes, niedrig = gut vernetzt
  garbageRatio: number;  // 0-1: Anteil low-quality Nodes
  consolidationAge: number; // Stunden seit letzter Consolidation
}

export function measureSystemHealth(): SystemHealth {
  const db = getDb();

  // Total nodes
  const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as { cnt: number };
  const totalNodes = totalRow.cnt;

  // Saturation: how full relative to a target
  const TARGET_NODES = 500; // after this, system is "full"
  const saturation = Math.min(1.0, totalNodes / TARGET_NODES);

  // Fragmentation: nodes with 0 edges / total nodes
  let fragmentation = 0;
  if (totalNodes > 0) {
    const orphanRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM nodes n
      WHERE NOT EXISTS (SELECT 1 FROM edges WHERE source_id = n.id OR target_id = n.id)
    `).get() as { cnt: number };
    fragmentation = orphanRow.cnt / totalNodes;
  }

  // Garbage ratio: low confidence + low importance nodes
  let garbageRatio = 0;
  if (totalNodes > 0) {
    const garbageRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM nodes
      WHERE confidence < 0.3 AND importance < 0.3 AND activation_count < 2
    `).get() as { cnt: number };
    garbageRatio = garbageRow.cnt / totalNodes;
  }

  // Consolidation age: hours since last consolidation
  let consolidationAge = 24; // default: assume it's been a while
  try {
    const lastConsolidation = db.prepare(
      "SELECT value FROM system_state WHERE key = 'last_consolidation_time'"
    ).get() as { value: string } | undefined;
    if (lastConsolidation) {
      const lastTime = parseInt(lastConsolidation.value, 10);
      consolidationAge = (Date.now() - lastTime) / (1000 * 60 * 60);
    }
  } catch { /* first time */ }

  // Energy: inverse of how stressed the system is
  // High saturation, high fragmentation, high garbage, long since consolidation = low energy
  const stressors = (saturation * 0.2) + (fragmentation * 0.3) + (garbageRatio * 0.3) + (Math.min(1.0, consolidationAge / 24) * 0.2);
  const energy = Math.max(0, Math.min(1.0, 1.0 - stressors));

  return { energy, saturation, fragmentation, garbageRatio, consolidationAge };
}

// Get cached health (updated every few messages to save perf)
export function getSystemHealth(): SystemHealth {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'system_health'")
      .get() as { value: string } | undefined;
    if (row) {
      const cached = JSON.parse(row.value) as SystemHealth & { _ts?: number };
      // Cache valid for 5 minutes
      if (cached._ts && Date.now() - cached._ts < 5 * 60 * 1000) {
        return cached;
      }
    }
  } catch { /* recalculate */ }

  const health = measureSystemHealth();

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('system_health', JSON.stringify({ ...health, _ts: Date.now() }), Date.now());

  return health;
}

// ── 17.4: System-Stimmung / Energy Levels ────────────────────

export interface SystemMood {
  energy: number;
  curiosity: number;
  confidence: number;
  satisfaction: number;
}

export function calculateSystemMood(): SystemMood {
  const db = getDb();
  const health = measureSystemHealth();

  const energy = health.energy;

  let curiosity = 0.5;
  try {
    const hzRow = db.prepare("SELECT value FROM system_state WHERE key = 'hunger_zones'")
      .get() as { value: string } | undefined;
    if (hzRow) {
      const zones = JSON.parse(hzRow.value) as unknown[];
      curiosity = Math.min(1.0, 0.3 + zones.length * 0.15);
    }
  } catch {}
  if (health.saturation < 0.3) curiosity = Math.min(1.0, curiosity + 0.2);

  let confidence = 0.5;
  try {
    const smRow = db.prepare("SELECT value FROM system_state WHERE key = 'self_model'")
      .get() as { value: string } | undefined;
    if (smRow) {
      const sm = JSON.parse(smRow.value);
      confidence = Math.min(1.0,
        0.2 + (sm.cortical_ratio || 0) * 1.5 + Math.min(0.3, (sm.avg_evidence || 1) * 0.1)
      );
    }
  } catch {}
  confidence = Math.max(0, confidence - health.garbageRatio * 0.3);

  let satisfaction = 0.5;
  try {
    const smRow = db.prepare("SELECT value FROM system_state WHERE key = 'self_model'")
      .get() as { value: string } | undefined;
    if (smRow) {
      const sm = JSON.parse(smRow.value);
      satisfaction = (sm.accuracy || 0.5) * 0.6 + (1 - health.fragmentation) * 0.4;
    }
  } catch {}

  const mood: SystemMood = {
    energy: Math.round(energy * 100) / 100,
    curiosity: Math.round(curiosity * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    satisfaction: Math.round(satisfaction * 100) / 100,
  };

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('system_mood', JSON.stringify(mood), Date.now());

  return mood;
}

export function getSystemMood(): SystemMood {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'system_mood'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch {}
  return { energy: 0.5, curiosity: 0.5, confidence: 0.5, satisfaction: 0.5 };
}
