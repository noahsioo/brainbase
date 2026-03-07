// 25.7: Multisensorische Integration — Precision-weighted Sinnes-Kombination
import type { ToneSignal } from './tone-sense.js';
import type { EmotionBypass } from './emotion-sense.js';
import type { StabilitySignal } from './stability-sense.js';
import type { SystemMood } from './interoception.js';
import type { EnvironmentSignal } from './environment-sense.js';

export interface IntegratedPercept {
  overall_confidence: number;
  dominant_signal: string;
  has_conflict: boolean;
  urgency: number;
}

export function integrateSenses(
  tone: ToneSignal,
  emotion: EmotionBypass,
  stability: StabilitySignal,
  systemMood: SystemMood,
  env: EnvironmentSignal,
): IntegratedPercept {
  const signals = [
    { name: 'tone', value: tone.urgency, precision: 0.7 },
    { name: 'emotion', value: emotion.intensity, precision: emotion.triggered ? 0.9 : 0.3 },
    { name: 'stability', value: stability.needsAttention ? 0.8 : 0.2, precision: 0.6 },
    { name: 'system_mood', value: 1.0 - systemMood.energy, precision: 0.5 },
    { name: 'environment', value: 1.0 - env.api_health, precision: 0.4 },
  ];

  const totalPrecision = signals.reduce((s, sig) => s + sig.precision, 0);
  const weightedUrgency = signals.reduce((s, sig) => s + sig.value * sig.precision, 0) / totalPrecision;

  const dominant = signals.reduce((best, sig) =>
    sig.value * sig.precision > best.value * best.precision ? sig : best
  );

  const values = signals.map(s => s.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const hasConflict = maxVal - minVal > 0.5 && signals.filter(s => s.value > 0.5).length >= 2;

  return {
    overall_confidence: 1.0 - weightedUrgency,
    dominant_signal: dominant.name,
    has_conflict: hasConflict,
    urgency: weightedUrgency,
  };
}
