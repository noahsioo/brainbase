import {
  getDb,
  addNode,
  addEdge,
  getNode,
  getEdgesForNode,
  type Node,
} from '../memory/store.js';
import { setSystemState } from '../memory/cold-start.js';
import type { LLMClient } from '../llm/types.js';

export interface DistillResult {
  clusters_distilled: number;
  global_updated: boolean;
}

const MAX_CLUSTER_DISTILLATIONS = 3;
const MIN_CLUSTER_SIZE = 5;
const GLOBAL_DISTILL_THRESHOLD = 50;

interface PatternCluster {
  pattern: Node;
  children: Node[];
}

function getPatternClusters(): PatternCluster[] {
  const db = getDb();

  const patterns = db.prepare(`
    SELECT * FROM nodes
    WHERE type = 'pattern'
      AND abstraction_level >= 2
    ORDER BY importance DESC
  `).all() as Node[];

  const clusters: PatternCluster[] = [];

  for (const pattern of patterns) {
    const edges = getEdgesForNode(pattern.id);
    const childIds = edges
      .filter(e => e.type === 'abstracts')
      .map(e => e.source_id === pattern.id ? e.target_id : e.source_id);

    const children: Node[] = [];
    for (const id of childIds) {
      const node = getNode(id);
      if (node) children.push(node);
    }

    if (children.length >= MIN_CLUSTER_SIZE) {
      clusters.push({ pattern, children });
    }
  }

  return clusters;
}

function hasExistingDistillation(patternId: string): boolean {
  const edges = getEdgesForNode(patternId);
  return edges.some(e => e.type === 'distills');
}

async function distillCluster(
  client: LLMClient,
  cluster: PatternCluster,
): Promise<string | null> {
  const contentList = cluster.children
    .map(n => `- [${n.type}] ${n.content}`)
    .join('\n');

  const prompt = `You are summarizing what we know about a user based on their knowledge graph.

Topic/Pattern: ${cluster.pattern.content}

Related facts:
${contentList}

Summarize ALL of these facts into 1-2 concise sentences about the user.
Write in third person ("The user..."). Be specific, not vague.
Only output the summary, nothing else.`;

  try {
    const summary = await client.generate(prompt, {
      temperature: 0.3,
      maxTokens: 200,
    });

    const trimmed = summary.trim();
    if (trimmed.length < 10 || trimmed.length > 500) return null;
    return trimmed;
  } catch {
    return null;
  }
}

async function distillClusters(client: LLMClient): Promise<number> {
  const clusters = getPatternClusters();
  let distilled = 0;

  for (const cluster of clusters) {
    if (distilled >= MAX_CLUSTER_DISTILLATIONS) break;
    if (hasExistingDistillation(cluster.pattern.id)) continue;

    const summary = await distillCluster(client, cluster);
    if (!summary) continue;

    const distilledNode = addNode(summary, 'distilled', {
      importance: Math.min(0.9, cluster.pattern.importance + 0.1),
      confidence: 0.8,
      source: 'distiller',
      abstraction_level: 3,
    });

    addEdge(distilledNode.id, cluster.pattern.id, 'distills', 0.7);
    distilled++;
  }

  return distilled;
}

async function buildGlobalProfile(client: LLMClient): Promise<boolean> {
  const db = getDb();

  const nodeCount = (
    db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }
  ).count;

  if (nodeCount < GLOBAL_DISTILL_THRESHOLD) return false;

  const topNodes = db.prepare(`
    SELECT * FROM nodes
    WHERE type NOT IN ('core', 'pattern')
    ORDER BY importance DESC
    LIMIT 30
  `).all() as Node[];

  if (topNodes.length < 10) return false;

  // Include distilled nodes first (higher quality summaries)
  const distilledNodes = db.prepare(`
    SELECT * FROM nodes
    WHERE type = 'distilled'
    ORDER BY importance DESC
    LIMIT 10
  `).all() as Node[];

  const allContent: string[] = [];

  for (const d of distilledNodes) {
    allContent.push(`[summary] ${d.content}`);
  }
  for (const n of topNodes) {
    if (n.type === 'distilled') continue;
    allContent.push(`[${n.type}] ${n.content}`);
  }

  const prompt = `You are building a comprehensive user profile from a knowledge graph.

Here are the most important things we know about this user:
${allContent.join('\n')}

Write a concise profile (max 200 words) that captures WHO this user is, what they work on, their preferences, and their goals. Write in third person. Be specific and useful - this will be injected as context for an AI assistant.

Only output the profile text, nothing else.`;

  try {
    const profile = await client.generate(prompt, {
      temperature: 0.3,
      maxTokens: 400,
    });

    const trimmed = profile.trim();
    if (trimmed.length < 20) return false;

    setSystemState('user_profile_distilled', trimmed);
    return true;
  } catch {
    return false;
  }
}

export async function distillKnowledge(client: LLMClient): Promise<DistillResult> {
  // 1. Cluster Destillation
  const clustersDistilled = await distillClusters(client);

  // 2. Global Profile
  const globalUpdated = await buildGlobalProfile(client);

  return {
    clusters_distilled: clustersDistilled,
    global_updated: globalUpdated,
  };
}
