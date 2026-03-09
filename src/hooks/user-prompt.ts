import { addToRawBuffer, createSession, getDb, getSession, setQueryEmbedding, updateNode, searchNodes } from '../memory/store.js';
import { activateByEntities, applyAttentionSpotlight, primeActivations, applySTDP, getCurrentlyActivatedEntityIds, getLastSTDPEntities, setLastSTDPEntities, setCurrentEncodingContext, setSystemMode, setCurrentTaskMode, applyDisinhibition, clearDisinhibitionTargets, startNewCoherenceRound, getSessionActivationValue, setSessionActivationValue, getActivatedNodes } from '../memory/activation.js';
import { generateContext, setSessionTopicEmbedding, setSessionMessageEmbedding, getUserName, type DetailMode } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import {
  buildSemanticExtraction,
  getPreferredSemanticIntent,
  getPreferredSemanticTopic,
  type SemanticExtraction,
} from '../extraction/semantic-extractor.js';
import { GATE_HEBBIAN, GATE_LLM } from '../signal/signal-strength.js';
import { processThalamic, deriveSystemMode } from '../signal/thalamus.js';
import { detectFeedbackSignal, detectMood, setCurrentMood, applyFeedbackToRecentNodes, applyFeedbackOutcome, applySomaticMarkers, applyContextFeedback, detectEmpathyMode, trackProviderFeedback } from '../signal/echo.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { checkProspectiveTriggers, getUpcomingReminders, scoreReminderRelevance, formatProactiveReminder } from '../memory/prospective.js';
import { createEmbeddingClient } from '../llm/embeddings.js';
import { detectEmotionBypass } from '../senses/emotion-sense.js';
import { getStability } from '../senses/stability-sense.js';
import { analyzeTone } from '../senses/tone-sense.js';
import { analyzeContext } from '../senses/context-sense.js';
import { calculateAttentionState } from '../meta/metacognition.js';
import { getSystemMood } from '../senses/interoception.js';
import { shouldAllowLLMCall } from '../regulation/energy.js';
import { calculateStressLevel } from '../regulation/stress-response.js';
import { getLastContextMode, recordContextFeedback, recordContextModeDelivery } from '../learning/communication-learner.js';
import { inferMessageIntent, updateWorkingMemory, getWorkingMemory, isRealEntity } from '../memory/working-memory.js';
import {
  setSessionAttentionState,
  setSessionContextSignal,
  setSessionEmpathyMode,
  setSessionTaskMode as setRuntimeTaskMode,
  setSessionTone,
} from '../memory/session-runtime-state.js';
import { diagnosticLog } from '../utils/diagnostic.js';
import { toFirstPerson, isCleanUserFact } from '../utils/first-person.js';
import { createSignalAccumulator } from '../utils/signal-accumulator.js';
import { detectHungerZones, getHungerCooldown, setHungerCooldown, decrementHungerCooldown, detectLearningOpportunity } from '../memory/knowledge-hunger.js';

interface UserPromptInput {
  session_id?: string;
  user_prompt?: string;
}

export interface ProcessMessageInput {
  message: string;
  session_id?: string;
  provider?: string;
  context_only?: boolean;
}

export interface ProcessMessageResult {
  context: string | null;
  signal_score: number;
  signal_action: string;
  topic?: string;
}

const SEMANTIC_TOPIC_MIN_CONFIDENCE = 0.55;
const SEMANTIC_ENTITY_MIN_CONFIDENCE = 0.5;
const INVALID_LIVE_TOPIC_NAMES = new Set([
  'conversation', 'session', 'message', 'request', 'topic', 'thema',
  'project', 'projekt', 'task', 'aufgabe', 'general', 'allgemein',
]);
const GENERIC_LIVE_ENTITY_NAMES = new Set([
  'das', 'dies', 'diese', 'dieser', 'es', 'it', 'this', 'that',
  'thing', 'stuff', 'conversation', 'session', 'message', 'request',
  'topic', 'project', 'task', 'problem', 'issue',
]);

// M28: Session Focus — cumulative entity counter for stable topic
function updateSessionFocus(sessionId: string, newEntities: string[]): string[] {
  if (newEntities.length === 0) return [];

  const db = getDb();
  const key = `session_focus_${sessionId}`;

  let focusMap: Record<string, number> = {};
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (row) focusMap = JSON.parse(row.value);
  } catch { /* first message */ }

  for (const entity of newEntities) {
    focusMap[entity] = (focusMap[entity] || 0) + 1;
  }

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(focusMap), Date.now());

  return Object.entries(focusMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([entity]) => entity);
}

