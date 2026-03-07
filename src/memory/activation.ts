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
  getEmbedding,
  type Node,
  type Edge,
} from './store.js';
import type { NodeMetadata } from './store.js';
import { getCurrentMood } from '../signal/echo.js';
import { boostCoActivatedCluster } from '../learning/cluster-tracker.js';
import { getEmbeddingCache, cosineSimilarity } from '../llm/embeddings.js';
import { recordActivationPattern, completeEngrams } from './engrams.js';
import { getDevelopmentPhase } from './cold-start.js';
import { getMetaplasticLearningRate, getRetrogradeDampening } from '../regulation/feedback-channels.js';
import { getHubDecayFactor } from '../regulation/hub-protection.js';
import { getScope } from './session-scope.js';

// M36: Current encoding context for retrieval matching (session-scoped)
export function setCurrentEncodingContext(ctx: { mood?: string; topic?: string; provider?: string } | null, sessionId: string): void {
  getScope(sessionId).encodingContext = ctx;
}

// M52: Gehirnwellen/Modi — system mode modulates activation parameters (session-scoped)
export function setSystemMode(mode: 'gamma' | 'beta' | 'theta', sessionId: string): void {
  getScope(sessionId).systemMode = mode;
}

// 22.5: Adaptive Coding — Edge-Gewichte je nach TaskMode
const MODE_EDGE_WEIGHTS: Record<string, Record<string, number>> = {
  debugging: { uses: 1.3, solved_by: 1.5, caused_by: 1.3, likes: 0.5, interested_in: 0.5 },
  building:  { uses: 1.2, depends_on: 1.3, part_of: 1.2, likes: 0.7 },
  learning:  { is_a: 1.3, part_of: 1.2, knows: 1.2, uses: 0.8 },
  exploring: { interested_in: 1.3, similar_to: 1.2, related_to: 1.2 },
  chatting:  { likes: 1.3, dislikes: 1.2, prefers: 1.2, uses: 0.7 },
};

export function setCurrentTaskMode(mode: string, sessionId: string): void {
  getScope(sessionId).taskMode = mode;
}

// 23.1: Disinhibition — gezielt Nodes aus Unterdrueckung holen (session-scoped)
export function setDisinhibitionTargets(targets: string[], sessionId: string): void {
  getScope(sessionId).disinhibitionTargets = new Set(targets);
}

export function clearDisinhibitionTargets(sessionId: string): void {
  getScope(sessionId).disinhibitionTargets.clear();
}

export function applyDisinhibition(query: string, sessionId: string): void {
  const db = getDb();
  const scope = getScope(sessionId);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return;

  const archived = db.prepare(`
    SELECT id, content FROM nodes
    WHERE metadata LIKE '%archive%'
    LIMIT 50
  `).all() as Array<{ id: string; content: string }>;

  for (const node of archived) {
    const contentLower = node.content.toLowerCase();
    const matches = words.filter(w => contentLower.includes(w)).length;
    if (matches >= 2 || (matches >= 1 && words.length <= 2)) {
      scope.disinhibitionTargets.add(node.id);
    }
  }
}

// 23.2: Coherence Groups — Nodes die im gleichen Zyklus aktiviert wurden (session-scoped)
export function startNewCoherenceRound(sessionId: string): void {
  getScope(sessionId).coherenceGroup.clear();
}

const SPREAD_FACTOR = 0.5;
const DECAY_RATE = 0.85;
const MIN_ACTIVATION = 0.01;
const MAX_DEPTH = 4;
const AUTO_LINK_THRESHOLD = 3;
const ACTIVATION_BUDGET = 50;
const INHIBITION_TOP_N = 20;
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 0.2;
const EMOTIONAL_BIAS_BOOST = 0.15;
const HEBBIAN_INCREMENT = 0.05;
const HEBBIAN_DECAY = 0.01;

// 16.3: STP — Kurzzeit-Plastizitaet (lebt nur im Memory, nicht in DB)
const _recentEdgeFirings: Map<string, { count: number; lastFired: number }> = new Map();
const STP_WINDOW = 60 * 1000;

function getSTPModifier(edgeId: string): number {
  const entry = _recentEdgeFirings.get(edgeId);
  if (!entry) return 1.0;
  const elapsed = Date.now() - entry.lastFired;
  if (elapsed > STP_WINDOW) {
    _recentEdgeFirings.delete(edgeId);
    return 1.0;
  }
  if (entry.count <= 3) {
    return 1.0 + entry.count * 0.1;
  } else {
    return Math.max(0.6, 1.3 - (entry.count - 3) * 0.15);
  }
}

