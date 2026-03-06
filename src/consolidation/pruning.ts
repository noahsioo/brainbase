import { getDb, type Edge, type Node } from '../memory/store.js';
import { isGarbage } from '../extraction/verification.js';

export interface PruningResult {
  edges_pruned: number;
  orphans_found: number;
  nodes_promoted: number;
  nodes_decayed: number;
  nodes_deleted: number;
}

export function pruneGraph(): PruningResult {
  const db = getDb();
  const result: PruningResult = {
    edges_pruned: 0,
    orphans_found: 0,
    nodes_promoted: 0,
    nodes_decayed: 0,
    nodes_deleted: 0,
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

  // 1.5 Dead Edge Pruning: edges not strengthened in 30+ days AND weak
  const thirtyDaysAgoEdges = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const deadEdges = db.prepare(`
    SELECT id FROM edges
    WHERE strength < 0.1
      AND last_strengthened < ?
      AND source_id NOT IN (SELECT id FROM nodes WHERE type = 'core')
      AND target_id NOT IN (SELECT id FROM nodes WHERE type = 'core')
  `).all(thirtyDaysAgoEdges) as Array<{ id: string }>;

  for (const edge of deadEdges) {
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

  // 5. Garbage Cleanup: delete nodes matching garbage patterns
  const PROTECTED_TYPES = new Set(['core', 'entity', 'system_knowledge', 'identity', 'prospective']);
  const allNodesForGarbage = db.prepare(
    "SELECT * FROM nodes WHERE type NOT IN ('core', 'entity', 'system_knowledge', 'identity', 'prospective')"
  ).all() as Node[];

  for (const node of allNodesForGarbage) {
    if (isGarbage(node.content)) {
      db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id);
      result.nodes_deleted++;
    }
  }

  // 6. Delete very low importance nodes older than 7 days
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const deadNodes = db.prepare(`
    SELECT id FROM nodes
    WHERE importance < 0.2
      AND last_activated < ?
      AND activation_count < 3
      AND type NOT IN ('core', 'entity', 'system_knowledge', 'identity', 'prospective')
  `).all(sevenDaysAgo) as Array<{ id: string }>;

  for (const node of deadNodes) {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id);
    result.nodes_deleted++;
  }

  return result;
}
