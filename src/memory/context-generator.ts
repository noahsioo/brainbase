import { getDb, getNodes, getEmbedding, getAllEntities, getEdgesForNode, findEntityByName, getNode, type Node, type NodeMetadata } from './store.js';
import { getStyleDNA } from '../learning/style-analyzer.js';
import { getActivatedNodes, getSessionActivationValue, setSessionActivationValue } from './activation.js';
import { getSystemState, getDevelopmentPhase, setSystemState } from './cold-start.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { buildGhostContext } from './ghost-context.js';
import { getChunksForContext } from './chunking.js';
import { getRelevantFailures, getActiveLifeEvents, getUpcomingLifeEvents, scoreLifeEventRelevance } from './prospective.js';
import { cosineSimilarity, getEmbeddingCache } from '../llm/embeddings.js';
import { getOpenGaps } from '../learning/gap-detector.js';
// V8-1: buildUserModel, getTopicExpertise entfernt (Budget-Modifier vereinfacht)
import { getProviderProfile, peekProviderProfile, recordContextDelivery, type ContextStyle } from '../learning/ai-profiles.js';
import { calculateJOL } from '../meta/metacognition.js';
import { getSelfModel, calibrateConfidence } from '../meta/self-model.js';
import { getSystemMood } from '../senses/interoception.js';
import { savePrediction } from '../regulation/comparator.js';
// V8-1: getStressLevel, getTradeoffState entfernt (Budget-Modifier vereinfacht)
import { getWorkingMemory } from './working-memory.js';
import { generateSpecificImpulse, type HungerZone } from './knowledge-hunger.js';
import { toFirstPerson } from '../utils/first-person.js';
import {
  getSessionAttentionState,
  getSessionContextSignal,
  getSessionEmpathyMode,
  getSessionMood,
  getSessionTaskMode,
} from './session-runtime-state.js';

export type DetailMode = 'MAXIMUM' | 'STANDARD' | 'LIGHT' | 'MINIMAL';

export function getUserName(): string {
  try {
    const db = getDb();
    // 1. Explizite Person-Entity
    const person = db.prepare(
      "SELECT content FROM nodes WHERE type = 'entity' AND metadata LIKE '%\"entity_type\":\"person\"%' ORDER BY importance DESC LIMIT 1"
    ).get() as { content: string } | undefined;
    if (person) return person.content;

    // 2. Core "User Identity" Node hat Links zu Name-Entities
    const identityCore = db.prepare(
      "SELECT n2.content FROM nodes n1 JOIN edges e ON n1.id = e.source_id JOIN nodes n2 ON e.target_id = n2.id WHERE n1.content = 'User Identity' AND n2.type = 'entity' LIMIT 1"
    ).get() as { content: string } | undefined;
    if (identityCore) return identityCore.content;

    // 3. Wichtigste kurze Entity — Name-Heuristik (Grossbuchstabe, einzelnes Wort, kein Tool)
    const candidates = db.prepare(
      "SELECT content FROM nodes WHERE type = 'entity' AND LENGTH(content) BETWEEN 3 AND 15 AND activation_count > 5 AND importance >= 0.8 ORDER BY importance DESC, activation_count DESC LIMIT 10"
    ).all() as Array<{ content: string }>;
    const nameCandidate = candidates.find(c => /^[A-Z][a-z]+$/.test(c.content) && c.content !== 'User');
    if (nameCandidate) return nameCandidate.content;

    return 'User';
  } catch { return 'User'; }
}

// 15.2: Module-level mode for JOL filtering in slot functions
let _currentMode: DetailMode = 'STANDARD';

// V9-3: Intent-Modulated Retrieval — module-level state
let _currentIntent: string = 'other';
let _currentTaskModeForIntent: string | undefined;

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
// V8-3: Erweiterte History fuer staerkere Repeat-Penalty
const MAX_CONTEXT_OUTPUT_HISTORY_WINDOWS = 10;
const MAX_CONTEXT_OUTPUT_HISTORY_NODE_IDS = 50;
const CONTEXT_OUTPUT_HISTORY_TTL_MS = 60 * 60 * 1000;

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
  if (node.type === 'failure') return false;
  if (node.type === 'system_knowledge') return false;
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

  // V8-3: Schaerfere Repeat-Penalty
  const floor = isRepeatPenaltyProtected(node) ? 0.25 : 0.05;
  return Math.max(floor, 1 - recentOutputWeight * 0.6);
}

