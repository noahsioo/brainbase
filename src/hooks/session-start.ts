import { createSession } from '../memory/store.js';
import { generateContext } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { decayAllActivations } from '../memory/activation.js';
import { incrementSessionCount, isCriticalPeriod } from '../memory/cold-start.js';
import { getConfig } from '../config.js';
import { buildPrediction, savePrediction } from '../signal/prediction.js';

interface SessionStartInput {
  session_id?: string;
  transcript_path?: string;
}

export async function handleSessionStart(input: SessionStartInput): Promise<void> {
  try {
    decayAllActivations();

    const sessionCount = incrementSessionCount();
    const critical = isCriticalPeriod();
    const sessionId = input.session_id || `session-${Date.now()}`;

    createSession('claude-code', sessionId);

    const prediction = buildPrediction();
    if (prediction) {
      savePrediction(prediction);
    }

    const config = getConfig();
    if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
      sendToWatcher('session-start', {
        session_id: sessionId,
        transcript_path: input.transcript_path,
        critical_period: critical,
        session_count: sessionCount,
      }).catch(() => {});
    }

    const context = generateContext('LIGHT');

    let systemMessage: string;
    if (context && context !== 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.') {
      systemMessage = `[Memory System Active - Session #${sessionCount}${critical ? ' (Learning Mode)' : ''}]\n\n${context}`;
    } else {
      systemMessage = '[Memory System Active] Noch keine Memories vorhanden. Das System lernt automatisch.';
    }

    const output = JSON.stringify({ systemMessage });
    process.stdout.write(output);
  } catch (err) {
    const fallback = JSON.stringify({
      systemMessage: '[Memory System Active] System gestartet.',
    });
    process.stdout.write(fallback);
  }
}
