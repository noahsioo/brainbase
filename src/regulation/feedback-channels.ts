// 21.2: Multi-Channel Feedback — 5 Kanaele gleichzeitig
// Kanal 1 (Hebbian) + 2 (Homeostatic) + 4 (Inhibitory) existieren schon
// NEU: Kanal 3 (Metaplastisch) + Kanal 5 (Retrograd/eCB)

import { getDb, getEdgesForNode, weakenEdge } from '../memory/store.js';

// Kanal 3: Metaplastische Lernraten-Anpassung
export function getMetaplasticLearningRate(): number {
  const db = getDb();
  try {
    const recentCreated = (db.prepare(`
      SELECT COUNT(*) as c FROM nodes WHERE created_at > ?
    `).get(Date.now() - 6 * 60 * 60 * 1000) as { c: number }).c;

    if (recentCreated > 20) return 0.7;
    if (recentCreated > 10) return 0.85;
    if (recentCreated < 3) return 1.3;
    return 1.0;
  } catch { return 1.0; }
}

// Kanal 5: Retrograd — Node empfaengt zu viel Input → "weniger senden"
export function getRetrogradeDampening(nodeId: string): number {
  const edges = getEdgesForNode(nodeId);
  const incomingCount = edges.length;
  if (incomingCount <= 15) return 1.0;
  return Math.max(0.5, 1.0 - (incomingCount - 15) * 0.02);
}

// Consolidation: Retrograde Cleanup fuer High-Degree Nodes
export function runFeedbackChannels(): { metaplastic_rate: number; retrograde_dampened: number } {
  const db = getDb();
  const metaplastic_rate = getMetaplasticLearningRate();

  let retrograde_dampened = 0;
  const highDegreeNodes = db.prepare(`
    SELECT n.id, COUNT(e.id) as deg FROM nodes n
    JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
    GROUP BY n.id HAVING deg > 25
    LIMIT 10
  `).all() as Array<{ id: string; deg: number }>;

  for (const node of highDegreeNodes) {
    const edges = getEdgesForNode(node.id);
    const weakest = edges
      .filter(e => e.strength < 0.2)
      .sort((a, b) => a.strength - b.strength)
      .slice(0, 3);
    for (const edge of weakest) {
      weakenEdge(edge.id, 0.05);
      retrograde_dampened++;
    }
  }

  return { metaplastic_rate, retrograde_dampened };
}
