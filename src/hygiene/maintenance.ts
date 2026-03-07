import { getDb } from '../memory/store.js';

interface MaintenanceReport {
  hot_zones: number;
  cooled: number;
  myelinated: number;
}

export function metabolicMaintenance(): MaintenanceReport {
  const db = getDb();
  let cooled = 0;
  let myelinated = 0;

  // Astrozyten-Analog: Hot Zones finden (hohe Aktivitaet, wenige Nodes)
  const hotChunks = db.prepare(`
    SELECT chunk_id, COUNT(*) as node_count, AVG(activation_count) as avg_act
    FROM nodes
    WHERE chunk_id IS NOT NULL
    GROUP BY chunk_id
    HAVING avg_act > 20
    ORDER BY avg_act DESC LIMIT 10
  `).all() as Array<{ chunk_id: string; node_count: number; avg_act: number }>;

  for (const chunk of hotChunks) {
    if (chunk.avg_act > 50 && chunk.node_count < 5) {
      // Ueberhitzung — Edges leicht schwaechen (Cooling)
      const chunkNodes = db.prepare('SELECT id FROM nodes WHERE chunk_id = ?')
        .all(chunk.chunk_id) as Array<{ id: string }>;
      for (const node of chunkNodes) {
        const edges = db.prepare(
          'SELECT id, strength FROM edges WHERE (source_id = ? OR target_id = ?) AND strength > 0.3'
        ).all(node.id, node.id) as Array<{ id: string; strength: number }>;
        for (const edge of edges) {
          db.prepare('UPDATE edges SET strength = ? WHERE id = ?')
            .run(edge.strength * 0.95, edge.id);
          cooled++;
        }
      }
    }
  }

  // Oligodendrozyten-Analog: haeufig genutzte Pfade bekommen Myelin-Boost
  const frequentEdges = db.prepare(`
    SELECT id, strength, co_activations FROM edges
    WHERE co_activations >= 10 AND strength < 0.8 AND strength > 0.3
    LIMIT 20
  `).all() as Array<{ id: string; strength: number; co_activations: number }>;

  for (const edge of frequentEdges) {
    const boost = Math.min(0.05, edge.co_activations * 0.002);
    db.prepare('UPDATE edges SET strength = ? WHERE id = ?')
      .run(Math.min(0.9, edge.strength + boost), edge.id);
    myelinated++;
  }

  return { hot_zones: hotChunks.length, cooled, myelinated };
}