function recordEdgeFiring(edgeId: string): void {
  const entry = _recentEdgeFirings.get(edgeId);
  const now = Date.now();
  if (entry && now - entry.lastFired < STP_WINDOW) {
    entry.count++;
    entry.lastFired = now;
  } else {
    _recentEdgeFirings.set(edgeId, { count: 1, lastFired: now });
  }
}

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
  // Semantic relation types (entity-relationship extraction)
  'uses',
  'likes',
  'dislikes',
  'builds',
  'knows',
  'works_with',
  'prefers',
  'wants',
  'is_a',
  'located_at',
  'has_skill',
  'created_by',
  'member_of',
  'speaks',
  'interested_in',
  'replaced_by',
] as const;

export type EdgeType = typeof EDGE_TYPES[number];

export interface ActivationResult {
  activated: Node[];
  edges: Edge[];
  inhibited: number;
}

export function activateNode(nodeId: string, energy = 1.0, sessionId = 'default'): ActivationResult {
  const node = getNode(nodeId);
  if (!node) return { activated: [], edges: [], inhibited: 0 };

  // 19.1: Skip archived nodes — they exist but shouldn't activate
  if (node.metadata) {
    try {
      const meta = JSON.parse(node.metadata);
      if (meta.visibility_tier === 'archive' || meta.visibility_tier === 'deep_archive') {
        // 23.1: Disinhibition — explizite Anfrage kann Archive oeffnen
        if (!getScope(sessionId).disinhibitionTargets.has(nodeId)) {
          return { activated: [], edges: [], inhibited: 0 };
        }
      }
    } catch { /* skip */ }
  }

  const now = Date.now();

  // 16.1: Refraktaerzeit — kuerzlich stark aktivierte Nodes sind gedaempft
  const timeSinceLastActivation = now - (node.last_activated || 0);
  const REFRACTORY_WINDOW = 30 * 1000;
  let refractoryDampen = 1.0;
  if (timeSinceLastActivation < REFRACTORY_WINDOW && node.activation > 0.5) {
    const timeFactor = timeSinceLastActivation / REFRACTORY_WINDOW;
    const strengthFactor = (node.activation - 0.5) * 2;
    refractoryDampen = 0.3 + 0.7 * timeFactor;
    refractoryDampen = Math.min(1.0, refractoryDampen + (1 - strengthFactor) * 0.3);
  }

  let boost = 0;
  if (now - node.last_activated < RECENCY_WINDOW_MS) {
    boost = RECENCY_BOOST;
  }

  const mood = getCurrentMood();
  if (mood !== 'neutral' && node.emotional_tag === mood) {
    boost += EMOTIONAL_BIAS_BOOST;
  }

  // M36: Encoding Specificity — matching context boosts retrieval
  const _currentEncodingContext = getScope(sessionId).encodingContext;
  if (node.metadata && _currentEncodingContext) {
    try {
      const meta = JSON.parse(node.metadata) as NodeMetadata;
      if (meta.encoding_context) {
        if (meta.encoding_context.mood && meta.encoding_context.mood === _currentEncodingContext.mood) {
          boost += 0.08;
        }
        if (meta.encoding_context.session_topic && _currentEncodingContext.topic) {
          const encTopic = meta.encoding_context.session_topic.toLowerCase();
          const curTopic = _currentEncodingContext.topic.toLowerCase();
          if (curTopic.includes(encTopic) || encTopic.includes(curTopic)) {
            boost += 0.10;
          }
        }
        // M47: Context-Dependent Retrieval — provider match boost
        if (meta.encoding_context.provider && _currentEncodingContext.provider) {
          if (meta.encoding_context.provider === _currentEncodingContext.provider) {
            boost += 0.05;
          }
        }
      }
    } catch { /* skip */ }
  }

  const totalEnergy = Math.min(1.0, (energy + boost) * refractoryDampen);

  const newActivationCount = (node.activation_count || 0) + 1;

  updateNode(nodeId, {
    activation: totalEnergy,
    activation_count: newActivationCount,
    last_activated: now,
  });

  // 23.2: Track coherence group (session-scoped)
  getScope(sessionId).coherenceGroup.add(nodeId);
  getScope(sessionId).activatedNodeIds.add(nodeId);

  const activatedNodes: Map<string, Node> = new Map();
  const touchedEdges: Edge[] = [];

  const updatedNode = getNode(nodeId);
  if (updatedNode) {
    activatedNodes.set(nodeId, updatedNode);
    reconsolidate(updatedNode);
  }

  if (node.chunk_id) {
    expandChunk(node.chunk_id, totalEnergy * 0.3, activatedNodes);
  }

  spread(nodeId, totalEnergy, 0, activatedNodes, touchedEdges, new Set([nodeId]), sessionId);
  antiHebbianPass(nodeId, activatedNodes);

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
  sessionId = 'default',
): void {
  // M52: Gehirnwellen — mode modulates depth and budget (session-scoped)
  const scope = getScope(sessionId);
  const effectiveMaxDepth = scope.systemMode === 'gamma' ? 3 : scope.systemMode === 'theta' ? 5 : MAX_DEPTH;
  const effectiveBudget = scope.systemMode === 'gamma' ? 30 : scope.systemMode === 'theta' ? 70 : ACTIVATION_BUDGET;

  if (depth >= effectiveMaxDepth) return;
  if (activatedNodes.size >= effectiveBudget) return;

  const edges = getEdgesForNode(nodeId);

  // M48: Cue Overload — high-degree nodes spread less energy per edge
  const degree = edges.length;
  const cueOverloadDampen = degree > 15 ? 1.0 / Math.sqrt(degree / 15) : 1.0;

  for (const edge of edges) {
    const neighborId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
    if (visited.has(neighborId)) continue;
    visited.add(neighborId);

    // M49: replaced_by inhibits like contradicts
    if (edge.type === 'contradicts' || edge.type === 'replaced_by') {
      const neighbor = getNode(neighborId);
      if (neighbor) {
        const inhibitedActivation = Math.max(0, (neighbor.activation || 0) - energy * edge.strength * 0.3);
        updateNode(neighborId, { activation: inhibitedActivation });
        // 16.5: Inhibitory Plasticity — staerke Inhibitions-Edge wenn bestaetigt
        if (energy > 0.3 && (neighbor.activation || 0) > 0.1) {
          strengthenEdge(edge.id, 0.02);
        }
      }
      continue;
    }

    // 16.2: Stochastische Transmission — nicht jede Edge feuert jedes Mal
    const releaseProbability = edge.strength > 0.9 ? 1.0 : 0.3 + edge.strength * 0.7;
    if (Math.random() > releaseProbability) continue;

    // M54: Basalganglien/Habits — ultra-myelinated pathways bypass decay
    let myelinFactor: number;
    if (edge.strength > 0.9) {
      myelinFactor = 0.95;
    } else if (edge.strength > 0.8) {
      myelinFactor = 0.7;
    } else {
      myelinFactor = SPREAD_FACTOR;
    }

    // 16.3: STP — Kurzzeit-Plastizitaet
    const stpModifier = getSTPModifier(edge.id);
    let spreadEnergy = energy * edge.strength * myelinFactor * cueOverloadDampen * stpModifier;

    if (edge.type === 'caused_by' || edge.type === 'enables') {
      spreadEnergy *= 1.2;
    } else if (edge.type === 'part_of') {
      spreadEnergy *= 1.1;
    }

    // 21.2: Retrograde dampening — Nodes mit vielen Edges signalisieren "weniger senden"
    spreadEnergy *= getRetrogradeDampening(neighborId);

    // 22.5: Adaptive Coding — Edge-Gewichte je nach TaskMode (session-scoped)
    const modeWeights = MODE_EDGE_WEIGHTS[scope.taskMode];
    if (modeWeights && modeWeights[edge.type]) {
      spreadEnergy *= modeWeights[edge.type];
    }

    // 23.2: Coherence — Nodes in gleicher Runde kommunizieren besser (session-scoped)
    if (scope.coherenceGroup.has(nodeId) && scope.coherenceGroup.has(neighborId)) {
      spreadEnergy *= 1.15;
    }

    if (spreadEnergy < MIN_ACTIVATION) continue;

    const neighbor = getNode(neighborId);
    if (!neighbor) continue;

    const preActivation = neighbor.activation || 0;
    // 16.1: Refraktaerzeit auf Target-Node
    let targetRefractoryDampen = 1.0;
    const targetTimeSince = Date.now() - (neighbor.last_activated || 0);
    if (targetTimeSince < 30000 && preActivation > 0.5) {
      targetRefractoryDampen = 0.3 + 0.7 * (targetTimeSince / 30000);
    }
    const newActivation = Math.min(1.0, preActivation + spreadEnergy * targetRefractoryDampen);
    updateNode(neighborId, {
      activation: newActivation,
      last_activated: Date.now(),
    });

    hebbianStrengthening(edge.id, nodeId, neighborId);
    antiHebbianWeakening(edge.id, nodeId, preActivation);
    touchedEdges.push(edge);
    recordEdgeFiring(edge.id);

    const refreshed = getNode(neighborId);
    if (refreshed) activatedNodes.set(neighborId, refreshed);

    if (activatedNodes.size < effectiveBudget) {
      // M54: Habits don't increment depth — they act like direct connections
      const nextDepth = edge.strength > 0.9 ? depth : depth + 1;
      spread(neighborId, spreadEnergy, nextDepth, activatedNodes, touchedEdges, visited, sessionId);
    }
  }
}

