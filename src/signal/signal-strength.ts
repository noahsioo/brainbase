import type { KeywordFlags } from './keywords.js';
import { processThalamic } from './thalamus.js';

// Thresholds
export const GATE_IGNORE = 0.3;
export const GATE_HEBBIAN = 0.3;
export const GATE_LLM = 0.15;

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

export function calculateSignalStrength(text: string, sessionId: string): SignalResult {
  const thalamic = processThalamic(text, sessionId);

  return {
    score: thalamic.combined,
    action: thalamic.action,
    factors: {
      repetition: thalamic.nuclei.entity.raw,
      emotion: thalamic.nuclei.emotion.raw,
      novelty: thalamic.nuclei.novelty.raw,
      info_density: thalamic.nuclei.entity.raw,
      explicit: thalamic.flags.explicit_memory ? 1.0 : 0,
      decision: thalamic.flags.decision ? 0.9 : 0,
      prediction_error: thalamic.nuclei.topic.raw,
    },
    flags: thalamic.flags,
    entities: thalamic.entities,
  };
}
