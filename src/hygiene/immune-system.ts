import { getDb } from '../memory/store.js';

interface InfectionReport {
  contaminated_nodes: number;
  inflamed_clusters: number;
  actions_taken: number;
}

export function recordGarbageType(content: string): void {
  const db = getDb();
  const type = classifyGarbageType(content);
  if (!type) return;

  let stats: Record<string, number> = {};
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'garbage_type_stats'")
      .get() as { value: string } | undefined;
    if (row) stats = JSON.parse(row.value);
  } catch { /* first time */ }

  stats[type] = (stats[type] || 0) + 1;

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('garbage_type_stats', JSON.stringify(stats), Date.now());
}

function classifyGarbageType(content: string): string | null {
  const lower = content.toLowerCase();
  if (/user (is|seems|appears|believes|thinks|wants|explores)/.test(lower)) return 'meta_observation';
  if (/\b(interesting|fascinating|cool|nice|great)\b/.test(lower) && lower.length < 50) return 'vague_reaction';
  if (/session|conversation|context|message|prompt/.test(lower)) return 'session_noise';
  if (lower.length < 15) return 'too_short';
  const specificWords = lower.split(/\s+/).filter(w => w.length > 5);
  if (specificWords.length < 2 && lower.length > 30) return 'vague_content';
  return null;
}

export function immuneScan(): InfectionReport {
  const db = getDb();
  let actions = 0;

  // 1. Kontaminierte Nodes: niedrige confidence aber trotzdem Edges
  const contaminated = db.prepare(`
    SELECT n.id, n.confidence,
      (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) as edge_count
    FROM nodes n
    WHERE n.confidence < 0.2 AND n.type NOT IN ('core', 'system_knowledge')
    HAVING edge_count > 3
    LIMIT 20
  `).all() as Array<{ id: string; confidence: number; edge_count: number }>;

  for (const node of contaminated) {
    const edges = db.prepare(
      'SELECT id, strength FROM edges WHERE source_id = ? OR target_id = ?'
    ).all(node.id, node.id) as Array<{ id: string; strength: number }>;

    for (const edge of edges) {
      if (edge.strength > 0.1) {
        db.prepare('UPDATE edges SET strength = ? WHERE id = ?')
          .run(edge.strength * 0.7, edge.id);
        actions++;
      }
    }
  }

  // 2. Entzuendete Cluster: viele contradicts-Edges = instabil
  const inflamed = db.prepare(`
    SELECT n.chunk_id, COUNT(*) as conflict_count FROM edges e
    JOIN nodes n ON n.id = e.source_id OR n.id = e.target_id
    WHERE e.type = 'contradicts' AND n.chunk_id IS NOT NULL
    GROUP BY n.chunk_id HAVING conflict_count >= 3
  `).all() as Array<{ chunk_id: string; conflict_count: number }>;

  return {
    contaminated_nodes: contaminated.length,
    inflamed_clusters: inflamed.length,
    actions_taken: actions,
  };
}

export function getImmuneBoost(): Record<string, number> {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'garbage_type_stats'")
      .get() as { value: string } | undefined;
    if (!row) return {};
    const stats: Record<string, number> = JSON.parse(row.value);
    const total = Object.values(stats).reduce((s, v) => s + v, 0);
    if (total < 10) return {};

    const boosts: Record<string, number> = {};
    for (const [type, count] of Object.entries(stats)) {
      if (count / total > 0.3) boosts[type] = 0.1;
    }
    return boosts;
  } catch { return {}; }
}
