import { searchNodes, setQueryEmbedding, type Node } from './store.js';
import { activateByQuery, getActivatedNodes } from './activation.js';
import { createEmbeddingClient } from '../llm/embeddings.js';

const WARM_EXCLUDED_TYPES = new Set(['failure', 'system_knowledge', 'auto_topic', 'example']);

let _warmEmbedPromise: Promise<void> | null = null;

async function ensureQueryEmbedding(topic: string): Promise<void> {
  const client = createEmbeddingClient();
  if (!client) return;
  try {
    const vec = await client.embed(topic);
    setQueryEmbedding(topic, vec);
  } catch {
    // Non-fatal — keyword search still works as fallback
  }
}

export async function getWarmMemoriesAsync(topic: string, limit = 10, sessionId?: string): Promise<Node[]> {
  await ensureQueryEmbedding(topic);
  return getWarmMemoriesSync(topic, limit, sessionId);
}

export function getWarmMemories(topic: string, limit = 10, sessionId?: string): Node[] {
  // Fire embedding request in background for NEXT call
  _warmEmbedPromise = ensureQueryEmbedding(topic);
  return getWarmMemoriesSync(topic, limit, sessionId);
}

function getWarmMemoriesSync(topic: string, limit: number, sessionId?: string): Node[] {
  activateByQuery(topic, 1.0, sessionId);
  const activated = getActivatedNodes(limit * 2, sessionId);
  const filtered = activated.filter(n =>
    !WARM_EXCLUDED_TYPES.has(n.type) &&
    n.content.length >= 10 &&
    !n.content.includes('Negative feedback'),
  );
  if (filtered.length > 0) return filtered.slice(0, limit);
  const fallback = searchNodes(topic, limit * 2);
  return fallback.filter(n =>
    !WARM_EXCLUDED_TYPES.has(n.type) &&
    n.content.length >= 10 &&
    !n.content.includes('Negative feedback'),
  ).slice(0, limit);
}

export function buildWarmMemoryBlock(topic: string, nodes: Node[]): string {
  if (nodes.length === 0) return '';

  const entityNodes = nodes.filter(n => n.type === 'entity');
  const knowledgeNodes = nodes.filter(n => n.type !== 'entity' && n.type !== 'core');

  const parts: string[] = [];

  if (entityNodes.length > 0) {
    parts.push(`Key concepts for ${topic}: ${entityNodes.map(n => n.content).join(', ')}.`);
  }

  for (const n of knowledgeNodes) {
    // Skip overly long episode blocks — summarize instead
    if (n.type === 'episode' && n.content.length > 200) {
      parts.push(n.content.substring(0, 197) + '...');
    } else {
      parts.push(n.content);
    }
  }

  if (parts.length === 0) return '';

  return `You know about ${topic}:\n${parts.map(p => `- ${p}`).join('\n')}\n`;
}

export function getWarmMemoryForTopic(topic: string, sessionId?: string): string {
  const nodes = getWarmMemories(topic, 10, sessionId);
  return buildWarmMemoryBlock(topic, nodes);
}

export async function getWarmMemoryForTopicAsync(topic: string, sessionId?: string): Promise<string> {
  const nodes = await getWarmMemoriesAsync(topic, 10, sessionId);
  return buildWarmMemoryBlock(topic, nodes);
}
