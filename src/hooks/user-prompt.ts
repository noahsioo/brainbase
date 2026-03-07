import { addToRawBuffer, getDb, getNode, updateNode, setQueryEmbedding } from '../memory/store.js';
import { activateByQuery, activateByConversation, primeActivations, applySTDP, getCurrentlyActivatedEntityIds, getLastSTDPEntities, setLastSTDPEntities, setCurrentEncodingContext, setSystemMode, setCurrentTaskMode, applyDisinhibition, clearDisinhibitionTargets, startNewCoherenceRound } from '../memory/activation.js';
import { generateContext, setSessionTopicEmbedding, type DetailMode } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import { GATE_HEBBIAN, GATE_LLM } from '../signal/signal-strength.js';
import { processThalamic, deriveSystemMode } from '../signal/thalamus.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { detectFeedbackSignal, detectMood, setCurrentMood, applyFeedbackToRecentNodes, applyFeedbackOutcome, applySomaticMarkers, applyContextFeedback, detectEmpathyMode, trackProviderFeedback } from '../signal/echo.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { trackExpertise } from '../learning/expertise-tracker.js';
import { trackProblem } from '../learning/outcome-tracker.js';
import { checkProspectiveTriggers } from '../memory/prospective.js';
import { createEmbeddingClient } from '../llm/embeddings.js';
import { loadPrediction, calculatePredictionError } from '../signal/prediction.js';
import { detectHungerZones, detectLearningOpportunity, applyDopaminReward, markImpulseIgnored, getHungerZones, generateCuriosityImpulses, type HungerZone } from '../memory/knowledge-hunger.js';
import { detectEmotionBypass } from '../senses/emotion-sense.js';
import { getStability } from '../senses/stability-sense.js';
import { analyzeTone } from '../senses/tone-sense.js';
import { analyzeContext } from '../senses/context-sense.js';
import { detectFeelingOfKnowing, calculateAttentionState } from '../meta/metacognition.js';
import { getSystemMood, measureSystemHealth } from '../senses/interoception.js';
import { recordTrendPoint, predictAllostasis } from '../regulation/allostasis.js';
import { compareAndCorrect } from '../regulation/comparator.js';
import { calculateTradeoffs, updateTradeoffState } from '../regulation/tradeoffs.js';
import { calculateStressLevel } from '../regulation/stress-response.js';
import { shouldAllowLLMCall } from '../regulation/energy.js';
import { analyzeEnvironment } from '../senses/environment-sense.js';
import { integrateSenses } from '../senses/integration.js';
import { recordContextDelivery } from '../learning/communication-learner.js';

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
}

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

  const activeNodes = db.prepare(
    'SELECT id, content, activation FROM nodes WHERE activation > 0.1 LIMIT 30'
  ).all() as Array<{ id: string; content: string; activation: number }>;

  for (const node of activeNodes) {
    const contentLower = node.content.toLowerCase();
    const isOldTopic = prevWords.some(w => contentLower.includes(w));
    const newWords = currentTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const isNewTopic = newWords.some(w => contentLower.includes(w));

    if (isOldTopic && !isNewTopic) {
      const faded = node.activation * 0.7;
      db.prepare('UPDATE nodes SET activation = ? WHERE id = ?').run(faded, node.id);
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

export async function processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const sessionId = input.session_id || `session-${Date.now()}`;
  const provider = input.provider || 'mcp';

  if (!input.context_only) {
    addToRawBuffer({
      session_id: sessionId,
      provider,
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
    });

    getDb().prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?').run(sessionId);

    updateMetaProfile(input.message);
    trackExpertise(input.message);
    trackProblem(input.message, sessionId);
  }

  // 10.3: Emotion-Bypass (Olfaktion — umgeht Thalamus direkt)
  const emotionBypass = detectEmotionBypass(input.message);

  const signal = processThalamic(input.message, sessionId);
  // M52: Gehirnwellen — set system mode for activation parameter modulation
  setSystemMode(deriveSystemMode(signal.mode, signal.salienceMode), sessionId);
  // M28: Stable session focus instead of volatile per-message entities
  const focusEntities = updateSessionFocus(sessionId, signal.entities.slice(0, 5));
  const currentTopic = focusEntities.length > 0 ? focusEntities.slice(0, 3).join(' ') : undefined;

  // M32: Task Switching Cost — smooth transition when topic changes
  const topicChanged = applyTaskSwitchingCost(sessionId, currentTopic);

  // 12.1: Event Boundary — topic change = episode boundary
  if (topicChanged) {
    markEventBoundary(sessionId);
  }

  const feedback = detectFeedbackSignal(input.message);
  applyFeedbackToRecentNodes(feedback);
  applyContextFeedback(feedback);
  applySomaticMarkers(feedback);
  applyFeedbackOutcome(feedback, sessionId);
  trackProviderFeedback(feedback, provider);
  // 21.3: Comparator — vergleiche Context-Prediction mit Feedback
  compareAndCorrect(feedback);
  let mood = detectMood(input.message, signal.flags.frustration);
  setCurrentMood(mood);

  // 13.2: Empathy Mode — affective vs cognitive
  const empathyMode = detectEmpathyMode(input.message, mood);
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('current_empathy_mode', empathyMode, Date.now());

  // 10.3: Bypass overrides normal mood + boosts emotion nucleus
  if (emotionBypass.triggered) {
    if (emotionBypass.moodOverride) {
      mood = emotionBypass.moodOverride;
      setCurrentMood(mood);
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

  // 10.3: Sarcasm flag for extractor (reduces extraction confidence)
  const dbSarcasm = getDb();
  dbSarcasm.prepare("DELETE FROM system_state WHERE key = 'current_sarcasm'").run();
  if (emotionBypass.type === 'sarcasm') {
    dbSarcasm.prepare("INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run('current_sarcasm', '1', Date.now());
  }

  // 13.3: Task-Set Inference — store current task mode
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('current_task_mode', signal.taskMode, Date.now());
  // 22.5: Adaptive Coding — Edge-Gewichte je nach TaskMode setzen
  setCurrentTaskMode(signal.taskMode, sessionId);

  // 10.5: Stability-Sense (Vestibular — bei Widerspruechen verlangsamen)
  const stability = getStability();
  if (stability.needsAttention) {
    signal.nuclei.novelty.raw *= 0.7;
  }

  // 10.2: Tone-Sense (Audition — WIE es klingt)
  const tone = analyzeTone(input.message);
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('current_tone', JSON.stringify(tone), Date.now());
  // 15.3: Drei Aufmerksamkeitssysteme
  const attentionState = calculateAttentionState(
    tone.urgency, signal.flags.frustration, signal.flags.explicit_memory,
    signal.entities.length, topicChanged,
    signal.nuclei.entity.raw, signal.taskMode,
  );
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('attention_state', JSON.stringify(attentionState), Date.now());

  // 15.3a: Alerting Override (subsumes tone.urgency > 0.7)
  if (attentionState.alerting > 0.7) {
    signal.combined = Math.max(signal.combined, GATE_LLM + 0.01);
    signal.action = 'full_extraction';
  }

  // 10.6: Context-Sense (Somatosensorik — wo stehen wir gerade?)
  const contextSignal = analyzeContext(sessionId, provider);
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('context_signal', JSON.stringify(contextSignal), Date.now());

  // M36: Set encoding context for retrieval matching in activation
  setCurrentEncodingContext({
    mood,
    topic: currentTopic,
    provider,
  }, sessionId);

  // M37: Synaptic Tagging — emotional events capture recent memories
  if (signal.nuclei.emotion.inhibited > 0.7) {
    const db = getDb();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentNodes = db.prepare(
      'SELECT id, importance FROM nodes WHERE created_at > ? ORDER BY created_at DESC LIMIT 10'
    ).all(fiveMinAgo) as Array<{ id: string; importance: number }>;

    for (const node of recentNodes) {
      const newImportance = Math.min(1.0, node.importance + 0.15);
      db.prepare('UPDATE nodes SET importance = ? WHERE id = ?').run(newImportance, node.id);
    }
  }

  // M36+M38+M39+M40: Encoding Signal — write to system_state for extractors
  const prediction = loadPrediction();
  const predictionError = prediction ? calculatePredictionError(prediction, input.message) : 0;

  const db2es = getDb();
  const sessionRowEs = db2es.prepare(
    'SELECT message_count FROM sessions WHERE id = ?'
  ).get(sessionId) as { message_count: number } | undefined;
  const msgIndex = sessionRowEs?.message_count ?? 0;

  const encodingSignal = {
    novelty: signal.nuclei.novelty.raw,
    prediction_error: predictionError,
    self_generated: signal.flags.self_generated,
    emotion_intensity: signal.nuclei.emotion.inhibited,
    session_topic: currentTopic,
    mood,
    provider,
    message_index: msgIndex,
    sarcasm_detected: emotionBypass.type === 'sarcasm' || tone.intent === 'sarcastic' || tone.intent === 'humorous',
    rhetorical_detected: tone.intent === 'rhetorical',
    emotion_bypass_type: emotionBypass.triggered ? emotionBypass.type : null,
    event_boundary: topicChanged,
  };

  db2es.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(`encoding_signal_${sessionId}`, JSON.stringify(encodingSignal), Date.now());

  // 17.4: System-Mood → Extraction Modulation
  const systemMood = getSystemMood();
  if (systemMood.energy < 0.3 && signal.combined < GATE_LLM) {
    signal.combined *= 0.8;
  }
  if (systemMood.curiosity > 0.7 && signal.combined >= GATE_HEBBIAN) {
    signal.combined = Math.max(signal.combined, GATE_LLM * 0.9);
  }

  // 21.1: Allostase — Trend-Tracking + antizipative Regulation
  try {
    const health = measureSystemHealth();
    recordTrendPoint(health, signal.flags.frustration);
    const prediction = predictAllostasis();
    if (prediction.recommendation === 'tighten') {
      signal.combined *= 0.85;
    } else if (prediction.recommendation === 'loosen') {
      signal.combined = Math.min(1.0, signal.combined * 1.1);
    }
  } catch { /* non-fatal */ }

  // 21.4: Tradeoff-Manager — dynamische Balance berechnen
  try {
    const sessionRow2 = getDb().prepare('SELECT message_count FROM sessions WHERE id = ?')
      .get(sessionId) as { message_count: number } | undefined;
    const tradeoffs = calculateTradeoffs(mood, signal.taskMode, sessionRow2?.message_count);
    updateTradeoffState(tradeoffs);
  } catch { /* non-fatal */ }

  // 21.5: Stress-Response — Graceful Degradation
  try { calculateStressLevel(); } catch { /* non-fatal */ }

  // 25.4: Environment Sense — Darm-Hirn-Analog
  let envSignal;
  try { envSignal = analyzeEnvironment(); } catch { /* non-fatal */ }

  // 25.7: Multisensorische Integration — Precision-weighted
  try {
    if (envSignal) {
      const percept = integrateSenses(tone, emotionBypass, stability, systemMood, envSignal);
      getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('integrated_percept', JSON.stringify(percept), Date.now());
    }
  } catch { /* non-fatal */ }

  if (!input.context_only) {
    extractFromPrompt(input.message, sessionId, signal.flags);

    // 9.4: Active Information Seeking — detect learning opportunities
    const learningTopics = detectLearningOpportunity(input.message, signal.entities);
    if (learningTopics.length > 0) {
      const dbLT = getDb();
      for (const topic of learningTopics) {
        dbLT.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
          .run(`hunger_boost_${topic}`, '1', Date.now());
      }
    }

    // 9.3: Dopamin-Reward — if user provides info about a hungry zone
    const previousZones = getHungerZones();
    if (previousZones.length > 0 && feedback !== 'negative') {
      for (const zone of previousZones) {
        if (input.message.toLowerCase().includes(zone.entity.toLowerCase())) {
          applyDopaminReward(zone.entity);
        }
      }
    }
  }

  // Pre-embed query for semantic search (non-blocking, best-effort)
  const embClient = createEmbeddingClient();
  if (embClient) {
    try {
      const queryVec = await embClient.embed(input.message);
      setQueryEmbedding(input.message, queryVec);
      if (currentTopic) {
        const topicVec = await embClient.embed(currentTopic);
        setQueryEmbedding(currentTopic, topicVec);
        setSessionTopicEmbedding(topicVec);
      }
    } catch {
      // Fallback to keyword search
    }
  }

  // 15.3b: Orienting → activation scope (before activation runs)
  getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('orienting_level', String(attentionState.orienting), Date.now());

  if (signal.combined >= GATE_HEBBIAN) {
    // 23.1: Disinhibition — bei explicit_memory archivierte Nodes freischalten
    if (signal.flags.explicit_memory) {
      applyDisinhibition(input.message, sessionId);
    }

    // 23.2: Neue Coherence-Runde starten
    startNewCoherenceRound(sessionId);

    const db = getDb();
    const recentRows = db.prepare(
      "SELECT content, role FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 5"
    ).all(sessionId) as Array<{ content: string; role: string }>;

    const CONV_WEIGHTS = [1.0, 0.6, 0.35, 0.2, 0.1];
    const messages = recentRows.map((r, i) => ({
      content: r.content,
      // M51: Corollary Discharge — own outputs weighted less (self-generated = less novel)
      weight: (CONV_WEIGHTS[i] ?? 0.1) * (r.role === 'assistant' ? 0.3 : 1.0),
    }));

    primeActivations(0.3, sessionId);
    activateByConversation(messages, sessionId);

    // M6: Sensory Gating — apply dampening to over-mentioned entities
    if (Object.keys(signal.dampening).length > 0) {
      for (const [entity, factor] of Object.entries(signal.dampening)) {
        const matches = db.prepare(
          "SELECT id, activation FROM nodes WHERE LOWER(content) = LOWER(?) AND activation > 0"
        ).all(entity) as Array<{ id: string; activation: number }>;
        for (const match of matches) {
          db.prepare('UPDATE nodes SET activation = ? WHERE id = ?')
            .run(match.activation * factor, match.id);
        }
      }
    }

    const currentEntities = getCurrentlyActivatedEntityIds();
    const previousEntities = getLastSTDPEntities(sessionId);
    applySTDP(previousEntities, currentEntities);
    setLastSTDPEntities(sessionId, currentEntities);

    // M45: Spacing Effect — track unique sessions for activated nodes
    const activatedIds = getCurrentlyActivatedEntityIds();
    for (const nodeId of activatedIds.slice(0, 20)) {
      const node = getNode(nodeId);
      if (!node) continue;
      let meta: Record<string, unknown> = {};
      try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }
      const sessions: string[] = (meta.unique_sessions as string[]) || [];
      if (!sessions.includes(sessionId)) {
        sessions.push(sessionId);
        if (sessions.length > 100) sessions.shift();
        meta.unique_sessions = sessions;
        updateNode(nodeId, { metadata: JSON.stringify(meta) });
      }
    }
  }

  // 23.1: Disinhibition Cleanup
  clearDisinhibitionTargets(sessionId);

  // 15.1: Feeling of Knowing
  const fokSignal = detectFeelingOfKnowing(currentTopic);
  if (fokSignal) {
    getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run('fok_signal', JSON.stringify(fokSignal), Date.now());
  } else {
    getDb().prepare("DELETE FROM system_state WHERE key = 'fok_signal'").run();
  }

  // Prospective Memory: check if any triggers match
  const prospectiveMatches = checkProspectiveTriggers(input.message);

  // 24.4: Energie-Management — LLM-Call Budget pruefen
  if (!shouldAllowLLMCall(sessionId) && signal.combined >= GATE_LLM) {
    signal.combined = Math.min(signal.combined, GATE_LLM - 0.01);
  }

  let watcherSystemMessage: string | undefined;
  if (!input.context_only && signal.combined >= GATE_LLM) {
    const config = getConfig();
    if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
      const db = getDb();
      const recentRows = db.prepare(
        "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 10"
      ).all(sessionId) as Array<{ content: string }>;
      const recentContext = recentRows.reverse().map(r => r.content).join('\n---\n');

      const watcherResponse = await sendToWatcher('user-prompt', {
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

  const db2 = getDb();
  const sessionRow = db2.prepare(
    'SELECT message_count FROM sessions WHERE id = ?'
  ).get(sessionId) as { message_count: number } | undefined;
  const messageCount = sessionRow?.message_count ?? 0;

  if (!input.context_only) {
    if (messageCount % 5 === 0 || messageCount <= 1) {
      updateHotMemoryInDb();
    }

    // 9.1: Detect hunger zones (every 3rd message to save perf)
    if (messageCount % 3 === 0 || messageCount <= 1) {
      detectHungerZones();
    }
  }

  // M29: Dual Process — signal strength determines context depth, not message count
  let contextMode: DetailMode;
  if (signal.combined < GATE_HEBBIAN) {
    contextMode = 'LIGHT';
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

  const context = generateContext(contextMode, currentTopic, mood, signal.mode, signal.salienceMode, signal.taskMode, provider);

  // 25.8: Communication Learner — Context-Effektivitaet tracken
  try { recordContextDelivery(contextMode, context?.length || 0); } catch { /* non-fatal */ }

  let finalContext = context;

  // 9.2: Inject curiosity impulses
  const hungerZones = getHungerZones();
  if (hungerZones.length > 0 && contextMode !== 'LIGHT') {
    const impulses = generateCuriosityImpulses(hungerZones);
    if (impulses.length > 0) {
      const impulseBlock = '\n' + impulses.join(' ');
      finalContext = finalContext ? finalContext + impulseBlock : impulseBlock;

      // Track: if user doesn't mention hungry entities next message, increment ignore
      getDb().prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run(`pending_impulses_${sessionId}`, JSON.stringify(hungerZones), Date.now());
    }
  }

  // Check if previous impulses were ignored
  const pendingRow = getDb().prepare("SELECT value FROM system_state WHERE key = ?")
    .get(`pending_impulses_${sessionId}`) as { value: string } | undefined;
  if (pendingRow) {
    const pending: HungerZone[] = JSON.parse(pendingRow.value);
    const ignoredZones = pending.filter(z =>
      !input.message.toLowerCase().includes(z.entity.toLowerCase())
    );
    if (ignoredZones.length > 0) {
      markImpulseIgnored(ignoredZones);
    }
    getDb().prepare("DELETE FROM system_state WHERE key = ?")
      .run(`pending_impulses_${sessionId}`);
  }

  // Inject prospective memory reminders
  if (prospectiveMatches.length > 0) {
    const reminders = prospectiveMatches
      .map(m => `- ${m.node.content}`)
      .join('\n');
    const reminderBlock = `\n## Erinnerung\n${reminders}\n`;
    finalContext = finalContext ? finalContext + reminderBlock : reminderBlock;
  }

  if (watcherSystemMessage && finalContext) {
    finalContext = finalContext + '\n' + watcherSystemMessage;
  } else if (watcherSystemMessage) {
    finalContext = watcherSystemMessage;
  }

  const isEmpty = !finalContext || finalContext === 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.';

  return {
    context: isEmpty ? null : finalContext,
    signal_score: signal.combined,
    signal_action: signal.action,
  };
}

export async function handleUserPrompt(input: UserPromptInput): Promise<void> {
  if (!input.user_prompt) return;

  try {
    const result = await processMessage({
      message: input.user_prompt,
      session_id: input.session_id,
      provider: 'claude-code',
    });

    if (result.context) {
      const output = JSON.stringify({ systemMessage: result.context });
      process.stdout.write(output);
    }
  } catch {
    // Silent fail - don't break the user's workflow
  }
}
