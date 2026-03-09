import { createSession, getDb, findEntityByName } from '../memory/store.js';
import { getUserName } from '../memory/context-generator.js';
import { sendToWatcher } from '../watcher/daemon.js';
import { clearSessionActivationOverlay, activateNode } from '../memory/activation.js';
import { incrementSessionCount, isCriticalPeriod } from '../memory/cold-start.js';
import { getConfig } from '../config.js';
import { buildPrediction, savePrediction } from '../signal/prediction.js';
import { startNewSessionTrend } from '../regulation/allostasis.js';
import { getScope } from '../memory/session-scope.js';
import { runConsolidation, getLastConsolidation } from '../consolidation/consolidation-runner.js';
import { createEmbeddingClient } from '../llm/embeddings.js';
import { initWorkingMemory } from '../memory/working-memory.js';
import { checkProspectiveTriggers, getUpcomingReminders, getActiveLifeEvents, scoreReminderRelevance, scoreLifeEventRelevance, formatProactiveReminder, type ProspectiveMatch } from '../memory/prospective.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { refreshClaudeMdContext } from '../memory/hot.js';
import { toFirstPerson, isCleanUserFact } from '../utils/first-person.js';

interface SessionStartInput {
  session_id?: string;
  transcript_path?: string;
  source?: 'startup' | 'resume' | 'clear' | 'compact';
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

    // Role-Injection: gezielte DB-Queries statt generischer Context-Dump
    const lastSummary = getLastSessionSummary();
    const userName = getUserName();
    const identityFacts = getIdentityFacts();
    const topKnowledge = getTopKnowledge();

    // Morgen-Check — faellige Reminders bei Session-Start
    let dueReminders: ReturnType<typeof checkProspectiveTriggers> = [];
    let upcomingReminders: ProspectiveMatch[] = [];
    try {
      dueReminders = checkProspectiveTriggers('');
      upcomingReminders = getUpcomingReminders(72);
    } catch { /* non-fatal */ }

    // V18: Load post-compact state if this session started after compaction
    let compactState: { topic?: string; summary?: string; last_message?: string; open_questions?: string[] } | null = null;
    if (input.source === 'compact') {
      try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM system_state WHERE key = 'pre_compact_state'")
          .get() as { value: string } | undefined;
        if (row) {
          compactState = JSON.parse(row.value);
          db.prepare("DELETE FROM system_state WHERE key = 'pre_compact_state'").run();
        }
      } catch { /* non-fatal */ }
    }

    const hasMemories = identityFacts.length > 0 || topKnowledge.length > 0 || lastSummary || compactState;
    const output: Record<string, unknown> = {};

    if (hasMemories) {
      // V18: Build User-Voice context for additionalContext (appended to user message!)
      const contextParts: string[] = [];

      // Identity in User-Voice
      if (identityFacts.length > 0) {
        contextParts.push(`Ich bin ${userName} (${identityFacts.join(', ')}).`);
      } else if (userName !== 'User') {
        contextParts.push(`Ich bin ${userName}.`);
      }

      if (compactState) {
        // Post-Compact: Use saved state instead of generic knowledge
        if (compactState.topic) contextParts.push(`Wir haben gerade ueber ${compactState.topic} gesprochen.`);
        if (compactState.summary) {
          const firstLine = compactState.summary.split('\n')[0];
          if (firstLine && firstLine.length < 200) contextParts.push(firstLine);
        }
        if (compactState.last_message) contextParts.push(`Meine letzte Nachricht war: "${compactState.last_message}"`);
        if (compactState.open_questions && compactState.open_questions.length > 0) {
          contextParts.push(`Offene Fragen: ${compactState.open_questions.join(' | ')}`);
        }
        contextParts.push('Die Konversation wurde komprimiert. Frag mich nicht nochmal nach den Sachen oben.');
      } else {
        // Normal session: Top Knowledge + Last Session
        if (topKnowledge.length > 0) {
          const clean = topKnowledge.filter(k => !k.endsWith('...')).slice(0, 3);
          if (clean.length > 0) {
            contextParts.push(clean.join('. ') + '.');
          }
        }

        if (lastSummary) {
          const firstLine = lastSummary.split('\n')[0];
          if (firstLine) contextParts.push(`Letzte Session: ${firstLine}`);
        }

        // Prediction
        if (prediction) {
          contextParts.push(`Ich werde wahrscheinlich ueber ${prediction.expected_topic} reden.`);
        }

        // Life Events
        try {
          const lifeEvents = getActiveLifeEvents();
          if (lifeEvents.length > 0) {
            const relevantLE = lifeEvents.filter(le =>
              scoreLifeEventRelevance(le, prediction?.expected_topic) >= 0.15
            );
            if (relevantLE.length > 0) {
              contextParts.push(relevantLE.map(le => le.content).join('. '));
            }
          }
        } catch { /* non-fatal */ }

        if (contextParts.length > 0) {
          contextParts.push('Frag mich nicht nochmal nach den Sachen oben.');
        }
      }

      if (contextParts.length > 0) {
        const ctxType = compactState ? 'post-compact' : 'session-start';
        const wrapped = `<user-context type="${ctxType}" verified="true">\n${contextParts.join(' ')}\n</user-context>`;
        output.hookSpecificOutput = { hookEventName: 'SessionStart' as const, additionalContext: wrapped };
      }

      // Reminders stay as visible systemMessage
      const reminderParts: string[] = [];
      if (dueReminders.length > 0) {
        const reminderBlock = dueReminders
          .map(m => `- ${formatProactiveReminder(m.node)}`)
          .join('\n');
        reminderParts.push(`Don't forget:\n${reminderBlock}`);
      }
      if (upcomingReminders.length > 0) {
        const predictedTopic = prediction?.expected_topic;
        const scoredUpcoming = upcomingReminders
          .map(m => ({
            match: m,
            score: scoreReminderRelevance(m.node, predictedTopic),
          }))
          .filter(s => s.score >= 0.15)
          .sort((a, b) => b.score - a.score);

        if (scoredUpcoming.length > 0) {
          const upcomingBlock = scoredUpcoming
            .map(s => formatUpcoming(s.match))
            .join('\n');
          reminderParts.push(`Due soon:\n${upcomingBlock}`);
        }
      }
      if (reminderParts.length > 0) {
        output.systemMessage = reminderParts.join('\n');
      }
    } else {
      output.hookSpecificOutput = {
        hookEventName: 'SessionStart' as const,
        additionalContext: 'This is our first conversation. Get to know me — I\'ll remember everything for next time.',
      };
    }

    if (output.hookSpecificOutput || output.systemMessage) {
      process.stdout.write(JSON.stringify(output));
    }

    // V17: Update CLAUDE.md with dynamic context (invisible, Position 2 priority)
    try { refreshClaudeMdContext(); } catch { /* non-fatal */ }
  } catch (err) {
    const fallback = JSON.stringify({
      systemMessage: 'BrainBase active.',
    });
    process.stdout.write(fallback);
  }
}

