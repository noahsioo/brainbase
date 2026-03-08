import { getDb, getNode, getSessionActivationRows, updateNode } from '../memory/store.js';
import { recordProviderFeedback } from '../learning/ai-profiles.js';
import { getSystemState, setSystemState } from '../memory/cold-start.js';
import { getSessionMood, setSessionMood } from '../memory/session-runtime-state.js';
import { markRecentOutcomesSuccess } from '../learning/outcome-tracker.js';
import { trackFailure } from '../memory/prospective.js';

export type FeedbackSignal = 'positive' | 'negative' | 'neutral';
export type Mood = 'neutral' | 'frustrated' | 'excited' | 'focused';

interface SessionContextFeedbackEntry {
  positive: number;
  negative: number;
  updated_at: number;
}

const POSITIVE_KEYWORDS = [
  'danke', 'geil', 'perfekt', 'super', 'genau', 'thanks', 'perfect',
  'great', 'exactly', 'nice', 'awesome', 'toll', 'klasse', 'top',
  'weiter', 'next', 'als naechstes', 'als nächstes',
];

const NEGATIVE_KEYWORDS = [
  'nein', 'falsch', 'anders', 'nochmal', 'no', 'wrong', 'not what',
  'try again', 'stimmt nicht', 'passt nicht', 'das meine ich nicht',
];

const EXCITED_KEYWORDS = [
  'geil', 'cool', 'excited', 'awesome', 'mega', 'krass', 'wow',
];

export function detectFeedbackSignal(currentPrompt: string): FeedbackSignal {
  const lower = currentPrompt.toLowerCase();

  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) return 'positive';
  }

  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) return 'negative';
  }

  return 'neutral';
}

export function detectMood(prompt: string, isFrustrated: boolean): Mood {
  const lower = prompt.toLowerCase();

  if (isFrustrated) return 'frustrated';

  for (const kw of EXCITED_KEYWORDS) {
    if (lower.includes(kw)) return 'excited';
  }

  return 'neutral';
}

export function getCurrentMood(sessionId?: string): Mood {
  if (sessionId) {
    return getSessionMood(sessionId);
  }

  const stored = getSystemState('current_mood');
  if (stored === 'frustrated' || stored === 'excited' || stored === 'focused') {
    return stored;
  }
  return 'neutral';
}

export function setCurrentMood(mood: Mood, sessionId?: string): void {
  if (sessionId) {
    setSessionMood(sessionId, mood);
    return;
  }

  setSystemState('current_mood', mood);
}

export function applyFeedbackOutcome(signal: FeedbackSignal, sessionId: string): void {
  if (signal === 'positive') {
    markRecentOutcomesSuccess(sessionId);
  }
  if (signal === 'negative') {
    trackFailure('negative feedback', sessionId);
  }
}