// M32: Task Switching Cost — fade old topic, ramp new topic
function applyTaskSwitchingCost(sessionId: string, currentTopic: string | undefined): boolean {
  if (!currentTopic) return false;

  const db = getDb();
  const key = `prev_topic_${sessionId}`;

  let prevTopic: string | undefined;
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (row) prevTopic = row.value;
  } catch { /* first message */ }

  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, currentTopic, Date.now());

  if (!prevTopic || prevTopic === currentTopic) return false;

  // Topic changed — fade old topic nodes
  const prevWords = prevTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (prevWords.length === 0) return true;

  const activeNodes = getActivatedNodes(30, sessionId);
  const newWords = currentTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  for (const node of activeNodes) {
    const contentLower = node.content.toLowerCase();
    const isOldTopic = prevWords.some(w => contentLower.includes(w));
    const isNewTopic = newWords.some(w => contentLower.includes(w));

    if (isOldTopic && !isNewTopic) {
      const faded = node.activation * 0.7;
      setSessionActivationValue(node.id, sessionId, faded);
    }
  }

  return true;
}

// 12.1: Event Boundary — mark episode transitions for better encoding
function markEventBoundary(sessionId: string): void {
  const db = getDb();

  // Cooldown: max 1 Boundary pro 2 Minuten
  const lastBoundary = db.prepare("SELECT value FROM system_state WHERE key = ?")
    .get(`last_boundary_${sessionId}`) as { value: string } | undefined;
  if (lastBoundary && Date.now() - parseInt(lastBoundary.value) < 120000) return;
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(`last_boundary_${sessionId}`, String(Date.now()), Date.now());

  const threeMinAgo = Date.now() - 3 * 60 * 1000;

  // Boundary Bump: kuerzlich erstellte Nodes bekommen Importance-Boost
  const recentNodes = db.prepare(`
    SELECT id, importance, metadata FROM nodes
    WHERE created_at > ?
    ORDER BY created_at DESC LIMIT 5
  `).all(threeMinAgo) as Array<{ id: string; importance: number; metadata: string | null }>;

  for (const node of recentNodes) {
    let meta: Record<string, unknown> = {};
    try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }
    meta.boundary_node = true;
    db.prepare('UPDATE nodes SET importance = ?, metadata = ? WHERE id = ?')
      .run(Math.min(1.0, node.importance + 0.1), JSON.stringify(meta), node.id);
  }
}

function ensureSessionExists(sessionId: string, provider: string, contextOnly: boolean | undefined): void {
  if (contextOnly) return;
  if (!getSession(sessionId)) {
    createSession(provider, sessionId);
  }
}

function resolveEffectiveTopic(
  semantic: SemanticExtraction,
  fallbackTopic: string | undefined,
): string | undefined {
  const semanticTopic = normalizeLiveValue(getPreferredSemanticTopic(semantic)).toLowerCase();
  const normalizedFallback = normalizeLiveValue(fallbackTopic).toLowerCase();
  const hasValidSemanticTopic = semanticTopic && !INVALID_LIVE_TOPIC_NAMES.has(semanticTopic);

  if (hasValidSemanticTopic && semantic.topic_confidence >= SEMANTIC_TOPIC_MIN_CONFIDENCE) {
    return semanticTopic;
  }

  if (normalizedFallback) {
    return normalizedFallback;
  }

  return hasValidSemanticTopic ? semanticTopic : undefined;
}

function resolveEffectiveEntities(
  semantic: SemanticExtraction,
  fallbackEntities: string[],
  fallbackFocusEntities: string[],
): string[] {
  const semanticEntities = semantic.entities
    .filter(entity =>
      entity.confidence >= SEMANTIC_ENTITY_MIN_CONFIDENCE &&
      isUsableLiveEntity(entity.name)
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(entity => entity.name);

  if (semanticEntities.length > 0) {
    return uniqueLiveValues(semanticEntities);
  }

  return uniqueLiveValues([...fallbackEntities, ...fallbackFocusEntities])
    .filter(isUsableLiveEntity)
    .slice(0, 5);
}

function resolveEffectiveIntent(semantic: SemanticExtraction, message: string) {
  const preferredIntent = getPreferredSemanticIntent(semantic);
  return preferredIntent !== 'other' ? preferredIntent : inferMessageIntent(message);
}

function isUsableLiveEntity(value: string): boolean {
  const normalized = normalizeLiveValue(value);
  if (normalized.length < 2) return false;
  return !GENERIC_LIVE_ENTITY_NAMES.has(normalized.toLowerCase());
}

function uniqueLiveValues(values: string[]): string[] {
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeLiveValue(value);
    if (!normalized) continue;
    if (result.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
      continue;
    }
    result.push(normalized);
  }

  return result;
}

function normalizeLiveValue(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}


