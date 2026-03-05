import { calculateSignalStrength } from '../signal/signal-strength.js';

const text = process.argv[2];

if (!text) {
  console.error('Usage: npx tsx src/commands/signal-test.ts "your text here"');
  process.exit(1);
}

const sessionId = `signal-test-${Date.now()}`;
const result = calculateSignalStrength(text, sessionId);

console.log(`\nInput: "${text}"`);
console.log(`\nSignal Score: ${result.score.toFixed(3)}`);
console.log(`Action:       ${result.action}`);
console.log(`\nFactors:`);
console.log(`  repetition:   ${result.factors.repetition.toFixed(3)}`);
console.log(`  emotion:      ${result.factors.emotion.toFixed(3)}`);
console.log(`  novelty:      ${result.factors.novelty.toFixed(3)}`);
console.log(`  info_density: ${result.factors.info_density.toFixed(3)}`);
console.log(`  explicit:     ${result.factors.explicit.toFixed(3)}`);
console.log(`  decision:     ${result.factors.decision.toFixed(3)}`);
console.log(`  pred_error:   ${result.factors.prediction_error.toFixed(3)}`);

const activeFlags = Object.entries(result.flags)
  .filter(([k, v]) => k !== 'emotion_intensity' && v === true)
  .map(([k]) => k);

console.log(`\nFlags: ${activeFlags.length > 0 ? activeFlags.join(', ') : 'none'}`);
console.log(`Emotion intensity: ${result.flags.emotion_intensity.toFixed(2)}`);
console.log(`Entities: [${result.entities.join(', ')}]`);
