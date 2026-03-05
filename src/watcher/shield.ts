import type { LLMClient } from '../llm/types.js';

interface FrustrationResult {
  frustrated: boolean;
  level: number;
  reason: string;
}

const FRUSTRATION_SYSTEM = `You detect user frustration in messages to AI coding assistants.
Signs of frustration: ALL CAPS, swearing, "delete everything", "start over", "this is garbage", repeated failures.
Respond ONLY as JSON: {"frustrated": true/false, "level": 0.0-1.0, "reason": "why"}
Level 0.0 = calm, 0.5 = mildly annoyed, 0.8 = very frustrated, 1.0 = rage`;

export async function detectFrustration(
  client: LLMClient,
  message: string,
): Promise<FrustrationResult> {
  try {
    const result = await client.generateJson<FrustrationResult>(
      `Analyze this message for frustration:\n"${message.substring(0, 500)}"`,
      { system: FRUSTRATION_SYSTEM, temperature: 0.1 },
    );
    return {
      frustrated: !!result.frustrated,
      level: typeof result.level === 'number' ? result.level : 0,
      reason: result.reason || '',
    };
  } catch {
    return { frustrated: false, level: 0, reason: '' };
  }
}

export function shouldBlockMemoryWrite(frustrationLevel: number): boolean {
  return frustrationLevel >= 0.7;
}
