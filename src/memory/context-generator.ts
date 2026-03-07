import { getDb, getNodes, getEmbedding, getAllEntities, getEdgesForNode, findEntityByName, getNode, type Node, type NodeMetadata } from './store.js';
import { getStyleDNA } from '../learning/style-analyzer.js';
import { getActivatedNodes } from './activation.js';
import { getSystemState, getDevelopmentPhase } from './cold-start.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { buildGhostContext } from './ghost-context.js';
import { getChunksForContext } from './chunking.js';
import { getRelevantFailures } from './prospective.js';
import { cosineSimilarity, getEmbeddingCache } from '../llm/embeddings.js';
import { getOpenGaps } from '../learning/gap-detector.js';
import { buildUserModel, getTopicExpertise } from '../learning/user-model.js';
import { getProviderProfile, recordContextDelivery, type ContextStyle } from '../learning/ai-profiles.js';
import { calculateJOL } from '../meta/metacognition.js';
import { getSelfModel, calibrateConfidence } from '../meta/self-model.js';
import { getSystemMood } from '../senses/interoception.js';
import { savePrediction } from '../regulation/comparator.js';
import { getStressLevel } from '../regulation/stress-response.js';
import { getTradeoffState } from '../regulation/tradeoffs.js';

export type DetailMode = 'MAXIMUM' | 'STANDARD' | 'LIGHT' | 'MINIMAL';

// 15.2: Module-level mode for JOL filtering in slot functions
let _currentMode: DetailMode = 'STANDARD';

interface ContextBudget {
  entityProfile: number;
  activeContext: number;
  sessionMomentum: number;
  extras: number;
  entityGraph: number;
  serendipity: number;
}

const BUDGETS: Record<DetailMode, ContextBudget> = {
  MAXIMUM: {
    entityProfile: 400,
    activeContext: 2400,
    sessionMomentum: 400,
    extras: 400,
    entityGraph: 2000,
    serendipity: 400,
  },
  STANDARD: {
    entityProfile: 200,
    activeContext: 1000,
    sessionMomentum: 200,
    extras: 200,
    entityGraph: 1000,
    serendipity: 200,
  },
  LIGHT: {
    entityProfile: 200,
    activeContext: 400,
    sessionMomentum: 100,
    extras: 100,
    entityGraph: 400,
    serendipity: 100,
  },
  MINIMAL: {
    entityProfile: 100,
    activeContext: 150,
    sessionMomentum: 50,
    extras: 50,
    entityGraph: 100,
    serendipity: 50,
  },
};

// 11.5: Track which node IDs are used in context (for Cerebellum feedback)
const contextNodeIds = new Set<string>();

const DISPLAY_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
  'von', 'zu', 'in', 'auf', 'an', 'fuer', 'für', 'the', 'a', 'is',
  'and', 'or', 'with', 'of', 'to', 'in', 'on', 'for', 'at', 'by',
  'also', 'halt', 'mal', 'ding', 'einfach', 'eigentlich', 'bisschen',
  'vielleicht', 'sozusagen', 'like', 'just', 'actually', 'basically',
  'stuff', 'thing', 'really', 'very', 'quite',
]);

function isDisplayWorthy(node: Node): boolean {
  if (node.content.length < 15) return false;
  if (node.type === 'auto_topic') return false;
  if (node.content.includes('(+')) return false;
  const words = node.content.toLowerCase().split(/\s+/);
  const realWords = words.filter(w => !DISPLAY_STOPWORDS.has(w));
  if (realWords.length < 2) return false;
  if (node.content.toLowerCase().startsWith('recurring topic:')) {
    const topic = node.content.replace(/^recurring topic:\s*/i, '').trim();
    if (topic.length < 4 || DISPLAY_STOPWORDS.has(topic.toLowerCase())) return false;
  }
  return true;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

// ── Relation Labels ─────────────────────────────────────────

const RELATION_LABELS: Record<string, string> = {
  builds: 'Baut',
  uses: 'Nutzt',
  likes: 'Mag',
  prefers: 'Bevorzugt',
  dislikes: 'Mag nicht',
  knows: 'Kennt',
  has_skill: 'Kann',
  works_with: 'Arbeitet mit',
  wants: 'Will',
  speaks: 'Spricht',
  interested_in: 'Interessiert an',
  member_of: 'Mitglied von',
  located_at: 'Wohnt in',
  is_a: 'Ist',
  part_of: 'Teil von',
};

// ── Entity Profile (replaces buildCoreIdentitySlot) ─────────

function buildEntityProfileSlot(budget: number, empathyMode?: string): string {
  const entities = getAllEntities(50);

  if (entities.length === 0) {
    return buildLegacyCoreSlot(budget);
  }

  const userEntity = entities.find(e => {
    if (!e.metadata) return false;
    try {
      const meta = JSON.parse(e.metadata) as NodeMetadata;
      return meta.entity_type === 'person';
    } catch { return false; }
  });

  const userName = userEntity?.content || 'User';

  const relationGroups: Record<string, string[]> = {};

  if (userEntity) {
    const edges = getEdgesForNode(userEntity.id);
    for (const edge of edges) {
      const targetId = edge.source_id === userEntity.id ? edge.target_id : edge.source_id;
      const target = getNode(targetId);
      if (!target) continue;

      const label = RELATION_LABELS[edge.type] || edge.type;
      if (!relationGroups[label]) relationGroups[label] = [];
      if (!relationGroups[label].includes(target.content)) {
        relationGroups[label].push(target.content);
      }
    }
  }

  let text = `## Ueber ${userName}\n`;

  for (const [label, targets] of Object.entries(relationGroups)) {
    // 15.2: JOL annotation on relation targets
    const annotatedTargets = targets.map(t => {
      const targetEntity = entities.find(e => e.content === t);
      if (targetEntity) {
        const jol = calculateJOL(targetEntity);
        if (jol.tier === 'secure') return t + ' ++';
        if (jol.tier === 'probable') return t + ' +';
      }
      return t;
    });
    const line = `- ${label}: ${annotatedTargets.join(', ')}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  // Only show legacy nodes if entity profile is empty
  if (Object.keys(relationGroups).length === 0) {
    return buildLegacyCoreSlot(budget);
  }

  // Orphan facts: high-importance facts not covered by entity relations
  const entityNames = new Set(entities.map(e => e.content.toLowerCase()));
  const PLACEHOLDER_NAMES = new Set([
    'User Identity', 'Communication Style', 'Current Project',
    'Tech Stack', 'Workflow', 'Pain Points', 'Goals', 'Expertise Map',
  ]);

  const orphanNodes = [
    ...getNodes({ type: 'fact', minImportance: 0.6, limit: 5 }),
    ...getNodes({ type: 'preference', minImportance: 0.6, limit: 5 }),
    ...getNodes({ type: 'decision', minImportance: 0.6, limit: 3 }),
  ].filter(n =>
    !PLACEHOLDER_NAMES.has(n.content) &&
    isDisplayWorthy(n) &&
    !entityNames.has(n.content.toLowerCase()) &&
    ![...entityNames].some(name => n.content.toLowerCase().includes(name))
  );

  for (const node of orphanNodes.slice(0, 3)) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  // M27: Approach/Avoidance — show entities with strong emotional valence
  const entitiesWithValence = entities.filter(e => {
    if (!e.metadata) return false;
    try {
      const meta = JSON.parse(e.metadata) as NodeMetadata;
      return meta.valence && Math.abs(meta.valence as number) > 0.3;
    } catch { return false; }
  });

  const positiveEntities = entitiesWithValence
    .filter(e => { const meta = JSON.parse(e.metadata!) as NodeMetadata; return (meta.valence as number) > 0.3; })
    .map(e => e.content);
  const negativeEntities = entitiesWithValence
    .filter(e => { const meta = JSON.parse(e.metadata!) as NodeMetadata; return (meta.valence as number) < -0.3; })
    .map(e => e.content);

  // 13.2: Affective empathy → strengths FIRST, hide negatives (don't pile on)
  if (empathyMode === 'affective' && positiveEntities.length > 0) {
    const strengthLine = `- Staerken: ${positiveEntities.join(', ')}\n`;
    if (estimateTokens(text + strengthLine) <= budget) {
      text = `## Ueber ${userName}\n` + strengthLine + text.replace(`## Ueber ${userName}\n`, '');
    }
  } else {
    if (positiveEntities.length > 0) {
      const line = `- Staerken: ${positiveEntities.join(', ')}\n`;
      if (estimateTokens(text + line) <= budget) text += line;
    }
    if (negativeEntities.length > 0) {
      const line = `- Vorsicht bei: ${negativeEntities.join(', ')}\n`;
      if (estimateTokens(text + line) <= budget) text += line;
    }
  }

  if (text === `## Ueber ${userName}\n`) return '';
  return truncateToTokens(text, budget);
}

