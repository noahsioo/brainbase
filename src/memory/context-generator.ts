import { getDb, getNodes, getEmbedding, getAllEntities, getEdgesForNode, findEntityByName, getNode, type Node, type NodeMetadata } from './store.js';
import { getStyleDNA } from '../learning/style-analyzer.js';
import { getActivatedNodes, getSessionActivationValue, setSessionActivationValue } from './activation.js';
import { getSystemState, getDevelopmentPhase, setSystemState } from './cold-start.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { buildGhostContext } from './ghost-context.js';
import { getChunksForContext } from './chunking.js';
import { getRelevantFailures } from './prospective.js';
import { cosineSimilarity, getEmbeddingCache } from '../llm/embeddings.js';
import { getOpenGaps } from '../learning/gap-detector.js';
import { buildUserModel, getTopicExpertise } from '../learning/user-model.js';
import { getProviderProfile, peekProviderProfile, recordContextDelivery, type ContextStyle } from '../learning/ai-profiles.js';
import { calculateJOL } from '../meta/metacognition.js';
import { getSelfModel, calibrateConfidence } from '../meta/self-model.js';
import { getSystemMood } from '../senses/interoception.js';
import { savePrediction } from '../regulation/comparator.js';
import { getStressLevel } from '../regulation/stress-response.js';
import { getTradeoffState } from '../regulation/tradeoffs.js';
import { getWorkingMemory } from './working-memory.js';
import {
  getSessionAttentionState,
  getSessionContextSignal,
  getSessionEmpathyMode,
  getSessionMood,
  getSessionTaskMode,
} from './session-runtime-state.js';

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

interface SessionPhaseBudgetProfile {
  phase: 'bootstrap' | 'active' | 'deep';
  workingMemoryShare: number;
  workingMemoryMin: number;
  workingMemoryMax: number;
  minimumEntityProfileBudget: number;
  showDistilledProfile: boolean;
  showSessionMomentum: boolean;
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
const MAX_CONTEXT_OUTPUT_HISTORY_WINDOWS = 5;
const MAX_CONTEXT_OUTPUT_HISTORY_NODE_IDS = 50;
const CONTEXT_OUTPUT_HISTORY_TTL_MS = 30 * 60 * 1000;

interface ContextOutputWindow {
  node_ids: string[];
  timestamp: number;
}

interface SessionContextFeedbackEntry {
  positive: number;
  negative: number;
  updated_at: number;
}

const DISPLAY_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
  'von', 'zu', 'in', 'auf', 'an', 'fuer', 'für', 'the', 'a', 'is',
  'and', 'or', 'with', 'of', 'to', 'in', 'on', 'for', 'at', 'by',
  'also', 'halt', 'mal', 'ding', 'einfach', 'eigentlich', 'bisschen',
  'vielleicht', 'sozusagen', 'like', 'just', 'actually', 'basically',
  'stuff', 'thing', 'really', 'very', 'quite',
]);

const NON_DISPLAY_WORKING_MEMORY_REFERENCES = new Set([
  'das', 'dies', 'diese', 'dieser', 'dieses', 'es',
  'it', 'this', 'that', 'these', 'those',
]);

const NON_DISPLAY_WORKING_MEMORY_REFERENCE_PHRASES = new Set([
  'wie eben',
  'mach weiter',
  'continue',
  'weiter',
  'same thing',
  'same as before',
]);

const MAX_WORKING_MEMORY_REFERENCE_LENGTH = 48;

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

function getContextOutputHistoryKey(sessionId?: string): string {
  return `context_output_history_${sessionId || 'global'}`;
}

function normalizeContextOutputHistory(raw: string | null): ContextOutputWindow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - CONTEXT_OUTPUT_HISTORY_TTL_MS;
    return parsed
      .filter((entry): entry is { node_ids?: unknown; timestamp?: unknown } => Boolean(entry && typeof entry === 'object'))
      .map(entry => ({
        node_ids: Array.isArray(entry.node_ids)
          ? [...new Set(entry.node_ids.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, MAX_CONTEXT_OUTPUT_HISTORY_NODE_IDS)
          : [],
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
      }))
      .filter(entry => entry.node_ids.length > 0 && entry.timestamp > cutoff)
      .slice(-MAX_CONTEXT_OUTPUT_HISTORY_WINDOWS);
  } catch {
    return [];
  }
}

function getContextOutputHistory(sessionId?: string): ContextOutputWindow[] {
  return normalizeContextOutputHistory(getSystemState(getContextOutputHistoryKey(sessionId)));
}

function getSessionContextFeedbackScores(sessionId?: string): Map<string, SessionContextFeedbackEntry> {
  if (!sessionId) return new Map();

  const raw = getSystemState(`context_feedback_scores_${sessionId}`);
  if (!raw) return new Map();

  try {
    const parsed = JSON.parse(raw) as Record<string, SessionContextFeedbackEntry>;
    return new Map(
      Object.entries(parsed).filter(([, value]) =>
        value &&
        typeof value.positive === 'number' &&
        typeof value.negative === 'number' &&
        typeof value.updated_at === 'number',
      ),
    );
  } catch {
    return new Map();
  }
}

function saveContextOutputHistory(nodeIds: string[], sessionId?: string): void {
  const normalizedIds = [...new Set(nodeIds.filter(id => id.length > 0))].slice(0, MAX_CONTEXT_OUTPUT_HISTORY_NODE_IDS);
  if (normalizedIds.length === 0) return;

  const history = getContextOutputHistory(sessionId);
  history.push({
    node_ids: normalizedIds,
    timestamp: Date.now(),
  });

  setSystemState(
    getContextOutputHistoryKey(sessionId),
    JSON.stringify(history.slice(-MAX_CONTEXT_OUTPUT_HISTORY_WINDOWS)),
  );
}

function isRepeatPenaltyProtected(node: Node): boolean {
  if (node.importance >= 0.9) return true;
  return ['failure', 'frustration', 'warning', 'solution', 'success'].includes(node.emotional_tag || '');
}

function getRecentOutputWeight(nodeId: string, history: ContextOutputWindow[]): number {
  let totalWeight = 0;
  const recentHistory = history.slice(-MAX_CONTEXT_OUTPUT_HISTORY_WINDOWS);
  for (let i = 0; i < recentHistory.length; i++) {
    const window = recentHistory[i];
    if (!window.node_ids.includes(nodeId)) continue;
    const recencyWeight = recentHistory.length - i;
    totalWeight += 1 + recencyWeight * 0.5;
  }
  return totalWeight;
}

function getContextRepeatPenalty(node: Node, history: ContextOutputWindow[]): number {
  const recentOutputWeight = getRecentOutputWeight(node.id, history);
  if (recentOutputWeight <= 0) return 1;

  const floor = isRepeatPenaltyProtected(node) ? 0.5 : 0.15;
  return Math.max(floor, 1 - recentOutputWeight * 0.45);
}

function getActiveContextNodeScore(
  node: Node,
  history: ContextOutputWindow[],
  mood?: string,
  sessionFeedback = new Map<string, SessionContextFeedbackEntry>(),
): number {
  const activation = node.activation || 0;
  const importance = node.importance || 0;
  const semanticScore = getSemanticRelevanceScore(node);

  let baseSignal: number;
  if (semanticScore > 0.1) {
    const normalizedActivation = Math.min(1, activation);
    baseSignal = 0.60 * semanticScore + 0.30 * normalizedActivation + 0.10 * importance;
  } else {
    baseSignal = Math.max(activation, importance * 0.35);
  }

  const feedbackMultiplier = getContextFeedbackMultiplier(node, sessionFeedback);
  const repeatPenalty = getContextRepeatPenalty(node, history);

  let moodBias = 1;
  if (mood === 'frustrated') {
    if (node.emotional_tag === 'success' || node.emotional_tag === 'solution') moodBias = 1.25;
    if (node.emotional_tag === 'failure' || node.emotional_tag === 'frustration') moodBias = 0.7;
  }

  return baseSignal * feedbackMultiplier * repeatPenalty * moodBias;
}

