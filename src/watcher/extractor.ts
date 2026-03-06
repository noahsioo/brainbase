import type { LLMClient } from '../llm/types.js';
import { addNode, getNode, updateNode, searchNodes, getDb, type Node } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { verifyExtraction, type ExtractionResponse } from '../extraction/verification.js';
import { analyzeStyleForCategory } from '../learning/style-analyzer.js';
import { queueEmbedding } from '../llm/embeddings.js';

const CONFIDENCE_CAP = 0.8;

function buildSystemPrompt(frustration: boolean): string {
  const base = `You are the Hippocampus of an AI memory system. Your job is to decide:
What from this conversation is WORTH remembering?

Rules:
1. Only store CONCRETE, SPECIFIC information
   GOOD: "User's name is Lovis, building Memory Unlimited with TypeScript"
   BAD: "There are weaknesses in the system"
   BAD: "User wants to do something"

2. Store CONCEPTS, not words
   GOOD: "User prefers direct communication, no filler"
   BAD: "User says 'digga' a lot"

3. Summarize instead of copying verbatim
   GOOD: "User frustrated because memory system stores garbage instead of real memories"
   BAD: "Das System macht nur Scheisse"

4. If the message contains NO new information → nothing_new: true
   Smalltalk, confirmations ("ok", "ja genau", "weiter"), pure code requests → store NOTHING

5. Types:
   - identity: Who is the user? Name, age, job, location
   - preference: What does the user like/want? How do they work?
   - decision: What was decided? Why?
   - project: What is the user working on? Tech stack?
   - learning: What did the user learn? What was new?
   - task: What needs to be done?
   - insight: Cross-cutting insights, patterns
   - example: The user shares an EXAMPLE of their work (a text they wrote, code they produced,
     a template they use, a message they crafted). Store the FULL text, not a summary.
     Examples are gold - they show HOW the user does things, not just WHAT.
     Add metadata.category (e.g. "youtube_description", "email", "code_review", "commit_message").

6. Keep content under 150 chars for normal types, but examples can be up to 2000 chars
7. confidence between 0.3 and 0.8 - NEVER higher
8. One fact per entry - don't combine multiple facts

9. You can also UPDATE existing knowledge if the new message changes or extends it.
   Use the "updates" array for this. Only update when there is a real change.`;

  if (frustration) {
    return base + `

FRUSTRATION MODE:
- The user is frustrated. Extract the CAUSE, not the emotion.
- Write "X causes problems" not "user hates X"
- Do NOT use emotional language in content fields`;
  }

  return base;
}

function buildExtractionPrompt(
  message: string,
  existingNodes: Node[],
  recentContext?: string,
): string {
  let nodesContext = '';
  if (existingNodes.length > 0) {
    const nodeList = existingNodes
      .slice(0, 15)
      .map(n => `- "${n.content}" (type: ${n.type}, confidence: ${n.confidence.toFixed(1)})`)
      .join('\n');
    nodesContext = `\nExisting knowledge (do NOT store again unless it CHANGED or got EXTENDED):\n${nodeList}\n`;
  }

  let conversationBlock: string;
  if (recentContext) {
    conversationBlock = `Recent conversation for context:\n${recentContext}\n\nExtract facts from the LATEST message(s) above. Use the earlier messages only for context.`;
  } else {
    conversationBlock = `New message: "${message}"`;
  }

  return `${nodesContext}
${conversationBlock}

Respond with this exact JSON:
{
  "nothing_new": true or false,
  "new_facts": [
    { "content": "...", "type": "identity|preference|decision|project|learning|task|insight|fact|example", "confidence": 0.3-0.8, "metadata": { "category": "optional_category" } }
  ],
  "updates": [
    { "existing_content": "exact content of existing node to update", "new_content": "updated content", "reason": "what changed" }
  ],
  "emotion": { "type": "neutral|frustrated|excited|curious", "intensity": 0.0-1.0 }
}

If nothing_new is true, new_facts and updates MUST be empty arrays.`;
}

function getRecentMessages(sessionId: string, limit: number = 10): string {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT role, content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(sessionId, limit) as Array<{ role: string; content: string }>;

    if (rows.length === 0) return '';

    return rows.reverse().map(r => {
      const prefix = r.role === 'user' ? 'User' : 'Assistant';
      return `${prefix}: ${r.content.slice(0, 500)}`;
    }).join('\n---\n');
  } catch {
    return '';
  }
}

