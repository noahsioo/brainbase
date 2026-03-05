import { getDb, type Edge } from '../memory/store.js';

export interface PruningResult {
  edges_pruned: number;
  orphans_found: number;
  nodes_promoted: number;
  nodes_decayed: number;
}

export function pruneGraph(): PruningResult {
  const db = getDb();
  const result: PruningResult = {
    edges_pruned: 0,
    orphans_found: 0,
    nodes_promoted: 0,
    nodes_decayed: 0,
  };

  // 1. Edge Pruning: weak edges that aren't connected to core nodes
  const coreNodeIds = (db.prepare(
    "SELECT id FROM nodes WHERE type = 'core'"
  ).all() as Array<{ id: string }>).map(r => r.id);
  const coreSet = new Set(coreNodeIds);

  const weakEdges = db.prepare(`
    SELECT * FROM edges
    WHERE strength < 0.15 AND co_activations < 2
  `).all() as Edge[];

  for (const edge of weakEdges) {
    if (coreSet.has(edge.source_id) || coreSet.has(edge.target_id)) continue;
    db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
    result.edges_pruned++;
  }

  // 2. Orphan Detection: nodes with zero edges (report only)
  const allNodes = db.prepare(
    "SELECT id FROM nodes WHERE type != 'core'"
  ).all() as Array<{ id: string }>;

  for (const node of allNodes) {
    const edgeCount = (db.prepare(
      'SELECT COUNT(*) as count FROM edges WHERE source_id = ? OR target_id = ?'
    ).get(node.id, node.id) as { count: number }).count;

    if (edgeCount === 0) {
      result.orphans_found++;
    }
  }

  // 3. Permanent Marking: nodes activated 5+ times get importance >= 0.8
  const frequentNodes = db.prepare(`
    SELECT id, importance FROM nodes
    WHERE activation_count >= 5 AND importance < 0.8
  `).all() as Array<{ id: string; importance: number }>;

  for (const node of frequentNodes) {
    db.prepare('UPDATE nodes SET importance = 0.8 WHERE id = ?').run(node.id);
    result.nodes_promoted++;
  }

  // 4. Importance Decay: nodes not activated in 30+ days
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

  const staleNodes = db.prepare(`
    SELECT id, importance, activation_count FROM nodes
    WHERE last_activated < ?
      AND type != 'core'
      AND activation_count < 5
      AND importance > 0.1
  `).all(thirtyDaysAgo) as Array<{ id: string; importance: number; activation_count: number }>;

  for (const node of staleNodes) {
    const newImportance = Math.max(0.1, node.importance - 0.1);
    if (newImportance < node.importance) {
      db.prepare('UPDATE nodes SET importance = ? WHERE id = ?').run(newImportance, node.id);
      result.nodes_decayed++;
    }
  }

  return result;
}
