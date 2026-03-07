import { createSession, getDb } from '../memory/store.js';
import { generateContext } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { decayAllActivations } from '../memory/activation.js';
import { incrementSessionCount, isCriticalPeriod, getDevelopmentPhase } from '../memory/cold-start.js';
import { getConfig } from '../config.js';
import { buildPrediction, savePrediction } from '../signal/prediction.js';
import { startNewSessionTrend } from '../regulation/allostasis.js';
import { getScope } from '../memory/session-scope.js';

interface SessionStartInput {
  session_id?: string;
  transcript_path?: string;
}

export async function handleSessionStart(input: SessionStartInput): Promise<void> {
  try {
    decayAllActivations();
    // 21.1: Neuer Session-Trend-Datenpunkt
    try { startNewSessionTrend(); } catch { /* non-fatal */ }

    const sessionCount = incrementSessionCount();
    const critical = isCriticalPeriod();
    const sessionId = input.session_id || `session-${Date.now()}`;

    createSession('claude-code', sessionId);
    getScope(sessionId);

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

    // Priming: load last session summary + use STANDARD mode at session start
    const lastSummary = getLastSessionSummary();
    const context = generateContext('STANDARD');

    let systemMessage: string;
    if (context && context !== 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.') {
      // 18.2: Phase label statt binary Learning Mode
      const devPhase = getDevelopmentPhase();
      const phaseLabel: Record<string, string> = {
        infant: 'Lernmodus', child: 'Wachstumsphase', teen: 'Spezialisierung', adult: 'Stabil', wise: 'Erfahren',
      };
      systemMessage = `[Memory System Active - Session #${sessionCount} (${phaseLabel[devPhase.phase]})]\n\n`;
      if (lastSummary) {
        systemMessage += `## Letzter Stand\n${lastSummary}\n\n`;
      }
      if (prediction) {
        systemMessage += `## Erwartung\nWahrscheinliches Thema: ${prediction.expected_topic} (${Math.round(prediction.confidence * 100)}%)\n\n`;
      }
      systemMessage += context;
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

function getLastSessionSummary(): string | null {
  try {
    const db = getDb();

    // Get last completed session
    const lastSession = db.prepare(`
      SELECT id, message_count, topics, started_at, ended_at
      FROM sessions WHERE ended_at IS NOT NULL
      ORDER BY ended_at DESC LIMIT 1
    `).get() as { id: string; message_count: number; topics: string; started_at: number; ended_at: number } | undefined;

    if (!lastSession) return null;

    const parts: string[] = [];

    // Session info
    const duration = lastSession.ended_at - lastSession.started_at;
    const minutes = Math.round(duration / 60000);
    parts.push(`Letzte Session: ${lastSession.message_count} Nachrichten, ${minutes} Min.`);

    // Topics
    try {
      const topics = JSON.parse(lastSession.topics) as string[];
      if (topics.length > 0) {
        parts.push(`Themen: ${topics.slice(0, 3).join(', ')}`);
      }
    } catch { /* no topics */ }

    // Last 3 messages from that session
    const lastMessages = db.prepare(
      "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 3"
    ).all(lastSession.id) as Array<{ content: string }>;

    if (lastMessages.length > 0) {
      const lastMsg = lastMessages[0].content;
      const truncated = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
      parts.push(`Letzter Austausch: "${truncated}"`);
    }

    // Open tasks
    const openTasks = db.prepare(
      "SELECT content FROM nodes WHERE type = 'task' AND (emotional_tag IS NULL OR emotional_tag != 'done') ORDER BY importance DESC LIMIT 3"
    ).all() as Array<{ content: string }>;

    if (openTasks.length > 0) {
      parts.push(`Offene Tasks: ${openTasks.map(t => t.content).join('; ')}`);
    }

    return parts.join('\n');
  } catch {
    return null;
  }
}
