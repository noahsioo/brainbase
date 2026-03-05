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

export function buildGhostContext(topic: string): string {
  if (!topic || topic.length < 2) return '';

  const level = calculateExpertise(topic);

  if (level < 0.2) {
    return `User hat wenig Erfahrung mit ${topic}. Erklaere Konzepte, nutze Analogien.`;
  } else if (level < 0.5) {
    return `User kennt Grundlagen von ${topic}. Keine Basics, aber Kontext geben.`;
  } else if (level < 0.8) {
    return `User ist erfahren mit ${topic}. Direkt zum Punkt, Code bevorzugt.`;
  } else {
    return `User ist Expert in ${topic}. Keine Erklaerungen, nur Loesungen.`;
  }
}
