import { getDb, type Edge, type Node } from '../memory/store.js';
import { isGarbage } from '../extraction/verification.js';
import { getDevelopmentPhase } from '../memory/cold-start.js';

export interface PruningResult {
  edges_pruned: number;
  orphans_found: number;
  nodes_promoted: number;
  nodes_decayed: number;
  nodes_deleted: number;
}

// 19.1: Kontrolliertes Vergessen — archivieren statt loeschen
function archiveNode(db: ReturnType<typeof getDb>, nodeId: string, tier: 'archive' | 'deep_archive'): void {
  const row = db.prepare('SELECT metadata FROM nodes WHERE id = ?').get(nodeId) as { metadata: string | null } | undefined;
  if (!row) return;
  let meta: Record<string, unknown> = {};
  try { if (row.metadata) meta = JSON.parse(row.metadata); } catch {}
  meta.visibility_tier = tier;
  meta.archived_at = Date.now();
  db.prepare('UPDATE nodes SET metadata = ?, importance = 0.01 WHERE id = ?')
    .run(JSON.stringify(meta), nodeId);
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

  // 18.2: Development phase modulates pruning aggressiveness
  const devPhase = getDevelopmentPhase();
  const pm = devPhase.pruning_multiplier;

  // 1. Edge Pruning: weak edges that aren't connected to core nodes
  const coreNodeIds = (db.prepare(
    "SELECT id FROM nodes WHERE type = 'core'"
  ).all() as Array<{ id: string }>).map(r => r.id);
  const coreSet = new Set(coreNodeIds);

  const edgeStrengthThreshold = 0.15 * pm;
  const edgeCoActivationThreshold = Math.ceil(2 / pm);
  const weakEdges = db.prepare(`
    SELECT * FROM edges
    WHERE strength < ? AND co_activations < ?
  `).all(edgeStrengthThreshold, edgeCoActivationThreshold) as Edge[];

  for (const edge of weakEdges) {
    if (coreSet.has(edge.source_id) || coreSet.has(edge.target_id)) continue;
    db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
    result.edges_pruned++;
  }

  // 1.5 Dead Edge Pruning: edges not strengthened in 30+ days AND weak
  const thirtyDaysAgoEdges = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const deadEdgeThreshold = 0.1 * pm;
  const deadEdges = db.prepare(`
    SELECT id FROM edges
    WHERE strength < ?
      AND last_strengthened < ?
      AND source_id NOT IN (SELECT id FROM nodes WHERE type = 'core')
      AND target_id NOT IN (SELECT id FROM nodes WHERE type = 'core')
  `).all(deadEdgeThreshold, thirtyDaysAgoEdges) as Array<{ id: string }>;

  for (const edge of deadEdges) {
    db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
    result.edges_pruned++;
  }

  // 1.7 Auto-generated Edge Decay: unconfirmed auto-edges older than 7 days with low strength
  const sevenDaysAgoEdges = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const autoEdges = db.prepare(`
    SELECT id, strength, metadata FROM edges
    WHERE metadata LIKE '%auto_generated%' AND strength < 0.3
    AND created_at < ?
  `).all(sevenDaysAgoEdges) as Array<{ id: string; strength: number; metadata: string | null }>;

  for (const edge of autoEdges) {
    let meta: Record<string, unknown> = {};
    try { meta = edge.metadata ? JSON.parse(edge.metadata) : {}; } catch {}
    if (meta.auto_generated && !meta.user_confirmed) {
      db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
      result.edges_pruned++;
    }
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
      archiveNode(db, node.id, 'deep_archive');
      result.nodes_deleted++;
    }
  }

  // 6. Delete very low importance nodes older than 7 days
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const deadNodeImportance = 0.2 * pm;
  const deadNodeActivation = Math.ceil(3 / pm);
  const deadNodes = db.prepare(`
    SELECT id FROM nodes
    WHERE importance < ?
      AND last_activated < ?
      AND activation_count < ?
      AND type NOT IN ('core', 'entity', 'system_knowledge', 'identity', 'prospective')
  `).all(deadNodeImportance, sevenDaysAgo, deadNodeActivation) as Array<{ id: string }>;

  for (const node of deadNodes) {
    // 23.3: Hub-protected Nodes werden NICHT archiviert
    let deadMeta: Record<string, unknown> = {};
    try {
      const deadRow = db.prepare('SELECT metadata FROM nodes WHERE id = ?').get(node.id) as { metadata: string | null } | undefined;
      if (deadRow?.metadata) deadMeta = JSON.parse(deadRow.metadata);
    } catch { /* skip */ }
    if (deadMeta.hub_protected) continue;

    archiveNode(db, node.id, 'archive');
    result.nodes_deleted++;
  }

  return result;
}
