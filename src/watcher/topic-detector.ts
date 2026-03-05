import type { LLMClient } from '../llm/types.js';

interface TopicResult {
  changed: boolean;
  newTopic: string;
  confidence: number;
}

const TOPIC_SYSTEM = `You detect topic changes in conversations.
Respond ONLY as JSON: {"changed": true/false, "newTopic": "topic name", "confidence": 0.0-1.0}
A topic change means the user is switching to a completely different subject, not just a sub-topic.`;

export async function detectTopicChange(
  client: LLMClient,
  currentTopic: string,
  userMessage: string,
): Promise<TopicResult> {
  const prompt = `Current topic: "${currentTopic || 'none'}"
New user message: "${userMessage.substring(0, 500)}"

Has the topic changed? If yes, what is the new topic?`;

  try {
    const result = await client.generateJson<TopicResult>(prompt, {
      system: TOPIC_SYSTEM,
      temperature: 0.1,
    });

    return {
      changed: !!result.changed,
      newTopic: result.newTopic || currentTopic || 'general',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
    };
  } catch {
    return { changed: false, newTopic: currentTopic || 'general', confidence: 0 };
  }
}
