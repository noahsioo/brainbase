import { getDb } from '../memory/store.js';
import { getSystemState, setSystemState } from '../memory/cold-start.js';

export interface Prediction {
  expected_topic: string;
  confidence: number;
  based_on: 'last_session' | 'temporal' | 'tasks';
}

export function buildPrediction(): Prediction | null {
  const db = getDb();

  const lastSession = db.prepare(`
    SELECT topics FROM sessions
    WHERE ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1
  `).get() as { topics: string } | undefined;

  if (lastSession) {
    try {
      const topics = JSON.parse(lastSession.topics) as string[];
      if (topics.length > 0) {
        return {
          expected_topic: topics[0],
          confidence: 0.6,
          based_on: 'last_session',
        };
      }
    } catch {
      // skip
    }
  }

  const openTask = db.prepare(`
    SELECT content FROM nodes
    WHERE type = 'task' AND (emotional_tag IS NULL OR emotional_tag != 'done')
    ORDER BY importance DESC LIMIT 1
  `).get() as { content: string } | undefined;

  if (openTask) {
    return {
      expected_topic: openTask.content,
      confidence: 0.4,
      based_on: 'tasks',
    };
  }

  return null;
}

export function savePrediction(prediction: Prediction): void {
  setSystemState('current_prediction', JSON.stringify(prediction));
}

export function loadPrediction(): Prediction | null {
  const raw = getSystemState('current_prediction');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Prediction;
  } catch {
    return null;
  }
}

export function calculatePredictionError(prediction: Prediction, actualPrompt: string): number {
  const predWords = new Set(
    prediction.expected_topic.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );
  const actualWords = new Set(
    actualPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );

  if (predWords.size === 0 || actualWords.size === 0) return 0.5;

  let overlap = 0;
  for (const w of predWords) {
    if (actualWords.has(w)) overlap++;
  }

  const overlapRatio = overlap / Math.max(predWords.size, 1);
  return Math.max(0, Math.min(1.0, 1.0 - overlapRatio)) * prediction.confidence;
}
