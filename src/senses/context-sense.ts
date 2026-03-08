// Phase 10.6: Kontext-Sinn ("Somatosensorik" — Body Schema)
// Somatosensorik = Koerperschema. Fuer uns: System-Schema
// Weiss: welcher Provider, welche Session-Laenge, welche Tageszeit, welches Projekt

import { getActivatedNodes } from '../memory/activation.js';
import { getDb, type Node, type NodeMetadata } from '../memory/store.js';
import { getWorkingMemory } from '../memory/working-memory.js';

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

function getEntityType(node: Node): string | null {
  if (!node.metadata) return null;
  try {
    const metadata = JSON.parse(node.metadata) as NodeMetadata;
    return typeof metadata.entity_type === 'string' ? metadata.entity_type : null;
  } catch {
    return null;
  }
}

function getSessionActivatedProject(sessionId: string): string | null {
  const activatedNodes = getActivatedNodes(20, sessionId);
  for (const node of activatedNodes) {
    if (node.type !== 'entity') continue;
    const entityType = getEntityType(node);
    if (entityType === 'project' || entityType === 'tool') {
      return node.content;
    }
  }
  return null;
}

function getWorkingMemoryProject(sessionId: string): string | null {
  const memory = getWorkingMemory(sessionId);
  if (!memory) return null;

  const topEntity = Object.entries(memory.active_entities)
    .sort((a, b) => b[1] - a[1])[0];

  return topEntity?.[0] ?? null;
}

function getSessionFocusProject(sessionId: string): string | null {
  const db = getDb();
  const focusRow = db.prepare("SELECT value FROM system_state WHERE key = ?")
    .get(`session_focus_${sessionId}`) as { value: string } | undefined;
  if (!focusRow) return null;

  try {
    const focusMap = JSON.parse(focusRow.value) as Record<string, number>;
    const topEntity = Object.entries(focusMap)
      .sort((a, b) => b[1] - a[1])[0];
    return topEntity?.[0] ?? null;
  } catch {
    return null;
  }
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

  // Current project: session-local activation first, then local memory/focus.
  const currentProject = getSessionActivatedProject(sessionId)
    ?? getWorkingMemoryProject(sessionId)
    ?? getSessionFocusProject(sessionId);

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