function getSemanticRelevanceScore(node: Node): number {
  const nodeVec = getEmbedding(node.id);
  if (!nodeVec) return 0;

  let best = 0;

  if (_sessionMessageVec) {
    best = Math.max(best, cosineSimilarity(nodeVec, _sessionMessageVec));
  }

  if (_sessionTopicVec) {
    const topicSim = cosineSimilarity(nodeVec, _sessionTopicVec);
    best = Math.max(best, topicSim * 0.85);
  }

  return best;
}

function getSemanticCandidateNodes(limit: number): Node[] {
  if (!_sessionMessageVec && !_sessionTopicVec) return [];

  const queryVec = _sessionMessageVec || _sessionTopicVec;
  if (!queryVec) return [];

  const allEmbeddings = getEmbeddingCache();
  if (allEmbeddings.size === 0) return [];

  const scored: Array<{ node_id: string; score: number }> = [];
  for (const [nodeId, vec] of allEmbeddings.entries()) {
    const sim = cosineSimilarity(queryVec, vec);
    if (sim > 0.25) {
      scored.push({ node_id: nodeId, score: sim });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topIds = scored.slice(0, limit);

  const nodes: Node[] = [];
  for (const { node_id } of topIds) {
    const node = getNode(node_id);
    if (node) nodes.push(node);
  }

  return nodes;
}

function getContextFeedbackMultiplier(
  node: Node,
  sessionFeedback = new Map<string, SessionContextFeedbackEntry>(),
): number {
  return 0.7 + 0.3 * getContextEffectivenessScore(node, sessionFeedback);
}

function getSessionPhaseBudgetProfile(
  sessionId?: string,
  contextSignal?: { isNewSession?: boolean; isDeepSession?: boolean } | null,
  memory = sessionId ? getWorkingMemory(sessionId) : null,
): SessionPhaseBudgetProfile {
  const messageCount = memory?.message_count ?? 0;
  const openQuestionCount = memory?.open_questions.length ?? 0;
  const contextDepth = memory?.context_stack.length ?? 0;

  if (contextSignal?.isNewSession || messageCount <= 2) {
    return {
      phase: 'bootstrap',
      workingMemoryShare: 0.42,
      workingMemoryMin: 140,
      workingMemoryMax: 360,
      minimumEntityProfileBudget: 80,
      showDistilledProfile: true,
      showSessionMomentum: false,
    };
  }

  if (contextSignal?.isDeepSession || messageCount >= 8 || openQuestionCount > 0 || contextDepth >= 2) {
    return {
      phase: 'deep',
      workingMemoryShare: 0.5,
      workingMemoryMin: 160,
      workingMemoryMax: 520,
      minimumEntityProfileBudget: 40,
      showDistilledProfile: false,
      showSessionMomentum: false,
    };
  }

  return {
    phase: 'active',
    workingMemoryShare: 0.35,
    workingMemoryMin: 120,
    workingMemoryMax: 400,
    minimumEntityProfileBudget: 100,
    showDistilledProfile: true,
    showSessionMomentum: true,
  };
}

function applySessionPhaseBudgetProfile(
  budget: ContextBudget,
  profile: SessionPhaseBudgetProfile,
  memory?: ReturnType<typeof getWorkingMemory>,
): void {
  switch (profile.phase) {
    case 'bootstrap':
      budget.entityProfile = Math.round(budget.entityProfile * 0.75);
      budget.activeContext = Math.round(budget.activeContext * 1.15);
      budget.sessionMomentum = Math.round(budget.sessionMomentum * 0.15);
      budget.entityGraph = Math.round(budget.entityGraph * 0.75);
      budget.extras = Math.round(budget.extras * 0.85);
      budget.serendipity = Math.round(budget.serendipity * 0.4);
      break;
    case 'deep':
      budget.entityProfile = Math.round(budget.entityProfile * 0.45);
      budget.activeContext = Math.round(budget.activeContext * 1.35);
      budget.sessionMomentum = Math.round(budget.sessionMomentum * 0.2);
      budget.entityGraph = Math.round(budget.entityGraph * 1.15);
      budget.serendipity = Math.round(budget.serendipity * 0.5);
      if ((memory?.open_questions.length ?? 0) > 0) {
        budget.activeContext = Math.round(budget.activeContext * 1.1);
        budget.extras = Math.round(budget.extras * 1.1);
      }
      break;
    case 'active':
      break;
  }
}

// ── V5-3: Dynamic Slot Decision ─────────────────────────────

interface SlotDecision {
  showScene: boolean;
  showWorkingMemory: boolean;
  showEntityProfile: boolean;
  showActiveContext: boolean;
  showEntityGraph: boolean;
  showMomentum: boolean;
  showExtras: boolean;
  showSerendipity: boolean;
}

function decideContextSlots(
  phase: 'bootstrap' | 'active' | 'deep',
  messageCount: number,
  hasTopicChange: boolean,
  mood?: string,
  taskMode?: string,
  wmHasOpenQuestions?: boolean,
): SlotDecision {
  // Nachricht 1: Orientierung — Profil + Kontext + letzte Session
  if (messageCount <= 1) {
    return {
      showScene: true, showWorkingMemory: false, showEntityProfile: true,
      showActiveContext: true, showEntityGraph: false, showMomentum: true,
      showExtras: false, showSerendipity: false,
    };
  }

  // Nachricht 2-3: Bootstrap — WM aufbauen
  if (phase === 'bootstrap') {
    return {
      showScene: true, showWorkingMemory: true, showEntityProfile: false,
      showActiveContext: true, showEntityGraph: hasTopicChange, showMomentum: false,
      showExtras: false, showSerendipity: false,
    };
  }

  // Topic-Wechsel: Graph zum neuen Topic zeigen
  if (hasTopicChange) {
    return {
      showScene: true, showWorkingMemory: true, showEntityProfile: false,
      showActiveContext: true, showEntityGraph: true, showMomentum: false,
      showExtras: false, showSerendipity: false,
    };
  }

  // Frustrated/Debugging: Failures + Kontext
  if (mood === 'frustrated' || taskMode === 'debugging') {
    return {
      showScene: true, showWorkingMemory: true, showEntityProfile: false,
      showActiveContext: true, showEntityGraph: false, showMomentum: false,
      showExtras: true, showSerendipity: false,
    };
  }

  // Deep Session: fokussiert, Extras nur periodisch
  if (phase === 'deep') {
    return {
      showScene: false, showWorkingMemory: true, showEntityProfile: false,
      showActiveContext: true, showEntityGraph: wmHasOpenQuestions || false,
      showMomentum: false, showExtras: messageCount % 5 === 0,
      showSerendipity: messageCount % 8 === 0,
    };
  }

  // Active (normal): WM + Kontext, Scene/Extras periodisch
  return {
    showScene: messageCount % 3 === 0, showWorkingMemory: true,
    showEntityProfile: false, showActiveContext: true, showEntityGraph: false,
    showMomentum: false, showExtras: messageCount % 5 === 0,
    showSerendipity: false,
  };
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

function normalizeProfileHint(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSessionProfileHints(sessionId?: string): {
  activatedNodes: Node[];
  activatedNodeIds: Set<string>;
  entityHints: Set<string>;
} {
  if (!sessionId) {
    return {
      activatedNodes: [],
      activatedNodeIds: new Set<string>(),
      entityHints: new Set<string>(),
    };
  }

  const activatedNodes = getActivatedNodes(40, sessionId);
  const activatedNodeIds = new Set<string>(activatedNodes.map(node => node.id));
  const entityHints = new Set<string>(
    activatedNodes
      .filter(node => node.type === 'entity')
      .map(node => normalizeProfileHint(node.content)),
  );

  const workingMemory = getWorkingMemory(sessionId);
  if (workingMemory?.current_topic) {
    entityHints.add(normalizeProfileHint(workingMemory.current_topic));
  }
  for (const entityName of Object.keys(workingMemory?.active_entities || {})) {
    entityHints.add(normalizeProfileHint(entityName));
  }

  return { activatedNodes, activatedNodeIds, entityHints };
}

function isSessionRelevantProfileNode(
  node: Node,
  sessionTopic?: string,
  activatedNodeIds = new Set<string>(),
  entityHints = new Set<string>(),
): boolean {
  if (!sessionTopic && activatedNodeIds.size === 0 && entityHints.size === 0) {
    return true;
  }

  if (activatedNodeIds.has(node.id)) return true;
  if (entityHints.has(normalizeProfileHint(node.content))) return true;
  if (sessionTopic && isTopicRelevant(node, sessionTopic)) return true;
  return false;
}

function isNodeFromSession(node: Node, sessionId?: string, prefixes: string[] = []): boolean {
  if (!sessionId) return false;
  return prefixes.some(prefix => node.source === `${prefix}:${sessionId}`);
}

function getSessionScopedNodes<T extends Node>(
  nodes: T[],
  sessionId?: string,
  sessionTopic?: string,
  sourcePrefixes: string[] = [],
): T[] {
  if (!sessionId) return nodes;

  const { activatedNodeIds, entityHints } = getSessionProfileHints(sessionId);
  return nodes.filter(node =>
    isNodeFromSession(node, sessionId, sourcePrefixes) ||
    isSessionRelevantProfileNode(node, sessionTopic, activatedNodeIds, entityHints),
  );
}

function buildEntityProfileSlot(
  budget: number,
  empathyMode?: string,
  sessionTopic?: string,
  sessionId?: string,
): string {
  const entities = getAllEntities(50);
  const { activatedNodes, activatedNodeIds, entityHints } = getSessionProfileHints(sessionId);

  if (entities.length === 0) {
    return buildLegacyCoreSlot(budget, sessionTopic, sessionId);
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
      if (!isSessionRelevantProfileNode(target, sessionTopic, activatedNodeIds, entityHints)) continue;

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
    return buildLegacyCoreSlot(budget, sessionTopic, sessionId);
  }

  // Orphan facts: high-importance facts not covered by entity relations
  const entityNames = new Set(entities.map(e => e.content.toLowerCase()));
  const PLACEHOLDER_NAMES = new Set([
    'User Identity', 'Communication Style', 'Current Project',
    'Tech Stack', 'Workflow', 'Pain Points', 'Goals', 'Expertise Map',
  ]);

  const orphanCandidates = sessionId
    ? activatedNodes.filter(node => ['fact', 'preference', 'decision'].includes(node.type))
    : [
        ...getNodes({ type: 'fact', minImportance: 0.6, limit: 5 }),
        ...getNodes({ type: 'preference', minImportance: 0.6, limit: 5 }),
        ...getNodes({ type: 'decision', minImportance: 0.6, limit: 3 }),
      ];

  const orphanNodes = orphanCandidates.filter(n =>
    !PLACEHOLDER_NAMES.has(n.content) &&
    isDisplayWorthy(n) &&
    !entityNames.has(n.content.toLowerCase()) &&
    ![...entityNames].some(name => n.content.toLowerCase().includes(name)) &&
    isSessionRelevantProfileNode(n, sessionTopic, activatedNodeIds, entityHints)
  );

  for (const node of orphanNodes.slice(0, 3)) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  // M27: Approach/Avoidance — show entities with strong emotional valence
  const entitiesWithValence = entities.filter(e => {
    if (!isSessionRelevantProfileNode(e, sessionTopic, activatedNodeIds, entityHints)) return false;
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

function buildLegacyCoreSlot(budget: number, sessionTopic?: string, sessionId?: string): string {
  if (sessionId) {
    const { activatedNodes, activatedNodeIds, entityHints } = getSessionProfileHints(sessionId);
    const sessionMeaningful = activatedNodes.filter(node =>
      ['core', 'fact', 'preference', 'identity', 'project', 'decision'].includes(node.type) &&
      isDisplayWorthy(node) &&
      isSessionRelevantProfileNode(node, sessionTopic, activatedNodeIds, entityHints),
    );

    if (sessionMeaningful.length === 0) return '';

    let sessionText = '## Ueber den User\n';
    for (const node of sessionMeaningful.slice(0, 4)) {
      const line = `- ${node.content}\n`;
      if (estimateTokens(sessionText + line) > budget) break;
      sessionText += line;
    }

    if (sessionText === '## Ueber den User\n') return '';
    return truncateToTokens(sessionText, budget);
  }

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
let _sessionMessageVec: Float32Array | null = null;

export function setSessionTopicEmbedding(vector: Float32Array | null): void {
  _sessionTopicVec = vector;
}

export function setSessionMessageEmbedding(vector: Float32Array | null): void {
  _sessionMessageVec = vector;
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
function buildSceneSlot(
  budget: number,
  topic?: string,
  mood?: string,
  taskMode?: string,
  sessionId?: string,
  contextSignal?: { isDeepSession?: boolean; isNewSession?: boolean } | null,
): string {
  const topicStr = topic || 'allgemeines Gespraech';
  const sessionHints = getSessionProfileHints(sessionId);
  const workingMemory = sessionId ? getWorkingMemory(sessionId) : null;

  let sceneAnchor = 'User';
  if (sessionId) {
    const personEntity = sessionHints.activatedNodes.find(node => {
      if (node.type !== 'entity' || !node.metadata) return false;
      try {
        const meta = JSON.parse(node.metadata) as NodeMetadata;
        return meta.entity_type === 'person';
      } catch {
        return false;
      }
    });
    const activeEntity = personEntity || sessionHints.activatedNodes.find(node => node.type === 'entity');
    sceneAnchor = activeEntity?.content || workingMemory?.current_topic || topicStr || 'User';
  } else {
    const db = getDb();
    const nameNode = db.prepare(
      "SELECT content FROM nodes WHERE type = 'entity' AND importance > 0.5 ORDER BY activation_count DESC LIMIT 1"
    ).get() as { content: string } | undefined;
    sceneAnchor = nameNode?.content || 'User';
  }

  const moodLabel: Record<string, string> = {
    frustrated: 'frustriert', excited: 'motiviert', neutral: 'fokussiert',
    confused: 'unsicher', satisfied: 'zufrieden',
  };
  const moodStr = moodLabel[mood || 'neutral'] || 'fokussiert';

  let timeStr = '';
  const signal = contextSignal ?? null;
  if (signal?.isDeepSession) timeStr = ', tiefe Session';
  else if (signal?.isNewSession) timeStr = ', Session-Start';

  const sameAnchor = normalizeProfileHint(sceneAnchor) === normalizeProfileHint(topicStr);
  const headerLine = sameAnchor
    ? `${topicStr} (${moodStr}${timeStr})`
    : `${sceneAnchor} — ${topicStr} (${moodStr}${timeStr})`;

  return truncateToTokens(`## Situation\n${headerLine}\n`, budget);
}

function buildWorkingMemorySlot(budget: number, sessionId?: string): string {
  if (!sessionId) return '';

  const memory = getWorkingMemory(sessionId);
  if (!memory) return '';

  const lines: string[] = [];
  const summary = sanitizeWorkingMemorySummary(memory.conversation_summary);
  const displayReference = getDisplayWorkingMemoryReference(memory.references, memory.current_topic);

  if (summary) {
    lines.push(summary);
  }

  if (memory.degraded_semantic) {
    lines.push('Semantik aktuell degradiert');
  }

  if (displayReference) {
    lines.push(`Aktiver Verweis: ${displayReference}`);
  }

  if (memory.context_stack.length > 0) {
    lines.push(`Kontext: ${memory.context_stack.slice(0, 4).join(' -> ')}`);
  }

  if (memory.open_questions.length > 0) {
    lines.push(`Offen: ${memory.open_questions.slice(0, 2).join(' | ')}`);
  }

  if (lines.length === 0) return '';

  let text = '## Arbeitsgedaechtnis\n';
  for (const line of lines) {
    const nextLine = `- ${line}\n`;
    if (estimateTokens(text + nextLine) > budget) break;
    text += nextLine;
  }

  if (text === '## Arbeitsgedaechtnis\n') return '';
  return truncateToTokens(text, budget);
}

function sanitizeWorkingMemorySummary(summary: string | undefined): string {
  const normalized = (summary || '').trim();
  if (!normalized) return '';

  const filteredParts = normalized
    .split('.')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part =>
      part !== 'Semantik aktuell degradiert' &&
      !part.startsWith('Verweis aktiv:') &&
      !part.startsWith('Aktiver Verweis:')
    );

  if (filteredParts.length === 0) return '';
  return `${filteredParts.join('. ')}.`;
}

function getDisplayWorkingMemoryReference(
  references: string[] | undefined,
  currentTopic?: string,
): string | undefined {
  const normalizedTopic = normalizeWorkingMemoryReference(currentTopic || '');

  for (const reference of references || []) {
    const normalized = normalizeWorkingMemoryReference(reference);
    if (!normalized) continue;
    if (normalizedTopic && normalized === normalizedTopic) continue;
    if (NON_DISPLAY_WORKING_MEMORY_REFERENCES.has(normalized)) continue;
    if (NON_DISPLAY_WORKING_MEMORY_REFERENCE_PHRASES.has(normalized)) continue;

    const tokens = normalized.split(/\s+/).filter(Boolean);
    const informativeTokens = tokens.filter(token => !NON_DISPLAY_WORKING_MEMORY_REFERENCES.has(token));
    const isDisplayWorthy = tokens.length > 1
      ? informativeTokens.some(token => token.length > 2)
      : normalized.length >= 5;

    if (!isDisplayWorthy) continue;
    return formatWorkingMemoryReference(reference);
  }

  return undefined;
}

function normalizeWorkingMemoryReference(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function formatWorkingMemoryReference(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_WORKING_MEMORY_REFERENCE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_WORKING_MEMORY_REFERENCE_LENGTH - 3).trimEnd()}...`;
}

function getContextEffectivenessScore(
  node: Node,
  sessionFeedback = new Map<string, SessionContextFeedbackEntry>(),
): number {
  let globalScore = 0.5;
  try {
    const meta = node.metadata ? JSON.parse(node.metadata) as Record<string, unknown> : {};
    const pos = (meta.context_positive as number) || 0;
    const neg = (meta.context_negative as number) || 0;
    if (pos + neg > 0) {
      globalScore = (pos + 1) / (pos + neg + 2);
    }
  } catch {
    globalScore = 0.5;
  }

  const sessionEntry = sessionFeedback.get(node.id);
  if (!sessionEntry) return globalScore;

  const sessionTotal = sessionEntry.positive + sessionEntry.negative;
  if (sessionTotal === 0) return globalScore;

  const sessionScore = (sessionEntry.positive + 1) / (sessionTotal + 2);
  return Math.max(0.05, Math.min(0.95, globalScore * 0.35 + sessionScore * 0.65));
}

function buildActiveContextSlot(budget: number, sessionTopic?: string, mood?: string, salience?: string, sessionId?: string): string {
  // 22.3: Speed-Accuracy Tradeoff — dynamische Node-Limits
  const tradeoffs = getTradeoffState();
  const nodeLimit = Math.round(15 + (1 - tradeoffs.speed_accuracy) * 25);
  const minActivation = 0.02 + tradeoffs.speed_accuracy * 0.08;

  const activated = getActivatedNodes(nodeLimit, sessionId);
  const semanticCandidates = getSemanticCandidateNodes(nodeLimit);

  const candidateMap = new Map<string, Node>();
  for (const node of activated) candidateMap.set(node.id, node);
  for (const node of semanticCandidates) {
    if (!candidateMap.has(node.id)) candidateMap.set(node.id, node);
  }

  let nodes = Array.from(candidateMap.values()).filter(n =>
    n.activation >= minActivation || getSemanticRelevanceScore(n) > 0.2
  );
  if (nodes.length === 0) {
    nodes = Array.from(candidateMap.values());
  }
  if (nodes.length === 0) {
    nodes = getNodes({ minImportance: 0.6, limit: 15 });
  }

  if (nodes.length === 0) return '';

  const outputHistory = getContextOutputHistory(sessionId);
  const sessionFeedback = getSessionContextFeedbackScores(sessionId);
  const sortByContextScore = (items: Node[]): Node[] =>
    [...items].sort((a, b) =>
      getActiveContextNodeScore(b, outputHistory, mood, sessionFeedback) -
      getActiveContextNodeScore(a, outputHistory, mood, sessionFeedback),
    );

  if (sessionTopic) {
    const relevant = nodes.filter(n => isTopicRelevant(n, sessionTopic));
    const irrelevant = nodes.filter(n => !isTopicRelevant(n, sessionTopic));
    nodes = sortByContextScore(relevant);
    // Fallback: wenn topic-relevant zu wenig (<3), Top irrelevant dazunehmen
    if (nodes.length < 3) {
      nodes = [...nodes, ...sortByContextScore(irrelevant).slice(0, 3 - nodes.length)];
    }
  } else {
    nodes = sortByContextScore(nodes);
  }

  if (nodes.length === 0) return '';

  let text = '## Aktiver Kontext\n';
  const seen = new Set<string>();
  const trackedBulletNodeIds = new Set<string>();
  const trackDisplayedNodes = (...nodeIds: string[]): void => {
    for (const nodeId of nodeIds) {
      if (trackedBulletNodeIds.size >= 3) break;
      if (trackedBulletNodeIds.has(nodeId)) continue;
      trackedBulletNodeIds.add(nodeId);
      contextNodeIds.add(nodeId);
    }
  };

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

  const entityAssociated = new Map<string, Node[]>();
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
        existing.push(node);
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
    trackDisplayedNodes(entity.id);

    const associated = entityAssociated.get(entity.content);
    if (associated) {
      for (const fact of associated.slice(0, 2)) {
        const subLine = `  - ${fact.content}\n`;
        if (estimateTokens(text + subLine) > budget) break;
        text += subLine;
        trackDisplayedNodes(fact.id);
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
    trackDisplayedNodes(...nonEntityChunkNodes.filter(n => isDisplayWorthy(n)).map(n => n.id));
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
    trackDisplayedNodes(node.id);
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

function buildEntityGraphSlot(budget: number, topic?: string, sessionId?: string): string {
  if (!topic) return '';

  const topicEntity = findEntityByName(topic);

  if (!topicEntity) {
    return buildLegacyWarmSlot(budget, topic, sessionId);
  }

  const edges = getEdgesForNode(topicEntity.id);
  if (edges.length === 0) return '';

  let text = `## Zum Thema: ${topicEntity.content}\n`;
  const outputHistory = getContextOutputHistory(sessionId);
  const sessionFeedback = getSessionContextFeedbackScores(sessionId);
  const trackedGraphNodeIds = new Set<string>();
  const trackDisplayedGraphNodes = (...nodeIds: string[]): void => {
    for (const nodeId of nodeIds) {
      if (trackedGraphNodeIds.size >= 3) break;
      if (trackedGraphNodeIds.has(nodeId)) continue;
      trackedGraphNodeIds.add(nodeId);
      contextNodeIds.add(nodeId);
    }
  };

  // 1-hop neighbors sorted by strength
  const neighbors: Array<{ node: Node; edge: typeof edges[0] }> = [];
  for (const edge of edges) {
    const otherId = edge.source_id === topicEntity.id ? edge.target_id : edge.source_id;
    const other = getNode(otherId);
    if (other) neighbors.push({ node: other, edge });
  }

  neighbors.sort((a, b) => {
    const scoreA = a.edge.strength
      * getContextRepeatPenalty(a.node, outputHistory)
      * getContextFeedbackMultiplier(a.node, sessionFeedback);
    const scoreB = b.edge.strength
      * getContextRepeatPenalty(b.node, outputHistory)
      * getContextFeedbackMultiplier(b.node, sessionFeedback);
    return scoreB - scoreA;
  });

  const shownIds = new Set<string>([topicEntity.id]);

  for (const { node, edge } of neighbors) {
    const relLabel = RELATION_LABELS[edge.type] || edge.type;
    const strengthStr = edge.strength >= 0.5 ? ` (${edge.strength.toFixed(1)})` : '';
    const line = `- ${topicEntity.content} → ${relLabel} → ${node.content}${strengthStr}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
    shownIds.add(node.id);
    trackDisplayedGraphNodes(topicEntity.id, node.id);
  }

  // 2-hop for strong entity connections
  const strongNeighbors = neighbors.filter(n => n.edge.strength > 0.6 && n.node.type === 'entity');
  for (const { node: neighbor } of strongNeighbors.slice(0, 3)) {
    const hop2Edges = getEdgesForNode(neighbor.id);
    const rankedHop2 = hop2Edges
      .map(edge2 => {
        const otherId = edge2.source_id === neighbor.id ? edge2.target_id : edge2.source_id;
        const other = getNode(otherId);
        return { edge2, otherId, other };
      })
      .filter((entry): entry is { edge2: typeof hop2Edges[number]; otherId: string; other: Node } =>
        Boolean(entry.other && entry.other.type === 'entity'),
      )
      .sort((a, b) => {
        const scoreA = a.edge2.strength
          * getContextRepeatPenalty(a.other, outputHistory)
          * getContextFeedbackMultiplier(a.other, sessionFeedback);
        const scoreB = b.edge2.strength
          * getContextRepeatPenalty(b.other, outputHistory)
          * getContextFeedbackMultiplier(b.other, sessionFeedback);
        return scoreB - scoreA;
      });

    for (const { edge2, otherId, other } of rankedHop2) {
      if (shownIds.has(otherId)) continue;

      const relLabel = RELATION_LABELS[edge2.type] || edge2.type;
      const line = `  - ${neighbor.content} → ${relLabel} → ${other.content}\n`;
      if (estimateTokens(text + line) > budget) break;
      text += line;
      shownIds.add(otherId);
      trackDisplayedGraphNodes(neighbor.id, other.id);
    }
  }

  // Topic-related facts (not entity→entity, but mentioning the topic)
  const topicNameLower = topicEntity.content.toLowerCase();
  const topicFacts = getNodes({ minImportance: 0.5, limit: 10 })
    .filter(n => n.type !== 'entity' && n.type !== 'core' &&
      n.content.toLowerCase().includes(topicNameLower) &&
      isDisplayWorthy(n))
    .sort((a, b) => {
      const scoreA = a.importance
        * getContextRepeatPenalty(a, outputHistory)
        * getContextFeedbackMultiplier(a, sessionFeedback);
      const scoreB = b.importance
        * getContextRepeatPenalty(b, outputHistory)
        * getContextFeedbackMultiplier(b, sessionFeedback);
      return scoreB - scoreA;
    });

  for (const fact of topicFacts.slice(0, 3)) {
    const line = `- ${fact.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
    trackDisplayedGraphNodes(fact.id);
  }

  if (text === `## Zum Thema: ${topicEntity.content}\n`) return '';
  return truncateToTokens(text, budget);
}

function buildLegacyWarmSlot(budget: number, topic: string, sessionId?: string): string {
  const activated = getActivatedNodes(20, sessionId);
  const outputHistory = getContextOutputHistory(sessionId);
  const sessionFeedback = getSessionContextFeedbackScores(sessionId);
  const relevant = activated
    .filter(n => {
      const content = n.content.toLowerCase();
      return content.includes(topic.toLowerCase());
    })
    .sort((a, b) => {
      const scoreA = (a.activation || a.importance)
        * getContextRepeatPenalty(a, outputHistory)
        * getContextFeedbackMultiplier(a, sessionFeedback);
      const scoreB = (b.activation || b.importance)
        * getContextRepeatPenalty(b, outputHistory)
        * getContextFeedbackMultiplier(b, sessionFeedback);
      return scoreB - scoreA;
    });

  if (relevant.length === 0) return '';

  let text = `## Zum Thema: ${topic}\n`;
  const trackedWarmNodeIds = new Set<string>();
  for (const node of relevant) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
    if (trackedWarmNodeIds.size < 3 && !trackedWarmNodeIds.has(node.id)) {
      trackedWarmNodeIds.add(node.id);
      contextNodeIds.add(node.id);
    }
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

function buildProspectionSlot(budget: number, currentTopic?: string, sessionId?: string, readOnly = false): string {
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

    // Pre-activate expected-next nodes only in the local session overlay.
    if (!readOnly && sessionId) {
      const expectedNext = sorted[0][0];
      const relatedNodes = db.prepare(
        "SELECT id FROM nodes WHERE content LIKE ? LIMIT 5"
      ).all(`%${expectedNext.split(' ')[0]}%`) as Array<{ id: string }>;
      for (const node of relatedNodes) {
        const currentActivation = getSessionActivationValue(node.id, sessionId);
        if (currentActivation < 0.05) {
          setSessionActivationValue(node.id, sessionId, 0.05);
        }
      }
    }
  }

  if (parts.length === 0) return '';

  return truncateToTokens(`## Antizipation\n- ${parts.join('\n- ')}\n`, budget);
}

// ── Task Reminder (unchanged) ───────────────────────────────

function buildTaskReminderSlot(budget: number, sessionId?: string): string {
  const tasks = getOpenTasks(sessionId);
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

function shouldShowLocalTaskReminder(sessionId: string | undefined, taskMode?: string): boolean {
  if (!sessionId) return false;
  if (taskMode === 'chatting') return false;
  return getOpenTasks(sessionId).length > 0;
}

// ── Ghost Context (unchanged) ───────────────────────────────

function buildGhostContextSlot(
  budget: number,
  currentTopic: string | undefined,
  topicExpertise: number,
  sessionPhase: SessionPhaseBudgetProfile['phase'],
): string {
  if (!currentTopic) return '';
  const hasStrongExpertiseSignal = topicExpertise < 0.4 || topicExpertise > 0.7;
  if (!hasStrongExpertiseSignal) {
    return '';
  }

  if (sessionPhase === 'bootstrap' && topicExpertise > 0.7) {
    return '';
  }

  const ghost = buildGhostContext(currentTopic, topicExpertise);
  if (!ghost) return '';

  let text = `## Expertise-Hinweis\n- ${ghost}\n`;

  // M33: Metacognition — show open knowledge gaps for this topic
  if (sessionPhase !== 'deep') {
    return truncateToTokens(text, budget);
  }

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

function buildFailureWarningSlot(budget: number, topic: string, sessionId?: string): string {
  const failures = getRelevantFailures(topic, sessionId);
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

function getActiveContradictions(sessionId?: string, minActivation = 0.1): Array<{ src: string; tgt: string; score: number }> {
  const activeNodes = getActivatedNodes(20, sessionId).filter(node => node.activation >= minActivation);
  if (activeNodes.length === 0) return [];

  const contradictions = new Map<string, { src: string; tgt: string; score: number }>();
  const activeMap = new Map(activeNodes.map(node => [node.id, node]));

  for (const node of activeNodes) {
    const edges = getEdgesForNode(node.id);
    for (const edge of edges) {
      if (edge.type !== 'contradicts') continue;

      const otherId = edge.source_id === node.id ? edge.target_id : edge.source_id;
      const other = activeMap.get(otherId) ?? getNode(otherId);
      if (!other) continue;

      const score = Math.max(node.activation || 0, other.activation || 0, edge.strength || 0);
      const key = [node.id, other.id].sort().join('::');
      const src = node.content;
      const tgt = other.content;
      const existing = contradictions.get(key);
      if (!existing || score > existing.score) {
        contradictions.set(key, { src, tgt, score });
      }
    }
  }

  return [...contradictions.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function buildConflictSlot(budget: number, sessionId?: string): string {
  const contradictions = getActiveContradictions(sessionId, 0.1);

  if (contradictions.length === 0) return '';

  let text = '## Hinweis: Widersprueche\n';
  for (const c of contradictions.slice(0, 3)) {
    const line = `- "${c.src}" vs "${c.tgt}"\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }
  return truncateToTokens(text, budget);
}

// ── 25.2: Counter-Evidence — aktive Gegensuche ──────────────

function buildCounterEvidenceSlot(budget: number, sessionId?: string): string {
  if (budget < 20) return '';
  const topNodes = getActivatedNodes(10, sessionId)
    .filter(node => node.activation > 0.3)
    .slice(0, 5);

  if (topNodes.length === 0) return '';

  const counterEvidence = new Set<string>();
  for (const node of topNodes) {
    const edges = getEdgesForNode(node.id);
    for (const edge of edges) {
      if (edge.type !== 'contradicts') continue;
      const otherId = edge.source_id === node.id ? edge.target_id : edge.source_id;
      const other = getNode(otherId);
      if (!other || other.confidence < 0.3) continue;
      counterEvidence.add(other.content);
      if (counterEvidence.size >= 4) break;
    }
    if (counterEvidence.size >= 4) break;
  }

  if (counterEvidence.size === 0) return '';

  return truncateToTokens(
    `## Aber beachte\n${[...counterEvidence].slice(0, 2).map(c => `- ${c}`).join('\n')}\n`,
    budget
  );
}

// ── Meta Insight (unchanged) ────────────────────────────────

function getSessionFokSignal(sessionId?: string): { topic?: string; has_fragments?: boolean; weakly_activated?: number } | null {
  try {
    const db = getDb();
    if (sessionId) {
      const sessionRow = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(`fok_signal_${sessionId}`) as { value: string } | undefined;
      if (!sessionRow) return null;
      return JSON.parse(sessionRow.value) as { topic?: string; has_fragments?: boolean; weakly_activated?: number };
    }

    const row = db.prepare("SELECT value FROM system_state WHERE key = 'fok_signal'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as { topic?: string; has_fragments?: boolean; weakly_activated?: number };
  } catch {
    return null;
  }
}

function isFokRelevantToTopic(
  fok: { topic?: string; has_fragments?: boolean; weakly_activated?: number } | null,
  currentTopic?: string,
): boolean {
  if (!fok?.has_fragments) return false;
  if (!currentTopic) return true;

  const fokTopic = normalizeProfileHint(fok.topic || '');
  const normalizedTopic = normalizeProfileHint(currentTopic);
  if (!fokTopic || !normalizedTopic) return true;
  return fokTopic.includes(normalizedTopic) || normalizedTopic.includes(fokTopic);
}

function buildMetaInsightSlot(
  budget: number,
  topicExpertise?: number,
  empathyMode?: string,
  taskMode?: string,
  sessionId?: string,
  currentTopic?: string,
  sessionPhase: SessionPhaseBudgetProfile['phase'] = 'active',
): string {
  const profile = getMetaProfile();

  const lines: string[] = [];
  const allowGlobalUserMeta = sessionPhase !== 'bootstrap';
  const allowGlobalSystemMeta = sessionPhase === 'deep';

  // 13.2: Empathy-based hint (first, most important)
  if (empathyMode === 'affective') {
    lines.push('User kaempft emotional. Zeige Verstaendnis, betone Staerken und Fortschritte.');
  } else if (empathyMode === 'cognitive') {
    lines.push('User hat ein konkretes Problem. Fokus auf Loesung und technische Details.');
  }

  if (allowGlobalUserMeta && profile.dominant_type !== 'unknown') {
    const hints: Record<string, string> = {
      pointer: 'User ist ein "Zeiger" - beobachte Verhalten statt auf Erklaerungen zu warten',
      explicit: 'User erklaert Praeferenzen direkt - achte auf explizite Anweisungen',
      corrector: 'User korrigiert oft - tracke Korrekturen als negative Signale',
    };
    const hint = hints[profile.dominant_type];
    if (hint) lines.push(hint);
  }

  const lp = profile.learning_profile;
  if (allowGlobalUserMeta && lp && profile.total_messages_analyzed >= 20) {
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
  const fok = getSessionFokSignal(sessionId);
  if (isFokRelevantToTopic(fok, currentTopic)) {
    lines.push(`Zu "${fok?.topic}" hat das System fragmentarische Erinnerungen (${fok?.weakly_activated || 0} Bruchstuecke). Details wuerden helfen.`);
  }

  // 15.4: Self-Model summary
  if (allowGlobalSystemMeta) {
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
  }

  // 18.2: Entwicklungsphase im Context
  if (allowGlobalSystemMeta) {
    const devPhase = getDevelopmentPhase();
    const phaseNames: Record<string, string> = {
      infant: 'Saeuglings-Phase (alles aufnehmen)',
      child: 'Kind-Phase (schnell lernen)',
      teen: 'Teenager-Phase (spezialisieren)',
      adult: 'Erwachsenen-Phase (stabil + selektiv)',
      wise: 'Weise-Phase (tiefes Wissensnetz)',
    };
    lines.push(`Entwicklungsphase: ${phaseNames[devPhase.phase]} (Session ${devPhase.session_count}).`);
  }

  // 17.3: DMN — kreative Verbindungen seit letzter Nachricht
  if (allowGlobalSystemMeta) {
    try {
      const dmnRow = getDb().prepare(
        "SELECT COUNT(*) as c FROM edges WHERE type = 'inferred' AND created_at > ?"
      ).get(Date.now() - 30 * 60 * 1000) as { c: number };
      if (dmnRow.c > 0) {
        lines.push(`System hat ${dmnRow.c} neue Verbindungen im Hintergrund entdeckt.`);
      }
    } catch {}
  }

  // 17.4: System-Mood im Context
  if (allowGlobalSystemMeta) {
    const sysMoodMeta = getSystemMood();
    if (sysMoodMeta.energy < 0.3) {
      lines.push('System-Energie niedrig. Fokus auf Wesentliches.');
    } else if (sysMoodMeta.curiosity > 0.7) {
      lines.push('System ist neugierig — bereit fuer neue Themen.');
    }
  }

  // 19.4: Meta-Calibration hint
  if (allowGlobalSystemMeta) {
    try {
      const cal = calibrateConfidence();
      if (cal.direction === 'down') {
        lines.push('System-Kalibration: Confidence wird korrigiert (overconfident). Fakten mit Vorsicht.');
      } else if (cal.direction === 'up') {
        lines.push('System-Kalibration: Wissen ist zuverlaessig (gut kalibriert).');
      }
    } catch { /* non-fatal */ }
  }

  if (lines.length === 0) return '';

  let text = '## Lernhinweis\n';
  for (const line of lines) {
    text += `- ${line}\n`;
  }
  return truncateToTokens(text, budget);
}

// ── Episodes (unchanged) ────────────────────────────────────

function buildEpisodeSlot(budget: number, topic?: string, sessionId?: string): string {
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

  if (sessionId) {
    const scoped = getSessionScopedNodes(relevant, sessionId, topic, ['episode']);
    if (scoped.length === 0) return '';
    relevant = scoped;
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

function buildExamplesSlot(budget: number, topic?: string, sessionId?: string): string {
  if (!topic) return '';

  const db = getDb();
  const examples = db.prepare(`
    SELECT * FROM nodes WHERE type = 'example'
    ORDER BY importance DESC, last_activated DESC LIMIT 20
  `).all() as Node[];

  if (examples.length === 0) return '';

  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);

  let relevant = examples.filter(ex => {
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

  if (sessionId) {
    const scoped = getSessionScopedNodes(relevant, sessionId, topic, ['code']);
    if (scoped.length === 0) return '';
    relevant = scoped.sort((a, b) => {
      const aFromSession = isNodeFromSession(a, sessionId, ['code']) ? 1 : 0;
      const bFromSession = isNodeFromSession(b, sessionId, ['code']) ? 1 : 0;
      if (bFromSession !== aFromSession) return bFromSession - aFromSession;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return b.last_activated - a.last_activated;
    });
  }

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

function buildTipOfTongueSlot(budget: number, sessionTopic?: string, sessionId?: string): string {
  const weakNodes = sessionId
    ? getActivatedNodes(20, sessionId)
        .filter(node =>
          node.activation >= 0.02 &&
          node.activation <= 0.15 &&
          ['entity', 'fact', 'preference', 'decision', 'project'].includes(node.type) &&
          node.importance >= 0.5,
        )
        .slice(0, 5)
    : (() => {
        const db = getDb();
        return db.prepare(`
          SELECT * FROM nodes
          WHERE activation BETWEEN 0.02 AND 0.15
          AND type IN ('entity', 'fact', 'preference', 'decision', 'project')
          AND importance >= 0.5
          ORDER BY activation DESC LIMIT 5
        `).all() as Node[];
      })();

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

function buildBackgroundThoughtsSlot(budget: number, primaryNodes: Node[], sessionId?: string): string {
  const primaryIds = new Set(primaryNodes.map(n => n.id));

  const backgroundNodes = sessionId
    ? getActivatedNodes(30, sessionId)
        .filter(node =>
          node.activation >= 0.05 &&
          node.activation <= 0.2 &&
          node.importance > 0.3 &&
          ['entity', 'fact', 'preference'].includes(node.type),
        )
        .slice(0, 5)
    : (() => {
        const db = getDb();
        return db.prepare(`
          SELECT * FROM nodes
          WHERE activation BETWEEN 0.05 AND 0.2
            AND importance > 0.3
            AND type IN ('entity', 'fact', 'preference')
          ORDER BY activation DESC LIMIT 5
        `).all() as Node[];
      })();

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
  sessionId?: string,
  readOnly = false,
): string {
  // 11.5: Clear tracked node IDs for this context generation
  contextNodeIds.clear();

  // M24: Burst mode → upgrade LIGHT to STANDARD (more context when signal is strong)
  const effectiveMode = (thalamicMode === 'burst' && mode === 'LIGHT') ? 'STANDARD' : mode;
  _currentMode = effectiveMode;
  const budget = { ...BUDGETS[effectiveMode] };
  const runtimeState = sessionId ? {
    mood: getSessionMood(sessionId),
    taskMode: getSessionTaskMode(sessionId),
    empathyMode: getSessionEmpathyMode(sessionId),
    attentionState: getSessionAttentionState(sessionId),
    contextSignal: getSessionContextSignal(sessionId),
  } : {
    mood: getSessionMood(),
    taskMode: getSessionTaskMode(),
    empathyMode: getSessionEmpathyMode(),
    attentionState: getSessionAttentionState(),
    contextSignal: getSessionContextSignal(),
  };
  const effectiveCurrentMood = currentMood ?? runtimeState.mood;
  const effectiveTaskMode = taskMode ?? runtimeState.taskMode ?? undefined;
  const effectiveEmpathyMode = runtimeState.empathyMode;
  const effectiveAttentionState = runtimeState.attentionState;
  const effectiveContextSignal = runtimeState.contextSignal;
  const sessionWorkingMemory = sessionId ? getWorkingMemory(sessionId) : null;
  const sessionPhaseProfile = getSessionPhaseBudgetProfile(sessionId, effectiveContextSignal, sessionWorkingMemory);

  // 13.1: User Model — expertise-based budget adjustment
  const userModel = buildUserModel(sessionId);
  const topicExpertise = getTopicExpertise(userModel, currentTopic);

  if (topicExpertise > 0.7) {
    budget.entityProfile = Math.round(budget.entityProfile * 0.6);
    budget.activeContext = Math.round(budget.activeContext * 1.2);
  } else if (topicExpertise < 0.3) {
    budget.entityProfile = Math.round(budget.entityProfile * 1.3);
  }

  // 13.2: Empathy Mode — adjust budgets based on emotional state
  if (effectiveEmpathyMode === 'affective') {
    budget.entityProfile = Math.round(budget.entityProfile * 1.4);
    budget.serendipity = 0;
  }

  // 13.3: Task-Set — mode-specific budget adjustment
  switch (effectiveTaskMode) {
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
  if (effectiveAttentionState) {
    const executiveLevel = effectiveAttentionState.executive || 0.5;
    if (executiveLevel > 0.7) {
      budget.extras = Math.round(budget.extras * 1.4);
      budget.entityGraph = Math.round(budget.entityGraph * 1.2);
    }
    if (executiveLevel < 0.3) {
      budget.extras = Math.round(budget.extras * 0.5);
      budget.serendipity = Math.round(budget.serendipity * 0.3);
    }
  }

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
  const stressLevel = getStressLevel(sessionId);
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
    const profile = readOnly ? peekProviderProfile(provider) : getProviderProfile(provider);
    contextStyle = profile.context_style;
    maxChunks = profile.max_chunks;

    const m = profile.budget_multiplier;
    budget.entityProfile = Math.round(budget.entityProfile * m);
    budget.activeContext = Math.round(budget.activeContext * m);
    budget.sessionMomentum = Math.round(budget.sessionMomentum * m);
    budget.extras = Math.round(budget.extras * m);
    budget.entityGraph = Math.round(budget.entityGraph * m);
    budget.serendipity = Math.round(budget.serendipity * m);

    if (!readOnly) {
      recordContextDelivery(provider);
    }
  }

  applySessionPhaseBudgetProfile(budget, sessionPhaseProfile, sessionWorkingMemory);

  // 14.4: Identity always passes — minimum entityProfile budget
  budget.entityProfile = Math.max(sessionPhaseProfile.minimumEntityProfileBudget, budget.entityProfile);

  const workingMemoryBudget = sessionId
    ? Math.max(
        sessionPhaseProfile.workingMemoryMin,
        Math.min(sessionPhaseProfile.workingMemoryMax, Math.round(budget.activeContext * sessionPhaseProfile.workingMemoryShare)),
      )
    : 0;
  if (workingMemoryBudget > 0) {
    budget.activeContext = Math.max(0, budget.activeContext - workingMemoryBudget);
  }

  // V5-3: Dynamic Slot Decision — WM-driven context assembly
  const wmMessageCount = sessionWorkingMemory?.message_count ?? 0;
  const wmTopicHistory = sessionWorkingMemory?.topic_history ?? [];
  const hasTopicChange = wmTopicHistory.length > 0
    ? wmTopicHistory[wmTopicHistory.length - 1] !== (sessionWorkingMemory?.current_topic || '')
    : false;

  const slots = decideContextSlots(
    sessionPhaseProfile.phase,
    wmMessageCount,
    hasTopicChange,
    effectiveCurrentMood,
    effectiveTaskMode,
    (sessionWorkingMemory?.open_questions.length ?? 0) > 0,
  );

  const sections: string[] = [];

  // Scene — kompakter Situations-Header
  if (slots.showScene) {
    const scene = buildSceneSlot(100, currentTopic, effectiveCurrentMood, effectiveTaskMode, sessionId, effectiveContextSignal);
    if (scene) sections.push(scene);
  }

  // Working Memory
  if (slots.showWorkingMemory) {
    const workingMemory = buildWorkingMemorySlot(workingMemoryBudget, sessionId);
    if (workingMemory) sections.push(workingMemory);
  }

  // Task Reminder — eigene Logik, unabhaengig von Slot-Decision
  const localTaskReminderBudget = Math.max(120, budget.sessionMomentum);
  const shouldShowTasksEarly = shouldShowLocalTaskReminder(sessionId, effectiveTaskMode);
  if (shouldShowTasksEarly) {
    const taskReminder = buildTaskReminderSlot(localTaskReminderBudget, sessionId);
    if (taskReminder) sections.push(taskReminder);
  }

  // Failure Warning — nur bei frustrated/debugging
  if ((effectiveCurrentMood === 'frustrated' || effectiveTaskMode === 'debugging') && currentTopic) {
    const failureWarning = buildFailureWarningSlot(budget.extras, currentTopic, sessionId);
    if (failureWarning) sections.push(failureWarning);
  }

  // Entity Profile — nur bei Session-Start oder Bootstrap
  if (slots.showEntityProfile) {
    if (sessionPhaseProfile.showDistilledProfile) {
      const distilledProfile = buildDistilledProfileSlot(budget.entityProfile);
      if (distilledProfile) sections.push(distilledProfile);
    }

    const entityProfile = buildEntityProfileSlot(budget.entityProfile, effectiveEmpathyMode, currentTopic, sessionId);
    if (entityProfile) sections.push(entityProfile);
  }

  // Active Context — semantisch gerankt (Hybrid Retrieval)
  if (slots.showActiveContext) {
    const activeContext = buildActiveContextSlot(budget.activeContext, currentTopic, effectiveCurrentMood, salienceMode, sessionId);
    if (activeContext) sections.push(activeContext);
  }

  // Session Momentum — nur bei Session-Start
  if (slots.showMomentum) {
    const momentum = buildSessionMomentumSlot(budget.sessionMomentum);
    if (momentum) sections.push(momentum);
  }

  // Entity Graph — nur bei Topic-Wechsel oder offenen Fragen
  if (slots.showEntityGraph) {
    const entityGraph = buildEntityGraphSlot(budget.entityGraph, currentTopic, sessionId);
    if (entityGraph) sections.push(entityGraph);
  }

  // Serendipity — selten, nur in deep sessions
  if (slots.showSerendipity) {
    const serendipity = buildSerendipitySlot(budget.serendipity, effectiveCurrentMood, salienceMode);
    if (serendipity) sections.push(serendipity);
  }

  // Extras — nur periodisch oder bei Bedarf
  if (slots.showExtras && (effectiveMode === 'MAXIMUM' || effectiveMode === 'STANDARD')) {
    const activatedNodes = getActivatedNodes(30, sessionId);
    const backgroundThoughts = buildBackgroundThoughtsSlot(budget.serendipity, activatedNodes, sessionId);
    if (backgroundThoughts) sections.push(backgroundThoughts);

    const ghostCtx = buildGhostContextSlot(budget.extras, currentTopic, topicExpertise, sessionPhaseProfile.phase);
    if (ghostCtx) sections.unshift(ghostCtx);

    if (sessionPhaseProfile.showSessionMomentum && !shouldShowTasksEarly) {
      const taskReminder = buildTaskReminderSlot(budget.sessionMomentum, sessionId);
      if (taskReminder) sections.push(taskReminder);
    }

    if (currentTopic && effectiveCurrentMood !== 'frustrated' && effectiveTaskMode !== 'debugging') {
      const failureWarning = buildFailureWarningSlot(budget.extras, currentTopic, sessionId);
      if (failureWarning) sections.push(failureWarning);
    }

    const conflicts = buildConflictSlot(budget.extras, sessionId);
    if (conflicts) sections.push(conflicts);

    const counterEvidence = buildCounterEvidenceSlot(budget.extras, sessionId);
    if (counterEvidence) sections.push(counterEvidence);

    const metaInsight = buildMetaInsightSlot(
      budget.extras,
      topicExpertise,
      effectiveEmpathyMode,
      effectiveTaskMode,
      sessionId,
      currentTopic,
      sessionPhaseProfile.phase,
    );
    if (metaInsight) sections.push(metaInsight);

    const episodes = buildEpisodeSlot(budget.entityGraph, currentTopic, sessionId);
    if (episodes) sections.push(episodes);

    const styleDna = buildStyleSlot(budget.extras, currentTopic);
    if (styleDna) sections.push(styleDna);

    const exampleBudget = effectiveMode === 'MAXIMUM' ? 2000 : 1000;
    const examples = buildExamplesSlot(exampleBudget, currentTopic, sessionId);
    if (examples) sections.push(examples);

    const tot = buildTipOfTongueSlot(budget.extras, currentTopic, sessionId);
    if (tot) sections.push(tot);

    const prospection = buildProspectionSlot(budget.extras, currentTopic, sessionId, readOnly);
    if (prospection) sections.push(prospection);
  }

  if (sections.length === 0) {
    return 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.';
  }

  // 11.5: Save context node IDs for Cerebellum feedback
  if (!readOnly && contextNodeIds.size > 0) {
    const contextNodeIdList = [...contextNodeIds].slice(0, 50);
    try {
      getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('last_context_node_ids', JSON.stringify(contextNodeIdList), Date.now());
    } catch { /* non-fatal */ }

    if (sessionId) {
      try {
        getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
          .run(`last_context_node_ids_${sessionId}`, JSON.stringify(contextNodeIdList), Date.now());
      } catch { /* non-fatal */ }
    }

    try {
      saveContextOutputHistory([...contextNodeIds], sessionId);
    } catch { /* non-fatal */ }

    // 21.3: Comparator — Prediction speichern fuer spaetere Korrektur
    try { savePrediction(contextNodeIdList.slice(0, 30), currentTopic, sessionId); } catch { /* non-fatal */ }
  }

  return integrateContext(sections, contextStyle, maxChunks, sessionId, effectiveCurrentMood, effectiveTaskMode);
}

export function getContextTokenCount(mode: DetailMode = 'STANDARD'): number {
  const context = generateContext(mode);
  return estimateTokens(context);
}

// ── Narrative Briefing ──────────────────────────────────────

function integrateContext(
  sections: string[],
  style: ContextStyle = 'narrative',
  maxChunks: number = 7,
  sessionId?: string,
  currentMood?: string,
  taskMode?: string,
): string {
  if (sections.length === 0) return '';

  const chunks: string[] = [];

  // V3 7.7: Scene Construction — kohaerentes Szenen-Briefing fuer narrative Provider
  if (style === 'narrative') {
    const scene = buildSceneBriefing(sessionId, currentMood, taskMode);
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

function buildSceneBriefing(sessionId?: string, currentMood?: string, taskMode?: string): string | null {
  try {
    const mood = currentMood ?? getSessionMood(sessionId);
    const effectiveTaskMode = taskMode ?? getSessionTaskMode(sessionId) ?? undefined;

    if (!effectiveTaskMode && (!mood || mood === 'neutral')) return null;

    const parts: string[] = [];
    if (effectiveTaskMode) parts.push(`Modus: ${effectiveTaskMode}`);
    if (mood && mood !== 'neutral') parts.push(`Stimmung: ${mood}`);

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
