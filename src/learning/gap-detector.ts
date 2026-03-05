import { getDb } from '../memory/store.js';

export interface GapResult {
  gaps_detected: number;
}

export function detectKnowledgeGaps(): GapResult {
  const db = getDb();
  let gapsDetected = 0;

  const expertise = db.prepare('SELECT * FROM expertise ORDER BY usage_count DESC').all() as Array<{
    domain: string; usage_count: number; question_count: number; error_count: number; level: number;
  }>;

  if (expertise.length < 2) return { gaps_detected: 0 };

  const avgUsage = expertise.reduce((s, e) => s + e.usage_count, 0) / expertise.length;

  for (const exp of expertise) {
    if (gapsDetected >= 5) break;

    const isGap = (exp.question_count > exp.usage_count * 0.5 && exp.usage_count > 3) ||
                  (exp.error_count > exp.usage_count * 0.3 && exp.usage_count > 5);

    if (!isGap) continue;

    const existingGap = db.prepare(
      "SELECT id FROM knowledge_gaps WHERE domain = ? AND filled_at IS NULL"
    ).get(exp.domain) as { id: string } | undefined;

    if (existingGap) continue;

    const priority = Math.min(1.0, (exp.question_count + exp.error_count) / (exp.usage_count + 1));
    const nodeCount = db.prepare(
      "SELECT COUNT(*) as c FROM nodes WHERE content LIKE ?"
    ).get(`%${exp.domain}%`) as { c: number };

    const description = exp.question_count > exp.error_count
      ? `High question rate in "${exp.domain}" (${exp.question_count} questions / ${exp.usage_count} uses)`
      : `High error rate in "${exp.domain}" (${exp.error_count} errors / ${exp.usage_count} uses)`;

    db.prepare(`
      INSERT INTO knowledge_gaps (id, domain, description, node_count, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `gap-${exp.domain}-${Date.now()}`,
      exp.domain,
      description,
      nodeCount.c,
      priority,
      Date.now(),
    );

    gapsDetected++;
  }

  return { gaps_detected: gapsDetected };
}

export function getOpenGaps(): Array<{ domain: string; description: string; priority: number }> {
  const db = getDb();
  return db.prepare(
    'SELECT domain, description, priority FROM knowledge_gaps WHERE filled_at IS NULL ORDER BY priority DESC'
  ).all() as Array<{ domain: string; description: string; priority: number }>;
}
