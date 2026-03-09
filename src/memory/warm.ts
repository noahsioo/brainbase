import { searchNodes, type Node } from './store.js';
import { activateByQuery, getActivatedNodes } from './activation.js';

const WARM_EXCLUDED_TYPES = new Set(['failure', 'system_knowledge', 'auto_topic', 'example']);

export function getWarmMemories(topic: string, limit = 10, sessionId?: string): Node[] {
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

  let block = `[Memory System - Topic: ${topic}]\n`;
  block += `Relevant nodes for this topic:\n\n`;

  for (const n of nodes) {
    block += `- [${n.type}] ${n.content}\n`;
  }

  return block;
}

export function getWarmMemoryForTopic(topic: string, sessionId?: string): string {
  const nodes = getWarmMemories(topic, 10, sessionId);
  return buildWarmMemoryBlock(topic, nodes);
}
