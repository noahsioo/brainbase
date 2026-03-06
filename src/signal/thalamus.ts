import { detectKeywordFlags, type KeywordFlags } from './keywords.js';
import {
  extractEntities,
  updateCounters,
  checkAutoNodeCreation,
  getRepetitionScore,
  getCoOccurrenceScore,
} from './counters.js';
import { searchNodes, getDb } from '../memory/store.js';
import { loadPrediction, calculatePredictionError } from './prediction.js';
import { detectMood } from './echo.js';
import { isCriticalPeriod } from '../memory/cold-start.js';
import { type SignalAction, GATE_IGNORE, GATE_LLM } from './signal-strength.js';

// ── Types ────────────────────────────────────────────────────

export type ThalamicMode = 'burst' | 'tonic';
export type SalienceMode = 'focus' | 'creative' | 'default';

export interface NucleusScore {
  raw: number;
  inhibited: number;
}

export interface ThalamicSignal {
  mode: ThalamicMode;
  salienceMode: SalienceMode;
  nuclei: {
    entity: NucleusScore;
    emotion: NucleusScore;
    topic: NucleusScore;
    novelty: NucleusScore;
  };
  combined: number;
  action: SignalAction;
  flags: KeywordFlags;
  entities: string[];
  dampening: Record<string, number>;
}

// ── Sensory Gating (session-local entity repetition dampening) ──

let sessionEntityCounts = new Map<string, number>();
let currentSessionId = '';

function getSensoryGating(entities: string[], sessionId: string): Record<string, number> {
  if (sessionId !== currentSessionId) {
    sessionEntityCounts.clear();
    currentSessionId = sessionId;
  }

  const dampening: Record<string, number> = {};
  for (const entity of entities) {
    const count = (sessionEntityCounts.get(entity) || 0) + 1;
    sessionEntityCounts.set(entity, count);
    if (count > 2) {
      dampening[entity] = Math.max(0.3, 1.0 - (count - 2) * 0.15);
    }
  }
  return dampening;
}

// ── Info Density (migrated from signal-strength.ts) ─────────

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

// ── Novelty (migrated from signal-strength.ts) ──────────────

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

// ── 4 Nuclei ────────────────────────────────────────────────

function scoreEntityNucleus(text: string, entities: string[]): number {
  const infoDensity = calculateInfoDensity(text);
  const repetition = getRepetitionScore(entities);
  const coOccurrence = getCoOccurrenceScore(entities);
  return 0.4 * infoDensity + 0.3 * repetition + 0.3 * coOccurrence;
}

function scoreEmotionNucleus(text: string, flags: KeywordFlags): number {
  let score = flags.emotion_intensity;
  if (flags.frustration) score = Math.max(score, score + 0.3);
  const mood = detectMood(text, flags.frustration);
  if (mood === 'excited') score = Math.max(score, score + 0.1);
  return Math.min(1.0, score);
}

function scoreTopicNucleus(text: string): number {
  // Cortex-Feedback-Loop: query Knowledge Graph
  const matchingNodes = searchNodes(text, 10);
  const graphDensity = Math.min(1.0, matchingNodes.length / 8);

  let predictionError = 0;
  const prediction = loadPrediction();
  if (prediction) {
    predictionError = calculatePredictionError(prediction, text);
  }

  return 0.5 * (1 - graphDensity) + 0.5 * predictionError;
}

function scoreNoveltyNucleus(text: string, entities: string[], flags: KeywordFlags): number {
  const novelty = calculateNovelty(text, entities);
  let explicitBoost = 0;
  if (flags.explicit_memory) explicitBoost += 0.5;
  if (flags.decision) explicitBoost += 0.4;
  return Math.min(1.0, novelty + explicitBoost);
}

// ── TRN Cross-Inhibition ────────────────────────────────────

function applyCrossInhibition(scores: Record<string, number>): Record<string, number> {
  const entries = Object.entries(scores);
  const maxEntry = entries.reduce((a, b) => b[1] > a[1] ? b : a);
  const maxKey = maxEntry[0];
  const maxVal = maxEntry[1];

  if (maxVal < 0.7) return scores;

  const inhibitionFactor = 0.3;
  const result: Record<string, number> = {};

  for (const [key, val] of entries) {
    if (key === maxKey) {
      result[key] = val;
    } else {
      result[key] = val * (1 - inhibitionFactor * maxVal);
    }
  }

  return result;
}

