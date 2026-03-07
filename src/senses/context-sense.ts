// Phase 10.6: Kontext-Sinn ("Somatosensorik" — Body Schema)
// Somatosensorik = Koerperschema. Fuer uns: System-Schema
// Weiss: welcher Provider, welche Session-Laenge, welche Tageszeit, welches Projekt

import { getDb } from '../memory/store.js';

export interface ContextSignal {
  provider: string;
  sessionLength: number;    // message count in current session
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayType: 'weekday' | 'weekend';
  sessionAge: number;       // minutes since session start
  currentProject: string | null;
  isNewSession: boolean;    // first few messages
  isDeepSession: boolean;   // many messages, deep in a topic
}

function getTimeOfDay(): ContextSignal['timeOfDay'] {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function getDayType(): ContextSignal['dayType'] {
  const day = new Date().getDay();
  return (day === 0 || day === 6) ? 'weekend' : 'weekday';
}

export function analyzeContext(sessionId: string, provider: string): ContextSignal {
  const db = getDb();

  // Session info
  let sessionLength = 0;
  let sessionAge = 0;
  try {
    const session = db.prepare(
      'SELECT message_count, started_at FROM sessions WHERE id = ?'
    ).get(sessionId) as { message_count: number; started_at: number } | undefined;

    if (session) {
      sessionLength = session.message_count;
      sessionAge = (Date.now() - session.started_at) / (1000 * 60); // minutes
    }
  } catch { /* new session */ }

  // Current project: most recent entity of type 'project' or 'tool'
  let currentProject: string | null = null;
  try {
    const projectNode = db.prepare(`
      SELECT content FROM nodes
      WHERE type = 'entity'
      AND metadata LIKE '%"entity_type":"project"%'
      AND activation > 0.1
      ORDER BY last_activated DESC LIMIT 1
    `).get() as { content: string } | undefined;

    if (projectNode) {
      currentProject = projectNode.content;
    } else {
      // Fallback: check session focus
      const focusRow = db.prepare("SELECT value FROM system_state WHERE key = ?")
        .get(`session_focus_${sessionId}`) as { value: string } | undefined;
      if (focusRow) {
        const focusMap: Record<string, number> = JSON.parse(focusRow.value);
        const topEntity = Object.entries(focusMap)
          .sort((a, b) => b[1] - a[1])[0];
        if (topEntity) currentProject = topEntity[0];
      }
    }
  } catch { /* no project */ }

  const isNewSession = sessionLength <= 2;
  const isDeepSession = sessionLength >= 10 && sessionAge >= 10;

  return {
    provider,
    sessionLength,
    timeOfDay: getTimeOfDay(),
    dayType: getDayType(),
    sessionAge,
    currentProject,
    isNewSession,
    isDeepSession,
  };
}
