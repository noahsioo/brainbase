import { createSession, getDb, findEntityByName } from '../memory/store.js';
import { generateContext } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { clearSessionActivationOverlay, activateNode } from '../memory/activation.js';
import { incrementSessionCount, isCriticalPeriod, getDevelopmentPhase } from '../memory/cold-start.js';
import { getConfig } from '../config.js';
import { buildPrediction, savePrediction } from '../signal/prediction.js';
import { startNewSessionTrend } from '../regulation/allostasis.js';
import { getScope } from '../memory/session-scope.js';
import { runConsolidation, getLastConsolidation } from '../consolidation/consolidation-runner.js';
import { createEmbeddingClient } from '../llm/embeddings.js';
import { initWorkingMemory } from '../memory/working-memory.js';
import { checkProspectiveTriggers, getUpcomingReminders, type ProspectiveMatch } from '../memory/prospective.js';
import { getOpenTasks } from '../watcher/task-watcher.js';

interface SessionStartInput {
  session_id?: string;
  transcript_path?: string;
}

export async function handleSessionStart(input: SessionStartInput): Promise<void> {
  try {
    // 21.1: Neuer Session-Trend-Datenpunkt
    try { startNewSessionTrend(); } catch { /* non-fatal */ }

    const sessionCount = incrementSessionCount();
    const critical = isCriticalPeriod();
    const sessionId = input.session_id || `session-${Date.now()}`;

    clearSessionActivationOverlay(sessionId);
    createSession('claude-code', sessionId);
    initWorkingMemory(sessionId);
    loadSessionBridge(sessionId);
    getScope(sessionId);

    // V3 Phase 6: Consolidation bei >6h seit letzter
    try {
      const lastConsolidation = getLastConsolidation();
      const hoursSince = (Date.now() - lastConsolidation) / (60 * 60 * 1000);
      if (hoursSince > 6) {
        setTimeout(() => { runConsolidation().catch(() => {}); }, 5000);
      }
    } catch { /* non-fatal */ }

    // V3 Phase 6: Embedding-Health Check
    try {
      const db = getDb();
      const embClient = createEmbeddingClient();
      db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run('embedding_status', embClient ? 'available' : 'unavailable', Date.now());
    } catch { /* non-fatal */ }

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
    const context = generateContext('STANDARD', undefined, undefined, undefined, undefined, undefined, undefined, sessionId);

    // V6-4: Morgen-Check — faellige Reminders bei Session-Start
    let dueReminders: ReturnType<typeof checkProspectiveTriggers> = [];
    let upcomingReminders: ProspectiveMatch[] = [];
    try {
      dueReminders = checkProspectiveTriggers('');
      upcomingReminders = getUpcomingReminders(24);
    } catch { /* non-fatal */ }

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
      if (dueReminders.length > 0) {
        const reminderBlock = dueReminders
          .map(m => `- ${m.node.content}`)
          .join('\n');
        systemMessage += `## Erinnerungen\n${reminderBlock}\n\n`;
      }
      if (upcomingReminders.length > 0) {
        const upcomingBlock = upcomingReminders
          .map(m => formatUpcoming(m))
          .join('\n');
        systemMessage += `## Bald faellig\n${upcomingBlock}\n\n`;
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

function loadSessionBridge(sessionId: string): void {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'session_bridge'")
      .get() as { value: string } | undefined;
    if (!row) return;

    const bridge = JSON.parse(row.value) as {
      last_topic: string;
      top_entities: Array<{ name: string; score: number }>;
      open_questions: string[];
      timestamp: number;
    };

    // Bridge nur 24h gueltig
    const ageHours = (Date.now() - bridge.timestamp) / (1000 * 60 * 60);
    if (ageHours > 24) return;

    // Frischer Bridge = staerkere Aktivierung
    const energyScale = ageHours < 2 ? 0.5 : ageHours < 8 ? 0.3 : 0.15;

    for (const entity of bridge.top_entities) {
      const entityNode = findEntityByName(entity.name);
      if (entityNode) {
        activateNode(entityNode.id, entity.score * energyScale, sessionId);
      }
    }
  } catch { /* non-fatal */ }
}

function getLastSessionSummary(): string | null {
  try {
    const db = getDb();

    // V6-5: Get last completed session — NOW includes summary column
    const lastSession = db.prepare(`
      SELECT id, message_count, topics, started_at, ended_at, summary
      FROM sessions WHERE ended_at IS NOT NULL
      ORDER BY ended_at DESC LIMIT 1
    `).get() as { id: string; message_count: number; topics: string; started_at: number; ended_at: number; summary: string | null } | undefined;

    if (!lastSession) return null;

    const parts: string[] = [];

    // Session info
    const duration = lastSession.ended_at - lastSession.started_at;
    const minutes = Math.round(duration / 60000);
    parts.push(`Letzte Session: ${lastSession.message_count} Nachrichten, ${minutes} Min.`);

    // V6-5: Use WM summary if available (contains topic history + open questions)
    if (lastSession.summary) {
      parts.push(lastSession.summary);
    } else {
      // Fallback: Topics + last message
      try {
        const topics = JSON.parse(lastSession.topics) as string[];
        if (topics.length > 0) {
          parts.push(`Themen: ${topics.slice(0, 3).join(', ')}`);
        }
      } catch { /* no topics */ }

      const lastMessages = db.prepare(
        "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 3"
      ).all(lastSession.id) as Array<{ content: string }>;

      if (lastMessages.length > 0) {
        const lastMsg = lastMessages[0].content;
        const truncated = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
        parts.push(`Letzter Austausch: "${truncated}"`);
      }
    }

    const openTasks = getOpenTasks(lastSession.id)
      .slice(0, 3)
      .map(task => task.content);

    if (openTasks.length > 0) {
      parts.push(`Offene Tasks aus letzter Session: ${openTasks.join('; ')}`);
    }

    return parts.join('\n');
  } catch {
    return null;
  }
}

// V10-5: Upcoming Reminders formatieren mit Zeitangabe
function formatUpcoming(match: ProspectiveMatch): string {
  try {
    const meta = JSON.parse(match.node.metadata || '{}') as Record<string, unknown>;
    const date = new Date(meta.trigger_date as number);
    const now = new Date();
    const diffH = Math.round((date.getTime() - now.getTime()) / (60 * 60 * 1000));

    let timeLabel: string;
    if (diffH <= 1) timeLabel = 'In ~1 Stunde';
    else if (diffH < 24) timeLabel = `In ~${diffH} Stunden`;
    else {
      const dayStr = date.toLocaleDateString('de-DE', { weekday: 'long' });
      timeLabel = dayStr;
    }

    return `- ${timeLabel}: ${match.node.content}`;
  } catch {
    return `- ${match.node.content}`;
  }
}
