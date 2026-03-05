import { randomUUID } from 'crypto';
import { getDb } from '../memory/store.js';
import { pruneGraph, type PruningResult } from './pruning.js';
import { mergeNodes, type MergeResult } from './merger.js';
import { buildAbstractions, type AbstractionResult } from './abstraction-builder.js';
import { dreamPhase, type DreamResult } from './dreamer.js';
import { distillKnowledge, type DistillResult } from './distiller.js';
import { updateHotMemoryInDb, updateAllProviderFiles } from '../memory/hot.js';
import { detectKnowledgeGaps } from '../learning/gap-detector.js';
import type { LLMClient } from '../llm/types.js';

export interface ConsolidationResult {
  edges_pruned: number;
  orphans_found: number;
  nodes_promoted: number;
  nodes_decayed: number;
  nodes_merged: number;
  patterns_created: number;
  dream_edges: number;
  gaps_found: number;
  contradictions: number;
  clusters_distilled: number;
  global_profile_updated: boolean;
  duration_ms: number;
}

function ensureSystemStateTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

export function getLastConsolidation(): number {
  const db = getDb();
  ensureSystemStateTable();
  const row = db.prepare(
    "SELECT value FROM system_state WHERE key = 'last_consolidation'"
  ).get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

function setLastConsolidation(): void {
  const db = getDb();
  ensureSystemStateTable();
  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES ('last_consolidation', ?, ?)
  `).run(String(Date.now()), Date.now());
}

export async function runConsolidation(client?: LLMClient): Promise<ConsolidationResult> {
  const start = Date.now();

  // 1. Pruning
  const pruning: PruningResult = pruneGraph();

  // 2. Merging
  const merge: MergeResult = mergeNodes();

  // 3. Abstraction Building
  const abstraction: AbstractionResult = buildAbstractions();

  // 4. Dream Phase (requires Ollama)
  let dream: DreamResult = { dream_edges: 0, gaps_found: 0, contradictions: 0 };
  if (client) {
    try {
      dream = await dreamPhase(client);
    } catch {
      // Dream phase failure is non-fatal
    }
  }

  // 5. Distillation (requires Ollama)
  let distill: DistillResult = { clusters_distilled: 0, global_updated: false };
  if (client) {
    try {
      distill = await distillKnowledge(client);
    } catch {
      // Distillation failure is non-fatal
    }
  }

  // 6. Knowledge Gap Detection (from expertise data)
  let gapsFromExpertise = 0;
  try {
    const gapResult = detectKnowledgeGaps();
    gapsFromExpertise = gapResult.gaps_detected;
  } catch {
    // non-fatal
  }

  // 7. Snapshot
  try {
    createSnapshot();
  } catch {
    // non-fatal
  }

  // 8. Update hot memory + provider files
  updateHotMemoryInDb();
  updateAllProviderFiles();

  // 9. Save timestamp
  setLastConsolidation();

  return {
    edges_pruned: pruning.edges_pruned,
    orphans_found: pruning.orphans_found,
    nodes_promoted: pruning.nodes_promoted,
    nodes_decayed: pruning.nodes_decayed,
    nodes_merged: merge.nodes_merged,
    patterns_created: abstraction.patterns_created,
    dream_edges: dream.dream_edges,
    gaps_found: dream.gaps_found + gapsFromExpertise,
    contradictions: dream.contradictions,
    clusters_distilled: distill.clusters_distilled,
    global_profile_updated: distill.global_updated,
    duration_ms: Date.now() - start,
  };
}

function createSnapshot(): void {
  const db = getDb();
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const existing = db.prepare('SELECT id FROM snapshots WHERE date = ?').get(dateStr) as { id: string } | undefined;
  if (existing) return;

  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  const patternCount = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE type = 'pattern'").get() as { c: number }).c;

  const topTypes = db.prepare(
    "SELECT type, COUNT(*) as c FROM nodes WHERE type NOT IN ('core', 'pattern', 'distilled') GROUP BY type ORDER BY c DESC LIMIT 5"
  ).all() as Array<{ type: string; c: number }>;
  const topTopics = topTypes.map(t => t.type);

  db.prepare(`
    INSERT INTO snapshots (id, date, node_count, edge_count, pattern_count, top_topics, state_hash)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(randomUUID(), dateStr, nodeCount, edgeCount, patternCount, JSON.stringify(topTopics));
}
