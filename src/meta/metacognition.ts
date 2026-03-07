import { getDb, type Node } from '../memory/store.js';

// ── 15.1: Feeling of Knowing ────────────────────────────────

export interface FOKSignal {
  topic: string;
  weakly_activated: number;
  strongly_activated: number;
  fok_score: number;
  has_fragments: boolean;
}

export function detectFeelingOfKnowing(topic?: string): FOKSignal | null {
  if (!topic) return null;

  const db = getDb();

  const weakCount = (db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE activation BETWEEN 0.02 AND 0.15 AND importance >= 0.4"
  ).get() as { c: number }).c;

  const strongCount = (db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE activation > 0.3"
  ).get() as { c: number }).c;

  if (weakCount < 3) return null;

  const fokScore = Math.min(1.0, weakCount / (strongCount + 3));
  const hasFragments = fokScore > 0.5 && weakCount >= 5;

  return { topic, weakly_activated: weakCount, strongly_activated: strongCount, fok_score: fokScore, has_fragments: hasFragments };
}

// ── 15.2: Judgment of Learning ───────────────────────────────

export type JOLTier = 'secure' | 'probable' | 'fragile';

export function calculateJOL(node: Node): { score: number; tier: JOLTier } {
  let meta: Record<string, unknown> = {};
  try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch {}

  const evidence = (meta.evidence_count as number) || 1;
  const sessions = ((meta.unique_sessions as string[]) || []).length;
  const ageDays = (Date.now() - node.created_at) / (1000 * 60 * 60 * 24);
  const isCortical = meta.memory_tier === 'cortical';

  let score = 0;
  score += Math.min(0.3, evidence * 0.06);
  score += Math.min(0.25, sessions * 0.05);
  score += Math.min(0.2, node.activation_count * 0.01);
  score += node.confidence * 0.15;

  if (ageDays > 14 && evidence <= 1 && sessions <= 1) score *= 0.5;
  if (isCortical) score = Math.max(score, 0.7);

  score = Math.min(1.0, score);
  const tier: JOLTier = score > 0.8 ? 'secure' : score > 0.3 ? 'probable' : 'fragile';
  return { score, tier };
}

// ── 15.3: Drei Aufmerksamkeitssysteme ────────────────────────

export interface AttentionState {
  alerting: number;
  orienting: number;
  executive: number;
}

export function calculateAttentionState(
  urgency: number,
  frustration: boolean,
  explicitMemory: boolean,
  entityCount: number,
  topicChanged: boolean,
  infoDensity: number,
  taskMode: string,
): AttentionState {
  let alerting = urgency;
  if (frustration) alerting = Math.max(alerting, 0.6);
  if (explicitMemory) alerting = Math.max(alerting, 0.5);
  if (topicChanged) alerting = Math.max(alerting, 0.4);
  alerting = Math.min(1.0, alerting);

  let orienting = 0.5;
  if (entityCount >= 3) orienting = Math.min(1.0, 0.5 + entityCount * 0.1);
  if (entityCount === 0) orienting = 0.2;
  if (topicChanged) orienting *= 0.7;
  orienting = Math.min(1.0, orienting);

  let executive = infoDensity;
  if (taskMode === 'learning' || taskMode === 'reviewing') executive = Math.max(executive, 0.7);
  if (taskMode === 'debugging') executive = Math.max(executive, 0.6);
  if (taskMode === 'chatting') executive = Math.min(executive, 0.3);
  if (taskMode === 'urgent') executive = Math.max(executive, 0.5);
  executive = Math.min(1.0, executive);

  return { alerting, orienting, executive };
}
