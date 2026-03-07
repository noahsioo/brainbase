import { getDb } from '../memory/store.js';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';

export interface EnvironmentSignal {
  api_health: number;
  disk_pressure: number;
  error_rate: number;
  provider_stability: number;
}

export function analyzeEnvironment(): EnvironmentSignal {
  const db = getDb();

  let apiHealth = 1.0;
  try {
    const recent = db.prepare(
      "SELECT value FROM system_state WHERE key LIKE 'energy_budget_%' ORDER BY updated_at DESC LIMIT 1"
    ).get() as { value: string } | undefined;
    if (recent) {
      const budget = JSON.parse(recent.value);
      if (budget.avg_value_per_call < 0.2) apiHealth = 0.5;
    }
  } catch {}

  let diskPressure = 0;
  try {
    const brainPath = `${homedir()}/.memory-unlimited/brain.db`;
    if (existsSync(brainPath)) {
      const stats = statSync(brainPath);
      const sizeMB = stats.size / (1024 * 1024);
      if (sizeMB > 100) diskPressure = 0.8;
      else if (sizeMB > 50) diskPressure = 0.4;
    }
  } catch {}

  let errorRate = 0;
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'self_tuner_stats'")
      .get() as { value: string } | undefined;
    if (row) {
      const stats = JSON.parse(row.value);
      const total = stats.nodes_created + stats.garbage_filtered;
      if (total > 10) errorRate = stats.garbage_filtered / total;
    }
  } catch {}

  let providerStability = 1.0;
  try {
    const providers = db.prepare(
      "SELECT DISTINCT provider FROM sessions ORDER BY started_at DESC LIMIT 5"
    ).all() as Array<{ provider: string }>;
    const uniqueProviders = new Set(providers.map(p => p.provider)).size;
    if (uniqueProviders > 2) providerStability = 0.5;
  } catch {}

  const signal: EnvironmentSignal = { api_health: apiHealth, disk_pressure: diskPressure, error_rate: errorRate, provider_stability: providerStability };

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('environment_signal', JSON.stringify(signal), Date.now());

  return signal;
}

export function getEnvironmentSignal(): EnvironmentSignal {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'environment_signal'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch {}
  return { api_health: 1.0, disk_pressure: 0, error_rate: 0, provider_stability: 1.0 };
}