// V9-3: Intent-Modulated Type Boost — bevorzugt Node-Types je nach Intent
function getIntentTypeBoost(nodeType: string): number {
  if (_currentTaskModeForIntent === 'debugging') {
    if (nodeType === 'fact' || nodeType === 'decision') return 0.12;
    return 0;
  }
  if (_currentIntent === 'request') {
    if (nodeType === 'preference' || nodeType === 'example' || nodeType === 'style_dna' || nodeType === 'identity') return 0.12;
    return 0;
  }
  if (_currentIntent === 'question') {
    if (nodeType === 'fact' || nodeType === 'decision' || nodeType === 'schema') return 0.10;
    return 0;
  }
  return 0;
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

  // V8-4: Freshness Bias — kuerzlich aktivierte Nodes bekommen Bonus
  const timeSinceActivation = Date.now() - (node.last_activated || 0);
  const freshness = timeSinceActivation < 5 * 60 * 1000 ? 0.15 :
                    timeSinceActivation < 30 * 60 * 1000 ? 0.08 :
                    timeSinceActivation < 60 * 60 * 1000 ? 0.03 : 0;

  let baseSignal: number;
  if (semanticScore > 0.1) {
    const normalizedActivation = Math.min(1, activation);
    baseSignal = 0.50 * semanticScore + 0.25 * normalizedActivation + 0.10 * importance + 0.15 * freshness;
  } else {
    baseSignal = Math.max(activation + freshness, importance * 0.35);
  }

  // V9-3: Intent-Modulated Type Boost
  baseSignal += getIntentTypeBoost(node.type);

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

  let text = `## About ${userName}\n`;

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
    const line = `- ${toFirstPerson(node.content, userName)}\n`;
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
    const strengthLine = `- Strengths: ${positiveEntities.join(', ')}\n`;
    if (estimateTokens(text + strengthLine) <= budget) {
      text = `## About ${userName}\n` + strengthLine + text.replace(`## About ${userName}\n`, '');
    }
  } else {
    if (positiveEntities.length > 0) {
      const line = `- Strengths: ${positiveEntities.join(', ')}\n`;
      if (estimateTokens(text + line) <= budget) text += line;
    }
    if (negativeEntities.length > 0) {
      const line = `- Caution with: ${negativeEntities.join(', ')}\n`;
      if (estimateTokens(text + line) <= budget) text += line;
    }
  }

  if (text === `## About ${userName}\n`) return '';
  return truncateToTokens(text, budget);
}