function hebbianStrengthening(edgeId: string, sourceId: string, targetId: string): void {
  const source = getNode(sourceId);
  const target = getNode(targetId);
  if (!source || !target) return;

  if (source.activation > 0.1 && target.activation > 0.1) {
    // 16.4: Metaplasticity/BCM — adaptive Hebbian increment
    const avgActivationCount = (source.activation_count + target.activation_count) / 2;
    let adaptiveIncrement = HEBBIAN_INCREMENT;
    if (avgActivationCount > 50) {
      adaptiveIncrement *= 0.5;
    } else if (avgActivationCount > 20) {
      adaptiveIncrement *= 0.75;
    } else if (avgActivationCount < 5) {
      adaptiveIncrement *= 1.3;
    }
    // 18.2: Plasticity modulates learning rate
    const devPhase = getDevelopmentPhase();
    adaptiveIncrement *= (0.5 + devPhase.plasticity * 0.5);
    // 21.2: Metaplastic learning rate — viel gelernt → langsamer, wenig → schneller
    adaptiveIncrement *= getMetaplasticLearningRate();
    strengthenEdge(edgeId, adaptiveIncrement);
  }
}

function antiHebbianWeakening(edgeId: string, sourceId: string, targetPreActivation: number): void {
  const source = getNode(sourceId);
  if (!source) return;

  if (source.activation > 0.3 && targetPreActivation < 0.05) {
    // 16.4: BCM — hochaktive Nodes haben staerkere LTD
    const adaptiveDecay = source.activation_count > 30 ? 0.04 : 0.02;
    weakenEdge(edgeId, adaptiveDecay);
  }
}