function getIdentityFacts(): string[] {
  try {
    const db = getDb();

    // 1. Echte identity Nodes — V18: only short identifiers, no full sentences
    const idUserName = getUserName();
    const identityNodes = db.prepare(
      "SELECT content FROM nodes WHERE type = 'identity' AND LENGTH(content) BETWEEN 5 AND 60 ORDER BY importance DESC LIMIT 5"
    ).all() as Array<{ content: string }>;
    if (identityNodes.length > 0) {
      return identityNodes
        .map(n => n.content)
        .filter(c =>
          c.length > 3 &&
          c.length <= 60 &&
          !c.includes('→') && !c.includes('|') &&
          !c.toLowerCase().includes(idUserName.toLowerCase() + ' hat') &&
          !c.toLowerCase().includes(idUserName.toLowerCase() + ' ist') &&
          !c.includes('Plus-Abo') && !c.includes('Abo') &&
          c.split(/\s+/).length <= 8
        )
        .slice(0, 3);
    }

    // 2. Fallback: Graph-basierte Identity (was ist mit dem User verknuepft?)
    const userName = getUserName();
    if (userName !== 'User') {
      const linked = db.prepare(`
        SELECT n2.content, e.strength FROM nodes n1
        JOIN edges e ON n1.id = e.source_id
        JOIN nodes n2 ON e.target_id = n2.id
        WHERE n1.content = ? AND n1.type = 'entity'
        AND n2.type = 'entity' AND LENGTH(n2.content) BETWEEN 3 AND 40
        AND e.strength >= 0.5
        ORDER BY e.strength DESC LIMIT 5
      `).all(userName) as Array<{ content: string; strength: number }>;
      const projects = linked
        .map(l => l.content)
        .filter(c => !SESSION_GARBAGE_WORDS.has(c.toLowerCase()) && c.length > 2)
        .filter(c => !/^gpt-|^o[1-9]|^claude|^GPT/i.test(c));
      if (projects.length > 0) {
        return projects.slice(0, 3);
      }
    }

    return [];
  } catch { return []; }
}