function getRecentSessionNodes(
  sessionId: string,
  limit = 10,
  minActivation = 0.1,
): Array<{ id: string; confidence: number; metadata: string | null; type: string }> {
  return getSessionActivationRows(sessionId, limit, minActivation)
    .map(row => getNode(row.node_id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map(node => ({
      id: node.id,
      confidence: node.confidence,
      metadata: node.metadata,
      type: node.type,
    }));
}

function getRecentAggregatedNodes(
  limit = 10,
  minActivation = 0.1,
  since = Date.now() - 5 * 60 * 1000,
): Array<{ id: string; confidence: number; metadata: string | null; type: string }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      sa.node_id,
      MAX(sa.activation) as activation,
      MAX(sa.activated_at) as activated_at
    FROM session_activations sa
    WHERE sa.activation >= ? AND sa.activated_at > ?
    GROUP BY sa.node_id
    ORDER BY activation DESC, activated_at DESC
    LIMIT ?
  `).all(minActivation, since, limit * 3) as Array<{
    node_id: string;
    activation: number;
    activated_at: number;
  }>;

  return rows
    .map(row => getNode(row.node_id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .slice(0, limit)
    .map(node => ({
      id: node.id,
      confidence: node.confidence,
      metadata: node.metadata,
      type: node.type,
    }));
}

export function applyFeedbackToRecentNodes(signal: FeedbackSignal, sessionId?: string): number {
  if (signal === 'neutral') return 0;

  const db = getDb();
  const recentNodes = sessionId
    ? getRecentSessionNodes(sessionId, 10, 0.01).map(node => ({ id: node.id, confidence: node.confidence }))
    : getRecentAggregatedNodes(10, 0.01).map(node => ({ id: node.id, confidence: node.confidence }));

  if (recentNodes.length === 0) return 0;

  const delta = signal === 'positive' ? 0.05 : -0.03;
  let affected = 0;

  for (const node of recentNodes) {
    const newConf = Math.max(0.1, Math.min(1.0, node.confidence + delta));
    db.prepare('UPDATE nodes SET confidence = ? WHERE id = ?').run(newConf, node.id);
    affected++;
  }

  return affected;
}

function getLastContextNodeIds(sessionId?: string): string[] {
  const db = getDb();
  const keys = sessionId
    ? [`last_context_node_ids_${sessionId}`, 'last_context_node_ids']
    : ['last_context_node_ids'];

  for (const key of keys) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;

      const parsed = JSON.parse(row.value);
      if (!Array.isArray(parsed)) continue;

      const nodeIds = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (nodeIds.length > 0) return nodeIds;
    } catch {
      continue;
    }
  }

  return [];
}

function getSessionContextFeedbackKey(sessionId: string): string {
  return `context_feedback_scores_${sessionId}`;
}

function getSessionContextFeedback(sessionId: string): Record<string, SessionContextFeedbackEntry> {
  const raw = getSystemState(getSessionContextFeedbackKey(sessionId));
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, SessionContextFeedbackEntry>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) =>
        value &&
        typeof value.positive === 'number' &&
        typeof value.negative === 'number' &&
        typeof value.updated_at === 'number',
      ),
    );
  } catch {
    return {};
  }
}

function saveSessionContextFeedback(sessionId: string, feedback: Record<string, SessionContextFeedbackEntry>): void {
  const trimmed = Object.entries(feedback)
    .sort((a, b) => b[1].updated_at - a[1].updated_at)
    .slice(0, 64);

  setSystemState(getSessionContextFeedbackKey(sessionId), JSON.stringify(Object.fromEntries(trimmed)));
}

// 14.3: Provider-specific feedback tracking
export function trackProviderFeedback(signal: FeedbackSignal, provider: string): void {
  if (signal === 'neutral') return;
  recordProviderFeedback(provider, signal === 'positive');
}

// 13.2: Empathy Mode — affective (user suffers) vs cognitive (user has a problem)
export type EmpathyMode = 'affective' | 'cognitive' | 'neutral';

const AFFECTIVE_PATTERNS = [
  /\b(ich\s+(verzweifle|gebe auf|kann nicht mehr|schaffe|hasse)|i\s+(give up|can't|hate this|quit))\b/i,
  /\b(frustriert|frustrated|ueberfordert|overwhelmed|stressed|gestresst|am ende)\b/i,
  /\b(was mache ich falsch|what am i doing wrong|warum klappt nichts|why does nothing work)\b/i,
  /\b(ich bin (so|echt|mega)\s+(dumm|schlecht|langsam))\b/i,
  /\b(seit stunden|for hours|seit tagen|for days)\b/i,
];

const COGNITIVE_PATTERNS = [
  /\b(error|fehler|bug|crash|exception|thrown|undefined|null|NaN)\b/i,
  /\b(funktioniert nicht|doesn't work|not working|geht nicht|broken|kaputt)\b/i,
  /\b(wie (kann|soll|mache)|how (do|can|should)|warum (passiert|macht))\b/i,
  /\b(problem|issue|trouble|schwierigkeit)\b/i,
];

export function detectEmpathyMode(text: string, mood: Mood): EmpathyMode {
  if (mood === 'excited') return 'neutral';

  const affectiveScore = AFFECTIVE_PATTERNS.filter(p => p.test(text)).length;
  const cognitiveScore = COGNITIVE_PATTERNS.filter(p => p.test(text)).length;

  if (affectiveScore >= 2) return 'affective';
  if (affectiveScore >= 1 && mood === 'frustrated') return 'affective';
  if (cognitiveScore >= 1) return 'cognitive';

  return 'neutral';
}

// M25: Somatic Markers — accumulate emotional valence on entities over time
export function applySomaticMarkers(signal: FeedbackSignal, sessionId?: string): void {
  if (signal === 'neutral') return;

  const db = getDb();
  const recentEntities = sessionId
    ? getRecentSessionNodes(sessionId, 10, 0.1)
        .filter(node => node.type === 'entity')
        .map(node => ({ id: node.id, metadata: node.metadata }))
    : getRecentAggregatedNodes(10, 0.1)
        .filter(node => node.type === 'entity')
        .map(node => ({ id: node.id, metadata: node.metadata }));

  const delta = signal === 'positive' ? 0.1 : -0.1;

  for (const entity of recentEntities) {
    let meta: Record<string, unknown> = {};
    try { meta = entity.metadata ? JSON.parse(entity.metadata) : {}; }
    catch { meta = {}; }

    const currentValence = (meta.valence as number) || 0;
    const newValence = Math.max(-1.0, Math.min(1.0, currentValence + delta));
    meta.valence = newValence;

    db.prepare('UPDATE nodes SET metadata = ? WHERE id = ?')
      .run(JSON.stringify(meta), entity.id);
  }
}

// 11.5: Cerebellum — feedback on nodes that were in the generated context
export function applyContextFeedback(signal: FeedbackSignal, sessionId?: string): void {
  if (signal === 'neutral') return;

  const db = getDb();
  try {
    const nodeIds = getLastContextNodeIds(sessionId);
    if (nodeIds.length === 0) return;

    const delta = signal === 'positive' ? 0.03 : -0.05;
    const sessionFeedback = sessionId ? getSessionContextFeedback(sessionId) : null;
    const now = Date.now();

    for (const id of nodeIds.slice(0, 20)) {
      const node = getNode(id);
      if (!node) continue;

      const newImportance = Math.max(0.1, Math.min(1.0, node.importance + delta));
      let meta: Record<string, unknown> = {};
      try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }

      if (signal === 'positive') {
        meta.context_positive = ((meta.context_positive as number) || 0) + 1;
      } else {
        meta.context_negative = ((meta.context_negative as number) || 0) + 1;
      }

      updateNode(id, { importance: newImportance, metadata: JSON.stringify(meta) });

      if (sessionFeedback) {
        const current = sessionFeedback[id] || { positive: 0, negative: 0, updated_at: now };
        if (signal === 'positive') {
          current.positive += 1;
        } else {
          current.negative += 1;
        }
        current.updated_at = now;
        sessionFeedback[id] = current;
      }
    }

    if (sessionId && sessionFeedback) {
      saveSessionContextFeedback(sessionId, sessionFeedback);
    }
  } catch { /* non-fatal */ }
}
