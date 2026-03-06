import { randomUUID } from 'crypto';
import { getDb, getNode, updateNode, type Node, type Edge } from './store.js';

const MIN_CO_ACTIVATIONS = 5;
const MIN_EDGE_STRENGTH = 0.4;
const MIN_CHUNK_SIZE = 2;
const MAX_CHUNK_SIZE = 6;

export interface ChunkingResult {
  chunks_created: number;
  nodes_chunked: number;
}

export function detectAndCreateChunks(): ChunkingResult {
  const db = getDb();

  // Find strong, frequently co-activated edges
  const strongEdges = db.prepare(`
    SELECT * FROM edges
    WHERE co_activations >= ? AND strength >= ?
    AND type NOT IN ('contradicts')
  `).all(MIN_CO_ACTIVATIONS, MIN_EDGE_STRENGTH) as Edge[];

  if (strongEdges.length === 0) return { chunks_created: 0, nodes_chunked: 0 };

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  for (const edge of strongEdges) {
    if (!adjacency.has(edge.source_id)) adjacency.set(edge.source_id, new Set());
    if (!adjacency.has(edge.target_id)) adjacency.set(edge.target_id, new Set());
    adjacency.get(edge.source_id)!.add(edge.target_id);
    adjacency.get(edge.target_id)!.add(edge.source_id);
  }

  // Connected components via BFS
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId)) continue;

    const component: string[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  let chunksCreated = 0;
  let nodesChunked = 0;

  for (const component of components) {
    // Filter out nodes that are already chunked
    const unchunked = component.filter(id => {
      const node = getNode(id);
      return node && !node.chunk_id;
    });

    if (unchunked.length < MIN_CHUNK_SIZE) continue;

    // If component is too large, take the most important nodes
    let chunkNodes: Node[];
    if (unchunked.length > MAX_CHUNK_SIZE) {
      chunkNodes = unchunked
        .map(id => getNode(id)!)
        .filter(Boolean)
        .sort((a, b) => b.importance - a.importance)
        .slice(0, MAX_CHUNK_SIZE);
    } else {
      chunkNodes = unchunked.map(id => getNode(id)!).filter(Boolean);
    }

    if (chunkNodes.length < MIN_CHUNK_SIZE) continue;

    const chunkName = generateChunkName(chunkNodes);
    const chunkId = randomUUID();

    db.prepare(`
      INSERT INTO chunks (id, name, description, node_ids, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      chunkId,
      chunkName,
      chunkNodes.map(n => n.content.slice(0, 50)).join(' | '),
      JSON.stringify(chunkNodes.map(n => n.id)),
      Date.now(),
    );

    for (const node of chunkNodes) {
      updateNode(node.id, { chunk_id: chunkId });
    }

    chunksCreated++;
    nodesChunked += chunkNodes.length;
  }

  return { chunks_created: chunksCreated, nodes_chunked: nodesChunked };
}

function generateChunkName(nodes: Node[]): string {
  // Extract common words across node contents
  const wordCounts = new Map<string, number>();
  const stopWords = new Set([
    'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
    'von', 'zu', 'in', 'auf', 'an', 'the', 'a', 'is', 'and', 'or',
    'with', 'of', 'to', 'for', 'at', 'by', 'not', 'but',
  ]);

  for (const node of nodes) {
    const words = new Set(
      node.content.toLowerCase()
        .replace(/[^a-zäöüß0-9\s-]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  // Words that appear in multiple nodes
  const commonWords = Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  if (commonWords.length > 0) {
    return commonWords.join(' + ');
  }

  // Fallback: use most common node type
  const typeCounts = new Map<string, number>();
  for (const node of nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  }
  const topType = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';

  return `${topType} cluster`;
}

export function getChunksForContext(limit = 10): Array<{ id: string; name: string; nodes: Node[] }> {
  const db = getDb();
  const chunks = db.prepare(`
    SELECT id, name, node_ids FROM chunks ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Array<{ id: string; name: string; node_ids: string }>;

  return chunks.map(chunk => {
    let nodeIds: string[];
    try {
      nodeIds = JSON.parse(chunk.node_ids);
    } catch {
      nodeIds = [];
    }

    const nodes = nodeIds.map(id => getNode(id)).filter(Boolean) as Node[];
    return { id: chunk.id, name: chunk.name, nodes };
  }).filter(c => c.nodes.length >= MIN_CHUNK_SIZE);
}
