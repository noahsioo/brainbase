import { randomUUID } from 'crypto';
import { getDb } from '../memory/store.js';

interface OutcomeRow {
  id: string;
  problem_node_id: string | null;
  attempt: string;
  success: number;
  session_id: string | null;
  timestamp: number;
}

const PROBLEM_PATTERNS = [
  /error/i, /fehler/i, /bug/i, /broken/i, /kaputt/i,
  /not working/i, /funktioniert nicht/i, /geht nicht/i,
  /problem/i, /issue/i, /crash/i,
];

export function trackProblem(message: string, sessionId: string): void {
  const isProblem = PROBLEM_PATTERNS.some(p => p.test(message));
  if (!isProblem) return;

  const db = getDb();

  const summary = message.substring(0, 200).trim();
  const existing = db.prepare(
    "SELECT id FROM outcomes WHERE attempt = ? AND success = 0 AND session_id = ?"
  ).get(summary, sessionId) as { id: string } | undefined;

  if (existing) return;

  db.prepare(`
    INSERT INTO outcomes (id, problem_node_id, attempt, success, session_id, timestamp)
    VALUES (?, NULL, ?, 0, ?, ?)
  `).run(randomUUID(), summary, sessionId, Date.now());
}

export function markRecentOutcomesSuccess(sessionId: string): number {
  const db = getDb();
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  const result = db.prepare(`
    UPDATE outcomes SET success = 1
    WHERE session_id = ? AND success = 0 AND timestamp > ?
  `).run(sessionId, fiveMinAgo);

  return result.changes;
}

export function getSuccessfulOutcomes(limit = 10): OutcomeRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM outcomes WHERE success = 1
    ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as OutcomeRow[];
}