function buildLegacyCoreSlot(budget: number, sessionTopic?: string, sessionId?: string): string {
  const userName = getUserName();

  if (sessionId) {
    const { activatedNodes, activatedNodeIds, entityHints } = getSessionProfileHints(sessionId);
    const sessionMeaningful = activatedNodes.filter(node =>
      ['core', 'fact', 'preference', 'identity', 'project', 'decision'].includes(node.type) &&
      isDisplayWorthy(node) &&
      isSessionRelevantProfileNode(node, sessionTopic, activatedNodeIds, entityHints),
    );

    if (sessionMeaningful.length === 0) return '';

    let sessionText = '## About the User\n';
    for (const node of sessionMeaningful.slice(0, 4)) {
      const line = `- ${toFirstPerson(node.content, userName)}\n`;
      if (estimateTokens(sessionText + line) > budget) break;
      sessionText += line;
    }

    if (sessionText === '## About the User\n') return '';
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

  let text = '## About the User\n';
  for (const node of meaningful) {
    const line = `- ${toFirstPerson(node.content, userName)}\n`;
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

  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
  const contentLower = node.content.toLowerCase();

  // Word overlap is the strongest signal
  if (contentLower.includes(topicLower)) return true;
  if (topicWords.some(w => contentLower.includes(w))) return true;

  // Embedding similarity — stricter for entities (avoid vague tech clustering)
  const nodeVec = getEmbedding(node.id);
  if (nodeVec && _sessionTopicVec) {
    const sim = cosineSimilarity(nodeVec, _sessionTopicVec);
    const threshold = node.type === 'entity' ? 0.55 : 0.4;
    if (sim > threshold) return true;
    if (sim < 0.15) return false;
  }

  // Use message embedding as secondary check (more specific than topic)
  if (nodeVec && _sessionMessageVec) {
    const msgSim = cosineSimilarity(nodeVec, _sessionMessageVec);
    const msgThreshold = node.type === 'entity' ? 0.5 : 0.35;
    if (msgSim > msgThreshold) return true;
  }

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
  if (signal?.isDeepSession) timeStr = ', deep session';
  else if (signal?.isNewSession) timeStr = ', session start';

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

  if (displayReference) {
    lines.push(`Reference: ${displayReference}`);
  }

  if (memory.open_questions.length > 0) {
    // V16: Only include real questions, not raw user text dumps
    const realQuestions = memory.open_questions
      .filter(q => q.endsWith('?') || q.length < 60)
      .slice(0, 2);
    if (realQuestions.length > 0) {
      lines.push(`Open: ${realQuestions.join(' | ')}`);
    }
  }

  if (lines.length === 0) return '';

  let text = '';
  for (const line of lines) {
    const nextLine = `${line}\n`;
    if (estimateTokens(text + nextLine) > budget) break;
    text += nextLine;
  }

  if (!text.trim()) return '';
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
  // V8-5: Feste Node-Limits (Tradeoff-Modulation entfernt)
  const nodeLimit = 25;
  const minActivation = 0.05;

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
    // Fallback: nur wenn ZERO relevante Nodes, dann irrelevante als Fallback
    if (nodes.length === 0) {
      nodes = sortByContextScore(irrelevant).slice(0, 3);
    }
  } else {
    nodes = sortByContextScore(nodes);
  }

  if (nodes.length === 0) return '';

  let text = '## Active Context\n';
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

  const entityNodes = nodes.filter(n => n.type === 'entity').slice(0, 5);
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

  if (text === '## Active Context\n') return '';

  return truncateToTokens(text, budget);
}

// ── Session Momentum (unchanged) ────────────────────────────

function normalizeTopicTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9._+-]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 3)
    .filter(token => !['with', 'und', 'der', 'die', 'das', 'the', 'auth'].includes(token));
}

function isSessionMomentumRelevant(currentTopic: string | undefined, sessionTopics: string[]): boolean {
  if (!currentTopic) return false;

  const currentTokens = new Set(normalizeTopicTokens(currentTopic));
  if (currentTokens.size === 0) return false;

  for (const topic of sessionTopics) {
    for (const token of normalizeTopicTokens(topic)) {
      if (currentTokens.has(token)) {
        return true;
      }
    }
  }

  return false;
}

