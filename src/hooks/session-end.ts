import { endSession, getDb } from '../memory/store.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { getConfig } from '../config.js';
import { runConsolidation, getLastConsolidation } from '../consolidation/consolidation-runner.js';
import { extractFromPrompt } from '../extraction/code-extractor.js';
import { calculateSignalStrength, GATE_HEBBIAN } from '../signal/signal-strength.js';
import { activateByQuery } from '../memory/activation.js';
import { extractEntities, updateCounters, checkAutoNodeCreation } from '../signal/counters.js';
import { clearScope } from '../memory/session-scope.js';


interface SessionEndInput {
  session_id?: string;
  transcript_path?: string;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export async function handleSessionEnd(input: SessionEndInput): Promise<void> {
  try {
    if (input.session_id) {
      const db = getDb();
      const row = db.prepare(
        'SELECT COUNT(*) as count FROM raw_buffer WHERE session_id = ?',
      ).get(input.session_id) as { count: number };

      db.prepare(
        'UPDATE sessions SET message_count = ? WHERE id = ?',
      ).run(row.count, input.session_id);

      endSession(input.session_id);
      clearScope(input.session_id);
    }

    const config = getConfig();
    if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
      sendToWatcher('session-end', {
        session_id: input.session_id,
        transcript_path: input.transcript_path,
      }).catch(() => {});
    } else if (config.watcher_engine === 'session' && input.session_id) {
      // Session mode: parse transcript locally via regex + entity counters
      parseTranscriptLocally(input.session_id);
    }

    // Auto-consolidation: run if last consolidation was 24h+ ago
    const lastConsolidation = getLastConsolidation();
    if (Date.now() - lastConsolidation > TWENTY_FOUR_HOURS) {
      if (config.watcher_engine !== 'none' && config.watcher_engine !== 'session') {
        // Daemon has LLM client → delegate for dream+distill phases
        sendToWatcher('consolidate', {}).catch(() => {
          // Fallback: local consolidation without LLM
          runConsolidation().catch(() => {});
        });
      } else {
        setTimeout(() => {
          runConsolidation().catch(() => {});
        }, 100);
      }
    }
  } catch {
    // Silent fail - session end should never break anything
  }
}

function parseTranscriptLocally(sessionId: string): void {
  try {
    const db = getDb();
    const messages = db.prepare(
      "SELECT content FROM raw_buffer WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC",
    ).all(sessionId) as Array<{ content: string }>;

    if (messages.length === 0) return;

    const entityCounts = new Map<string, number>();

    for (const msg of messages) {
      const signal = calculateSignalStrength(msg.content, sessionId);
      extractFromPrompt(msg.content, sessionId, signal.flags);

      if (signal.score >= GATE_HEBBIAN) {
        activateByQuery(msg.content);
      }

      const entities = extractEntities(msg.content);
      const counters = updateCounters(entities, sessionId);
      checkAutoNodeCreation(counters);

      // Collect entity frequencies for topic extraction
      for (const entity of entities) {
        entityCounts.set(entity, (entityCounts.get(entity) || 0) + 1);
      }
    }

    // Save top entities as session topics
    const topEntities = Array.from(entityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entity]) => entity);

    if (topEntities.length > 0) {
      try {
        const row = db.prepare('SELECT topics FROM sessions WHERE id = ?').get(sessionId) as { topics: string } | undefined;
        const existing: string[] = row ? JSON.parse(row.topics) : [];
        const merged = [...new Set([...existing, ...topEntities])];
        db.prepare('UPDATE sessions SET topics = ? WHERE id = ?').run(JSON.stringify(merged), sessionId);
      } catch { /* silent */ }
    }
  } catch {
    // Silent - transcript parsing should never break session end
  }
}