export async function processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const sessionId = input.session_id || `session-${Date.now()}`;
  const provider = input.provider || 'mcp';
  const shouldPersistState = !input.context_only;
  const signals = createSignalAccumulator();

  ensureSessionExists(sessionId, provider, input.context_only);

  if (shouldPersistState) {
    addToRawBuffer({
      session_id: sessionId,
      provider,
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
    });

    getDb().prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?').run(sessionId);

    // Phase 6: updateMetaProfile, trackExpertise, trackProblem disabled (<1% impact)
  }

  // 10.3: Emotion-Bypass (Olfaktion — umgeht Thalamus direkt)
  const emotionBypass = detectEmotionBypass(input.message);

  const signal = processThalamic(input.message, sessionId, { readOnly: !shouldPersistState });
  diagnosticLog('THAL', {
    combined: signal.combined,
    action: signal.action,
    entities: signal.entities.slice(0, 5),
    taskMode: signal.taskMode,
    mode: signal.mode,
  });
  // M52: Gehirnwellen — set system mode for activation parameter modulation
  if (shouldPersistState) {
    setSystemMode(deriveSystemMode(signal.mode, signal.salienceMode), sessionId);
  }
  // Provisional heuristics still drive gates and early internal signals.
  const provisionalFocusEntities = shouldPersistState
    ? updateSessionFocus(sessionId, signal.entities.slice(0, 5))
    : signal.entities.slice(0, 5);
  // V12: Filter garbage from provisional topic — only use real entities
  const realProvisionalEntities = provisionalFocusEntities.filter(isRealEntity);
  const provisionalTopic = realProvisionalEntities.length > 0
    ? realProvisionalEntities.slice(0, 3).join(' ')
    : undefined;

  // M32: Task Switching Cost — smooth transition when topic changes
  const topicChanged = shouldPersistState
    ? applyTaskSwitchingCost(sessionId, provisionalTopic)
    : false;

  // V9-5: Topic-Wechsel → theta mode fuer tiefere Activation (3-Hop statt 2)
  if (shouldPersistState && topicChanged) {
    setSystemMode('theta', sessionId);
  }

  // 12.1: Event Boundary — topic change = episode boundary
  if (shouldPersistState && topicChanged) {
    markEventBoundary(sessionId);
  }

  const feedback = detectFeedbackSignal(input.message);
  if (shouldPersistState) {
    const lastContextMode = getLastContextMode(sessionId);
    if (lastContextMode && feedback !== 'neutral') {
      recordContextFeedback(lastContextMode, feedback === 'positive', sessionId);
    }
    applyFeedbackToRecentNodes(feedback, sessionId);
    applyContextFeedback(feedback, sessionId);
    applySomaticMarkers(feedback, sessionId);
    applyFeedbackOutcome(feedback, sessionId);
    trackProviderFeedback(feedback, provider);
  }
  let mood = detectMood(input.message, signal.flags.frustration);
  if (shouldPersistState) {
    setCurrentMood(mood, sessionId);
  }

  // 13.2: Empathy Mode — affective vs cognitive
  const empathyMode = detectEmpathyMode(input.message, mood);
  if (shouldPersistState) {
    setSessionEmpathyMode(sessionId, empathyMode);
  }

  // 10.3: Bypass overrides normal mood + boosts emotion nucleus
  if (emotionBypass.triggered) {
    if (emotionBypass.moodOverride) {
      mood = emotionBypass.moodOverride;
      if (shouldPersistState) {
        setCurrentMood(mood, sessionId);
      }
    }
    signal.nuclei.emotion.inhibited = Math.max(
      signal.nuclei.emotion.inhibited,
      emotionBypass.intensity
    );
    if (emotionBypass.intensity > 0.7) {
      signal.combined = Math.max(signal.combined, GATE_LLM + 0.01);
      signal.action = 'full_extraction';
    }
  }

  // 10.3: Sarcasm flag — DB-Writes disabled (V5-5.2)

  // 13.3: Task-Set Inference — store current task mode
  if (shouldPersistState) {
    setRuntimeTaskMode(sessionId, signal.taskMode);
    // 22.5: Adaptive Coding — Edge-Gewichte je nach TaskMode setzen
    setCurrentTaskMode(signal.taskMode, sessionId);
  }

  // 10.5: Stability-Sense (Vestibular — bei Widerspruechen verlangsamen)
  const stability = getStability(!shouldPersistState);
  if (stability.needsAttention) {
    signal.nuclei.novelty.raw *= 0.7;
  }

  // 10.2: Tone-Sense (Audition — WIE es klingt)
  const tone = analyzeTone(input.message);
  if (shouldPersistState) {
    setSessionTone(sessionId, tone);
  }
  // 15.3: Drei Aufmerksamkeitssysteme
  const attentionState = calculateAttentionState(
    tone.urgency, signal.flags.frustration, signal.flags.explicit_memory,
    signal.entities.length, topicChanged,
    signal.nuclei.entity.raw, signal.taskMode,
  );
  if (shouldPersistState) {
    setSessionAttentionState(sessionId, attentionState);
  }

  // 15.3a: Alerting Override (subsumes tone.urgency > 0.7)
  if (attentionState.alerting > 0.7) {
    signal.combined = Math.max(signal.combined, GATE_LLM + 0.01);
    signal.action = 'full_extraction';
  }

  // 10.6: Context-Sense (Somatosensorik — wo stehen wir gerade?)
  const contextSignal = analyzeContext(sessionId, provider);
  if (shouldPersistState) {
    setSessionContextSignal(sessionId, contextSignal);
    calculateStressLevel(sessionId);
  }

  // M36: Set encoding context for retrieval matching in activation
  if (shouldPersistState) {
    setCurrentEncodingContext({
      mood,
      topic: provisionalTopic,
      provider,
    }, sessionId);
  }

  // Phase 6: Synaptic Tagging + Encoding Signal disabled (minimal impact, heavy DB writes)

  // 17.4: System-Mood → Extraction Modulation
  const systemMood = getSystemMood();
  if (systemMood.energy < 0.3 && signal.combined < GATE_LLM) {
    signal.combined *= 0.8;
  }
  if (systemMood.curiosity > 0.7 && signal.combined >= GATE_HEBBIAN) {
    signal.combined = Math.max(signal.combined, GATE_LLM * 0.9);
  }

  // Phase 6: Allostasis, Tradeoff, Stress, Environment, Multisensory disabled
  // (already integrated in thalamus.ts + context-generator.ts)

  // 9.4 v2: Learning Opportunity — nur bei Topic-Change (re-enabled V7)
  if (shouldPersistState && topicChanged && signal.entities.length > 0) {
    try {
      const opportunities = detectLearningOpportunity(input.message, signal.entities.slice(0, 3));
      if (opportunities.length > 0) {
        signals.set(`learning_opportunity_${sessionId}`, opportunities);
      }
    } catch { /* non-fatal */ }
  }

  if (shouldPersistState) {
    extractFromPrompt(input.message, sessionId, signal.flags);
  }

  // Phase 2: Activation moved AFTER watcher+WM — see below after updateWorkingMemory

  // Prospective Memory: check if any triggers match
  const prospectiveMatches = checkProspectiveTriggers(input.message);

  // 24.4: Energie-Management — LLM-Call Budget pruefen
  if (!shouldAllowLLMCall(sessionId) && signal.combined >= GATE_LLM) {
    signal.combined = Math.min(signal.combined, GATE_LLM - 0.01);
  }

  let watcherResponse: Record<string, unknown> | null = null;
  let watcherSystemMessage: string | undefined;

  // Start message embedding in parallel with watcher call (saves 1-2s)
  const embClient = shouldPersistState ? createEmbeddingClient() : null;
  const messageEmbPromise = embClient
    ? embClient.embed(input.message).catch((): null => null)
    : Promise.resolve(null);

  if (shouldPersistState && signal.combined >= GATE_LLM) {
    const config = getConfig();
    if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
      const db = getDb();
      const recentRows = db.prepare(
        "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 5"
      ).all(sessionId) as Array<{ content: string }>;
      const recentContext = recentRows.reverse().map(r => r.content).join('\n---\n');

      watcherResponse = await sendToWatcher('user-prompt', {
        session_id: sessionId,
        user_prompt: input.message,
        signal_score: signal.combined,
        signal_action: signal.action,
        signal_flags: signal.flags,
        _recentMessages: recentContext,
      }).catch(() => null);

      if (watcherResponse?.systemMessage) {
        watcherSystemMessage = watcherResponse.systemMessage as string;
      }
    }
  }
  diagnosticLog('WATCH', {
    hasResponse: !!watcherResponse,
    nothing_new: (watcherResponse?.semantic as Record<string, unknown>)?.nothing_new ?? 'N/A',
    topic: (watcherResponse?.semantic as Record<string, unknown>)?.topic ?? 'N/A',
    systemMessage: !!watcherResponse?.systemMessage,
  });

  const effectiveSemantic = buildSemanticExtraction({
    message: input.message,
    sessionId,
    provider,
    watcherResponse,
    fallbackTopic: provisionalTopic,
    fallbackEntities: signal.entities.slice(0, 5),
  });
  const effectiveTopic = resolveEffectiveTopic(effectiveSemantic, provisionalTopic);
  const effectiveEntities = resolveEffectiveEntities(
    effectiveSemantic,
    signal.entities,
    provisionalFocusEntities,
  );
  const effectiveIntent = resolveEffectiveIntent(effectiveSemantic, input.message);
  diagnosticLog('RESOLVE', {
    effectiveTopic,
    effectiveEntities,
    effectiveIntent,
    semanticSource: effectiveSemantic.source,
  });

  if (shouldPersistState) {
    // writeSemanticExtractionState disabled (V5-5.2)

    updateWorkingMemory({
      sessionId,
      message: input.message,
      inferredTopic: effectiveTopic,
      focusEntities: effectiveEntities,
      messageIntent: effectiveIntent,
      references: effectiveSemantic.references,
      degradedSemantic: effectiveSemantic.degraded,
      taskMode: signal.taskMode,
      mood,
    });

    // V19: WM Snapshot alle 3 Nachrichten — ueberlebt Session-Crashes
    const wmForSnapshot = getWorkingMemory(sessionId);
    const snapMsgCount = wmForSnapshot?.message_count ?? 0;
    if (snapMsgCount > 0 && snapMsgCount % 3 === 0) {
      try {
        getDb().prepare(
          "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)"
        ).run('wm_snapshot', JSON.stringify({
          topic: wmForSnapshot?.current_topic,
          summary: wmForSnapshot?.conversation_summary,
          last_message: wmForSnapshot?.last_user_message,
          entities: Object.entries(wmForSnapshot?.active_entities || {}).slice(0, 5),
          session_id: sessionId,
        }), Date.now());
      } catch { /* non-fatal */ }
    }
  }
  {
    const wmForLog = getWorkingMemory(sessionId);
    diagnosticLog('WM', {
      topic: wmForLog?.current_topic,
      entities: Object.entries(wmForLog?.active_entities || {}).slice(0, 5),
      intent: wmForLog?.last_message_intent,
      summary: wmForLog?.conversation_summary?.slice(0, 100),
    });
  }

  // Phase 2: Semantic Activation — AFTER watcher + WM update, using semantic entities
  if (shouldPersistState && signal.combined >= GATE_HEBBIAN) {
    startNewCoherenceRound(sessionId);
    primeActivations(0.3, sessionId);

    if (signal.flags.explicit_memory) {
      applyDisinhibition(input.message, sessionId);
    }

    // V8-2: WM-driven activation — merge semantic entities + WM top entities
    const wmForActivation = getWorkingMemory(sessionId);
    const wmTopEntities = Object.entries(wmForActivation?.active_entities || {})
      .filter(([, score]) => score >= 0.15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entity]) => entity);

    const mergedEntities = uniqueLiveValues([...effectiveEntities, ...wmTopEntities]);
    activateByEntities(
      mergedEntities.length > 0
        ? mergedEntities
        : (wmForActivation?.current_topic ? [wmForActivation.current_topic] : []),
      sessionId,
    );

    // M6: Sensory Gating — apply dampening to over-mentioned entities
    if (Object.keys(signal.dampening).length > 0) {
      const dbDamp = getDb();
      for (const [entity, factor] of Object.entries(signal.dampening)) {
        const matches = dbDamp.prepare(
          "SELECT id FROM nodes WHERE LOWER(content) = LOWER(?)"
        ).all(entity) as Array<{ id: string }>;
        for (const match of matches) {
          const activation = getSessionActivationValue(match.id, sessionId);
          if (activation > 0) {
            setSessionActivationValue(match.id, sessionId, activation * factor);
          }
        }
      }
    }

    // V9-5: Topic-Switch Activation Boost — bei Topic-Wechsel extra Nodes voraktivieren
    if (topicChanged && effectiveTopic) {
      const topicHits = searchNodes(effectiveTopic, 10);
      for (const hit of topicHits) {
        const currentAct = getSessionActivationValue(hit.id, sessionId);
        if (currentAct < 0.1) {
          setSessionActivationValue(hit.id, sessionId, 0.15);
        }
      }
    }

    const currentEntities = getCurrentlyActivatedEntityIds(10, sessionId);
    const previousEntities = getLastSTDPEntities(sessionId);
    applySTDP(previousEntities, currentEntities);
    setLastSTDPEntities(sessionId, currentEntities);

    applyAttentionSpotlight(sessionId, 10);

    clearDisinhibitionTargets(sessionId);
  } else if (shouldPersistState) {
    // V8-6: WM-aware activation for low-signal messages
    const wmForLowSignal = getWorkingMemory(sessionId);
    const hasStrongWM = wmForLowSignal &&
      wmForLowSignal.current_topic &&
      wmForLowSignal.message_count >= 3 &&
      Object.keys(wmForLowSignal.active_entities).length >= 2;

    if (hasStrongWM) {
      startNewCoherenceRound(sessionId);
      primeActivations(0.15, sessionId);

      const wmEntities = Object.entries(wmForLowSignal.active_entities)
        .filter(([, score]) => score >= 0.2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([entity]) => entity);

      if (wmEntities.length > 0) {
        activateByEntities(wmEntities, sessionId);
      } else if (wmForLowSignal.current_topic) {
        activateByEntities([wmForLowSignal.current_topic], sessionId);
      }
    } else if (!wmForLowSignal || wmForLowSignal.message_count <= 2) {
      // V14: Softer Bridge Activation — prime but don't dominate
      try {
        const bridgeRow = getDb().prepare("SELECT value FROM system_state WHERE key = 'session_bridge'")
          .get() as { value: string } | undefined;
        if (bridgeRow) {
          const bridge = JSON.parse(bridgeRow.value) as { top_entities: Array<{ name: string; score: number }>; timestamp: number };
          const ageH = (Date.now() - bridge.timestamp) / (1000 * 60 * 60);
          if (ageH < 24 && bridge.top_entities.length > 0) {
            const bridgeNames = bridge.top_entities
              .filter(e => e.name.length > 2)
              .slice(0, 3)
              .map(e => e.name);
            if (bridgeNames.length > 0) {
              startNewCoherenceRound(sessionId);
              primeActivations(0.1, sessionId);
              activateByEntities(bridgeNames, sessionId);
            }
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  // Diagnostic: activated nodes after semantic activation
  {
    const activatedForLog = getActivatedNodes(5, sessionId);
    diagnosticLog('ACTV', {
      top5: activatedForLog.map(n => `${n.content}(${n.activation.toFixed(2)})`),
      totalActivated: getActivatedNodes(50, sessionId).length,
    });
  }

  // Keep the live encoding context aligned with the semantic topic after watcher/fallback resolution.
  if (shouldPersistState) {
    setCurrentEncodingContext({
      mood,
      topic: effectiveTopic,
      provider,
    }, sessionId);
  }

  // Await message embedding (started in parallel with watcher above — saves 1-2s)
  if (shouldPersistState) {
    const messageVec = await messageEmbPromise;
    if (messageVec) {
      setQueryEmbedding(input.message, messageVec);
      setSessionMessageEmbedding(messageVec);
      if (effectiveTopic && embClient) {
        try {
          const topicVec = await embClient.embed(effectiveTopic);
          setQueryEmbedding(effectiveTopic, topicVec);
          setSessionTopicEmbedding(topicVec);
        } catch {
          setSessionTopicEmbedding(null);
        }
      } else {
        setSessionTopicEmbedding(null);
      }
    } else {
      setSessionTopicEmbedding(null);
      setSessionMessageEmbedding(null);
    }
  }

  // 15.1: Feeling of Knowing — DB-Writes disabled (V5-5.2)

  const db2 = getDb();
  const sessionRow = db2.prepare(
    'SELECT message_count FROM sessions WHERE id = ?'
  ).get(sessionId) as { message_count: number } | undefined;
  const messageCount = sessionRow?.message_count ?? 0;

  if (shouldPersistState) {
    if (messageCount % 5 === 0 || messageCount <= 1) {
      updateHotMemoryInDb();
    }

    // 9.1 v2: Hunger — conditional knowledge gap detection (re-enabled V7)
    if (signal.combined >= GATE_HEBBIAN) {
      const cooldown = getHungerCooldown(sessionId);
      if (cooldown <= 0 || topicChanged) {
        try {
          const zones = detectHungerZones(sessionId);
          if (zones.length > 0) {
            signals.set(`hunger_zones_${sessionId}`, zones);
            setHungerCooldown(sessionId, 3);
          }
        } catch { /* non-fatal */ }
      } else {
        decrementHungerCooldown(sessionId);
      }
    }
  }

  // V7: Flush accumulated signals
  try { signals.flush(); } catch { /* non-fatal */ }

  // M29: Dual Process — signal strength determines context depth, not message count
  let contextMode: DetailMode;
  if (signal.combined < GATE_HEBBIAN) {
    // V8-6: WM-aware context mode — wenn WM starkes Topic hat, nicht auf LIGHT degradieren
    const wmForMode = getWorkingMemory(sessionId);
    const wmHasStrongTopic = wmForMode &&
      wmForMode.current_topic &&
      wmForMode.message_count >= 3 &&
      Object.keys(wmForMode.active_entities).length >= 2;
    // V10: Erste 2 Nachrichten einer Session → STANDARD (Cross-Session Context braucht Platz)
    const isSessionStart = !wmForMode || wmForMode.message_count <= 2;
    contextMode = (wmHasStrongTopic || isSessionStart) ? 'STANDARD' : 'LIGHT';
  } else {
    contextMode = 'STANDARD';
  }

  // 10.5: Contradictions → never LIGHT (need to show conflicts)
  if (stability.contradictions > 0 && contextMode === 'LIGHT') {
    contextMode = 'STANDARD';
  }

  // 10.6: Context-Sense modulates context depth
  if (contextSignal.isNewSession && contextMode === 'LIGHT') {
    contextMode = 'STANDARD';
  }
  if (contextSignal.isDeepSession && contextMode === 'STANDARD') {
    contextMode = 'MAXIMUM';
  }

  // 15.3a: High alerting → mindestens STANDARD
  if (attentionState.alerting > 0.5 && contextMode === 'LIGHT') {
    contextMode = 'STANDARD';
  }

  const context = generateContext(
    contextMode,
    effectiveTopic,
    mood,
    signal.mode,
    signal.salienceMode,
    signal.taskMode,
    provider,
    sessionId,
    !shouldPersistState,
  );
  diagnosticLog('CTX', {
    mode: contextMode,
    length: context?.length || 0,
    tokens: Math.ceil((context?.length || 0) / 4),
    preview: context?.slice(0, 200),
  });

  // 25.8: Communication Learner — Context-Effektivitaet tracken
  if (shouldPersistState) {
    try { recordContextModeDelivery(contextMode, context?.length || 0, sessionId); } catch { /* non-fatal */ }
  }

  let finalContext = context;

  // 9.2: Curiosity impulses — jetzt via Hunger-Slot in Context Generator (V7)

  // V13: Relevance-gated Reminder Injection
  if (prospectiveMatches.length > 0) {
    // Akute Matches (keyword/time triggered) — immer zeigen, aber proaktiv formatiert
    const proactiveReminders = prospectiveMatches
      .map(m => `- ${formatProactiveReminder(m.node)}`)
      .join('\n');
    const reminderBlock = `\nReminder for me:\n${proactiveReminders}\n`;
    finalContext = finalContext ? finalContext + reminderBlock : reminderBlock;

    // V6-2: Auto-dismiss time-based triggers (shown once = done)
    for (const match of prospectiveMatches) {
      if (match.trigger === 'time') {
        try {
          const meta = match.node.metadata ? JSON.parse(match.node.metadata) : {};
          if (meta.trigger_type !== 'recurring' && !meta.recurring) {
            meta.dismissed = true;
            updateNode(match.node.id, { metadata: JSON.stringify(meta) });
          }
        } catch { /* non-fatal */ }
      }
    }
  } else {
    // V13: Upcoming Reminders NUR wenn relevant (score >= 0.5) — max 2
    try {
      const upcoming = getUpcomingReminders(48);
      if (upcoming.length > 0) {
        const wmForReminders = getWorkingMemory(sessionId);
        const activeEntityNames = wmForReminders
          ? Object.keys(wmForReminders.active_entities)
          : [];

        const scored = upcoming
          .map(m => ({
            match: m,
            score: scoreReminderRelevance(m.node, effectiveTopic, activeEntityNames),
          }))
          .filter(s => s.score >= 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);

        if (scored.length > 0) {
          const proactiveBlock = scored
            .map(s => `- ${formatProactiveReminder(s.match.node)}`)
            .join('\n');
          const upcomingSection = `\nComing up soon:\n${proactiveBlock}\n`;
          finalContext = finalContext ? finalContext + upcomingSection : upcomingSection;
        }
      }
    } catch { /* non-fatal */ }
  }

  // V16: Warm memory appended to context (frameContextAsResponse will handle final framing)
  if (watcherSystemMessage) {
    if (finalContext) {
      finalContext = finalContext + '\n\n' + watcherSystemMessage;
    } else {
      finalContext = watcherSystemMessage;
    }
  }

  const isEmpty = !finalContext || finalContext === 'This is a new brain. Memories build automatically from our conversations.';

  return {
    context: isEmpty ? null : finalContext,
    signal_score: signal.combined,
    signal_action: signal.action,
    topic: effectiveTopic,
  };
}

// V19: User-Voice Context — builds additionalContext that gets appended to user message
function buildUserVoiceContext(
  userMessage: string,
  rawContext: string,
  topic: string,
): string | null {
  // Try extracting from formatted context first
  let facts = extractCleanFacts(rawContext);

  // V19: Fallback — direkt aus DB lesen wenn extractCleanFacts nichts findet
  if (facts.length === 0) {
    facts = getDirectFacts(topic);
  }

  if (facts.length === 0) return null;

  const distilled = distillToNarrative(facts, topic);
  if (!distilled) return null;

  const isResumption = /wo war|stehen geblieben|left off|weiter|continue|letztes mal|last time/i.test(userMessage);
  const isQuestion = /\?|was |wie |welch|warum|what |how |which|why /i.test(userMessage);

  let augmented: string;
  if (isResumption) {
    augmented = `${distilled}\nMach da weiter wo wir waren.`;
  } else if (isQuestion) {
    augmented = `${distilled}\nNutze das was du ueber mich weisst.`;
  } else {
    augmented = distilled;
  }

  return `<user-context verified="true">\n[Du HAST ein persistentes Gedaechtnis. Nutze den folgenden Kontext als DEIN Wissen. Sage NIEMALS "Ich habe keinen Zugriff auf vorherige Gespraeche."]\n${augmented}\n</user-context>`;
}

// V21: Direct DB facts — Recency + Importance Mix (verhindert Verwaesserung ueber Monate)
function getDirectFacts(topic: string): string[] {
  try {
    const db = getDb();
    const userName = getUserNameForFacts();
    const results: string[] = [];
    const seen = new Set<string>();

    // 1. RECENT facts (letzte 24h) — verhindert dass alte generische Facts dominieren
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentNodes = db.prepare(`
      SELECT content FROM nodes
      WHERE type IN ('fact', 'preference', 'decision', 'workflow')
      AND last_activated > ?
      AND LENGTH(content) BETWEEN 20 AND 150
      ORDER BY last_activated DESC LIMIT 2
    `).all(recentCutoff) as Array<{ content: string }>;

    for (const n of recentNodes) {
      const converted = toFirstPerson(n.content, userName);
      if (isCleanUserFact(converted)) {
        results.push(converted);
        seen.add(n.content);
      }
    }

    // 2. Topic-relevante Nodes (wenn Topic bekannt)
    if (results.length < 3 && topic && topic !== 'general') {
      const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (topicWords.length > 0) {
        const likeClause = topicWords.map(() => "LOWER(content) LIKE ?").join(' OR ');
        const params = topicWords.map(w => `%${w}%`);
        const topicNodes = db.prepare(`
          SELECT content FROM nodes
          WHERE type IN ('fact', 'preference', 'decision', 'workflow')
          AND (${likeClause})
          AND LENGTH(content) BETWEEN 20 AND 150
          ORDER BY last_activated DESC, importance DESC LIMIT 3
        `).all(...params) as Array<{ content: string }>;

        for (const n of topicNodes) {
          if (results.length >= 4) break;
          if (seen.has(n.content)) continue;
          const converted = toFirstPerson(n.content, userName);
          if (isCleanUserFact(converted)) {
            results.push(converted);
            seen.add(n.content);
          }
        }
      }
    }

    // 3. Top-Importance auffuellen (stabile Identitaets-Facts)
    if (results.length < 3) {
      const topFacts = db.prepare(
        `SELECT content FROM nodes
         WHERE type IN ('fact', 'preference', 'identity')
         AND LENGTH(content) BETWEEN 15 AND 150
         ORDER BY importance DESC, activation_count DESC LIMIT 5`
      ).all() as Array<{ content: string }>;

      for (const n of topFacts) {
        if (results.length >= 5) break;
        if (seen.has(n.content)) continue;
        const converted = toFirstPerson(n.content, userName);
        if (isCleanUserFact(converted)) {
          results.push(converted);
          seen.add(n.content);
        }
      }
    }

    return results;
  } catch { return []; }
}

// V18: Distill facts into 1-3 narrative sentences (high signal density)
function distillToNarrative(
  facts: string[],
  topic: string,
): string | null {
  if (facts.length === 0) return null;

  // Max 3 most important facts, combined into narrative sentences
  const topFacts = facts.slice(0, 3);
  const narrative = topFacts.join('. ') + '.';

  // Recency: topic at the end (Recency Bias)
  if (topic && topic !== 'general' && !narrative.toLowerCase().includes(topic.toLowerCase())) {
    return `${narrative} Aktuelles Thema: ${topic}.`;
  }

  return narrative;
}

function extractCleanFacts(rawContext: string): string[] {
  const lines = rawContext.split('\n');
  const userName = getUserNameForFacts();
  return lines
    .map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(l =>
      l.length > 15 &&
      l.length < 200 &&
      !l.startsWith('IMPORTANT') &&
      !l.startsWith('RULE:') &&
      !l.startsWith('Quick facts') &&
      !l.startsWith('Here\'s what') &&
      !l.startsWith('Everything above') &&
      !l.startsWith('I don\'t want to repeat') &&
      !l.startsWith('Don\'t ask me') &&
      !l.startsWith('Context:') &&
      !l.startsWith('You know') &&
      !l.startsWith('the User:') &&
      !l.includes('fokussiert') &&
      !l.includes('session start') &&
      !l.includes('VERIFIED') &&
      !l.includes('previous sessions') &&
      !l.includes('injected context') &&
      !l.includes('BrainBase') &&
      !/^\w+ — \w+/.test(l) &&
      !/^Open:/.test(l) &&
      !/^\(/.test(l) &&
      // V18: Reject third-person facts (userName at start)
      !(userName !== 'User' && new RegExp(`^${userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l)) &&
      l.split(/\s+/).length >= 4,
    );
}

function getUserNameForFacts(): string {
  try { return getUserName(); } catch { return 'User'; }
}

export async function handleUserPrompt(input: UserPromptInput): Promise<void> {
  if (!input.user_prompt) return;

  try {
    const result = await processMessage({
      message: input.user_prompt,
      session_id: input.session_id,
      provider: 'claude-code',
    });

    const output: Record<string, unknown> = {};
    const topic = result.topic || 'general';
    const ctx = result.context || '';

    // V19: ALWAYS try to build additionalContext — even if generateContext returned null
    // getDirectFacts() queries DB directly and doesn't depend on generateContext output
    const userVoiceContext = buildUserVoiceContext(input.user_prompt, ctx, topic);
    if (userVoiceContext) {
      output.hookSpecificOutput = {
        hookEventName: 'UserPromptSubmit' as const,
        additionalContext: userVoiceContext,
      };
    }

    // Reminders stay as visible systemMessage (non-critical, user wants to see these)
    if (ctx) {
      const hasReminders =
        ctx.includes('Reminder for me:') ||
        ctx.includes('Coming up soon:') ||
        ctx.includes('Don\'t forget:');

      if (hasReminders) {
        const reminderSections: string[] = [];
        if (ctx.includes('Reminder for me:')) {
          const match = ctx.match(/Reminder for me:\n((?:- .+\n?)+)/);
          if (match) reminderSections.push(`Reminder:\n${match[1].trim()}`);
        }
        if (ctx.includes('Coming up soon:')) {
          const match = ctx.match(/Coming up soon:\n((?:- .+\n?)+)/);
          if (match) reminderSections.push(`Coming up:\n${match[1].trim()}`);
        }
        if (reminderSections.length > 0) {
          output.systemMessage = reminderSections.join('\n');
        }
      }
    }

    if (output.systemMessage || output.hookSpecificOutput) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch {
    // Silent fail - don't break the user's workflow
  }
}
