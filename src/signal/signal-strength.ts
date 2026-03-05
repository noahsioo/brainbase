import { detectKeywordFlags, type KeywordFlags } from './keywords.js';
import {
  extractEntities,
  updateCounters,
  checkAutoNodeCreation,
  getRepetitionScore,
  getCoOccurrenceScore,
} from './counters.js';
import { searchNodes } from '../memory/store.js';
import { loadPrediction, calculatePredictionError } from './prediction.js';

// Thresholds
export const GATE_IGNORE = 0.3;
export const GATE_HEBBIAN = 0.3;
export const GATE_LLM = 0.6;

// Factor weights (sum = 1.0)
const W_REPETITION = 0.13;
const W_EMOTION = 0.18;
const W_NOVELTY = 0.18;
const W_INFO_DENSITY = 0.13;
const W_EXPLICIT = 0.18;
const W_DECISION = 0.10;
const W_PREDICTION_ERROR = 0.10;

export type SignalAction = 'ignore' | 'hebbian_only' | 'full_extraction';

export interface SignalResult {
  score: number;
  action: SignalAction;
  factors: {
    repetition: number;
    emotion: number;
    novelty: number;
    info_density: number;
    explicit: number;
    decision: number;
    prediction_error: number;
  };
  flags: KeywordFlags;
  entities: string[];
}

function calculateNovelty(text: string, entities: string[]): number {
  if (entities.length === 0) return 0;

  const existingNodes = searchNodes(text, 10);
  if (existingNodes.length === 0) return 1.0;

  const textLower = text.toLowerCase();
  let matchingContent = 0;

  for (const node of existingNodes) {
    const nodeLower = node.content.toLowerCase();
    if (nodeLower.includes(textLower) || textLower.includes(nodeLower)) {
      matchingContent++;
    }
  }

  const overlapRatio = matchingContent / existingNodes.length;
  return Math.max(0, 1.0 - overlapRatio);
}

function calculateInfoDensity(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount <= 3) return 0.1;
  if (wordCount <= 5) return 0.2;

  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const uniqueRatio = uniqueWords.size / wordCount;

  const hasNumbers = /\d/.test(text);
  const hasProperNouns = /[A-Z][a-z]{2,}/.test(text.slice(1));
  const hasCode = /[{}\[\]()=>:;]/.test(text) || /\.(ts|js|py|go|rs|css|html|json)\b/.test(text);
  const hasUrls = /https?:\/\//.test(text);
  const hasFilePaths = /\/[a-zA-Z][\w\-./]+/.test(text);

  let density = uniqueRatio * 0.4;

  if (hasNumbers) density += 0.1;
  if (hasProperNouns) density += 0.15;
  if (hasCode) density += 0.15;
  if (hasUrls) density += 0.1;
  if (hasFilePaths) density += 0.1;

  if (wordCount > 15) density += 0.1;

  return Math.min(1.0, density);
}

export function calculateSignalStrength(text: string, sessionId: string): SignalResult {
  const flags = detectKeywordFlags(text);
  const entities = extractEntities(text);

  const updatedCounters = updateCounters(entities, sessionId);
  checkAutoNodeCreation(updatedCounters);

  const repetition = getRepetitionScore(entities);

  let emotion = flags.emotion_intensity;
  if (flags.frustration) emotion = Math.max(emotion, 0.6);
  const coOccurrence = getCoOccurrenceScore(entities);
  emotion = Math.min(1.0, emotion + coOccurrence * 0.2);

  const novelty = calculateNovelty(text, entities);
  const info_density = calculateInfoDensity(text);
  const explicit = flags.explicit_memory ? 1.0 : 0;
  const decision = flags.decision ? 0.9 : 0;

  let prediction_error = 0;
  const prediction = loadPrediction();
  if (prediction) {
    prediction_error = calculatePredictionError(prediction, text);
  }

  const rawScore =
    W_REPETITION * repetition +
    W_EMOTION * emotion +
    W_NOVELTY * novelty +
    W_INFO_DENSITY * info_density +
    W_EXPLICIT * explicit +
    W_DECISION * decision +
    W_PREDICTION_ERROR * prediction_error;

  // Explicit memory + Decision requests always get full extraction
  let score = rawScore;
  if (flags.explicit_memory) score = Math.max(score, GATE_LLM + 0.01);
  if (flags.decision) score = Math.max(score, GATE_LLM + 0.01);

  let action: SignalAction;
  if (score < GATE_IGNORE) {
    action = 'ignore';
  } else if (score < GATE_LLM) {
    action = 'hebbian_only';
  } else {
    action = 'full_extraction';
  }

  return {
    score,
    action,
    factors: { repetition, emotion, novelty, info_density, explicit, decision, prediction_error },
    flags,
    entities,
  };
}