// ── Burst vs. Tonic Mode ────────────────────────────────────

function determineMode(nuclei: ThalamicSignal['nuclei']): ThalamicMode {
  if (nuclei.emotion.inhibited > 0.6) return 'burst';
  if (nuclei.novelty.inhibited > 0.6 && nuclei.topic.inhibited > 0.4) return 'burst';
  return 'tonic';
}

// ── Combined Score ──────────────────────────────────────────

function calculateCombined(nuclei: ThalamicSignal['nuclei'], mode: ThalamicMode): number {
  const weights = mode === 'burst'
    ? { entity: 0.15, emotion: 0.35, topic: 0.15, novelty: 0.35 }
    : { entity: 0.30, emotion: 0.15, topic: 0.35, novelty: 0.20 };

  return weights.entity * nuclei.entity.inhibited
       + weights.emotion * nuclei.emotion.inhibited
       + weights.topic * nuclei.topic.inhibited
       + weights.novelty * nuclei.novelty.inhibited;
}

// ── Salience Mode (M30) ─────────────────────────────────────

function detectSalienceMode(text: string, nuclei: ThalamicSignal['nuclei']): SalienceMode {
  const FOCUS_PATTERNS = /\b(fix|fehler|bug|error|wie |how |warum|why |problem|issue|crash|debug|broken|kaputt|geht nicht)\b/i;
  const CREATIVE_PATTERNS = /\b(idee|idea|brainstorm|ueberlegen|überlegen|vielleicht|maybe|could|what if|was wäre|konzept|concept|vision|explore|strategie|strategy|architektur|architecture)\b/i;

  if (FOCUS_PATTERNS.test(text)) return 'focus';
  if (CREATIVE_PATTERNS.test(text)) return 'creative';

  if (nuclei.topic.inhibited > 0.6) return 'focus';
  if (nuclei.novelty.inhibited > 0.5) return 'creative';

  return 'default';
}

// ── Main Function ───────────────────────────────────────────

export function processThalamic(text: string, sessionId: string): ThalamicSignal {
  const flags = detectKeywordFlags(text);
  const entities = extractEntities(text);

  const updatedCounters = updateCounters(entities, sessionId);
  checkAutoNodeCreation(updatedCounters);

  // 4 Nuclei
  const entityRaw = scoreEntityNucleus(text, entities);
  const emotionRaw = scoreEmotionNucleus(text, flags);
  const topicRaw = scoreTopicNucleus(text);
  const noveltyRaw = scoreNoveltyNucleus(text, entities, flags);

  // Cross-Inhibition
  const inhibited = applyCrossInhibition({
    entity: entityRaw, emotion: emotionRaw, topic: topicRaw, novelty: noveltyRaw,
  });

  const nuclei = {
    entity:  { raw: entityRaw,  inhibited: inhibited.entity },
    emotion: { raw: emotionRaw, inhibited: inhibited.emotion },
    topic:   { raw: topicRaw,   inhibited: inhibited.topic },
    novelty: { raw: noveltyRaw, inhibited: inhibited.novelty },
  };

  const mode = determineMode(nuclei);
  const combined = calculateCombined(nuclei, mode);
  const dampening = getSensoryGating(entities, sessionId);

  // Action gates
  const effectiveGateLLM = isCriticalPeriod() ? 0.3 : GATE_LLM;
  let score = combined;
  if (flags.explicit_memory) score = Math.max(score, effectiveGateLLM + 0.01);
  if (flags.decision) score = Math.max(score, effectiveGateLLM + 0.01);

  let action: SignalAction;
  if (score < GATE_IGNORE) {
    action = 'ignore';
  } else if (score < effectiveGateLLM) {
    action = 'hebbian_only';
  } else {
    action = 'full_extraction';
  }

  const salienceMode = detectSalienceMode(text, nuclei);

  return { mode, salienceMode, nuclei, combined: score, action, flags, entities, dampening };
}

// M52: Gehirnwellen/Modi — derive system mode from thalamic state
export type SystemMode = 'gamma' | 'beta' | 'theta';

export function deriveSystemMode(mode: ThalamicMode, salience: SalienceMode): SystemMode {
  if (mode === 'burst' && salience === 'focus') return 'gamma';
  if (salience === 'creative') return 'theta';
  return 'beta';
}
