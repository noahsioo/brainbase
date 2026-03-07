import { getDb } from '../memory/store.js';

interface EnergyBudget {
  calls_this_session: number;
  max_calls_per_session: number;
  total_calls: number;
  avg_value_per_call: number;
}

export function getEnergyBudget(sessionId: string): EnergyBudget {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = ?")
      .get(`energy_budget_${sessionId}`) as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch { /* first time */ }
  return { calls_this_session: 0, max_calls_per_session: 15, total_calls: 0, avg_value_per_call: 0.5 };
}

export function recordLLMCall(sessionId: string, producedNodes: number): void {
  const db = getDb();
  const budget = getEnergyBudget(sessionId);
  budget.calls_this_session++;
  budget.total_calls++;

  const callValue = Math.min(1.0, producedNodes * 0.3);
  budget.avg_value_per_call = budget.total_calls > 1
    ? (budget.avg_value_per_call * (budget.total_calls - 1) + callValue) / budget.total_calls
    : callValue;

  if (budget.avg_value_per_call > 0.6) {
    budget.max_calls_per_session = 20;
  } else if (budget.avg_value_per_call < 0.2) {
    budget.max_calls_per_session = 8;
  } else {
    budget.max_calls_per_session = 15;
  }

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(`energy_budget_${sessionId}`, JSON.stringify(budget), Date.now());
}

export function shouldAllowLLMCall(sessionId: string): boolean {
  const budget = getEnergyBudget(sessionId);
  return budget.calls_this_session < budget.max_calls_per_session;
}