function buildSessionMomentumSlot(budget: number, currentTopic?: string, sessionId?: string): string {
  const db = getDb();
  const lastSession = db.prepare(
    'SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
  ).get() as { mood_end: string | null; productivity: number | null; topics: string } | undefined;

  if (!lastSession) return '';

  let parsedTopics: string[] = [];
  try {
    parsedTopics = JSON.parse(lastSession.topics);
  } catch {
    parsedTopics = [];
  }

  if (sessionId && !isSessionMomentumRelevant(currentTopic, parsedTopics)) {
    return '';
  }

  let text = '## Last Session\n';

  if (lastSession.mood_end) {
    text += `- Mood: ${lastSession.mood_end}\n`;
  }
  if (lastSession.productivity !== null) {
    const prodLabel = lastSession.productivity > 0.7 ? 'high' :
      lastSession.productivity > 0.4 ? 'medium' : 'low';
    text += `- Productivity: ${prodLabel}\n`;
  }

  if (parsedTopics.length > 0) {
    text += `- Topics: ${parsedTopics.join(', ')}\n`;
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

  let text = `## On Topic: ${topicEntity.content}\n`;
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
  // V9-5: Tiefere Traversierung — niedrigerer Threshold (0.3 statt 0.6)
  const strongNeighbors = neighbors.filter(n => n.edge.strength > 0.3 && n.node.type === 'entity');
  for (const { node: neighbor } of strongNeighbors.slice(0, 3)) {
    const hop2Edges = getEdgesForNode(neighbor.id);
    const rankedHop2 = hop2Edges
      .map(edge2 => {
        const otherId = edge2.source_id === neighbor.id ? edge2.target_id : edge2.source_id;
        const other = getNode(otherId);
        return { edge2, otherId, other };
      })
      .filter((entry): entry is { edge2: typeof hop2Edges[number]; otherId: string; other: Node } =>
        // V9-5: Auch Facts/Preferences bei 2-Hop zeigen, nicht nur Entities
        Boolean(entry.other && entry.other.type !== 'auto_topic' && entry.other.type !== 'disambiguator' && entry.other.type !== 'core'),
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

  if (text === `## On Topic: ${topicEntity.content}\n`) return '';
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

  let text = `## On Topic: ${topic}\n`;
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
    `## Creative Connection\n- ${randomNode.content}\n`,
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

  return truncateToTokens(`## Anticipation\n- ${parts.join('\n- ')}\n`, budget);
}

// ── V11-4: Life Context — aktive Lebensphasen ────────────────

function buildLifeContextSlot(budget: number, topic?: string, intent?: string, activeEntities?: string[]): string {
  const active = getActiveLifeEvents();
  const upcoming = getUpcomingLifeEvents(30);

  if (active.length === 0 && upcoming.length === 0) return '';

  // V13: Relevance Gate — nur Life Events mit score >= 0.3 zeigen
  const allEvents = [...active, ...upcoming];
  const scored = allEvents
    .map(node => ({
      node,
      score: scoreLifeEventRelevance(node, topic, activeEntities, intent),
      isActive: active.includes(node),
    }))
    .filter(s => s.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) return '';

  const now = Date.now();
  const parts: string[] = [];

  for (const { node, isActive } of scored) {
    try {
      const meta = JSON.parse(node.metadata || '{}') as Record<string, unknown>;
      if (isActive) {
        const validUntil = meta.valid_until as number;
        const daysLeft = Math.round((validUntil - now) / (24 * 60 * 60 * 1000));
        parts.push(`Current phase: ${node.content} (~${daysLeft} days left)`);
      } else {
        const validFrom = meta.valid_from as number;
        const daysUntil = Math.round((validFrom - now) / (24 * 60 * 60 * 1000));
        parts.push(`Soon: ${node.content} (in ~${daysUntil} days)`);
      }
    } catch {
      parts.push(isActive ? `Current phase: ${node.content}` : `Soon: ${node.content}`);
    }
  }

  return truncateToTokens(`## Life Context\n- ${parts.join('\n- ')}\n`, budget);
}

// ── Task Reminder (unchanged) ───────────────────────────────

function buildTaskReminderSlot(budget: number, sessionId?: string): string {
  const tasks = getOpenTasks(sessionId);
  if (tasks.length === 0) return '';

  let text = '## Open Tasks\n';
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

  let text = `## Expertise Note\n- ${ghost}\n`;

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
    const line = `- Knowledge gap: ${gap.description}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

// ── Failure Warning (unchanged) ─────────────────────────────

function buildFailureWarningSlot(budget: number, topic: string, sessionId?: string): string {
  const failures = getRelevantFailures(topic, sessionId);
  if (failures.length === 0) return '';

  let text = '## Caution\n';
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

  let text = '## Note: Contradictions\n';
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
    `## Counter-Evidence\n${[...counterEvidence].slice(0, 2).map(c => `- ${c}`).join('\n')}\n`,
    budget
  );
}

// ── Meta Insight (unchanged) ────────────────────────────────

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
    lines.push('User is struggling emotionally. Show empathy, highlight strengths and progress.');
  } else if (empathyMode === 'cognitive') {
    lines.push('User has a specific problem. Focus on solutions and technical details.');
  }

  if (allowGlobalUserMeta && profile.dominant_type !== 'unknown') {
    const hints: Record<string, string> = {
      pointer: 'User is a "pointer" — observe behavior rather than waiting for explanations.',
      explicit: 'User states preferences directly — follow explicit instructions.',
      corrector: 'User corrects often — track corrections as negative signals.',
    };
    const hint = hints[profile.dominant_type];
    if (hint) lines.push(hint);
  }

  const lp = profile.learning_profile;
  if (allowGlobalUserMeta && lp && profile.total_messages_analyzed >= 20) {
    const dominant = [
      { key: 'examples', val: lp.learns_by_examples, hint: 'User learns best through examples. Give concrete examples.' },
      { key: 'doing', val: lp.learns_by_doing, hint: 'User learns by doing. Less explaining, more building.' },
      { key: 'explanation', val: lp.learns_by_explanation, hint: 'User wants to understand the why. Explain the reasoning.' },
      { key: 'vision', val: lp.learns_by_vision, hint: 'User thinks in big visions. Big picture first, then details.' },
    ].sort((a, b) => b.val - a.val);

    if (dominant[0].val > 0.6) {
      lines.push(dominant[0].hint);
    }

    if (lp.prefers_direct > 0.65) {
      lines.push('User prefers direct, concise answers.');
    } else if (lp.prefers_detailed > 0.65) {
      lines.push('User likes detailed explanations.');
    }
  }

  // 13.3: Task-Set hint
  const TASK_HINTS: Record<string, string> = {
    debugging: 'User is debugging. Focus on error analysis and solutions.',
    learning: 'User is learning. Explain concepts and give examples.',
    building: 'User is building. Less explaining, more code.',
    exploring: 'User is exploring. Show options and connections.',
    chatting: 'User is chatting. Keep it brief.',
    urgent: 'User is in a hurry. Only the essentials.',
  };
  if (taskMode && TASK_HINTS[taskMode]) {
    lines.push(TASK_HINTS[taskMode]);
  }

  // V13: Life Phase hint — nur wenn relevant
  try {
    const activeLE = getActiveLifeEvents();
    if (activeLE.length > 0) {
      const relevantLE = activeLE.filter(le =>
        scoreLifeEventRelevance(le, currentTopic, undefined, taskMode) >= 0.3
      );
      if (relevantLE.length > 0) {
        lines.push(`User is currently in: ${relevantLE.map(le => le.content).join(', ')}. Consider this life context.`);
      }
    }
  } catch { /* non-fatal */ }

  // 13.1: Expertise-based hint
  if (topicExpertise !== undefined) {
    if (topicExpertise > 0.7) {
      lines.push('User is an expert here. Less explaining, just build.');
    } else if (topicExpertise < 0.3) {
      lines.push('User is a beginner here. More context and explanations.');
    }
  }

  // 15.4: Self-Model summary
  if (allowGlobalSystemMeta) {
    const selfModel = getSelfModel();
    if (selfModel) {
      const maturity = selfModel.cortical_ratio > 0.3 ? 'mature' : selfModel.cortical_ratio > 0.1 ? 'growing' : 'young';
      lines.push(`System: ${selfModel.total_nodes} facts, ${selfModel.entity_count} entities, ${maturity} (${Math.round(selfModel.cortical_ratio * 100)}% long-term stored).`);
      if (selfModel.strongest_domains.length > 0) {
        lines.push(`Strongest domains: ${selfModel.strongest_domains.join(', ')}.`);
      }
      if (selfModel.weakest_areas.length > 0) {
        lines.push(`Knowledge gaps: ${selfModel.weakest_areas.join(', ')}.`);
      }
    }
  }

  // 18.2: Entwicklungsphase im Context
  if (allowGlobalSystemMeta) {
    const devPhase = getDevelopmentPhase();
    const phaseNames: Record<string, string> = {
      infant: 'Infant phase (absorb everything)',
      child: 'Child phase (learn fast)',
      teen: 'Teen phase (specialize)',
      adult: 'Adult phase (stable + selective)',
      wise: 'Wise phase (deep knowledge network)',
    };
    lines.push(`Development phase: ${phaseNames[devPhase.phase]} (Session ${devPhase.session_count}).`);
  }

  // 17.3: DMN — kreative Verbindungen seit letzter Nachricht
  if (allowGlobalSystemMeta) {
    try {
      const dmnRow = getDb().prepare(
        "SELECT COUNT(*) as c FROM edges WHERE type = 'inferred' AND created_at > ?"
      ).get(Date.now() - 30 * 60 * 1000) as { c: number };
      if (dmnRow.c > 0) {
        lines.push(`System discovered ${dmnRow.c} new connections in background.`);
      }
    } catch {}
  }

  // 17.4: System-Mood im Context
  if (allowGlobalSystemMeta) {
    const sysMoodMeta = getSystemMood();
    if (sysMoodMeta.energy < 0.3) {
      lines.push('System energy low. Focus on essentials.');
    } else if (sysMoodMeta.curiosity > 0.7) {
      lines.push('System is curious — ready for new topics.');
    }
  }

  // 19.4: Meta-Calibration hint
  if (allowGlobalSystemMeta) {
    try {
      const cal = calibrateConfidence();
      if (cal.direction === 'down') {
        lines.push('System calibration: Confidence being corrected (overconfident). Use facts with caution.');
      } else if (cal.direction === 'up') {
        lines.push('System calibration: Knowledge is reliable (well calibrated).');
      }
    } catch { /* non-fatal */ }
  }

  if (lines.length === 0) return '';

  let text = '## System Hints\n';
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
  let text = '## Previous Sessions\n';
  for (const ep of toShow) {
    const date = new Date(ep.created_at).toLocaleDateString('de-DE');
    const preview = ep.content.slice(0, 300);
    const line = `### ${date}\n${preview}\n\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Previous Sessions\n') return '';
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

  let text = '## Style Parameters\n';
  for (const node of relevant) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Style Parameters\n') return '';
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

// ── Knowledge Hunger (V7) ────────────────────────────────────

function buildHungerSlot(sessionId?: string): string {
  if (!sessionId) return '';
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
      .get(`hunger_zones_${sessionId}`) as { value: string } | undefined;
    if (!row) return '';
    const zones = JSON.parse(row.value) as HungerZone[];
    if (zones.length === 0) return '';
    const topZone = zones[0];
    const impulse = generateSpecificImpulse(topZone.entity, topZone.entity_id);
    if (!impulse) return '';
    return `\n[Knowledge gap: ${impulse}]\n`;
  } catch { return ''; }
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
    : getActivatedNodes(20)
        .filter(node =>
          node.activation >= 0.02 &&
          node.activation <= 0.15 &&
          ['entity', 'fact', 'preference', 'decision', 'project'].includes(node.type) &&
          node.importance >= 0.5,
        )
        .slice(0, 5);

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

  let text = '## Possibly relevant\n';
  for (const node of relevant.slice(0, 3)) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Possibly relevant\n') return '';
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
    : getActivatedNodes(30)
        .filter(node =>
          node.activation >= 0.05 &&
          node.activation <= 0.2 &&
          node.importance > 0.3 &&
          ['entity', 'fact', 'preference'].includes(node.type),
        )
        .slice(0, 5);

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
  const effectiveContextSignal = runtimeState.contextSignal;
  const sessionWorkingMemory = sessionId ? getWorkingMemory(sessionId) : null;

  // V9-3: Intent state fuer Node-Type Boosting
  _currentIntent = sessionWorkingMemory?.last_message_intent || 'other';
  _currentTaskModeForIntent = effectiveTaskMode;
  const sessionPhaseProfile = getSessionPhaseBudgetProfile(sessionId, effectiveContextSignal, sessionWorkingMemory);

  // V8-1: Budget-Modifier vereinfacht — nur noch Base + SessionPhase + Provider

  // 14.1+14.2: Provider-specific budget scaling + format
  let contextStyle: ContextStyle = 'narrative';
  let maxChunks = 5; // V16: fewer, more focused chunks = LLM actually reads them
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

  // V16: Scene slot removed — was metadata noise ("Sidewalks — videobeschreibung (fokussiert)")
  // that LLMs treated as debug info and ignored the entire context block.

  // V13: Life Context — nur wenn relevant (scored)
  const lifeEntityNames = sessionWorkingMemory
    ? Object.keys(sessionWorkingMemory.active_entities)
    : [];
  const lifeContext = buildLifeContextSlot(80, currentTopic, effectiveTaskMode, lifeEntityNames);
  if (lifeContext) sections.push(lifeContext);

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
    const momentum = buildSessionMomentumSlot(budget.sessionMomentum, currentTopic, sessionId);
    if (momentum) sections.push(momentum);
  }

  // Entity Graph — nur bei Topic-Wechsel oder offenen Fragen
  if (slots.showEntityGraph) {
    const entityGraph = buildEntityGraphSlot(budget.entityGraph, currentTopic, sessionId);
    if (entityGraph) sections.push(entityGraph);
  }

  // V8-1: Extras — nur noch Conflicts + Tasks + Failures (Meta-Noise entfernt)
  if (slots.showExtras && (effectiveMode === 'MAXIMUM' || effectiveMode === 'STANDARD')) {
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
  }

  // V9-6: Dedup-Pass — entfernt doppelte Informationen zwischen Slots
  const dedupedSections = deduplicateContextSections(sections);

  if (dedupedSections.length === 0) {
    return 'This is a new brain. Memories build automatically from our conversations.';
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

  return integrateContext(dedupedSections, contextStyle, maxChunks, sessionId, effectiveCurrentMood, effectiveTaskMode);
}

export function getContextTokenCount(mode: DetailMode = 'STANDARD'): number {
  const context = generateContext(mode);
  return estimateTokens(context);
}

// V9-6: Context Deduplication — gleiche Info nicht in mehreren Slots
function deduplicateContextSections(sections: string[]): string[] {
  const seenContentKeys = new Set<string>();

  return sections.map(section => {
    const lines = section.split('\n');
    const filtered = lines.filter(line => {
      const trimmed = line.replace(/^[-*\s#]+/, '').trim();
      if (!trimmed || trimmed.startsWith('##')) return true;

      const contentKey = trimmed.toLowerCase()
        .replace(/[^a-z\u00e4\u00f6\u00fc\u00df\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (contentKey.length < 10) return true;

      const words = new Set(contentKey.split(' ').filter(w => w.length > 2));
      if (words.size < 3) return true;

      for (const seen of seenContentKeys) {
        const seenWords = new Set(seen.split(' ').filter(w => w.length > 2));
        const intersection = [...words].filter(w => seenWords.has(w)).length;
        const overlap = intersection / Math.min(words.size, seenWords.size);
        if (overlap > 0.7) return false;
      }

      seenContentKeys.add(contentKey);
      return true;
    });

    return filtered.join('\n');
  }).filter(section => {
    const sectionContent = section.replace(/^##[^\n]*\n?/gm, '').trim();
    return sectionContent.length > 0;
  });
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

  for (const section of sections) {
    if (style === 'minimal') {
      const cleaned = sectionToMinimal(section);
      if (cleaned) chunks.push(cleaned);
    } else if (style === 'structured') {
      const structured = sectionToStructured(section);
      if (structured) chunks.push(structured);
    } else {
      const narrative = sectionToNarrative(section);
      if (narrative) chunks.push(narrative);
    }
  }

  // Skip if no real content chunks survived conversion
  if (chunks.length === 0) return '';

  const body = chunks.slice(0, maxChunks).join('\n\n');

  // V16: Raw facts only — frameContextAsResponse() in user-prompt.ts adds the bridge framing
  return body;
}

function buildSceneBriefing(sessionId?: string, currentMood?: string, taskMode?: string): string | null {
  try {
    const mood = currentMood ?? getSessionMood(sessionId);
    const effectiveTaskMode = taskMode ?? getSessionTaskMode(sessionId) ?? undefined;
    const userName = getUserName();

    const moodLabels: Record<string, string> = {
      frustrated: 'frustriert', excited: 'motiviert', confused: 'unsicher',
      satisfied: 'zufrieden', neutral: 'fokussiert',
    };
    const moodStr = moodLabels[mood || 'neutral'] || '';

    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? 'Nacht' : hour < 12 ? 'Morgens' : hour < 18 ? 'Nachmittags' : 'Abends';

    const parts: string[] = [userName];
    if (moodStr) parts.push(moodStr);
    if (effectiveTaskMode) parts.push(effectiveTaskMode);
    parts.push(timeOfDay);

    return parts.join(' | ');
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

// V8-7: Structured format — compact Key: Value with pipe separators
function sectionToStructured(section: string): string | null {
  const lines = section.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const header = lines[0].replace(/^#+\s*/, '').trim();
  const rest = lines.slice(1);

  const bullets = rest
    .filter(l => l.trimStart().startsWith('- '))
    .map(l => l.replace(/^\s*-\s*/, '').trim());

  const hasSubHeaders = rest.some(l => l.trimStart().startsWith('### '));
  if (hasSubHeaders) {
    return rest.join('\n').trim() || null;
  }

  if (bullets.length === 0) {
    const raw = rest.map(l => l.trim()).join(' | ');
    return raw || null;
  }

  if (header.startsWith('About ') || header.startsWith('User Profile')) {
    const name = header.replace('About ', '').replace('User Profile', '').trim() || 'User';
    const compact = bullets.map(b => {
      const colonIdx = b.indexOf(':');
      if (colonIdx > 0) return b.substring(colonIdx + 1).trim();
      return b;
    });
    return `${name}: ${compact.join(' | ')}`;
  }

  if (header === 'Active Context') {
    const compact = bullets.map(b => {
      return b.replace(/^\*\*(.+?)\*\*/, '$1').replace(/\s+/g, ' ').trim();
    });
    return `Context: ${compact.join(' | ')}`;
  }

  if (header.startsWith('On Topic:')) {
    const topic = header.replace('On Topic:', '').trim();
    return `About ${topic}: ${bullets.join(' | ')}`;
  }

  if (header === 'Open Tasks') {
    return `Tasks: ${bullets.join(' | ')}`;
  }

  if (header === 'Caution') {
    return `Caution: ${bullets.join(' | ')}`;
  }

  if (header.startsWith('Note: Contradictions')) {
    return `Contradiction: ${bullets.join(' | ')}`;
  }

  if (header === 'Reminder') {
    return `Reminder: ${bullets.join(' | ')}`;
  }

  return `${header}: ${bullets.join(' | ')}`;
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

  if (header.startsWith('About ') || header.startsWith('User Profile')) {
    return buildIdentityNarrative(header, bulletPoints);
  }
  if (header === 'Active Context') {
    return buildActiveNarrative(bulletPoints);
  }
  if (header.startsWith('On Topic:')) {
    return buildGraphNarrative(header, bulletPoints);
  }
  if (header === 'Last Session') {
    return buildSessionNarrative(bulletPoints);
  }
  if (header === 'Open Tasks') {
    return buildTaskNarrative(bulletPoints);
  }
  if (header === 'Caution') {
    return buildWarningNarrative(bulletPoints);
  }
  if (header === 'Reminder') {
    return 'Don\'t forget: ' + bulletPoints.join('. ') + '.';
  }
  if (header.startsWith('Note: Contradictions')) {
    return 'Warning, contradiction: ' + bulletPoints.join('. ') + '. Clarify which info is current.';
  }
  if (header === 'Possibly relevant') {
    return 'Possibly also relevant: ' + bulletPoints.join(', ') + '.';
  }

  return bulletPoints.join('. ') + '.';
}

function buildIdentityNarrative(header: string, points: string[]): string {
  const name = header.replace('About ', '').replace('User Profile', '').trim() || 'the user';
  const sentences: string[] = [`I'm ${name}.`];

  for (const point of points) {
    const colonIdx = point.indexOf(':');
    if (colonIdx > 0) {
      const label = point.substring(0, colonIdx).trim();
      const value = point.substring(colonIdx + 1).trim();
      const verb = label.charAt(0).toLowerCase() + label.slice(1);
      sentences.push(`I ${verb} ${value}.`);
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
        parts.push(`${name} connects to ${connected}`);
      } else {
        parts.push(name + (extra ? ' ' + extra : ''));
      }
    } else {
      const cleaned = point.replace(/^!*\[.*?\]\s*/, '').trim();
      parts.push(cleaned);
    }
  }

  return 'Things I\'ve mentioned: ' + parts.join('. ') + '.';
}

