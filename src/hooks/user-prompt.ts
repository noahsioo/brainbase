import { addToRawBuffer, getDb, setQueryEmbedding } from '../memory/store.js';
import { activateByQuery } from '../memory/activation.js';
import { generateContext, setSessionTopicEmbedding } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import { calculateSignalStrength, GATE_HEBBIAN, GATE_LLM } from '../signal/signal-strength.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { detectFeedbackSignal, detectMood, setCurrentMood, applyFeedbackToRecentNodes, applyFeedbackOutcome } from '../signal/echo.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { trackExpertise } from '../learning/expertise-tracker.js';
import { trackProblem } from '../learning/outcome-tracker.js';
import { checkProspectiveTriggers } from '../memory/prospective.js';
import { createEmbeddingClient } from '../llm/embeddings.js';

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

  const signal = calculateSignalStrength(input.message, sessionId);
  const topEntities = signal.entities.slice(0, 3);
  const currentTopic = topEntities.length > 0 ? topEntities.join(' ') : undefined;

  const feedback = detectFeedbackSignal(input.message);
  applyFeedbackToRecentNodes(feedback);
  applyFeedbackOutcome(feedback, sessionId);
  const mood = detectMood(input.message, signal.flags.frustration);
  setCurrentMood(mood);

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

  if (signal.score >= GATE_HEBBIAN) {
    activateByQuery(input.message);
  }

  // Prospective Memory: check if any triggers match
  const prospectiveMatches = checkProspectiveTriggers(input.message);

  let watcherSystemMessage: string | undefined;
  if (signal.score >= GATE_LLM) {
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
        signal_score: signal.score,
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

  const contextMode = messageCount >= 10 ? 'STANDARD' : 'LIGHT';
  const context = generateContext(contextMode as 'LIGHT' | 'STANDARD', currentTopic);

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
    signal_score: signal.score,
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
