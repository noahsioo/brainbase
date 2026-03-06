import { addToRawBuffer, getDb, getNode, updateNode, setQueryEmbedding } from '../memory/store.js';
import { activateByQuery, activateByConversation, primeActivations, applySTDP, getCurrentlyActivatedEntityIds, getLastSTDPEntities, setLastSTDPEntities, setCurrentEncodingContext, setSystemMode } from '../memory/activation.js';
import { generateContext, setSessionTopicEmbedding, type DetailMode } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import { GATE_HEBBIAN, GATE_LLM } from '../signal/signal-strength.js';
import { processThalamic, deriveSystemMode } from '../signal/thalamus.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { detectFeedbackSignal, detectMood, setCurrentMood, applyFeedbackToRecentNodes, applyFeedbackOutcome, applySomaticMarkers } from '../signal/echo.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { trackExpertise } from '../learning/expertise-tracker.js';
import { trackProblem } from '../learning/outcome-tracker.js';
import { checkProspectiveTriggers } from '../memory/prospective.js';
import { createEmbeddingClient } from '../llm/embeddings.js';
import { loadPrediction, calculatePredictionError } from '../signal/prediction.js';

interface UserPromptInput {
  session_id?: string;
  user_prompt?: string;
}

export interface ProcessMessageInput {
  message: string;
  session_id?: string;
  provider?: string;
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
function applyTaskSwitchingCost(sessionId: string, currentTopic: string | undefined): void {
  if (!currentTopic) return;

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

  if (!prevTopic || prevTopic === currentTopic) return;

  // Topic changed — fade old topic nodes
  const prevWords = prevTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (prevWords.length === 0) return;

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
}

export async function processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const sessionId = input.session_id || `session-${Date.now()}`;
  const provider = input.provider || 'mcp';

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

  const signal = processThalamic(input.message, sessionId);
  // M52: Gehirnwellen — set system mode for activation parameter modulation
  setSystemMode(deriveSystemMode(signal.mode, signal.salienceMode));
  // M28: Stable session focus instead of volatile per-message entities
  const focusEntities = updateSessionFocus(sessionId, signal.entities.slice(0, 5));
  const currentTopic = focusEntities.length > 0 ? focusEntities.slice(0, 3).join(' ') : undefined;

  // M32: Task Switching Cost — smooth transition when topic changes
  applyTaskSwitchingCost(sessionId, currentTopic);

  const feedback = detectFeedbackSignal(input.message);
  applyFeedbackToRecentNodes(feedback);
  applySomaticMarkers(feedback);
  applyFeedbackOutcome(feedback, sessionId);
  const mood = detectMood(input.message, signal.flags.frustration);
  setCurrentMood(mood);

  // M36: Set encoding context for retrieval matching in activation
  setCurrentEncodingContext({
    mood,
    topic: currentTopic,
    provider,
  });

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
  };

  db2es.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(`encoding_signal_${sessionId}`, JSON.stringify(encodingSignal), Date.now());

  extractFromPrompt(input.message, sessionId, signal.flags);

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

  if (signal.combined >= GATE_HEBBIAN) {
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

    primeActivations(0.3);
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

  // Prospective Memory: check if any triggers match
  const prospectiveMatches = checkProspectiveTriggers(input.message);

  let watcherSystemMessage: string | undefined;
  if (signal.combined >= GATE_LLM) {
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

  if (messageCount % 5 === 0 || messageCount <= 1) {
    updateHotMemoryInDb();
  }

  // M29: Dual Process — signal strength determines context depth, not message count
  let contextMode: DetailMode;
  if (signal.combined < GATE_HEBBIAN) {
    contextMode = 'LIGHT';
  } else {
    contextMode = 'STANDARD';
  }
  const context = generateContext(contextMode, currentTopic, mood, signal.mode, signal.salienceMode);

  let finalContext = context;

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