export async function extractFromMessage(
  client: LLMClient,
  message: string,
  sessionId: string,
  flags?: KeywordFlags,
): Promise<Node[]> {
  const existingNodes = searchNodes(message, 15);

  const systemPrompt = buildSystemPrompt(flags?.frustration ?? false);

  // Always get recent context from raw_buffer for better understanding
  const isMultiMessage = message.includes('\n---\n');
  let recentContext: string | undefined;
  if (isMultiMessage) {
    recentContext = message;
  } else {
    const buffered = getRecentMessages(sessionId, 8);
    if (buffered) {
      recentContext = buffered;
    }
  }

  const prompt = buildExtractionPrompt(message, existingNodes, recentContext);

  let response: ExtractionResponse & { updates?: Array<{ existing_content: string; new_content: string; reason: string }> };
  try {
    response = await client.generateJson(prompt, {
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

  // Handle updates to existing nodes
  if (Array.isArray(response.updates)) {
    for (const update of response.updates) {
      if (!update.existing_content || !update.new_content) continue;
      if (update.new_content.length < 5 || update.new_content.length > 300) continue;

      // Find the existing node by content match
      for (const node of existingNodes) {
        if (node.content.toLowerCase().trim() === update.existing_content.toLowerCase().trim()) {
          updateNode(node.id, { content: update.new_content.trim() });
          break;
        }
      }
    }
  }

  if (response.nothing_new || !Array.isArray(response.new_facts) || response.new_facts.length === 0) {
    return [];
  }

  const verified = verifyExtraction(response, existingNodes);

  // Skip the old enrichment system - it appended garbage words
  // verified.enrichments are ignored now

  const createdNodes: Node[] = [];

  for (const fact of verified.new_facts) {
    const maxLen = fact.type === 'example' ? 2000 : 300;
    if (!fact.content || fact.content.length < 5 || fact.content.length > maxLen) continue;

    const validTypes = ['preference', 'fact', 'decision', 'task', 'project', 'learning', 'identity', 'insight', 'example'];
    if (!validTypes.includes(fact.type)) continue;

    const confidence = Math.min(CONFIDENCE_CAP, Math.max(0, fact.confidence));

    const emotionalTag = flags?.frustration ? 'frustration' :
      (response.emotion?.type && response.emotion.type !== 'neutral' ? response.emotion.type : undefined);

    const node = addNode(fact.content.trim(), fact.type, {
      importance: fact.type === 'example' ? 0.75 : confidence * 0.9,
      confidence,
      emotional_tag: emotionalTag,
      source: `llm:${sessionId}`,
      metadata: fact.metadata,
    });

    autoLinkNodes(node.id);
    queueEmbedding(node.id, node.content);
    createdNodes.push(node);

    // Trigger style analysis when example is created via LLM
    if (fact.type === 'example' && fact.metadata?.category) {
      try { analyzeStyleForCategory(fact.metadata.category); } catch { /* non-critical */ }
    }
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

const EPISODE_SYSTEM_PROMPT = `You are writing a diary entry for an AI memory system.
Summarize this session as an EXPERIENCE, not a fact list.

Format:
- What was worked on? Be specific (project names, features, bugs).
- What was the result? Did it succeed, fail, get stuck?
- What was the mood? Frustrated, excited, focused, confused?
- Any key decisions or breakthroughs?

Write like a diary entry. Max 300 words. Concrete and specific.
Write in the SAME LANGUAGE the user used (German if they spoke German, English if English).
Respond with JSON: { "episode": "the diary entry text" }`;

export async function extractEpisode(
  client: LLMClient,
  transcriptText: string,
  sessionId: string,
): Promise<Node | null> {
  const truncated = truncateConversation(transcriptText, 6000);

  let response: { episode?: string };
  try {
    response = await client.generateJson(
      `Session transcript:\n${truncated}\n\nWrite the diary entry for this session.`,
      { system: EPISODE_SYSTEM_PROMPT, temperature: 0.3 },
    );
  } catch {
    return null;
  }

  if (!response?.episode || response.episode.length < 20) return null;

  const episode = response.episode.slice(0, 1500);

  const node = addNode(episode, 'episode', {
    importance: 0.7,
    confidence: 0.7,
    source: `episode:${sessionId}`,
  });

  autoLinkNodes(node.id);
  queueEmbedding(node.id, node.content);
  return node;
}