function buildGraphNarrative(header: string, points: string[]): string {
  const topic = header.replace('On Topic:', '').trim();
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
  return `About ${topic}: ${relations.join(', ')}.`;
}

function buildSessionNarrative(points: string[]): string {
  let mood = '';
  let productivity = '';
  let topics = '';

  for (const point of points) {
    if (point.startsWith('Mood:')) mood = point.replace('Mood:', '').trim();
    else if (point.startsWith('Productivity:')) productivity = point.replace('Productivity:', '').trim();
    else if (point.startsWith('Topics:')) topics = point.replace('Topics:', '').trim();
  }

  const parts: string[] = ['In the last session, the user'];
  if (mood) parts.push(`was ${mood}`);
  if (productivity) parts.push(`and ${productivity === 'high' ? 'productive' : productivity === 'low' ? 'unproductive' : 'moderately productive'}`);
  let sentence = parts.join(' ') + '.';
  if (topics) sentence += ` They discussed: ${topics}.`;
  return sentence;
}

function buildTaskNarrative(points: string[]): string {
  const tasks = points.map(p => {
    if (p.startsWith('!!')) return p.slice(2).trim() + ' (high priority)';
    if (p.startsWith('!')) return p.slice(1).trim() + ' (priority)';
    return p;
  });
  return 'Open tasks: ' + tasks.join(', ') + '.';
}

function buildWarningNarrative(points: string[]): string {
  return 'Caution: ' + points.join('. ') + '.';
}
