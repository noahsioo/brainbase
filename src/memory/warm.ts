import { searchNodes, type Node } from './store.js';
import { activateByQuery, getActivatedNodes } from './activation.js';

export function getWarmMemories(topic: string, limit = 10, sessionId?: string): Node[] {
  activateByQuery(topic, 1.0, sessionId);
  const activated = getActivatedNodes(limit, sessionId);
  if (activated.length > 0) return activated;
  return searchNodes(topic, limit);
}

export function buildWarmMemoryBlock(topic: string, nodes: Node[]): string {
  if (nodes.length === 0) return '';

  let block = `[Memory System - Topic: ${topic}]\n`;
  block += `Relevante Nodes fuer dieses Thema:\n\n`;

  for (const n of nodes) {
    block += `- [${n.type}] ${n.content}\n`;
  }

  return block;
}

export function getWarmMemoryForTopic(topic: string, sessionId?: string): string {
  const nodes = getWarmMemories(topic, 10, sessionId);
  return buildWarmMemoryBlock(topic, nodes);
}
