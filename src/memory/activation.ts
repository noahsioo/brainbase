import {
  getDb,
  getNode,
  updateNode,
  searchNodes,
  getEdgesForNode,
  getEdgeBetween,
  addEdge,
  strengthenEdge,
  weakenEdge,
  type Node,
  type Edge,
} from './store.js';
import { getCurrentMood } from '../signal/echo.js';

const SPREAD_FACTOR = 0.5;
const DECAY_RATE = 0.85;
const MIN_ACTIVATION = 0.01;
const MAX_DEPTH = 3;
const AUTO_LINK_THRESHOLD = 1;
const ACTIVATION_BUDGET = 50;
const INHIBITION_TOP_N = 20;
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 0.2;
const EMOTIONAL_BIAS_BOOST = 0.15;
const HEBBIAN_INCREMENT = 0.05;
const HEBBIAN_DECAY = 0.01;

export const EDGE_TYPES = [
  'related_to',
  'part_of',
  'caused_by',
  'contradicts',
  'enables',
  'temporal',
  'depends_on',
  'similar_to',
  'solved_by',
  'dreamed',
  'inferred',
  'expert_at',
  'auto',
  'abstracts',
] as const;

export type EdgeType = typeof EDGE_TYPES[number];

export interface ActivationResult {
  activated: Node[];
  edges: Edge[];
  inhibited: number;
}

export function activateNode(nodeId: string, energy = 1.0): ActivationResult {
  const node = getNode(nodeId);
  if (!node) return { activated: [], edges: [], inhibited: 0 };

  const now = Date.now();

  let boost = 0;
  if (now - node.last_activated < RECENCY_WINDOW_MS) {
    boost = RECENCY_BOOST;
  }

  const mood = getCurrentMood();
  if (mood !== 'neutral' && node.emotional_tag === mood) {
    boost += EMOTIONAL_BIAS_BOOST;
  }

  const totalEnergy = Math.min(1.0, energy + boost);

  updateNode(nodeId, {
    activation: totalEnergy,
    activation_count: (node.activation_count || 0) + 1,
    last_activated: now,
  });

  const activatedNodes: Map<string, Node> = new Map();
  const touchedEdges: Edge[] = [];

  const updatedNode = getNode(nodeId);
  if (updatedNode) activatedNodes.set(nodeId, updatedNode);

  if (node.chunk_id) {
    expandChunk(node.chunk_id, totalEnergy * 0.3, activatedNodes);
  }

  spread(nodeId, totalEnergy, 0, activatedNodes, touchedEdges, new Set([nodeId]));

  const inhibited = applyCompetitiveInhibition(activatedNodes);

  const budgetedNodes = Array.from(activatedNodes.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, ACTIVATION_BUDGET);

  return {
    activated: budgetedNodes,
    edges: touchedEdges,
    inhibited,
  };
}

function expandChunk(
  chunkId: string,
  energy: number,
  activatedNodes: Map<string, Node>,
): void {
  const db = getDb();
  const chunk = db.prepare('SELECT node_ids FROM chunks WHERE id = ?').get(chunkId) as { node_ids: string } | undefined;
  if (!chunk) return;

  let nodeIds: string[];
  try {
    nodeIds = JSON.parse(chunk.node_ids);
  } catch {
    return;
  }

  for (const nid of nodeIds) {
    if (activatedNodes.has(nid)) continue;
    const node = getNode(nid);
    if (!node) continue;
    const newActivation = Math.min(1.0, (node.activation || 0) + energy);
    updateNode(nid, { activation: newActivation, last_activated: Date.now() });
    const refreshed = getNode(nid);
    if (refreshed) activatedNodes.set(nid, refreshed);
  }
}