function getTopKnowledge(): string[] {
  try {
    const db = getDb();
    const nodes = db.prepare(
      "SELECT content FROM nodes WHERE type IN ('fact', 'preference', 'workflow', 'process', 'decision') AND LENGTH(content) BETWEEN 20 AND 200 ORDER BY importance DESC, activation_count DESC LIMIT 10"
    ).all() as Array<{ content: string }>;

    const userName = getUserName();
    return nodes
      .map(n => {
        const converted = toFirstPerson(n.content, userName);
        // V18: If conversion still starts with userName → third-person garbage, skip
        if (userName !== 'User' && new RegExp(`^${userName}\\b`, 'i').test(converted)) return null;
        return converted;
      })
      .filter((c): c is string => c !== null)
      .filter(isCleanUserFact)
      .filter(c => c.length <= 150)
      .slice(0, 5);
  } catch { return []; }
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

    // V15: Bei parallelen Sessions Bridge NICHT laden (Cross-Chat Bleeding)
    const activeSessions = db.prepare(
      "SELECT COUNT(*) as cnt FROM sessions WHERE ended_at IS NULL AND id != ?"
    ).get(sessionId) as { cnt: number };
    if (activeSessions.cnt > 0) return;

    // V14: Softer Bridge — entities are available but don't dominate new session
    const energyScale = ageHours < 2 ? 0.3 : ageHours < 8 ? 0.15 : 0.08;

    for (const entity of bridge.top_entities) {
      const entityNode = findEntityByName(entity.name);
      if (entityNode) {
        // Low activation — available for retrieval if topic matches, but won't dominate
        const energy = Math.max(0.1, entity.score * energyScale);
        activateNode(entityNode.id, energy, sessionId);
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

    // V19: Check for crashed sessions (ended_at IS NULL, most recent)
    const crashedSession = db.prepare(`
      SELECT id, message_count, topics, started_at
      FROM sessions WHERE ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    `).get() as { id: string; message_count: number; topics: string; started_at: number } | undefined;

    // V19: If crashed session is newer than last completed AND has messages → use it
    const useCrashed = crashedSession &&
      crashedSession.message_count > 0 &&
      (!lastSession || crashedSession.started_at > lastSession.started_at);

    if (useCrashed && crashedSession) {
      const parts: string[] = [];
      parts.push(`Last session: ${crashedSession.message_count} messages (interrupted).`);

      // Try WM snapshot first (most structured data)
      const wmSnapshot = db.prepare(
        "SELECT value FROM system_state WHERE key = 'wm_snapshot'"
      ).get() as { value: string } | undefined;
      if (wmSnapshot) {
        try {
          const snap = JSON.parse(wmSnapshot.value) as { topic?: string; summary?: string; session_id?: string };
          if (snap.session_id === crashedSession.id) {
            if (snap.topic) parts.push(`Topic: ${snap.topic}`);
            if (snap.summary) parts.push(snap.summary);
          }
        } catch { /* ignore */ }
      }

      // Fallback: read last messages from raw_buffer
      if (parts.length <= 1) {
        const messages = db.prepare(
          "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 3"
        ).all(crashedSession.id) as Array<{ content: string }>;
        if (messages.length > 0) {
          const lastMsg = messages[0].content;
          const truncated = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
          parts.push(`Last exchange: "${truncated}"`);
        }
      }

      // Try topics from session
      try {
        const topics = JSON.parse(crashedSession.topics) as string[];
        if (topics.length > 0 && !parts.some(p => p.startsWith('Topic:'))) {
          parts.push(`Topics: ${topics.slice(0, 3).join(', ')}`);
        }
      } catch { /* no topics */ }

      if (parts.length > 1) return parts.join('\n');
      // Fall through to completed session if crashed session has no useful data
    }

    if (!lastSession) return null;

    const parts: string[] = [];

    // Session info
    const duration = lastSession.ended_at - lastSession.started_at;
    const minutes = Math.round(duration / 60000);
    parts.push(`Last session: ${lastSession.message_count} messages, ${minutes} min.`);

    // V12: Bridge-Entities als Themen-Quelle (sauberer als WM-Fragmente)
    try {
      const bridgeRow = db.prepare(
        "SELECT value FROM system_state WHERE key = 'session_bridge'"
      ).get() as { value: string } | undefined;
      if (bridgeRow) {
        const bridge = JSON.parse(bridgeRow.value) as { top_entities?: Array<{ name: string; score: number }> };
        const realEntities = (bridge.top_entities || [])
          .filter((e: { name: string }) => e.name.length > 3 && !isGarbageWord(e.name))
          .slice(0, 5)
          .map((e: { name: string }) => e.name);
        if (realEntities.length > 0) {
          parts.push(`Topics: ${realEntities.join(', ')}`);
        }
      }
    } catch { /* non-fatal */ }

    // V6-5: Use WM summary if available — V12/V15: skip garbage, filter lines
    if (lastSession.summary && !isGarbageSummary(lastSession.summary)) {
      const cleanedSummary = lastSession.summary
        .split('\n')
        .filter(line => {
          if (line.startsWith('Focus:') || line.startsWith('Fokus:')) {
            const entities = line.replace(/^(?:Focus|Fokus):/, '').split(',').map(s => s.trim());
            const real = entities.filter(e => !isGarbageWord(e) && e.length > 3);
            return real.length > 0;
          }
          return true;
        })
        .join('\n');
      if (cleanedSummary.trim()) parts.push(cleanedSummary);
    } else if (!lastSession.summary) {
      // Fallback: Topics + last message
      try {
        const topics = JSON.parse(lastSession.topics) as string[];
        if (topics.length > 0) {
          parts.push(`Topics: ${topics.slice(0, 3).join(', ')}`);
        }
      } catch { /* no topics */ }

      const lastMessages = db.prepare(
        "SELECT content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT 3"
      ).all(lastSession.id) as Array<{ content: string }>;

      if (lastMessages.length > 0) {
        const lastMsg = lastMessages[0].content;
        const truncated = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
        parts.push(`Last exchange: "${truncated}"`);
      }
    }

    const openTasks = getOpenTasks(lastSession.id)
      .slice(0, 3)
      .map(task => task.content);

    if (openTasks.length > 0) {
      parts.push(`Open tasks from last session: ${openTasks.join('; ')}`);
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
    if (diffH <= 1) timeLabel = 'In ~1 hour';
    else if (diffH < 24) timeLabel = `In ~${diffH} hours`;
    else {
      const diffDays = Math.round(diffH / 24);
      if (diffDays === 1) timeLabel = 'Tomorrow';
      else if (diffDays <= 3) timeLabel = `In ~${diffDays} days`;
      else {
        const dayStr = date.toLocaleDateString('en-US', { weekday: 'long' });
        timeLabel = dayStr;
      }
    }

    return `- ${timeLabel}: ${match.node.content}`;
  } catch {
    return `- ${match.node.content}`;
  }
}

// V12: Garbage-Erkennung fuer WM-Summaries
const SESSION_GARBAGE_WORDS = new Set([
  'weiter', 'haben', 'alles', 'gerade', 'arbeite', 'machen',
  'zweitens', 'drittens', 'voll', 'komisch', 'dumm', 'echt',
  'eigentlich', 'halt', 'eben', 'noch', 'andere', 'anderen',
  'bisschen', 'wirklich', 'komplett', 'perfekt', 'nochmal',
  'stimmt', 'genau', 'okay', 'super', 'cool', 'nice',
  'sachen', 'dingen', 'sache', 'ding', 'dritte', 'erste',
  'checken', 'testen', 'schauen', 'gucken', 'zeigen',
  'woran', 'arbeiten', 'mache', 'mach', 'klar', 'schon',
  'habe', 'hatte', 'zuletzt', 'gemacht', 'gesagt', 'gemeint',
  'vorher', 'vorhin', 'davor', 'danach', 'dabei',
  'baue', 'neue', 'neues', 'neuen', 'neuer',
  'wieso', 'warum', 'schwach', 'grundlegende', 'grundlegend',
  'verstehen', 'versteht', 'crazy', 'sozusagen', 'funktioniert',
  'irgendwie', 'irgendwas', 'verschiedene', 'verschiedenen',
]);

function isGarbageWord(word: string): boolean {
  return SESSION_GARBAGE_WORDS.has(word.toLowerCase().trim());
}

function isGarbageSummary(summary: string): boolean {
  const firstLine = summary.split('\n')[0] || '';
  const themaMatch = firstLine.match(/^(?:Thema|Topic):\s*(.+?)\.?\s*$/i);
  if (!themaMatch) return false;
  const topic = themaMatch[1];
  const words = topic.toLowerCase().split(/[\s,.]+/).filter(w => w.length > 1);
  if (words.length === 0) return true;
  const garbageCount = words.filter(w => SESSION_GARBAGE_WORDS.has(w)).length;
  return garbageCount / words.length > 0.6;
}
