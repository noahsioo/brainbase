import { getDb, getNode, updateNode } from '../memory/store.js';
import { recordProviderFeedback } from '../learning/ai-profiles.js';
import { getSystemState, setSystemState } from '../memory/cold-start.js';
import { markRecentOutcomesSuccess } from '../learning/outcome-tracker.js';
import { trackFailure } from '../memory/prospective.js';

export type FeedbackSignal = 'positive' | 'negative' | 'neutral';
export type Mood = 'neutral' | 'frustrated' | 'excited' | 'focused';

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

export function getCurrentMood(): Mood {
  const stored = getSystemState('current_mood');
  if (stored === 'frustrated' || stored === 'excited' || stored === 'focused') {
    return stored;
  }
  return 'neutral';
}

export function setCurrentMood(mood: Mood): void {
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

export function applyFeedbackToRecentNodes(signal: FeedbackSignal): number {
  if (signal === 'neutral') return 0;

  const db = getDb();
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  const recentNodes = db.prepare(`
    SELECT id, confidence FROM nodes
    WHERE last_activated > ? AND activation > 0
    ORDER BY activation DESC LIMIT 10
  `).all(fiveMinAgo) as Array<{ id: string; confidence: number }>;

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
export function applySomaticMarkers(signal: FeedbackSignal): void {
  if (signal === 'neutral') return;

  const db = getDb();
  const recentEntities = db.prepare(`
    SELECT id, metadata FROM nodes
    WHERE type = 'entity' AND activation > 0.1
    ORDER BY activation DESC LIMIT 10
  `).all() as Array<{ id: string; metadata: string | null }>;

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
export function applyContextFeedback(signal: FeedbackSignal): void {
  if (signal === 'neutral') return;

  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'last_context_node_ids'")
      .get() as { value: string } | undefined;
    if (!row) return;

    const nodeIds: string[] = JSON.parse(row.value);
    const delta = signal === 'positive' ? 0.03 : -0.02;

    for (const id of nodeIds.slice(0, 20)) {
      const node = getNode(id);
      if (node) {
        const newImportance = Math.max(0.1, Math.min(1.0, node.importance + delta));
        updateNode(id, { importance: newImportance });
      }
    }
  } catch { /* non-fatal */ }
}