function spread(
  nodeId: string,
  energy: number,
  depth: number,
  activatedNodes: Map<string, Node>,
  touchedEdges: Edge[],
  visited: Set<string>,
): void {
  if (depth >= MAX_DEPTH) return;
  if (activatedNodes.size >= ACTIVATION_BUDGET) return;

  const edges = getEdgesForNode(nodeId);

  for (const edge of edges) {
    const neighborId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
    if (visited.has(neighborId)) continue;
    visited.add(neighborId);

    if (edge.type === 'contradicts') {
      const neighbor = getNode(neighborId);
      if (neighbor) {
        const inhibitedActivation = Math.max(0, (neighbor.activation || 0) - energy * edge.strength * 0.3);
        updateNode(neighborId, { activation: inhibitedActivation });
      }
      continue;
    }

    let spreadEnergy = energy * edge.strength * SPREAD_FACTOR;

    if (edge.type === 'caused_by' || edge.type === 'enables') {
      spreadEnergy *= 1.2;
    } else if (edge.type === 'part_of') {
      spreadEnergy *= 1.1;
    }

    if (spreadEnergy < MIN_ACTIVATION) continue;

    const neighbor = getNode(neighborId);
    if (!neighbor) continue;

    const newActivation = Math.min(1.0, (neighbor.activation || 0) + spreadEnergy);
    updateNode(neighborId, {
      activation: newActivation,
      last_activated: Date.now(),
    });

    hebbianStrengthening(edge.id, nodeId, neighborId);
    touchedEdges.push(edge);

    const refreshed = getNode(neighborId);
    if (refreshed) activatedNodes.set(neighborId, refreshed);

    if (activatedNodes.size < ACTIVATION_BUDGET) {
      spread(neighborId, spreadEnergy, depth + 1, activatedNodes, touchedEdges, visited);
    }
  }
}

function hebbianStrengthening(edgeId: string, sourceId: string, targetId: string): void {
  const source = getNode(sourceId);
  const target = getNode(targetId);
  if (!source || !target) return;

  if (source.activation > 0.1 && target.activation > 0.1) {
    strengthenEdge(edgeId, HEBBIAN_INCREMENT);
  }
}

function applyCompetitiveInhibition(activatedNodes: Map<string, Node>): number {
  if (activatedNodes.size <= INHIBITION_TOP_N) return 0;

  const sorted = Array.from(activatedNodes.values())
    .sort((a, b) => b.activation - a.activation);

  const winners = new Set(sorted.slice(0, INHIBITION_TOP_N).map(n => n.id));
  let inhibitedCount = 0;

  for (const [id, node] of activatedNodes) {
    if (winners.has(id)) continue;

    const maxWinnerActivation = sorted[0].activation;
    const inhibitionStrength = maxWinnerActivation * 0.5;
    const inhibitedActivation = Math.max(0, node.activation - inhibitionStrength);

    updateNode(id, { activation: inhibitedActivation });

    if (inhibitedActivation < MIN_ACTIVATION) {
      activatedNodes.delete(id);
      inhibitedCount++;
    } else {
      const refreshed = getNode(id);
      if (refreshed) activatedNodes.set(id, refreshed);
    }
  }

  return inhibitedCount;
}

const ENRICH_MAX_CONTENT = 500;
const ENRICH_MIN_ACTIVATIONS = 2;

export function enrichNodeFromContext(node: Node, queryContext: string): boolean {
  if (node.activation_count < ENRICH_MIN_ACTIVATIONS) return false;
  if (node.content.length >= ENRICH_MAX_CONTENT) return false;

  const nodeWords = extractWords(node.content);
  const queryWords = extractWords(queryContext);

  const newTerms: string[] = [];
  for (const w of queryWords) {
    if (!nodeWords.has(w) && w.length > 2) {
      newTerms.push(w);
    }
  }

  if (newTerms.length === 0 || newTerms.length > 5) return false;

  const addition = ` (${newTerms.join(', ')})`;
  if (node.content.length + addition.length > ENRICH_MAX_CONTENT) return false;

  updateNode(node.id, { content: node.content + addition });
  return true;
}

