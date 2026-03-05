import {
  getDb,
  addNode,
  addEdge,
  getNode,
  getEdgesForNode,
  type Node,
} from '../memory/store.js';

export interface AbstractionResult {
  clusters_found: number;
  patterns_created: number;
  pattern_ids: string[];
}

interface NodeCluster {
  node_ids: string[];
  shared_words: string[];
}

function extractWords(text: string): Set<string> {
  const stopWords = new Set([
    'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
    'von', 'zu', 'in', 'auf', 'an', 'fuer', 'the', 'a', 'is', 'and',
    'or', 'with', 'of', 'to', 'in', 'on', 'for', 'at', 'by',
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w)),
  );
}

function findClusters(nodes: Node[]): NodeCluster[] {
  const clusters: NodeCluster[] = [];
  const used = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    if (used.has(nodes[i].id)) continue;

    const nodeEdges = getEdgesForNode(nodes[i].id);
    const neighbors = new Set(
      nodeEdges.map(e => e.source_id === nodes[i].id ? e.target_id : e.source_id)
    );

    const clusterIds: string[] = [nodes[i].id];

    for (let j = i + 1; j < nodes.length; j++) {
      if (used.has(nodes[j].id)) continue;

      const jEdges = getEdgesForNode(nodes[j].id);
      const jNeighbors = new Set(
        jEdges.map(e => e.source_id === nodes[j].id ? e.target_id : e.source_id)
      );

      let sharedNeighbors = 0;
      for (const n of neighbors) {
        if (jNeighbors.has(n)) sharedNeighbors++;
      }

      if (sharedNeighbors >= 3) {
        clusterIds.push(nodes[j].id);
      }
    }

    if (clusterIds.length >= 2) {
      const allWords: Map<string, number> = new Map();
      for (const id of clusterIds) {
        const node = getNode(id);
        if (!node) continue;
        const words = extractWords(node.content);
        for (const w of words) {
          allWords.set(w, (allWords.get(w) || 0) + 1);
        }
      }

      const shared = [...allWords.entries()]
        .filter(([, count]) => count >= Math.ceil(clusterIds.length * 0.5))
        .map(([word]) => word);

      if (shared.length > 0) {
        clusters.push({ node_ids: clusterIds, shared_words: shared });
        for (const id of clusterIds) used.add(id);
      }
    }
  }

  return clusters;
}

export function buildAbstractions(): AbstractionResult {
  const db = getDb();

  const candidateNodes = db.prepare(`
    SELECT * FROM nodes
    WHERE activation_count >= 3
      AND abstraction_level = 0
    ORDER BY activation_count DESC
    LIMIT 200
  `).all() as Node[];

  if (candidateNodes.length < 2) {
    return { clusters_found: 0, patterns_created: 0, pattern_ids: [] };
  }

  const clusters = findClusters(candidateNodes);
  const patternIds: string[] = [];

  for (const cluster of clusters) {
    const content = `Pattern: ${cluster.shared_words.slice(0, 8).join(', ')}`;

    const existing = db.prepare(`
      SELECT id FROM nodes
      WHERE type = 'pattern' AND content = ?
    `).get(content) as { id: string } | undefined;

    if (existing) continue;

    const avgImportance = cluster.node_ids.reduce((sum, id) => {
      const n = getNode(id);
      return sum + (n?.importance ?? 0);
    }, 0) / cluster.node_ids.length;

    const patternNode = addNode(content, 'pattern', {
      importance: Math.min(0.9, avgImportance + 0.1),
      confidence: 0.7,
      source: 'abstraction-builder',
      abstraction_level: 2,
    });

    for (const sourceId of cluster.node_ids) {
      addEdge(patternNode.id, sourceId, 'abstracts', 0.6);
    }

    patternIds.push(patternNode.id);
  }

  return {
    clusters_found: clusters.length,
    patterns_created: patternIds.length,
    pattern_ids: patternIds,
  };
}
