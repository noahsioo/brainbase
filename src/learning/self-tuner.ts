// 11.4: Self-Tuning / Performance Tracker
// Homeostase + Metaplasticity — System passt eigene Schwellen an
// Zu viel Garbage = strenger filtern. Zu wenig Speicherung = offener filtern.

import { getDb } from '../memory/store.js';
import { getDevelopmentPhase } from '../memory/cold-start.js';

interface TuningStats {
  nodes_created: number;
  garbage_filtered: number;
  evidence_hits: number;
  window_start: number;
}

const WINDOW_SIZE = 100;
const DEFAULT_THRESHOLD = 0.3;
const MIN_THRESHOLD = 0.15;
const MAX_THRESHOLD = 0.5;
const ADJUSTMENT_STEP = 0.05;

function getStats(): TuningStats {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'self_tuner_stats'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch { /* first time */ }
  return { nodes_created: 0, garbage_filtered: 0, evidence_hits: 0, window_start: Date.now() };
}

function saveStats(stats: TuningStats): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('self_tuner_stats', JSON.stringify(stats), Date.now());
}

function resetWindowIfNeeded(stats: TuningStats): TuningStats {
  const total = stats.nodes_created + stats.garbage_filtered;
  if (total >= WINDOW_SIZE) {
    return { nodes_created: 0, garbage_filtered: 0, evidence_hits: 0, window_start: Date.now() };
  }
  return stats;
}

export function recordCreation(): void {
  const stats = getStats();
  stats.nodes_created++;
  saveStats(resetWindowIfNeeded(stats));
}

export function recordGarbage(): void {
  const stats = getStats();
  stats.garbage_filtered++;
  saveStats(resetWindowIfNeeded(stats));
}

export function recordEvidence(): void {
  const stats = getStats();
  stats.evidence_hits++;
  saveStats(stats);
}

export function getAdaptiveQualityThreshold(): number {
  const db = getDb();
  let threshold = DEFAULT_THRESHOLD;

  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'quality_threshold'")
      .get() as { value: string } | undefined;
    if (row) threshold = parseFloat(row.value);
  } catch { /* use default */ }

  const stats = getStats();
  const total = stats.nodes_created + stats.garbage_filtered;

  if (total >= 20) {
    const garbageRate = stats.garbage_filtered / total;

    if (garbageRate > 0.5) {
      threshold = Math.min(MAX_THRESHOLD, threshold + ADJUSTMENT_STEP);
    } else if (garbageRate < 0.1) {
      threshold = Math.max(MIN_THRESHOLD, threshold - ADJUSTMENT_STEP);
    }

    db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run('quality_threshold', String(threshold), Date.now());
  }

  // 18.2: Development phase modulates quality threshold
  const devPhase = getDevelopmentPhase();
  threshold *= devPhase.quality_multiplier;
  threshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold));

  return threshold;
}