function buildLegacyCoreSlot(budget: number): string {
  let coreNodes = getNodes({ type: 'core', minImportance: 0.9, limit: 10 });
  let facts = getNodes({ type: 'fact', minImportance: 0.9, limit: 5 });
  let prefs = getNodes({ type: 'preference', minImportance: 0.9, limit: 3 });

  let allCore = [...coreNodes, ...facts, ...prefs];

  const PLACEHOLDER_NAMES = ['User Identity', 'Communication Style', 'Current Project', 'Tech Stack', 'Workflow', 'Pain Points', 'Goals', 'Expertise Map'];
  if (allCore.filter(n => !PLACEHOLDER_NAMES.includes(n.content)).length === 0) {
    coreNodes = getNodes({ type: 'core', minImportance: 0.5, limit: 10 });
    facts = getNodes({ type: 'fact', minImportance: 0.5, limit: 10 });
    prefs = getNodes({ type: 'preference', minImportance: 0.5, limit: 5 });
    const identityNodes = getNodes({ type: 'identity', minImportance: 0.5, limit: 5 });
    const projectNodes = getNodes({ type: 'project', minImportance: 0.5, limit: 5 });
    allCore = [...coreNodes, ...facts, ...prefs, ...identityNodes, ...projectNodes];
  }

  const meaningful = allCore.filter(n =>
    !PLACEHOLDER_NAMES.includes(n.content) &&
    isDisplayWorthy(n)
  );

  if (meaningful.length === 0) return '';

  let text = '## Ueber den User\n';
  for (const node of meaningful) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Session Topic Embedding ─────────────────────────────────

const UNIVERSAL_TYPES = new Set(['core', 'identity', 'preference', 'style_dna']);

let _sessionTopicVec: Float32Array | null = null;

export function setSessionTopicEmbedding(vector: Float32Array | null): void {
  _sessionTopicVec = vector;
}

function isTopicRelevant(node: Node, topic: string | undefined): boolean {
  if (!topic) return true;
  if (UNIVERSAL_TYPES.has(node.type)) return true;

  const nodeVec = getEmbedding(node.id);
  if (nodeVec && _sessionTopicVec) {
    const sim = cosineSimilarity(nodeVec, _sessionTopicVec);
    if (sim > 0.4) return true;
    if (sim < 0.15) return false;
  }

  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
  const contentLower = node.content.toLowerCase();

  if (contentLower.includes(topicLower)) return true;
  if (topicWords.some(w => contentLower.includes(w))) return true;

  return false;
}

// ── Active Context (entities + legacy nodes) ────────────────

// 22.2: Scene Construction — kompakter Situations-Header
function buildSceneSlot(budget: number, topic?: string, mood?: string, taskMode?: string): string {
  const db = getDb();

  const nameNode = db.prepare(
    "SELECT content FROM nodes WHERE type = 'entity' AND importance > 0.5 ORDER BY activation_count DESC LIMIT 1"
  ).get() as { content: string } | undefined;
  const userName = nameNode?.content || 'User';

  const topicStr = topic || 'allgemeines Gespraech';

  const moodLabel: Record<string, string> = {
    frustrated: 'frustriert', excited: 'motiviert', neutral: 'fokussiert',
    confused: 'unsicher', satisfied: 'zufrieden',
  };
  const moodStr = moodLabel[mood || 'neutral'] || 'fokussiert';

  let timeStr = '';
  try {
    const ctxRow = db.prepare("SELECT value FROM system_state WHERE key = 'context_signal'")
      .get() as { value: string } | undefined;
    if (ctxRow) {
      const ctx = JSON.parse(ctxRow.value);
      if (ctx.isDeepSession) timeStr = ', tiefe Session';
      else if (ctx.isNewSession) timeStr = ', Session-Start';
    }
  } catch {}

  return truncateToTokens(`## Situation\n${userName} — ${topicStr} (${moodStr}${timeStr})\n`, budget);
}

function getContextEffectivenessScore(node: Node): number {
  if (!node.metadata) return 0.5;
  try {
    const meta = JSON.parse(node.metadata) as Record<string, unknown>;
    const pos = (meta.context_positive as number) || 0;
    const neg = (meta.context_negative as number) || 0;
    if (pos + neg === 0) return 0.5;
    return (pos + 1) / (pos + neg + 2);
  } catch { return 0.5; }
}

function buildActiveContextSlot(budget: number, sessionTopic?: string, mood?: string, salience?: string): string {
  // 22.3: Speed-Accuracy Tradeoff — dynamische Node-Limits
  const tradeoffs = getTradeoffState();
  const nodeLimit = Math.round(15 + (1 - tradeoffs.speed_accuracy) * 25);
  const minActivation = 0.02 + tradeoffs.speed_accuracy * 0.08;

  const activated = getActivatedNodes(nodeLimit);

  let nodes = activated.filter(n => n.activation >= minActivation);
  if (nodes.length === 0) {
    nodes = activated;
  }
  if (nodes.length === 0) {
    nodes = getNodes({ minImportance: 0.6, limit: 15 });
  }

  if (nodes.length === 0) return '';

  // V3 Phase 3: Context-Feedback-Loop — Nodes mit gutem Feedback-Score bevorzugen
  nodes.sort((a, b) => {
    const scoreA = getContextEffectivenessScore(a);
    const scoreB = getContextEffectivenessScore(b);
    const effectiveA = a.activation * (0.7 + 0.3 * scoreA);
    const effectiveB = b.activation * (0.7 + 0.3 * scoreB);
    return effectiveB - effectiveA;
  });

  // 11.5: Collect node IDs for Cerebellum feedback
  for (const n of nodes) contextNodeIds.add(n.id);

  if (sessionTopic) {
    const relevant = nodes.filter(n => isTopicRelevant(n, sessionTopic));
    const irrelevant = nodes.filter(n => !isTopicRelevant(n, sessionTopic));

    // M30: Focus mode → only topic-relevant nodes (strict filtering)
    if (salience === 'focus') {
      nodes = relevant;
    } else {
      nodes = [...relevant, ...irrelevant];
    }
  }

  if (nodes.length === 0) return '';

  // M23: Mood-based sorting — frustrated → solutions first, failures last
  if (mood === 'frustrated') {
    nodes.sort((a, b) => {
      const aBoost = a.emotional_tag === 'success' || a.emotional_tag === 'solution' ? 1 : 0;
      const bBoost = b.emotional_tag === 'success' || b.emotional_tag === 'solution' ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;
      const aPenalty = a.emotional_tag === 'failure' || a.emotional_tag === 'frustration' ? 1 : 0;
      const bPenalty = b.emotional_tag === 'failure' || b.emotional_tag === 'frustration' ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return (b.activation || 0) - (a.activation || 0);
    });
  }

  let text = '## Aktiver Kontext\n';
  const seen = new Set<string>();

  const entityNodes = nodes.filter(n => n.type === 'entity');
  const nonEntityNodes = nodes.filter(n => n.type !== 'entity');

  // Pass 1: Build entity association map + collect orphans
  const chunks = getChunksForContext(5);
  const chunkedNodeIds = new Set<string>();

  for (const chunk of chunks) {
    const hasActivated = chunk.nodes.some(n => activated.some(a => a.id === n.id));
    if (!hasActivated && activated.length > 0) continue;
    for (const n of chunk.nodes) {
      chunkedNodeIds.add(n.id);
      seen.add(n.content);
    }
  }

  const entityAssociated = new Map<string, string[]>();
  const orphanFacts: Node[] = [];

  for (const node of nonEntityNodes) {
    if (chunkedNodeIds.has(node.id)) continue;
    if (node.type === 'core') continue;
    if (node.content === 'User Identity' || node.content === 'Communication Style') continue;
    if (!isDisplayWorthy(node)) continue;
    if (seen.has(node.content)) continue;
    // 15.2: JOL — skip fragile facts in non-MAXIMUM modes
    if (_currentMode !== 'MAXIMUM' && calculateJOL(node).tier === 'fragile') continue;

    const contentLower = node.content.toLowerCase();
    let associated = false;

    for (const entity of entityNodes) {
      if (contentLower.includes(entity.content.toLowerCase())) {
        const existing = entityAssociated.get(entity.content) || [];
        existing.push(node.content);
        entityAssociated.set(entity.content, existing);
        associated = true;
        seen.add(node.content);
        break;
      }
    }

    if (!associated) {
      orphanFacts.push(node);
    }
  }

  // Pass 2: Show entities with connections + associated facts
  for (const entity of entityNodes) {
    if (seen.has(entity.content)) continue;
    seen.add(entity.content);

    let entityType = '';
    if (entity.metadata) {
      try {
        const meta = JSON.parse(entity.metadata) as NodeMetadata;
        entityType = meta.entity_type || '';
      } catch { /* skip */ }
    }

    const edges = getEdgesForNode(entity.id);
    const connected: string[] = [];
    for (const edge of edges) {
      if (connected.length >= 3) break;
      const otherId = edge.source_id === entity.id ? edge.target_id : edge.source_id;
      const other = getNode(otherId);
      if (other && other.type === 'entity' && other.content !== entity.content) {
        connected.push(other.content);
      }
    }

    const connStr = connected.length > 0 ? ` → ${connected.join(', ')}` : '';
    const typeStr = entityType ? ` (${entityType})` : '';
    const countStr = entity.activation_count > 5 ? ` [${entity.activation_count}x]` : '';

    // M27: Valence indicator for entities with strong negative somatic markers
    let valenceHint = '';
    if (entity.metadata) {
      try {
        const meta = JSON.parse(entity.metadata) as NodeMetadata;
        if (meta.valence && (meta.valence as number) < -0.3) {
          valenceHint = ' (oft Probleme)';
        }
      } catch { /* skip */ }
    }

    const line = `- **${entity.content}**${typeStr}${valenceHint}${connStr}${countStr}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;

    const associated = entityAssociated.get(entity.content);
    if (associated) {
      for (const fact of associated.slice(0, 2)) {
        const subLine = `  - ${fact}\n`;
        if (estimateTokens(text + subLine) > budget) break;
        text += subLine;
      }
    }
  }

  // Pass 3: Show chunks
  for (const chunk of chunks) {
    const hasActivated = chunk.nodes.some(n => activated.some(a => a.id === n.id));
    if (!hasActivated && activated.length > 0) continue;

    const nonEntityChunkNodes = chunk.nodes.filter(n => n.type !== 'entity');
    if (nonEntityChunkNodes.length === 0) continue;

    const chunkHeader = `- **${chunk.name}**: `;
    const chunkContent = nonEntityChunkNodes
      .filter(n => isDisplayWorthy(n))
      .map(n => n.content.slice(0, 60))
      .join(' | ');

    if (!chunkContent) continue;

    const line = chunkHeader + chunkContent + '\n';
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  // Pass 4: Show orphan facts (no [type] prefix)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const node of orphanFacts) {
    if (seen.has(node.content)) continue;
    seen.add(node.content);
    const prio = node.importance >= 0.7 ? '! ' : '';
    // 19.3: Unconfirmed warning for single-confirmation facts older than 7 days
    let unconfirmed = '';
    if (node.metadata) {
      try {
        const meta = JSON.parse(node.metadata) as NodeMetadata;
        if (meta.source_details?.confirmation_count === 1 && node.created_at < sevenDaysAgo) {
          unconfirmed = ' (unbestaetigt)';
        }
      } catch { /* skip */ }
    }
    const line = `- ${prio}${node.content}${unconfirmed}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Aktiver Kontext\n') return '';

  return truncateToTokens(text, budget);
}

// ── Session Momentum (unchanged) ────────────────────────────

function buildSessionMomentumSlot(budget: number): string {
  const db = getDb();
  const lastSession = db.prepare(
    'SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
  ).get() as { mood_end: string | null; productivity: number | null; topics: string } | undefined;

  if (!lastSession) return '';

  let text = '## Letzte Session\n';

  if (lastSession.mood_end) {
    text += `- Stimmung: ${lastSession.mood_end}\n`;
  }
  if (lastSession.productivity !== null) {
    const prodLabel = lastSession.productivity > 0.7 ? 'hoch' :
      lastSession.productivity > 0.4 ? 'mittel' : 'niedrig';
    text += `- Produktivitaet: ${prodLabel}\n`;
  }

  try {
    const topics = JSON.parse(lastSession.topics);
    if (Array.isArray(topics) && topics.length > 0) {
      text += `- Themen: ${topics.join(', ')}\n`;
    }
  } catch {
    // skip
  }

  return truncateToTokens(text, budget);
}

// ── Entity Graph (replaces buildWarmMemorySlot) ─────────────

function buildEntityGraphSlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const topicEntity = findEntityByName(topic);

  if (!topicEntity) {
    return buildLegacyWarmSlot(budget, topic);
  }

  const edges = getEdgesForNode(topicEntity.id);
  if (edges.length === 0) return '';

  let text = `## Zum Thema: ${topicEntity.content}\n`;

  // 1-hop neighbors sorted by strength
  const neighbors: Array<{ node: Node; edge: typeof edges[0] }> = [];
  for (const edge of edges) {
    const otherId = edge.source_id === topicEntity.id ? edge.target_id : edge.source_id;
    const other = getNode(otherId);
    if (other) neighbors.push({ node: other, edge });
  }

  neighbors.sort((a, b) => b.edge.strength - a.edge.strength);

  const shownIds = new Set<string>([topicEntity.id]);

  for (const { node, edge } of neighbors) {
    const relLabel = RELATION_LABELS[edge.type] || edge.type;
    const strengthStr = edge.strength >= 0.5 ? ` (${edge.strength.toFixed(1)})` : '';
    const line = `- ${topicEntity.content} → ${relLabel} → ${node.content}${strengthStr}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
    shownIds.add(node.id);
  }

  // 2-hop for strong entity connections
  const strongNeighbors = neighbors.filter(n => n.edge.strength > 0.6 && n.node.type === 'entity');
  for (const { node: neighbor } of strongNeighbors.slice(0, 3)) {
    const hop2Edges = getEdgesForNode(neighbor.id);
    for (const edge2 of hop2Edges) {
      const otherId = edge2.source_id === neighbor.id ? edge2.target_id : edge2.source_id;
      if (shownIds.has(otherId)) continue;
      const other = getNode(otherId);
      if (!other || other.type !== 'entity') continue;

      const relLabel = RELATION_LABELS[edge2.type] || edge2.type;
      const line = `  - ${neighbor.content} → ${relLabel} → ${other.content}\n`;
      if (estimateTokens(text + line) > budget) break;
      text += line;
      shownIds.add(otherId);
    }
  }

  // Topic-related facts (not entity→entity, but mentioning the topic)
  const topicNameLower = topicEntity.content.toLowerCase();
  const topicFacts = getNodes({ minImportance: 0.5, limit: 10 })
    .filter(n => n.type !== 'entity' && n.type !== 'core' &&
      n.content.toLowerCase().includes(topicNameLower) &&
      isDisplayWorthy(n));

  for (const fact of topicFacts.slice(0, 3)) {
    const line = `- ${fact.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === `## Zum Thema: ${topicEntity.content}\n`) return '';
  return truncateToTokens(text, budget);
}

function buildLegacyWarmSlot(budget: number, topic: string): string {
  const activated = getActivatedNodes(20);
  const relevant = activated.filter(n => {
    const content = n.content.toLowerCase();
    return content.includes(topic.toLowerCase());
  });

  if (relevant.length === 0) return '';

  let text = `## Zum Thema: ${topic}\n`;
  for (const node of relevant) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Distilled Profile (unchanged) ───────────────────────────

function buildDistilledProfileSlot(budget: number): string {
  const profile = getSystemState('user_profile_distilled');
  if (!profile) return '';

  const text = `## User Profile\n${profile}\n`;
  return truncateToTokens(text, budget);
}

// ── Serendipity (unchanged) ─────────────────────────────────

function buildSerendipitySlot(budget: number, mood?: string, salience?: string): string {
  const sessionCount = getSystemState('sessions_count');
  const count = sessionCount ? parseInt(sessionCount, 10) : 0;

  // M23 + M30: Show serendipity when excited OR creative mode
  if ((count % 20 !== 0 || count === 0) && mood !== 'excited' && salience !== 'creative') return '';

  const db = getDb();
  const randomNode = db.prepare(`
    SELECT * FROM nodes
    WHERE type NOT IN ('core')
    AND importance > 0.3
    ORDER BY RANDOM()
    LIMIT 1
  `).get() as Node | undefined;

  if (!randomNode) return '';

  return truncateToTokens(
    `## Kreative Verbindung\n- ${randomNode.content}\n`,
    budget,
  );
}

// ── 22.4: Prospection — Zukunft konstruieren ────────────────

function buildProspectionSlot(budget: number, currentTopic?: string): string {
  if (!currentTopic) return '';
  const db = getDb();
  const parts: string[] = [];
  const topicLower = currentTopic.toLowerCase();

  const schemas = db.prepare(
    "SELECT content FROM nodes WHERE type = 'schema' ORDER BY importance DESC LIMIT 5"
  ).all() as Array<{ content: string }>;

  for (const schema of schemas) {
    if (schema.content.toLowerCase().includes(topicLower)) {
      parts.push(schema.content);
      break;
    }
  }

  const sessions = db.prepare(`
    SELECT topics FROM sessions WHERE ended_at IS NOT NULL
    AND topics LIKE ? ORDER BY ended_at DESC LIMIT 5
  `).all(`%${currentTopic.split(' ')[0]}%`) as Array<{ topics: string }>;

  const nextTopics = new Map<string, number>();
  for (const session of sessions) {
    try {
      const topics = JSON.parse(session.topics) as string[];
      const idx = topics.findIndex(t => t.toLowerCase().includes(topicLower));
      if (idx >= 0 && idx < topics.length - 1) {
        const next = topics[idx + 1];
        nextTopics.set(next, (nextTopics.get(next) || 0) + 1);
      }
    } catch {}
  }

  if (nextTopics.size > 0) {
    const sorted = [...nextTopics.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] >= 2) {
      parts.push(`Haeufig danach: ${sorted[0][0]}`);
    }

    // Pre-activate related nodes for expected next topic
    const expectedNext = sorted[0][0];
    const relatedNodes = db.prepare(
      "SELECT id FROM nodes WHERE content LIKE ? AND activation < 0.1 LIMIT 5"
    ).all(`%${expectedNext.split(' ')[0]}%`) as Array<{ id: string }>;
    for (const node of relatedNodes) {
      db.prepare('UPDATE nodes SET activation = MAX(activation, 0.05) WHERE id = ?').run(node.id);
    }
  }

  if (parts.length === 0) return '';

  return truncateToTokens(`## Antizipation\n- ${parts.join('\n- ')}\n`, budget);
}

// ── Task Reminder (unchanged) ───────────────────────────────

function buildTaskReminderSlot(budget: number): string {
  const tasks = getOpenTasks();
  if (tasks.length === 0) return '';

  let text = '## Offene Aufgaben\n';
  for (const task of tasks) {
    const deadline = task.emotional_tag?.startsWith('deadline:')
      ? ` (${task.emotional_tag.replace('deadline:', '')})`
      : '';
    const prio = task.importance >= 0.9 ? '!!' : task.importance >= 0.7 ? '!' : '';
    const line = `- ${prio}${task.content}${deadline}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Ghost Context (unchanged) ───────────────────────────────

function buildGhostContextSlot(budget: number, currentTopic?: string): string {
  if (!currentTopic) return '';
  const ghost = buildGhostContext(currentTopic);
  if (!ghost) return '';

  let text = `## Expertise-Hinweis\n- ${ghost}\n`;

  // M33: Metacognition — show open knowledge gaps for this topic
  const gaps = getOpenGaps();
  const topicLower = currentTopic.toLowerCase();
  const relevantGaps = gaps.filter(g =>
    topicLower.includes(g.domain.toLowerCase()) ||
    g.domain.toLowerCase().includes(topicLower)
  );

  for (const gap of relevantGaps.slice(0, 2)) {
    const line = `- Wissensluecke: ${gap.description}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Failure Warning (unchanged) ─────────────────────────────

function buildFailureWarningSlot(budget: number, topic: string): string {
  const failures = getRelevantFailures(topic);
  if (failures.length === 0) return '';

  let text = '## Vorsicht\n';
  for (const node of failures) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Conflict Monitoring (M31) ────────────────────────────────

function buildConflictSlot(budget: number): string {
  const db = getDb();

  const contradictions = db.prepare(`
    SELECT n1.content as src, n2.content as tgt
    FROM edges e
    JOIN nodes n1 ON e.source_id = n1.id
    JOIN nodes n2 ON e.target_id = n2.id
    WHERE e.type = 'contradicts'
    AND (n1.activation > 0.1 OR n2.activation > 0.1)
    LIMIT 3
  `).all() as Array<{ src: string; tgt: string }>;

  if (contradictions.length === 0) return '';

  let text = '## Hinweis: Widersprueche\n';
  for (const c of contradictions) {
    const line = `- "${c.src}" vs "${c.tgt}"\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }
  return truncateToTokens(text, budget);
}

// ── 25.2: Counter-Evidence — aktive Gegensuche ──────────────

function buildCounterEvidenceSlot(budget: number): string {
  if (budget < 20) return '';
  const db = getDb();

  const topNodes = db.prepare(
    "SELECT id, content FROM nodes WHERE activation > 0.3 ORDER BY activation DESC LIMIT 5"
  ).all() as Array<{ id: string; content: string }>;

  if (topNodes.length === 0) return '';

  const counterEvidence: string[] = [];
  for (const node of topNodes) {
    const contradicting = db.prepare(`
      SELECT n.content FROM edges e
      JOIN nodes n ON (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END) = n.id
      WHERE (e.source_id = ? OR e.target_id = ?) AND e.type = 'contradicts'
      AND n.confidence >= 0.3
      LIMIT 2
    `).all(node.id, node.id, node.id) as Array<{ content: string }>;

    for (const c of contradicting) {
      counterEvidence.push(c.content);
    }
  }

  if (counterEvidence.length === 0) return '';

  return truncateToTokens(
    `## Aber beachte\n${counterEvidence.slice(0, 2).map(c => `- ${c}`).join('\n')}\n`,
    budget
  );
}

// ── Meta Insight (unchanged) ────────────────────────────────

function buildMetaInsightSlot(budget: number, topicExpertise?: number, empathyMode?: string, taskMode?: string): string {
  const profile = getMetaProfile();

  const lines: string[] = [];

  // 13.2: Empathy-based hint (first, most important)
  if (empathyMode === 'affective') {
    lines.push('User kaempft emotional. Zeige Verstaendnis, betone Staerken und Fortschritte.');
  } else if (empathyMode === 'cognitive') {
    lines.push('User hat ein konkretes Problem. Fokus auf Loesung und technische Details.');
  }

  if (profile.dominant_type !== 'unknown') {
    const hints: Record<string, string> = {
      pointer: 'User ist ein "Zeiger" - beobachte Verhalten statt auf Erklaerungen zu warten',
      explicit: 'User erklaert Praeferenzen direkt - achte auf explizite Anweisungen',
      corrector: 'User korrigiert oft - tracke Korrekturen als negative Signale',
    };
    const hint = hints[profile.dominant_type];
    if (hint) lines.push(hint);
  }

  const lp = profile.learning_profile;
  if (lp && profile.total_messages_analyzed >= 20) {
    const dominant = [
      { key: 'examples', val: lp.learns_by_examples, hint: 'User lernt am besten durch Beispiele. Gib konkrete Beispiele.' },
      { key: 'doing', val: lp.learns_by_doing, hint: 'User lernt durch Machen. Weniger erklaeren, mehr umsetzen.' },
      { key: 'explanation', val: lp.learns_by_explanation, hint: 'User will Hintergruende verstehen. Erklaere das Warum.' },
      { key: 'vision', val: lp.learns_by_vision, hint: 'User denkt in grossen Visionen. Big Picture zuerst, dann Details.' },
    ].sort((a, b) => b.val - a.val);

    if (dominant[0].val > 0.6) {
      lines.push(dominant[0].hint);
    }

    if (lp.prefers_direct > 0.65) {
      lines.push('User bevorzugt direkte, knappe Antworten.');
    } else if (lp.prefers_detailed > 0.65) {
      lines.push('User mag ausfuehrliche Erklaerungen.');
    }
  }

  // 13.3: Task-Set hint
  const TASK_HINTS: Record<string, string> = {
    debugging: 'User debuggt. Fokus auf Fehleranalyse und Loesungen.',
    learning: 'User lernt. Erklaere Konzepte und gib Beispiele.',
    building: 'User baut. Weniger erklaeren, mehr Code.',
    exploring: 'User exploriert. Zeige Optionen und Verbindungen.',
    chatting: 'User chattet. Halte dich kurz.',
    urgent: 'User hat es eilig. Nur das Wichtigste.',
  };
  if (taskMode && TASK_HINTS[taskMode]) {
    lines.push(TASK_HINTS[taskMode]);
  }

  // 13.1: Expertise-based hint
  if (topicExpertise !== undefined) {
    if (topicExpertise > 0.7) {
      lines.push('User ist Experte in diesem Bereich. Weniger erklaeren, direkt umsetzen.');
    } else if (topicExpertise < 0.3) {
      lines.push('User ist Beginner hier. Mehr Kontext und Erklaerungen geben.');
    }
  }

  // 15.1: FOK warning
  try {
    const fokRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'fok_signal'")
      .get() as { value: string } | undefined;
    if (fokRow) {
      const fok = JSON.parse(fokRow.value);
      if (fok.has_fragments) {
        lines.push(`Zu "${fok.topic}" hat das System fragmentarische Erinnerungen (${fok.weakly_activated} Bruchstuecke). Details wuerden helfen.`);
      }
    }
  } catch {}

  // 15.4: Self-Model summary
  const selfModel = getSelfModel();
  if (selfModel) {
    const maturity = selfModel.cortical_ratio > 0.3 ? 'reif' : selfModel.cortical_ratio > 0.1 ? 'wachsend' : 'jung';
    lines.push(`System: ${selfModel.total_nodes} Fakten, ${selfModel.entity_count} Entitaeten, ${maturity} (${Math.round(selfModel.cortical_ratio * 100)}% langzeitgespeichert).`);
    if (selfModel.strongest_domains.length > 0) {
      lines.push(`Staerkste Bereiche: ${selfModel.strongest_domains.join(', ')}.`);
    }
    if (selfModel.weakest_areas.length > 0) {
      lines.push(`Wissensluecken: ${selfModel.weakest_areas.join(', ')}.`);
    }
  }

  // 18.2: Entwicklungsphase im Context
  const devPhase = getDevelopmentPhase();
  const phaseNames: Record<string, string> = {
    infant: 'Saeuglings-Phase (alles aufnehmen)',
    child: 'Kind-Phase (schnell lernen)',
    teen: 'Teenager-Phase (spezialisieren)',
    adult: 'Erwachsenen-Phase (stabil + selektiv)',
    wise: 'Weise-Phase (tiefes Wissensnetz)',
  };
  lines.push(`Entwicklungsphase: ${phaseNames[devPhase.phase]} (Session ${devPhase.session_count}).`);

  // 17.3: DMN — kreative Verbindungen seit letzter Nachricht
  try {
    const dmnRow = getDb().prepare(
      "SELECT COUNT(*) as c FROM edges WHERE type = 'inferred' AND created_at > ?"
    ).get(Date.now() - 30 * 60 * 1000) as { c: number };
    if (dmnRow.c > 0) {
      lines.push(`System hat ${dmnRow.c} neue Verbindungen im Hintergrund entdeckt.`);
    }
  } catch {}

  // 17.4: System-Mood im Context
  const sysMoodMeta = getSystemMood();
  if (sysMoodMeta.energy < 0.3) {
    lines.push('System-Energie niedrig. Fokus auf Wesentliches.');
  } else if (sysMoodMeta.curiosity > 0.7) {
    lines.push('System ist neugierig — bereit fuer neue Themen.');
  }

  // 19.4: Meta-Calibration hint
  try {
    const cal = calibrateConfidence();
    if (cal.direction === 'down') {
      lines.push('System-Kalibration: Confidence wird korrigiert (overconfident). Fakten mit Vorsicht.');
    } else if (cal.direction === 'up') {
      lines.push('System-Kalibration: Wissen ist zuverlaessig (gut kalibriert).');
    }
  } catch { /* non-fatal */ }

  if (lines.length === 0) return '';

  let text = '## Lernhinweis\n';
  for (const line of lines) {
    text += `- ${line}\n`;
  }
  return truncateToTokens(text, budget);
}

// ── Episodes (unchanged) ────────────────────────────────────

function buildEpisodeSlot(budget: number, topic?: string): string {
  const db = getDb();
  const episodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'episode' ORDER BY created_at DESC LIMIT 10"
  ).all() as Node[];

  if (episodes.length === 0) return '';

  let relevant = episodes;
  if (topic) {
    const topicLower = topic.toLowerCase();
    const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
    const matched = episodes.filter(ep => {
      const content = ep.content.toLowerCase();
      return topicWords.some(w => content.includes(w));
    });
    if (matched.length > 0) relevant = matched;
  }

  const toShow = relevant.slice(0, 2);
  let text = '## Fruehere Sessions\n';
  for (const ep of toShow) {
    const date = new Date(ep.created_at).toLocaleDateString('de-DE');
    const preview = ep.content.slice(0, 300);
    const line = `### ${date}\n${preview}\n\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Fruehere Sessions\n') return '';
  return truncateToTokens(text, budget);
}

// ── Style Slot (unchanged) ──────────────────────────────────

function buildStyleSlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const db = getDb();
  const styleDnaNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'style_dna' ORDER BY importance DESC LIMIT 10"
  ).all() as Node[];

  if (styleDnaNodes.length === 0) return '';

  const topicLower = topic.toLowerCase().replace(/\s+/g, '_');

  const relevant = styleDnaNodes.filter(n => {
    if (!n.metadata) return false;
    try {
      const meta = JSON.parse(n.metadata) as NodeMetadata;
      if (!meta.category) return false;
      return topicLower.includes(meta.category) || meta.category.includes(topicLower);
    } catch { return false; }
  });

  if (relevant.length === 0) return '';

  let text = '## Stil-Parameter\n';
  for (const node of relevant) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Stil-Parameter\n') return '';
  return truncateToTokens(text, budget);
}

// ── Examples Slot (unchanged) ───────────────────────────────

function buildExamplesSlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const db = getDb();
  const examples = db.prepare(`
    SELECT * FROM nodes WHERE type = 'example'
    ORDER BY importance DESC, last_activated DESC LIMIT 20
  `).all() as Node[];

  if (examples.length === 0) return '';

  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);

  const relevant = examples.filter(ex => {
    const contentLower = ex.content.toLowerCase();
    if (contentLower.includes(topicLower)) return true;
    if (topicWords.some(w => contentLower.includes(w))) return true;
    if (ex.metadata) {
      try {
        const meta = JSON.parse(ex.metadata) as NodeMetadata;
        if (meta.category && topicLower.includes(meta.category.replace(/_/g, ' '))) return true;
        if (meta.category && meta.category.includes(topicLower.replace(/\s+/g, '_'))) return true;
      } catch { /* skip */ }
    }
    return false;
  });

  if (relevant.length === 0) return '';

  let text = '## Beispiele\n';
  for (const ex of relevant.slice(0, 2)) {
    let label = '';
    if (ex.metadata) {
      try {
        const meta = JSON.parse(ex.metadata) as NodeMetadata;
        if (meta.category) label = ` (${meta.category.replace(/_/g, ' ')})`;
      } catch { /* skip */ }
    }
    const line = `### Beispiel${label}\n${ex.content}\n\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Beispiele\n') return '';
  return truncateToTokens(text, budget);
}

// ── Tip-of-the-Tongue (M50) ─────────────────────────────────

function buildTipOfTongueSlot(budget: number, sessionTopic?: string): string {
  const db = getDb();
  const weakNodes = db.prepare(`
    SELECT * FROM nodes
    WHERE activation BETWEEN 0.02 AND 0.15
    AND type IN ('entity', 'fact', 'preference', 'decision', 'project')
    AND importance >= 0.5
    ORDER BY activation DESC LIMIT 5
  `).all() as Node[];

  if (weakNodes.length === 0) return '';

  let relevant = weakNodes;
  if (sessionTopic) {
    const topicLower = sessionTopic.toLowerCase();
    const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
    relevant = weakNodes.filter(n => {
      const c = n.content.toLowerCase();
      return topicWords.some(w => c.includes(w));
    });
  }

  if (relevant.length === 0) return '';

  let text = '## Moeglicherweise relevant\n';
  for (const node of relevant.slice(0, 3)) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Moeglicherweise relevant\n') return '';
  return truncateToTokens(text, budget);
}

// ── Background Thoughts (19.2: Paralleles Bewusstsein) ──────

function buildBackgroundThoughtsSlot(budget: number, primaryNodes: Node[]): string {
  const db = getDb();
  const primaryIds = new Set(primaryNodes.map(n => n.id));

  const backgroundNodes = db.prepare(`
    SELECT * FROM nodes
    WHERE activation BETWEEN 0.05 AND 0.2
      AND importance > 0.3
      AND type IN ('entity', 'fact', 'preference')
    ORDER BY activation DESC LIMIT 5
  `).all() as Node[];

  const filtered = backgroundNodes.filter(n => {
    if (primaryIds.has(n.id)) return false;
    if (!n.metadata) return true;
    try {
      const meta = JSON.parse(n.metadata);
      return !meta.visibility_tier || meta.visibility_tier === 'active';
    } catch { return true; }
  });

  if (filtered.length === 0) return '';

  let text = '## Nebengedanken\n';
  for (const node of filtered.slice(0, 3)) {
    text += `- ${node.content}\n`;
  }
  return truncateToTokens(text, budget);
}

// ── Main Context Generator ──────────────────────────────────

export function generateContext(
  mode: DetailMode = 'STANDARD',
  currentTopic?: string,
  currentMood?: string,
  thalamicMode?: 'burst' | 'tonic',
  salienceMode?: 'focus' | 'creative' | 'default',
  taskMode?: string,
  provider?: string,
): string {
  // 11.5: Clear tracked node IDs for this context generation
  contextNodeIds.clear();

  // M24: Burst mode → upgrade LIGHT to STANDARD (more context when signal is strong)
  const effectiveMode = (thalamicMode === 'burst' && mode === 'LIGHT') ? 'STANDARD' : mode;
  _currentMode = effectiveMode;
  const budget = { ...BUDGETS[effectiveMode] };

  // 10.6: Context-Sense — adjust budgets based on session state
  try {
    const ctxRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'context_signal'")
      .get() as { value: string } | undefined;
    if (ctxRow) {
      const ctx = JSON.parse(ctxRow.value);
      if (ctx.isNewSession) {
        budget.entityProfile = Math.round(budget.entityProfile * 1.5);
      }
      if (ctx.isDeepSession) {
        budget.activeContext = Math.round(budget.activeContext * 1.3);
        budget.entityGraph = Math.round(budget.entityGraph * 1.2);
      }
    }
  } catch { /* context signal not available */ }

  // 13.1: User Model — expertise-based budget adjustment
  const userModel = buildUserModel();
  const topicExpertise = getTopicExpertise(userModel, currentTopic);

  if (topicExpertise > 0.7) {
    budget.entityProfile = Math.round(budget.entityProfile * 0.6);
    budget.activeContext = Math.round(budget.activeContext * 1.2);
  } else if (topicExpertise < 0.3) {
    budget.entityProfile = Math.round(budget.entityProfile * 1.3);
  }

  // 13.2: Empathy Mode — adjust budgets based on emotional state
  let empathyMode = 'neutral';
  try {
    const empRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'current_empathy_mode'")
      .get() as { value: string } | undefined;
    if (empRow) empathyMode = empRow.value;
  } catch {}

  if (empathyMode === 'affective') {
    budget.entityProfile = Math.round(budget.entityProfile * 1.4);
    budget.serendipity = 0;
  }

  // 13.3: Task-Set — mode-specific budget adjustment
  switch (taskMode) {
    case 'debugging':
      budget.extras = Math.round(budget.extras * 1.5);
      budget.serendipity = 0;
      break;
    case 'learning':
      budget.entityGraph = Math.round(budget.entityGraph * 1.3);
      break;
    case 'exploring':
      budget.serendipity = Math.round(budget.serendipity * 2.0);
      budget.entityGraph = Math.round(budget.entityGraph * 1.2);
      break;
    case 'reviewing':
      budget.entityProfile = Math.round(budget.entityProfile * 1.3);
      break;
    case 'chatting':
      budget.activeContext = Math.round(budget.activeContext * 0.5);
      budget.extras = Math.round(budget.extras * 0.3);
      budget.entityGraph = Math.round(budget.entityGraph * 0.3);
      break;
    case 'urgent':
      budget.serendipity = 0;
      budget.extras = Math.round(budget.extras * 0.5);
      break;
  }

  // 15.3c: Executive → meta-information depth
  try {
    const attRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'attention_state'")
      .get() as { value: string } | undefined;
    if (attRow) {
      const att = JSON.parse(attRow.value);
      const executiveLevel = att.executive || 0.5;
      if (executiveLevel > 0.7) {
        budget.extras = Math.round(budget.extras * 1.4);
        budget.entityGraph = Math.round(budget.entityGraph * 1.2);
      }
      if (executiveLevel < 0.3) {
        budget.extras = Math.round(budget.extras * 0.5);
        budget.serendipity = Math.round(budget.serendipity * 0.3);
      }
    }
  } catch { /* attention state not available */ }

  // 17.4: System-Mood → Context Modulation
  const sysMood = getSystemMood();
  if (sysMood.energy < 0.3) {
    budget.serendipity = 0;
    budget.extras = Math.round(budget.extras * 0.5);
  }
  if (sysMood.curiosity > 0.7) {
    budget.serendipity = Math.round(budget.serendipity * 1.5);
    budget.entityGraph = Math.round(budget.entityGraph * 1.2);
  }

  // 21.5: Stress-Response — unter Stress weniger kreativ, nur bewaehrte Pfade
  const stressLevel = getStressLevel();
  if (stressLevel === 'stressed') {
    budget.serendipity = 0;
    budget.extras = Math.round(budget.extras * 0.5);
  } else if (stressLevel === 'recovery') {
    budget.serendipity = 0; // noch kein Serendipity, aber normale extras
  }

  // 14.1+14.2: Provider-specific budget scaling + format
  let contextStyle: ContextStyle = 'narrative';
  let maxChunks = 7;
  if (provider) {
    const profile = getProviderProfile(provider);
    contextStyle = profile.context_style;
    maxChunks = profile.max_chunks;

    const m = profile.budget_multiplier;
    budget.entityProfile = Math.round(budget.entityProfile * m);
    budget.activeContext = Math.round(budget.activeContext * m);
    budget.sessionMomentum = Math.round(budget.sessionMomentum * m);
    budget.extras = Math.round(budget.extras * m);
    budget.entityGraph = Math.round(budget.entityGraph * m);
    budget.serendipity = Math.round(budget.serendipity * m);

    recordContextDelivery(provider);
  }

  // 14.4: Identity always passes — minimum entityProfile budget
  budget.entityProfile = Math.max(100, budget.entityProfile);

  const sections: string[] = [];

  // 22.2: Scene Construction — kompakter Situations-Header
  const scene = buildSceneSlot(100, currentTopic, currentMood, taskMode);
  if (scene) sections.push(scene);

  // M24: Frustrated → failure warnings FIRST and ALWAYS
  // 13.3: Debugging → also show failures first (task-driven, not mood-driven)
  if ((currentMood === 'frustrated' || taskMode === 'debugging') && currentTopic) {
    const failureWarning = buildFailureWarningSlot(budget.extras, currentTopic);
    if (failureWarning) sections.push(failureWarning);
  }

  const distilledProfile = buildDistilledProfileSlot(budget.entityProfile);
  if (distilledProfile) sections.push(distilledProfile);

  const entityProfile = buildEntityProfileSlot(budget.entityProfile, empathyMode);
  if (entityProfile) sections.push(entityProfile);

  const activeContext = buildActiveContextSlot(budget.activeContext, currentTopic, currentMood, salienceMode);
  if (activeContext) sections.push(activeContext);

  const momentum = buildSessionMomentumSlot(budget.sessionMomentum);
  if (momentum) sections.push(momentum);

  const entityGraph = buildEntityGraphSlot(budget.entityGraph, currentTopic);
  if (entityGraph) sections.push(entityGraph);

  const serendipity = buildSerendipitySlot(budget.serendipity, currentMood, salienceMode);
  if (serendipity) sections.push(serendipity);

  // 19.2: Nebengedanken — schwach aktivierte aber wichtige Nodes
  if (effectiveMode === 'MAXIMUM' || effectiveMode === 'STANDARD') {
    const activatedNodes = getActivatedNodes(30);
    const backgroundThoughts = buildBackgroundThoughtsSlot(budget.serendipity, activatedNodes);
    if (backgroundThoughts) sections.push(backgroundThoughts);
  }

  if (effectiveMode === 'MAXIMUM' || effectiveMode === 'STANDARD') {
    const ghostCtx = buildGhostContextSlot(budget.extras, currentTopic);
    if (ghostCtx) sections.unshift(ghostCtx);

    const taskReminder = buildTaskReminderSlot(budget.sessionMomentum);
    if (taskReminder) sections.push(taskReminder);

    // Failure warning already added at top for frustrated/debugging — skip duplicate
    if (currentTopic && currentMood !== 'frustrated' && taskMode !== 'debugging') {
      const failureWarning = buildFailureWarningSlot(budget.extras, currentTopic);
      if (failureWarning) sections.push(failureWarning);
    }

    // M31: Conflict Monitoring — show active contradictions
    const conflicts = buildConflictSlot(budget.extras);
    if (conflicts) sections.push(conflicts);

    // 25.2: Counter-Evidence — aktive Gegensuche gegen Confirmation Bias
    const counterEvidence = buildCounterEvidenceSlot(budget.extras);
    if (counterEvidence) sections.push(counterEvidence);

    const metaInsight = buildMetaInsightSlot(budget.extras, topicExpertise, empathyMode, taskMode);
    if (metaInsight) sections.push(metaInsight);

    const episodes = buildEpisodeSlot(budget.entityGraph, currentTopic);
    if (episodes) sections.push(episodes);

    const styleDna = buildStyleSlot(budget.extras, currentTopic);
    if (styleDna) sections.push(styleDna);

    const exampleBudget = effectiveMode === 'MAXIMUM' ? 2000 : 1000;
    const examples = buildExamplesSlot(exampleBudget, currentTopic);
    if (examples) sections.push(examples);

    // M50: Tip-of-the-Tongue — weakly activated but relevant nodes
    const tot = buildTipOfTongueSlot(budget.extras, currentTopic);
    if (tot) sections.push(tot);

    // 22.4: Prospection — Zukunft konstruieren (Schema + zeitliche Nachfolger)
    const prospection = buildProspectionSlot(budget.extras, currentTopic);
    if (prospection) sections.push(prospection);
  }

  if (sections.length === 0) {
    return 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.';
  }

  // 11.5: Save context node IDs for Cerebellum feedback
  if (contextNodeIds.size > 0) {
    try {
      getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('last_context_node_ids', JSON.stringify([...contextNodeIds].slice(0, 50)), Date.now());
    } catch { /* non-fatal */ }

    // 21.3: Comparator — Prediction speichern fuer spaetere Korrektur
    try { savePrediction([...contextNodeIds].slice(0, 30), currentTopic); } catch { /* non-fatal */ }
  }

  return integrateContext(sections, contextStyle, maxChunks);
}

export function getContextTokenCount(mode: DetailMode = 'STANDARD'): number {
  const context = generateContext(mode);
  return estimateTokens(context);
}

// ── Narrative Briefing ──────────────────────────────────────

function integrateContext(sections: string[], style: ContextStyle = 'narrative', maxChunks: number = 7): string {
  if (sections.length === 0) return '';

  const chunks: string[] = [];

  // V3 7.7: Scene Construction — kohaerentes Szenen-Briefing fuer narrative Provider
  if (style === 'narrative') {
    const scene = buildSceneBriefing();
    if (scene) chunks.push(scene);
  }

  for (const section of sections) {
    if (style === 'minimal') {
      const cleaned = sectionToMinimal(section);
      if (cleaned) chunks.push(cleaned);
    } else {
      const narrative = sectionToNarrative(section);
      if (narrative) chunks.push(narrative);
    }
  }

  return chunks.slice(0, maxChunks).join('\n\n');
}

function buildSceneBriefing(): string | null {
  try {
    const db = getDb();
    const moodRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_mood'")
      .get() as { value: string } | undefined;
    const taskRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_task_mode'")
      .get() as { value: string } | undefined;

    if (!moodRow && !taskRow) return null;

    const parts: string[] = [];
    if (taskRow?.value) parts.push(`Modus: ${taskRow.value}`);
    if (moodRow?.value && moodRow.value !== 'neutral') parts.push(`Stimmung: ${moodRow.value}`);

    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? 'Nacht' : hour < 12 ? 'Morgen' : hour < 18 ? 'Nachmittag' : 'Abend';
    parts.push(timeOfDay);

    return parts.join('. ') + '.';
  } catch { return null; }
}

// 14.2: Minimal format for small-context providers (Cursor, Aider, Codex)
function sectionToMinimal(section: string): string | null {
  const lines = section.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const header = lines[0].replace(/^#+\s*/, '').trim();
  const bullets = lines.slice(1)
    .filter(l => l.trimStart().startsWith('- '))
    .map(l => l.replace(/^\s*-\s*/, '').trim())
    .slice(0, 3);

  if (bullets.length === 0) return null;
  return `[${header}] ${bullets.join(' | ')}`;
}

function sectionToNarrative(section: string): string | null {
  const lines = section.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const header = lines[0].replace(/^#+\s*/, '').trim();
  const rest = lines.slice(1);

  const bulletPoints = rest
    .filter(l => l.trimStart().startsWith('- '))
    .map(l => l.replace(/^\s*-\s*/, '').trim());

  // Sections with sub-headers (###) like episodes/examples — keep as-is
  const hasSubHeaders = rest.some(l => l.trimStart().startsWith('### '));
  if (hasSubHeaders) {
    return rest.join('\n').trim() || null;
  }

  if (bulletPoints.length === 0) {
    return rest.join(' ').trim() || null;
  }

  if (header.startsWith('Ueber ') || header.startsWith('User Profile')) {
    return buildIdentityNarrative(header, bulletPoints);
  }
  if (header === 'Aktiver Kontext') {
    return buildActiveNarrative(bulletPoints);
  }
  if (header.startsWith('Zum Thema:')) {
    return buildGraphNarrative(header, bulletPoints);
  }
  if (header === 'Letzte Session') {
    return buildSessionNarrative(bulletPoints);
  }
  if (header === 'Offene Aufgaben') {
    return buildTaskNarrative(bulletPoints);
  }
  if (header === 'Vorsicht') {
    return buildWarningNarrative(bulletPoints);
  }
  if (header === 'Erinnerung') {
    return 'Erinnerung: ' + bulletPoints.join('. ') + '.';
  }
  if (header.startsWith('Hinweis: Widersprueche')) {
    return 'Achtung, Widerspruch: ' + bulletPoints.join('. ') + '. Klaere welche Info aktuell ist.';
  }
  if (header === 'Moeglicherweise relevant') {
    return 'Vielleicht auch relevant: ' + bulletPoints.join(', ') + '.';
  }

  return bulletPoints.join('. ') + '.';
}

function buildIdentityNarrative(header: string, points: string[]): string {
  const name = header.replace('Ueber ', '').replace('User Profile', '').trim() || 'der User';
  const sentences: string[] = [`Du sprichst mit ${name}.`];

  for (const point of points) {
    const colonIdx = point.indexOf(':');
    if (colonIdx > 0) {
      const label = point.substring(0, colonIdx).trim();
      const value = point.substring(colonIdx + 1).trim();
      const verb = label.charAt(0).toLowerCase() + label.slice(1);
      sentences.push(`${name} ${verb} ${value}.`);
    } else {
      sentences.push(point.endsWith('.') ? point : point + '.');
    }
  }

  return sentences.join(' ');
}

function buildActiveNarrative(points: string[]): string {
  if (points.length === 0) return '';
  const parts: string[] = [];

  for (const point of points) {
    // Entity format: **Name** (type) -> connected
    const entityMatch = point.match(/^\*\*(.+?)\*\*(.*)$/);
    if (entityMatch) {
      const name = entityMatch[1];
      const extra = entityMatch[2].trim();
      if (extra.includes('\u2192')) {
        const connected = extra.replace(/^.*?\u2192\s*/, '').trim();
        parts.push(`${name} (verbunden mit ${connected})`);
      } else {
        parts.push(name + (extra ? ' ' + extra : ''));
      }
    } else {
      const cleaned = point.replace(/^!*\[.*?\]\s*/, '').trim();
      parts.push(cleaned);
    }
  }

  return 'Aktuell relevant: ' + parts.join('. ') + '.';
}

function buildGraphNarrative(header: string, points: string[]): string {
  const topic = header.replace('Zum Thema:', '').trim();
  const relations: string[] = [];

  for (const point of points) {
    const parts = point.split('\u2192').map(p => p.trim());
    if (parts.length >= 3) {
      const rel = parts[1].toLowerCase();
      const target = parts[2].replace(/\s*\([\d.]+\)\s*$/, '').trim();
      relations.push(`${rel} ${target}`);
    } else {
      relations.push(point);
    }
  }

  if (relations.length === 0) return '';
  return `Zum Thema ${topic}: ${relations.join(', ')}.`;
}

function buildSessionNarrative(points: string[]): string {
  let mood = '';
  let productivity = '';
  let topics = '';

  for (const point of points) {
    if (point.startsWith('Stimmung:')) mood = point.replace('Stimmung:', '').trim();
    else if (point.startsWith('Produktivitaet:')) productivity = point.replace('Produktivitaet:', '').trim();
    else if (point.startsWith('Themen:')) topics = point.replace('Themen:', '').trim();
  }

  const parts: string[] = ['Letzte Session'];
  if (mood) parts.push(`war ${mood}`);
  if (productivity) parts.push(`und ${productivity === 'hoch' ? 'produktiv' : productivity === 'niedrig' ? 'wenig produktiv' : 'mittelmaessig produktiv'}`);
  let sentence = parts.join(' ') + '.';
  if (topics) sentence += ` Themen: ${topics}.`;
  return sentence;
}

function buildTaskNarrative(points: string[]): string {
  const tasks = points.map(p => {
    if (p.startsWith('!!')) return p.slice(2).trim() + ' (hohe Prioritaet)';
    if (p.startsWith('!')) return p.slice(1).trim() + ' (Prioritaet)';
    return p;
  });
  return 'Offene Aufgaben: ' + tasks.join(', ') + '.';
}

function buildWarningNarrative(points: string[]): string {
  return 'Vorsicht: ' + points.join('. ') + '.';
}