function antiHebbianPass(nodeId: string, activatedNodes: Map<string, Node>): void {
  const source = getNode(nodeId);
  if (!source || source.activation < 0.3) return;

  const edges = getEdgesForNode(nodeId);
  for (const edge of edges) {
    const neighborId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
    if (activatedNodes.has(neighborId)) continue;

    const neighbor = getNode(neighborId);
    if (!neighbor) continue;
    if (neighbor.activation < 0.05) {
      weakenEdge(edge.id, 0.02);
    }
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

// ── Reconsolidation ──────────────────────────────────────────

const RECONSOLIDATION_THRESHOLDS = [3, 7, 15, 30, 60];
const IMPORTANCE_BOOST_PER_RECON = 0.03;
const MAX_IMPORTANCE_RECON = 0.95;
const CONFIDENCE_BOOST_PER_RECON = 0.02;
const MAX_CONFIDENCE_RECON = 1.0;
const ENRICH_MAX_CONTENT = 400;

const TECH_KEYWORDS = new Set([
  'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'typescript', 'javascript',
  'python', 'rust', 'go', 'java', 'swift', 'kotlin', 'flutter', 'dart',
  'node', 'deno', 'bun', 'docker', 'kubernetes', 'aws', 'gcp', 'azure',
  'postgres', 'mysql', 'redis', 'mongodb', 'sqlite', 'supabase', 'firebase',
  'tailwind', 'css', 'html', 'api', 'rest', 'graphql', 'grpc', 'websocket',
  'git', 'github', 'vercel', 'netlify', 'vite', 'webpack', 'eslint', 'jest',
  'testing', 'deploy', 'ci/cd', 'linux', 'macos', 'ios', 'android',
]);

export function reconsolidate(node: Node, queryContext?: string): boolean {
  if (node.type === 'core' || node.type === 'system_knowledge') return false;
  if (!RECONSOLIDATION_THRESHOLDS.includes(node.activation_count)) return false;

  const updates: Partial<Pick<Node, 'importance' | 'confidence'>> = {};

  // M45: Spacing Effect — unique sessions boost importance more than raw activation count
  let spacingBonus = 0;
  try {
    const meta: Record<string, unknown> = node.metadata ? JSON.parse(node.metadata) : {};
    const uniqueSessions = meta.unique_sessions as string[] | undefined;
    if (uniqueSessions && uniqueSessions.length >= 3) {
      spacingBonus = Math.min(0.1, uniqueSessions.length * 0.015);
    }
  } catch { /* no metadata */ }

  const newImportance = Math.min(MAX_IMPORTANCE_RECON, node.importance + IMPORTANCE_BOOST_PER_RECON + spacingBonus);
  if (newImportance > node.importance) {
    updates.importance = newImportance;
  }

  const newConfidence = Math.min(MAX_CONFIDENCE_RECON, node.confidence + CONFIDENCE_BOOST_PER_RECON);
  if (newConfidence > node.confidence) {
    updates.confidence = newConfidence;
  }

  if (Object.keys(updates).length > 0) {
    updateNode(node.id, updates);
  }

  // enrichNodeFromContext disabled: it appended random words to node content
  // e.g. "jetzt (+ Also, Prinzip, Fick)" - makes nodes worse, not better

  return true;
}

export function enrichNodeFromContext(node: Node, queryContext: string): boolean {
  if (node.type === 'core' || node.type === 'system_knowledge') return false;
  if (node.activation_count < 3) return false;
  if (node.content.length >= ENRICH_MAX_CONTENT) return false;

  const nodeWordsLower = new Set(node.content.toLowerCase().split(/\s+/));
  const contextTokens = queryContext.split(/\s+/).filter(w => w.length > 3);

  const enrichments: string[] = [];
  for (const token of contextTokens) {
    const lower = token.toLowerCase().replace(/[^a-z0-9/]/g, '');
    if (nodeWordsLower.has(lower)) continue;
    if (/^[A-Z]/.test(token) || TECH_KEYWORDS.has(lower)) {
      if (!enrichments.includes(lower)) {
        enrichments.push(token.replace(/[^a-zA-Z0-9._/-]/g, ''));
      }
    }
    if (enrichments.length >= 3) break;
  }

  if (enrichments.length === 0) return false;

  const addition = ` (+ ${enrichments.join(', ')})`;
  if (node.content.length + addition.length > ENRICH_MAX_CONTENT) return false;

  updateNode(node.id, { content: node.content + addition });
  return true;
}

export function activateByQuery(query: string, energy = 1.0, sessionId = 'default'): ActivationResult {
  const hits = searchNodes(query);
  const allActivated: Map<string, Node> = new Map();
  const allEdges: Edge[] = [];
  let totalInhibited = 0;

  for (const hit of hits) {
    const result = activateNode(hit.id, energy, sessionId);
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
      reconsolidate(freshHit, query);
    }
  }

  // Cluster boost: co-activated nodes in clusters get stronger connections
  const activatedIds = Array.from(allActivated.keys());
  if (activatedIds.length >= 2) {
    boostCoActivatedCluster(activatedIds.slice(0, 15));
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
    'SELECT id, activation, activation_count FROM nodes WHERE activation > 0',
  ).all() as Array<{ id: string; activation: number; activation_count: number }>;

  let affected = 0;

  for (const row of activeNodes) {
    // Decay resistance: frequently activated nodes decay slower
    // activation_count 0-2: normal decay (0.85)
    // activation_count 3-14: slow decay (0.90)
    // activation_count 15+: very slow decay (0.94)
    let effectiveDecay = DECAY_RATE;
    if (row.activation_count >= 15) {
      effectiveDecay = 0.94;
    } else if (row.activation_count >= 3) {
      effectiveDecay = 0.90;
    }

    // 23.3: Hub-Nodes verfallen langsamer
    effectiveDecay *= getHubDecayFactor(row.id);

    const decayed = row.activation * effectiveDecay;
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
  let nodes = db.prepare(
    'SELECT * FROM nodes WHERE activation > 0 ORDER BY activation DESC LIMIT ?',
  ).all(limit * 2) as Node[];

  // 19.1: Filter out archived nodes
  nodes = nodes.filter(n => {
    if (!n.metadata) return true;
    try {
      const meta = JSON.parse(n.metadata);
      return !meta.visibility_tier || meta.visibility_tier === 'active';
    } catch { return true; }
  });

  // M35: Complementary Learning Tiers — fragile memories get less retrieval weight
  for (const node of nodes) {
    // 12.4: Cortical nodes skip tier penalty — quasi-permanent
    let meta: Record<string, unknown> = {};
    try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch {}
    if (meta.memory_tier === 'cortical') {
      const edgeCount = getEdgesForNode(node.id).length;
      if (edgeCount > 20) {
        node.activation *= Math.max(0.5, 1.0 - (edgeCount - 20) * 0.02);
      }
      continue;
    }

    const isTier1 = node.confidence < 0.5 || node.activation_count < 5;
    if (isTier1) {
      node.activation *= 0.6;
    }

    // M48: Cue Overload — generic high-degree nodes get retrieval penalty
    const edgeCount = getEdgesForNode(node.id).length;
    if (edgeCount > 20) {
      node.activation *= Math.max(0.5, 1.0 - (edgeCount - 20) * 0.02);
    }
  }

  nodes.sort((a, b) => b.activation - a.activation);
  return nodes.slice(0, limit);
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

const AUTO_LINK_MAX_EDGES = 10;
const SEMANTIC_LINK_THRESHOLD = 0.35;

export function autoLinkNodes(nodeId: string): Edge[] {
  const node = getNode(nodeId);
  if (!node) return [];

  if (node.type === 'auto_topic') return [];

  // M7: Latent Inhibition — high-frequency nodes form fewer new connections
  const effectiveMaxEdges = node.activation_count > 50
    ? Math.ceil(AUTO_LINK_MAX_EDGES / 2)
    : AUTO_LINK_MAX_EDGES;

  // Try semantic auto-linking first
  const semanticEdges = semanticAutoLink(nodeId, node, effectiveMaxEdges);
  if (semanticEdges) return semanticEdges;

  // Fallback: keyword-based auto-linking
  const nodeWords = extractWords(node.content);
  if (nodeWords.size === 0) return [];

  const db = getDb();
  const allNodes = db.prepare(
    'SELECT * FROM nodes WHERE id != ? AND importance >= 0.5 AND type != ? LIMIT 50',
  ).all(nodeId, 'auto_topic') as Node[];

  const createdEdges: Edge[] = [];

  for (const other of allNodes) {
    if (createdEdges.length >= effectiveMaxEdges) break;

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

function semanticAutoLink(nodeId: string, node: Node, maxEdges: number = AUTO_LINK_MAX_EDGES): Edge[] | null {
  const nodeVec = getEmbedding(nodeId);
  if (!nodeVec) return null;

  const cache = getEmbeddingCache();
  if (cache.size < 2) return null;

  const createdEdges: Edge[] = [];

  // Find semantically similar nodes
  const similarities: Array<{ id: string; sim: number }> = [];
  for (const [otherId, otherVec] of cache) {
    if (otherId === nodeId) continue;
    const sim = cosineSimilarity(nodeVec, otherVec);
    if (sim >= SEMANTIC_LINK_THRESHOLD) {
      similarities.push({ id: otherId, sim });
    }
  }

  similarities.sort((a, b) => b.sim - a.sim);

  for (const match of similarities.slice(0, maxEdges)) {
    if (createdEdges.length >= maxEdges) break;

    const existing = getEdgeBetween(nodeId, match.id);
    if (existing) continue;

    const other = getNode(match.id);
    if (!other || other.type === 'auto_topic') continue;

    // Strength from similarity: capped at 0.7 for auto-links
    const strength = Math.min(0.7, match.sim * 0.5);
    const edgeType = match.sim > 0.8 ? 'similar_to' : detectEdgeType(node.content, other.content);
    const edge = addEdge(nodeId, match.id, edgeType, strength, { auto_generated: true });
    createdEdges.push(edge);
  }

  return createdEdges;
}

// ── Mechanism 13: Priming ────────────────────────────────────

export function primeActivations(factor: number = 0.3, sessionId?: string): void {
  const db = getDb();
  if (sessionId) {
    const scope = getScope(sessionId);
    if (scope.activatedNodeIds.size > 0) {
      const ids = Array.from(scope.activatedNodeIds);
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const placeholders = batch.map(() => '?').join(',');
        db.prepare(`UPDATE nodes SET activation = activation * ? WHERE id IN (${placeholders}) AND activation > 0`)
          .run(factor, ...batch);
      }
    }
  } else {
    db.prepare('UPDATE nodes SET activation = activation * ? WHERE activation > 0').run(factor);
  }

  // 16.3: STP Cleanup — alte Eintraege entfernen
  const now = Date.now();
  for (const [id, entry] of _recentEdgeFirings) {
    if (now - entry.lastFired > STP_WINDOW) _recentEdgeFirings.delete(id);
  }
}

// ── Mechanism 14: Inhibition of Return ───────────────────────

function getIoRNodes(sessionId: string): string[] {
  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT value FROM system_state WHERE key = ?"
    ).get(`ior_nodes_${sessionId}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : [];
  } catch { return []; }
}

function setIoRNodes(sessionId: string, nodeIds: string[]): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(`ior_nodes_${sessionId}`, JSON.stringify(nodeIds), Date.now());
  } catch { /* system_state may not exist yet */ }
}

function applyInhibitionOfReturn(
  activatedNodes: Map<string, Node>,
  sessionId: string,
): void {
  const lastTopNodes = getIoRNodes(sessionId);

  for (const nodeId of lastTopNodes) {
    const node = activatedNodes.get(nodeId);
    if (node) {
      const penalized = Math.max(0, node.activation - 0.2);
      updateNode(nodeId, { activation: penalized });
      if (penalized < MIN_ACTIVATION) {
        activatedNodes.delete(nodeId);
      } else {
        const refreshed = getNode(nodeId);
        if (refreshed) activatedNodes.set(nodeId, refreshed);
      }
    }
  }

  const sorted = Array.from(activatedNodes.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 10);
  setIoRNodes(sessionId, sorted.map(n => n.id));
}

// ── Mechanism 16: Pattern Completion ─────────────────────────

function patternComplete(activatedNodes: Map<string, Node>): void {
  const db = getDb();
  const chunks = db.prepare(
    'SELECT id, node_ids FROM chunks'
  ).all() as Array<{ id: string; node_ids: string }>;

  for (const chunk of chunks) {
    let nodeIds: string[];
    try { nodeIds = JSON.parse(chunk.node_ids); }
    catch { continue; }

    if (nodeIds.length < 2) continue;

    const activeCount = nodeIds.filter(id => activatedNodes.has(id)).length;
    const ratio = activeCount / nodeIds.length;

    if (ratio >= 0.6) {
      for (const id of nodeIds) {
        if (activatedNodes.has(id)) continue;
        const node = getNode(id);
        if (!node) continue;

        const fillActivation = Math.min(1.0, (node.activation || 0) + 0.1);
        updateNode(id, { activation: fillActivation, last_activated: Date.now() });
        const refreshed = getNode(id);
        if (refreshed) activatedNodes.set(id, refreshed);
      }
    }
  }
}

// ── 22.1: Retrieval-Induced Forgetting ────────────────────────

function applyRetrievalInducedForgetting(activatedNodes: Map<string, Node>): number {
  if (activatedNodes.size < 5) return 0;

  const topNodes = Array.from(activatedNodes.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 10);
  const topIds = new Set(topNodes.map(n => n.id));

  const db = getDb();
  const placeholders = topNodes.map(() => '?').join(',');
  const candidates = db.prepare(
    `SELECT id, activation FROM nodes WHERE activation > 0.05 AND id NOT IN (${placeholders}) LIMIT 30`
  ).all(...topNodes.map(n => n.id)) as Array<{ id: string; activation: number }>;

  let suppressed = 0;

  for (const candidate of candidates) {
    const candidateVec = getEmbedding(candidate.id);
    if (!candidateVec) continue;

    let maxSim = 0;
    for (const top of topNodes) {
      const topVec = getEmbedding(top.id);
      if (!topVec) continue;
      const sim = cosineSimilarity(candidateVec, topVec);
      if (sim > maxSim) maxSim = sim;
    }

    if (maxSim > 0.5) {
      const suppressedActivation = candidate.activation * 0.3;
      updateNode(candidate.id, { activation: suppressedActivation });
      activatedNodes.delete(candidate.id);
      suppressed++;
    }
  }

  return suppressed;
}

// ── 25.3: Anti-Hijack — Dominanz-Erkennung ──────────────────

function applyAntiHijack(activatedNodes: Map<string, Node>): number {
  if (activatedNodes.size < 5) return 0;

  const db = getDb();
  const avgRow = db.prepare(
    "SELECT AVG(activation_count) as avg FROM nodes WHERE type NOT IN ('core', 'system_knowledge') AND activation_count > 0"
  ).get() as { avg: number } | undefined;
  const avgAct = avgRow?.avg || 1;

  let capped = 0;
  for (const [id, node] of activatedNodes) {
    const dominance = node.activation_count / avgAct;
    if (dominance > 10) {
      const ceiling = avgAct * 2;
      const dampFactor = Math.min(1.0, ceiling / node.activation_count);
      const cappedActivation = node.activation * dampFactor;
      updateNode(id, { activation: cappedActivation });
      const refreshed = getNode(id);
      if (refreshed) activatedNodes.set(id, refreshed);
      capped++;
    }
  }
  return capped;
}

// ── 25.5: Divisive Normalization — Kanonische Gain Control ──

function applyDivisiveNormalization(activatedNodes: Map<string, Node>): void {
  if (activatedNodes.size < 3) return;

  const BASELINE = 0.1;
  const totalActivation = Array.from(activatedNodes.values())
    .reduce((sum, n) => sum + n.activation, 0);

  if (totalActivation < BASELINE) return;

  for (const [id, node] of activatedNodes) {
    const normalized = node.activation / (BASELINE + totalActivation);
    const scaled = normalized * activatedNodes.size;
    const final = Math.min(1.0, Math.max(0, scaled));
    updateNode(id, { activation: final });
    const refreshed = getNode(id);
    if (refreshed) activatedNodes.set(id, refreshed);
  }
}

// ── 25.6: Kognitive Karten — Konzeptuelle Nachbarschaften ───

export function activateNeighborhood(entityId: string, hops = 2): string[] {
  const db = getDb();
  const visited = new Set<string>([entityId]);
  let frontier = [entityId];

  for (let hop = 0; hop < hops; hop++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const neighbors = db.prepare(`
        SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as neighbor_id
        FROM edges WHERE (source_id = ? OR target_id = ?) AND strength > 0.3
      `).all(nodeId, nodeId, nodeId) as Array<{ neighbor_id: string }>;

      for (const n of neighbors) {
        if (!visited.has(n.neighbor_id)) {
          visited.add(n.neighbor_id);
          nextFrontier.push(n.neighbor_id);
        }
      }
    }
    frontier = nextFrontier;
  }

  visited.delete(entityId);
  return Array.from(visited).slice(0, 15);
}

// ── Mechanism 11: Conversation Activation ────────────────────

export function activateByConversation(
  messages: Array<{ content: string; weight: number }>,
  sessionId: string,
): ActivationResult {
  const allActivated: Map<string, Node> = new Map();
  const allEdges: Edge[] = [];
  let totalInhibited = 0;

  for (const msg of messages) {
    const hits = searchNodes(msg.content);
    for (const hit of hits) {
      const result = activateNode(hit.id, msg.weight, sessionId);
      for (const n of result.activated) allActivated.set(n.id, n);
      for (const e of result.edges) {
        if (!allEdges.find(ex => ex.id === e.id)) allEdges.push(e);
      }
      totalInhibited += result.inhibited;
      const freshHit = getNode(hit.id);
      if (freshHit) reconsolidate(freshHit, msg.content);
    }
  }

  const activatedIds = Array.from(allActivated.keys());
  if (activatedIds.length >= 2) {
    boostCoActivatedCluster(activatedIds.slice(0, 15));
  }

  applyInhibitionOfReturn(allActivated, sessionId);
  patternComplete(allActivated);

  // 12.2: Engram Completion — bewiesene Muster staerker als Chunk-Completion
  completeEngrams(allActivated);

  // 12.2: Aktivierungsmuster aufzeichnen fuer zukuenftige Engram-Erkennung
  recordActivationPattern(Array.from(allActivated.keys()).slice(0, 15));

  // 25.3: Anti-Hijack — Nodes die alles dominieren werden gecapped
  applyAntiHijack(allActivated);

  // 25.5: Divisive Normalization — kanonische Gain Control
  applyDivisiveNormalization(allActivated);

  // 22.1: Retrieval-Induced Forgetting — aehnliche aber nicht-Top Nodes unterdruecken
  applyRetrievalInducedForgetting(allActivated);

  // 15.3b: Orienting modulates activation budget (focused → fewer, broad → more)
  let orientingBudget = ACTIVATION_BUDGET;
  try {
    const orientRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'orienting_level'")
      .get() as { value: string } | undefined;
    if (orientRow) {
      const orienting = parseFloat(orientRow.value);
      orientingBudget = Math.round(30 + (1 - orienting) * 40);
    }
  } catch { /* fallback to default */ }

  const budgeted = Array.from(allActivated.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, orientingBudget);

  return { activated: budgeted, edges: allEdges, inhibited: totalInhibited };
}

// ── Mechanism 18: STDP (Spike-Timing-Dependent Plasticity) ───

export function getLastSTDPEntities(sessionId: string): string[] {
  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT value FROM system_state WHERE key = ?"
    ).get(`stdp_entities_${sessionId}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : [];
  } catch { return []; }
}

export function setLastSTDPEntities(sessionId: string, entityIds: string[]): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(`stdp_entities_${sessionId}`, JSON.stringify(entityIds), Date.now());
  } catch { /* system_state may not exist yet */ }
}

export function getCurrentlyActivatedEntityIds(limit = 10): string[] {
  const db = getDb();
  return (db.prepare(
    "SELECT id FROM nodes WHERE type = 'entity' AND activation > 0.1 ORDER BY activation DESC LIMIT ?"
  ).all(limit) as Array<{ id: string }>).map(r => r.id);
}

export function applySTDP(previousEntityIds: string[], currentEntityIds: string[]): void {
  if (previousEntityIds.length === 0 || currentEntityIds.length === 0) return;

  for (const prevId of previousEntityIds.slice(0, 10)) {
    for (const currId of currentEntityIds.slice(0, 10)) {
      if (prevId === currId) continue;

      const edge = getEdgeBetween(prevId, currId);
      if (edge) {
        strengthenEdge(edge.id, 0.08);
      }

      const reverseEdge = getEdgeBetween(currId, prevId);
      if (reverseEdge && reverseEdge.id !== edge?.id) {
        strengthenEdge(reverseEdge.id, 0.02);
      }
    }
  }
}