export function activateByQuery(query: string, energy = 1.0): ActivationResult {
  const hits = searchNodes(query);
  const allActivated: Map<string, Node> = new Map();
  const allEdges: Edge[] = [];
  let totalInhibited = 0;

  for (const hit of hits) {
    const result = activateNode(hit.id, energy);
    for (const n of result.activated) {
      allActivated.set(n.id, n);
    }
    for (const e of result.edges) {
      if (!allEdges.find(existing => existing.id === e.id)) {
        allEdges.push(e);
      }
    }
    totalInhibited += result.inhibited;

    const freshHit = getNode(hit.id);
    if (freshHit) {
      enrichNodeFromContext(freshHit, query);
    }
  }

  const budgeted = Array.from(allActivated.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, ACTIVATION_BUDGET);

  return {
    activated: budgeted,
    edges: allEdges,
    inhibited: totalInhibited,
  };
}

export function decayAllActivations(): number {
  const db = getDb();
  const activeNodes = db.prepare(
    'SELECT id, activation FROM nodes WHERE activation > 0',
  ).all() as Array<{ id: string; activation: number }>;

  let affected = 0;

  for (const row of activeNodes) {
    const decayed = row.activation * DECAY_RATE;
    if (decayed < MIN_ACTIVATION) {
      updateNode(row.id, { activation: 0 });
    } else {
      updateNode(row.id, { activation: decayed });
    }
    affected++;
  }

  decayUnusedEdges();

  return affected;
}

function decayUnusedEdges(): void {
  const db = getDb();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const staleEdges = db.prepare(
    'SELECT id FROM edges WHERE last_strengthened < ? AND strength > 0.05',
  ).all(cutoff) as Array<{ id: string }>;

  for (const edge of staleEdges) {
    weakenEdge(edge.id, HEBBIAN_DECAY);
  }
}

export function getActivatedNodes(limit = 20): Node[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM nodes WHERE activation > 0 ORDER BY activation DESC LIMIT ?',
  ).all(limit) as Node[];
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

export function detectEdgeType(sourceContent: string, targetContent: string): EdgeType {
  const s = sourceContent.toLowerCase();
  const t = targetContent.toLowerCase();

  if (s.includes('weil') || s.includes('because') || s.includes('caused by')) {
    return 'caused_by';
  }
  if (s.includes('teil von') || s.includes('part of') || s.includes('gehoert zu')) {
    return 'part_of';
  }
  if (s.includes('widerspricht') || s.includes('contradicts') || s.includes('aber nicht')) {
    return 'contradicts';
  }
  if (s.includes('ermoeglicht') || s.includes('enables') || s.includes('erlaubt')) {
    return 'enables';
  }
  if (s.includes('braucht') || s.includes('requires') || s.includes('depends')) {
    return 'depends_on';
  }
  if (s.includes('geloest durch') || s.includes('solved by') || s.includes('fix:')) {
    return 'solved_by';
  }

  const sWords = extractWords(s);
  const tWords = extractWords(t);
  let shared = 0;
  for (const w of sWords) {
    if (tWords.has(w)) shared++;
  }
  const overlap = shared / Math.max(1, Math.min(sWords.size, tWords.size));
  if (overlap > 0.5) return 'similar_to';

  return 'related_to';
}

export function autoLinkNodes(nodeId: string): Edge[] {
  const node = getNode(nodeId);
  if (!node) return [];

  const nodeWords = extractWords(node.content);
  if (nodeWords.size === 0) return [];

  const db = getDb();
  const allNodes = db.prepare(
    'SELECT * FROM nodes WHERE id != ? LIMIT 200',
  ).all(nodeId) as Node[];

  const createdEdges: Edge[] = [];

  for (const other of allNodes) {
    const existing = getEdgeBetween(nodeId, other.id);
    if (existing) continue;

    const otherWords = extractWords(other.content);
    let shared = 0;
    for (const w of nodeWords) {
      if (otherWords.has(w)) shared++;
    }

    if (shared >= AUTO_LINK_THRESHOLD) {
      const strength = Math.min(0.5, 0.15 * shared);
      const edgeType = detectEdgeType(node.content, other.content);
      const edge = addEdge(nodeId, other.id, edgeType, strength);
      createdEdges.push(edge);
    }
  }

  return createdEdges;
}
