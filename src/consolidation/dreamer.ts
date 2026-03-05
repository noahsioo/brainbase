import { getDb, addEdge, getEdgeBetween, type Node } from '../memory/store.js';
import { isContradiction, isSimilar } from '../extraction/verification.js';
import type { LLMClient } from '../llm/types.js';

export interface DreamResult {
  dream_edges: number;
  gaps_found: number;
  contradictions: number;
}

const MAX_DREAM_EDGES = 5;
const MAX_GAPS = 3;

function getTopNodes(limit: number): Node[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM nodes
    WHERE abstraction_level < 2
      AND type NOT IN ('core', 'pattern', 'distilled')
    ORDER BY importance DESC
    LIMIT ?
  `).all(limit) as Node[];
}

function getUnconnectedPairs(nodes: Node[]): Array<[Node, Node]> {
  const pairs: Array<[Node, Node]> = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].type === nodes[j].type) continue;

      const edge = getEdgeBetween(nodes[i].id, nodes[j].id);
      if (!edge) {
        pairs.push([nodes[i], nodes[j]]);
      }
    }
  }

  // Shuffle and take first 5 pairs for LLM evaluation
  for (let k = pairs.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1));
    [pairs[k], pairs[r]] = [pairs[r], pairs[k]];
  }

  return pairs.slice(0, 5);
}

async function discoverCrossDomainConnections(
  client: LLMClient,
  nodes: Node[],
): Promise<number> {
  const pairs = getUnconnectedPairs(nodes);
  if (pairs.length === 0) return 0;

  const pairDescriptions = pairs
    .map(([a, b], i) => `${i + 1}. "${a.content}" <-> "${b.content}"`)
    .join('\n');

  const prompt = `You are analyzing a knowledge graph about a user. These node pairs have NO connection yet.
For each pair, decide if there is a meaningful, non-obvious connection.

Pairs:
${pairDescriptions}

Respond in JSON format:
{
  "connections": [
    { "pair": 1, "makes_sense": true, "connection": "Both relate to X" },
    { "pair": 2, "makes_sense": false, "connection": "" }
  ]
}

Be conservative - only say makes_sense: true if there is a REAL connection, not just vague similarity.`;

  let dreamEdges = 0;

  try {
    const result = await client.generateJson<{
      connections: Array<{ pair: number; makes_sense: boolean; connection: string }>;
    }>(prompt, { temperature: 0.7 });

    if (!result.connections || !Array.isArray(result.connections)) return 0;

    for (const conn of result.connections) {
      if (!conn.makes_sense || dreamEdges >= MAX_DREAM_EDGES) continue;

      const idx = conn.pair - 1;
      if (idx < 0 || idx >= pairs.length) continue;

      const [nodeA, nodeB] = pairs[idx];
      const existing = getEdgeBetween(nodeA.id, nodeB.id);
      if (existing) continue;

      addEdge(nodeA.id, nodeB.id, 'dreamed', 0.3);
      dreamEdges++;
    }
  } catch {
    // LLM failure is non-fatal
  }

  return dreamEdges;
}

function detectKnowledgeGaps(nodes: Node[]): number {
  const db = getDb();

  // Group nodes by keywords (simple domain detection)
  const domainMap = new Map<string, string[]>();

  for (const node of nodes) {
    const words = node.content
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const word of words) {
      if (!domainMap.has(word)) {
        domainMap.set(word, []);
      }
      domainMap.get(word)!.push(node.id);
    }
  }

  // Find domains with few nodes but connected to large domains
  const allNodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
  const largeThreshold = Math.max(5, Math.floor(allNodes.count * 0.1));

  let gapsFound = 0;
  const existingGaps = db.prepare(
    'SELECT domain FROM knowledge_gaps WHERE filled_at IS NULL'
  ).all() as Array<{ domain: string }>;
  const existingDomains = new Set(existingGaps.map(g => g.domain));

  const sorted = [...domainMap.entries()]
    .filter(([domain, ids]) => ids.length < 3 && ids.length >= 1 && !existingDomains.has(domain))
    .sort((a, b) => a[1].length - b[1].length);

  for (const [domain, nodeIds] of sorted) {
    if (gapsFound >= MAX_GAPS) break;

    // Check if this small domain connects to larger ones
    let connectsToLarge = false;
    for (const nodeId of nodeIds) {
      const edges = db.prepare(
        'SELECT * FROM edges WHERE source_id = ? OR target_id = ?'
      ).all(nodeId, nodeId) as Array<{ source_id: string; target_id: string }>;

      for (const edge of edges) {
        const otherId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
        const otherNode = db.prepare('SELECT content FROM nodes WHERE id = ?').get(otherId) as { content: string } | undefined;
        if (!otherNode) continue;

        // Check if other node is in a larger domain
        const otherWords = otherNode.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const w of otherWords) {
          if (domainMap.has(w) && domainMap.get(w)!.length >= largeThreshold) {
            connectsToLarge = true;
            break;
          }
        }
        if (connectsToLarge) break;
      }
      if (connectsToLarge) break;
    }

    if (connectsToLarge) {
      const now = Date.now();
      db.prepare(`
        INSERT INTO knowledge_gaps (id, domain, description, node_count, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `gap-${now}-${gapsFound}`,
        domain,
        `Only ${nodeIds.length} nodes about "${domain}" but connected to larger clusters`,
        nodeIds.length,
        0.5,
        now,
      );
      gapsFound++;
    }
  }

  return gapsFound;
}

function scanContradictions(nodes: Node[]): number {
  const db = getDb();
  let contradictions = 0;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (contradictions >= 5) return contradictions;

      // Only check nodes that are somewhat similar (same domain)
      if (!isSimilar(nodes[i].content, nodes[j].content)) continue;

      if (isContradiction(nodes[i].content, nodes[j].content)) {
        const existing = getEdgeBetween(nodes[i].id, nodes[j].id);
        if (existing && existing.type === 'contradicts') continue;

        if (existing) {
          // Update existing edge to contradicts type
          db.prepare('UPDATE edges SET type = ?, strength = 0.5 WHERE id = ?')
            .run('contradicts', existing.id);
        } else {
          addEdge(nodes[i].id, nodes[j].id, 'contradicts', 0.5);
        }
        contradictions++;
      }
    }
  }

  return contradictions;
}

export async function dreamPhase(client: LLMClient): Promise<DreamResult> {
  const topNodes = getTopNodes(20);

  if (topNodes.length < 2) {
    return { dream_edges: 0, gaps_found: 0, contradictions: 0 };
  }

  // 1. Cross-Domain Discovery (needs LLM)
  const dreamEdges = await discoverCrossDomainConnections(client, topNodes);

  // 2. Knowledge Gap Detection (pure DB)
  const gapsFound = detectKnowledgeGaps(topNodes);

  // 3. Contradiction Scan (pure logic)
  const contradictions = scanContradictions(topNodes);

  return { dream_edges: dreamEdges, gaps_found: gapsFound, contradictions };
}
