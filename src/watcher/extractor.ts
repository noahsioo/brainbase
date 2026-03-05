import type { LLMClient } from '../llm/types.js';
import { addNode, getNode, updateNode, searchNodes, type Node } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { verifyExtraction, type ExtractionResponse } from '../extraction/verification.js';

const CONFIDENCE_CAP = 0.8;

function buildSystemPrompt(frustration: boolean): string {
  const base = `You are a factual analyst. Your ONLY job is to translate a user message into structured data.
You do NOT decide what is important. The system already decided this message matters.
You ONLY extract what is EXPLICITLY stated. Never infer, assume, or add.

Rules:
- Set nothing_new=true if the message contains NO new information beyond what existing nodes already cover
- confidence MUST be between 0.3 and 0.8 - NEVER set it higher
- Keep content short and precise (max 150 chars)
- Do NOT use absolute words like "always", "never", "hates", "loves"
- Use neutral, factual language
- One fact per entry - don't combine multiple facts`;

  if (frustration) {
    return base + `

FRUSTRATION MODE:
- The user is frustrated right now. Extract the CAUSE, not the emotion.
- Write "X causes problems" not "user hates X"
- Write "X not working" not "user is angry about X"
- Do NOT use emotional language in content fields
- emotion.type should be "frustrated" with appropriate intensity`;
  }

  return base;
}

function buildExtractionPrompt(
  message: string,
  existingNodes: Node[],
): string {
  let nodesContext = '';
  if (existingNodes.length > 0) {
    const nodeList = existingNodes
      .slice(0, 10)
      .map(n => `- "${n.content}" (type: ${n.type}, confidence: ${n.confidence.toFixed(1)})`)
      .join('\n');
    nodesContext = `\nExisting knowledge about this topic:\n${nodeList}\n`;
  }

  return `${nodesContext}
New message: "${message}"

Fill this JSON exactly:
{
  "nothing_new": true or false,
  "new_facts": [
    { "content": "...", "type": "fact|preference|decision|task|project|learning", "confidence": 0.3-0.8 }
  ],
  "emotion": { "type": "neutral|frustrated|excited|curious", "intensity": 0.0-1.0 }
}

If nothing_new is true, new_facts MUST be an empty array.`;
}

export async function extractFromMessage(
  client: LLMClient,
  message: string,
  sessionId: string,
  flags?: KeywordFlags,
): Promise<Node[]> {
  const existingNodes = searchNodes(message, 10);

  const systemPrompt = buildSystemPrompt(flags?.frustration ?? false);
  const prompt = buildExtractionPrompt(message, existingNodes);

  let response: ExtractionResponse;
  try {
    response = await client.generateJson<ExtractionResponse>(prompt, {
      system: systemPrompt,
      temperature: 0.1,
    });
  } catch (err) {
    console.error('[Extractor] LLM extraction failed:', err);
    return [];
  }

  if (!response || typeof response.nothing_new !== 'boolean') {
    console.error('[Extractor] Invalid response format');
    return [];
  }

  if (response.nothing_new || !Array.isArray(response.new_facts) || response.new_facts.length === 0) {
    return [];
  }

  const verified = verifyExtraction(response, existingNodes);

  for (const enrichment of verified.enrichments) {
    const existing = getNode(enrichment.node_id);
    if (existing && existing.content.length + enrichment.addition.length + 3 <= 500) {
      updateNode(enrichment.node_id, {
        content: `${existing.content} (${enrichment.addition})`,
      });
    }
  }

  const createdNodes: Node[] = [];

  for (const fact of verified.new_facts) {
    if (!fact.content || fact.content.length < 3 || fact.content.length > 300) continue;

    const validTypes = ['preference', 'fact', 'decision', 'task', 'project', 'learning'];
    if (!validTypes.includes(fact.type)) continue;

    const confidence = Math.min(CONFIDENCE_CAP, Math.max(0, fact.confidence));

    const emotionalTag = flags?.frustration ? 'frustration' :
      (response.emotion?.type && response.emotion.type !== 'neutral' ? response.emotion.type : undefined);

    const node = addNode(fact.content.trim(), fact.type, {
      importance: confidence * 0.9,
      confidence,
      emotional_tag: emotionalTag,
      source: `llm:${sessionId}`,
    });

    autoLinkNodes(node.id);
    createdNodes.push(node);
  }

  return createdNodes;
}

function truncateConversation(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.substring(0, half) + '\n\n[...truncated...]\n\n' + text.substring(text.length - half);
}

export async function extractFromTranscript(
  client: LLMClient,
  transcriptPath: string,
  sessionId?: string,
): Promise<Node[]> {
  const { readFileSync } = await import('fs');
  const { existsSync } = await import('fs');

  if (!existsSync(transcriptPath)) {
    console.error(`[Extractor] Transcript not found: ${transcriptPath}`);
    return [];
  }

  const raw = readFileSync(transcriptPath, 'utf-8');

  let conversation = '';
  try {
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'human' || entry.type === 'assistant') {
        const role = entry.type === 'human' ? 'User' : 'Assistant';
        const text = typeof entry.message === 'string'
          ? entry.message
          : entry.message?.content || JSON.stringify(entry.message);
        conversation += `${role}: ${text}\n\n`;
      }
    }
  } catch {
    conversation = raw;
  }

  const truncated = truncateConversation(conversation);
  const sid = sessionId || `transcript-${Date.now()}`;

  return extractFromMessage(client, truncated, sid);
}
