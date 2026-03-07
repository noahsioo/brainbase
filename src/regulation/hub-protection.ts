import { getDb } from '../memory/store.js';

export interface HubNode {
  id: string;
  content: string;
  edge_count: number;
  activation_count: number;
}

export function detectHubs(minEdges = 10, minActivations = 20): HubNode[] {
  const db = getDb();
  return db.prepare(`
    SELECT n.id, n.content, n.activation_count,
      (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) as edge_count
    FROM nodes n
    WHERE n.type NOT IN ('core', 'system_knowledge')
    HAVING edge_count >= ? AND n.activation_count >= ?
    ORDER BY edge_count DESC LIMIT 20
  `).all(minEdges, minActivations) as HubNode[];
}

export function protectHubs(): number {
  const db = getDb();
  const hubs = detectHubs();
  let protectedCount = 0;

  for (const hub of hubs) {
    const node = db.prepare('SELECT metadata, importance FROM nodes WHERE id = ?')
      .get(hub.id) as { metadata: string | null; importance: number } | undefined;
    if (!node) continue;

    let meta: Record<string, unknown> = {};
    try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }

    if (!meta.hub_protected) {
      meta.hub_protected = true;
      meta.hub_edge_count = hub.edge_count;
      const newImportance = Math.max(node.importance, 0.6);
      db.prepare('UPDATE nodes SET importance = ?, metadata = ? WHERE id = ?')
        .run(newImportance, JSON.stringify(meta), hub.id);
      protectedCount++;
    }
  }

  return protectedCount;
}

export function getHubDecayFactor(nodeId: string): number {
  const db = getDb();
  try {
    const row = db.prepare('SELECT metadata FROM nodes WHERE id = ?')
      .get(nodeId) as { metadata: string | null } | undefined;
    if (!row?.metadata) return 1.0;
    const meta = JSON.parse(row.metadata);
    if (meta.hub_protected) return 0.95;
  } catch { /* skip */ }
  return 1.0;
}
