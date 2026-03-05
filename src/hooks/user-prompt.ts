import { addToRawBuffer, getDb } from '../memory/store.js';
import { activateByQuery } from '../memory/activation.js';
import { generateContext } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import { calculateSignalStrength, GATE_HEBBIAN, GATE_LLM } from '../signal/signal-strength.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { detectFeedbackSignal, detectMood, setCurrentMood, applyFeedbackToRecentNodes, applyFeedbackOutcome } from '../signal/echo.js';
import { updateHotMemoryInDb, updateAllProviderFiles } from '../memory/hot.js';
import { trackExpertise } from '../learning/expertise-tracker.js';
import { trackProblem } from '../learning/outcome-tracker.js';

interface UserPromptInput {
  session_id?: string;
  user_prompt?: string;
}

export async function handleUserPrompt(input: UserPromptInput): Promise<void> {
  if (!input.user_prompt) return;

  try {
    const sessionId = input.session_id || `session-${Date.now()}`;

    // Always save to raw buffer
    addToRawBuffer({
      session_id: sessionId,
      provider: 'claude-code',
      role: 'user',
      content: input.user_prompt,
      timestamp: Date.now(),
    });

    // Meta-learner scoring (lightweight, no LLM)
    updateMetaProfile(input.user_prompt);

    // Expertise tracking (lightweight, keyword-based)
    trackExpertise(input.user_prompt);

    // Outcome tracking: detect problems
    trackProblem(input.user_prompt, sessionId);

    // Signal strength first - this updates counters + co-occurrence
    const signal = calculateSignalStrength(input.user_prompt, sessionId);

    // Echo System: detect feedback + update mood + outcome tracking
    const feedback = detectFeedbackSignal(input.user_prompt);
    applyFeedbackToRecentNodes(feedback);
    applyFeedbackOutcome(feedback, sessionId);
    const mood = detectMood(input.user_prompt, signal.flags.frustration);
    setCurrentMood(mood);

    // Layer 1: Regex extraction always runs (passes flags from signal for emotional tagging)
    extractFromPrompt(input.user_prompt, sessionId, signal.flags);

    // Gate: Only activate existing nodes (Hebbian) if signal >= 0.3
    if (signal.score >= GATE_HEBBIAN) {
      activateByQuery(input.user_prompt);
    }

    // Gate: Only send to LLM watcher if signal >= 0.6
    if (signal.score >= GATE_LLM) {
      const config = getConfig();
      if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
        sendToWatcher('user-prompt', {
          session_id: sessionId,
          user_prompt: input.user_prompt,
          signal_score: signal.score,
          signal_action: signal.action,
          signal_flags: signal.flags,
        }).catch(() => {});
      }
    }

    // Hot Memory: always update DB, provider files every 10 prompts
    updateHotMemoryInDb();

    const db = getDb();
    const promptCount = db.prepare(
      "SELECT COUNT(*) as c FROM raw_buffer WHERE session_id = ?",
    ).get(sessionId) as { c: number };
    if (promptCount.c % 10 === 0) {
      updateAllProviderFiles();
    }

    const context = generateContext('LIGHT');

    if (context && context !== 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.') {
      const output = JSON.stringify({ systemMessage: context });
      process.stdout.write(output);
    }
  } catch {
    // Silent fail - don't break the user's workflow
  }
}
