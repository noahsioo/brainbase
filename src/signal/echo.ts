import { getDb } from '../memory/store.js';
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
