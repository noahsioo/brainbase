import { getDb } from './store.js';

export function calculateExpertise(topic: string): number {
  const db = getDb();
  const pattern = `%${topic.toLowerCase()}%`;

  const nodeCount = (db.prepare(
    'SELECT COUNT(*) as c FROM nodes WHERE LOWER(content) LIKE ?'
  ).get(pattern) as { c: number }).c;

  if (nodeCount === 0) return 0;

  const edgeCount = (db.prepare(`
    SELECT COUNT(*) as c FROM edges
    WHERE source_id IN (SELECT id FROM nodes WHERE LOWER(content) LIKE ?)
    OR target_id IN (SELECT id FROM nodes WHERE LOWER(content) LIKE ?)
  `).get(pattern, pattern) as { c: number }).c;

  const density = Math.min(1.0, (nodeCount * 0.1) + (edgeCount * 0.05));
  return density;
}

export function buildGhostContext(topic: string, expertiseOverride?: number): string {
  if (!topic || topic.length < 2) return '';

  const level = typeof expertiseOverride === 'number'
    ? Math.max(0, Math.min(1, expertiseOverride))
    : calculateExpertise(topic);

  if (level < 0.2) {
    return `User has little experience with ${topic}. Explain concepts, use analogies.`;
  } else if (level < 0.5) {
    return `User knows basics of ${topic}. No basics, but provide context.`;
  } else if (level < 0.8) {
    return `User is experienced with ${topic}. Get to the point, code preferred.`;
  } else {
    return `User is an expert in ${topic}. No explanations, just solutions.`;
  }
}
