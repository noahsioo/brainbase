// 21.1: Allostase — Vorausschauende Regulation
// Nicht reagieren WENN was falsch ist, sondern VORHERSAGEN dass es falsch werden WIRD

import { getDb } from '../memory/store.js';
import { type SystemHealth } from '../senses/interoception.js';

interface TrendData {
  garbage_rates: number[];
  frustration_counts: number[];
  energy_levels: number[];
  updated_at: number;
}

export interface AllostasisPrediction {
  garbage_rising: boolean;
  frustration_likely: boolean;
  energy_dropping: boolean;
  recommendation: 'tighten' | 'loosen' | 'consolidate' | 'none';
}

function getTrendData(): TrendData {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'allostasis_trends'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch {}
  return { garbage_rates: [], frustration_counts: [], energy_levels: [], updated_at: 0 };
}

function saveTrendData(data: TrendData): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('allostasis_trends', JSON.stringify(data), Date.now());
}

export function recordTrendPoint(health: SystemHealth, wasFrustrated: boolean): void {
  const data = getTrendData();
  data.garbage_rates.push(health.garbageRatio);
  if (data.garbage_rates.length > 10) data.garbage_rates.shift();
  data.energy_levels.push(health.energy);
  if (data.energy_levels.length > 10) data.energy_levels.shift();
  if (wasFrustrated) {
    const lastIdx = data.frustration_counts.length - 1;
    if (lastIdx >= 0) {
      data.frustration_counts[lastIdx] = (data.frustration_counts[lastIdx] || 0) + 1;
    }
  }
  data.updated_at = Date.now();
  saveTrendData(data);
}

export function startNewSessionTrend(): void {
  const data = getTrendData();
  data.frustration_counts.push(0);
  if (data.frustration_counts.length > 5) data.frustration_counts.shift();
  saveTrendData(data);
}

function detectTrend(values: number[]): 'rising' | 'falling' | 'stable' {
  if (values.length < 3) return 'stable';
  const recent = values.slice(-3);
  const older = values.slice(-6, -3);
  if (older.length === 0) return 'stable';
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const delta = recentAvg - olderAvg;
  if (delta > 0.05) return 'rising';
  if (delta < -0.05) return 'falling';
  return 'stable';
}

export function predictAllostasis(): AllostasisPrediction {
  const data = getTrendData();
  const garbageTrend = detectTrend(data.garbage_rates);
  const energyTrend = detectTrend(data.energy_levels);
  const frustTrend = detectTrend(data.frustration_counts);

  const garbage_rising = garbageTrend === 'rising';
  const energy_dropping = energyTrend === 'falling';
  const frustration_likely = frustTrend === 'rising';

  let recommendation: AllostasisPrediction['recommendation'] = 'none';
  if (garbage_rising) recommendation = 'tighten';
  else if (energy_dropping) recommendation = 'consolidate';
  else if (frustration_likely) recommendation = 'loosen';

  return { garbage_rising, frustration_likely, energy_dropping, recommendation };
}
