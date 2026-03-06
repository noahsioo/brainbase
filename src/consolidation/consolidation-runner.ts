import { randomUUID } from 'crypto';
import { getDb, addNode, addEdge, getEmbedding, getEdgeBetween } from '../memory/store.js';
import { cosineSimilarity } from '../llm/embeddings.js';
import { pruneGraph, type PruningResult } from './pruning.js';
import { mergeNodes, type MergeResult } from './merger.js';
import { buildAbstractions, type AbstractionResult } from './abstraction-builder.js';
import { dreamPhase, type DreamResult } from './dreamer.js';
import { distillKnowledge, type DistillResult } from './distiller.js';
import { updateHotMemoryInDb, updateAllProviderFiles } from '../memory/hot.js';
import { detectKnowledgeGaps } from '../learning/gap-detector.js';
import { detectAndCreateChunks } from '../memory/chunking.js';
import { runClusterStrengthening } from '../learning/cluster-tracker.js';
import { analyzeAllCategories } from '../learning/style-analyzer.js';
import { extractFromMessage } from '../watcher/extractor.js';
import type { LLMClient } from '../llm/types.js';

export interface ConsolidationResult {
  edges_pruned: number;
  orphans_found: number;
  nodes_promoted: number;
  nodes_decayed: number;
  nodes_deleted: number;
  nodes_merged: number;
  patterns_created: number;
  dream_edges: number;
  gaps_found: number;
  contradictions: number;
  clusters_distilled: number;
  global_profile_updated: boolean;
  chunks_created: number;
  nodes_chunked: number;
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

function homeostaticScaling(): number {
  const db = getDb();
  let scaled = 0;

  const avg = (db.prepare(
    "SELECT AVG(activation_count) as avg FROM nodes WHERE type != 'core'"
  ).get() as { avg: number }).avg || 1;

  const hotNodes = db.prepare(
    "SELECT id, activation_count FROM nodes WHERE activation_count > ? AND type != 'core'"
  ).all(avg * 3) as Array<{ id: string; activation_count: number }>;

  for (const hot of hotNodes) {
    const edges = db.prepare(
      'SELECT id, strength FROM edges WHERE source_id = ? OR target_id = ?'
    ).all(hot.id, hot.id) as Array<{ id: string; strength: number }>;

    const scaleFactor = Math.max(0.5, avg / hot.activation_count);

    for (const edge of edges) {
      const newStrength = Math.max(0.05, edge.strength * scaleFactor);
      if (newStrength < edge.strength) {
        db.prepare('UPDATE edges SET strength = ? WHERE id = ?').run(newStrength, edge.id);
        scaled++;
      }
    }
  }

  return scaled;
}

// M42: Tier 2 Transfer — nodes that crossed confidence+activation threshold get consolidation boost
function transferToTier2(): number {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT id, confidence, activation_count, importance, metadata FROM nodes
    WHERE confidence >= 0.5 AND activation_count >= 5
    AND type NOT IN ('core', 'system_knowledge', 'pattern', 'distilled')
  `).all() as Array<{ id: string; confidence: number; activation_count: number; importance: number; metadata: string | null }>;

  let transferred = 0;
  for (const node of candidates) {
    let meta: Record<string, unknown> = {};
    try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }
    if (meta.tier2_transferred) continue;

    const newImportance = Math.min(0.95, node.importance + 0.05);
    meta.tier2_transferred = true;
    db.prepare('UPDATE nodes SET importance = ?, metadata = ? WHERE id = ?')
      .run(newImportance, JSON.stringify(meta), node.id);
    transferred++;
  }
  return transferred;
}

// M42: Old emotional tags fade over time (emotion is transient)
function reviewEmotionalTags(): number {
  const db = getDb();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const result = db.prepare(`
    UPDATE nodes SET emotional_tag = NULL
    WHERE emotional_tag = 'frustration'
    AND last_activated < ?
    AND activation_count < 5
  `).run(thirtyDaysAgo);
  return result.changes;
}

// M45: Spacing Effect — unique sessions boost importance more than raw activation count
function applySpacingEffect(): number {
  const db = getDb();
  const nodes = db.prepare(`
    SELECT id, importance, metadata FROM nodes
    WHERE metadata IS NOT NULL AND activation_count >= 5
    AND type NOT IN ('core', 'system_knowledge')
  `).all() as Array<{ id: string; importance: number; metadata: string }>;

  let boosted = 0;
  for (const node of nodes) {
    let meta: Record<string, unknown>;
    try { meta = JSON.parse(node.metadata); } catch { continue; }

    const sessions = meta.unique_sessions as string[] | undefined;
    if (!sessions || sessions.length < 3) continue;
    if (meta.spacing_applied_count && (meta.spacing_applied_count as number) >= sessions.length) continue;

    const spacingBonus = Math.min(0.15, sessions.length * 0.02);
    const newImportance = Math.min(0.95, node.importance + spacingBonus);

    if (newImportance > node.importance) {
      meta.spacing_applied_count = sessions.length;
      db.prepare('UPDATE nodes SET importance = ?, metadata = ? WHERE id = ?')
        .run(newImportance, JSON.stringify(meta), node.id);
      boosted++;
    }
  }
  return boosted;
}

// M43: Replay — re-extract recent sessions with current knowledge
async function replayRecentSessions(client: LLMClient): Promise<number> {
  const db = getDb();
  const recentSessions = db.prepare(`
    SELECT id FROM sessions
    WHERE ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 3
  `).all() as Array<{ id: string }>;

  let nodesCreated = 0;

  for (const session of recentSessions) {
    const messages = db.prepare(
      "SELECT content FROM raw_buffer WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC LIMIT 20"
    ).all(session.id) as Array<{ content: string }>;

    if (messages.length === 0) continue;

    const combined = messages.map(m => m.content.slice(0, 500)).join('\n---\n');
    const nodes = await extractFromMessage(client, combined, session.id);
    nodesCreated += nodes.length;
  }

  return nodesCreated;
}

// M44: Deep Reconsolidation — LLM rewrites mature nodes with full context
async function deepReconsolidate(client: LLMClient): Promise<number> {
  const db = getDb();
  const matureNodes = db.prepare(`
    SELECT id, content, type, metadata FROM nodes
    WHERE activation_count > 30
    AND type NOT IN ('core', 'system_knowledge', 'entity', 'pattern', 'distilled', 'style_dna')
    AND length(content) < 200
    ORDER BY activation_count DESC LIMIT 5
  `).all() as Array<{ id: string; content: string; type: string; metadata: string | null }>;

  let rewritten = 0;

  for (const node of matureNodes) {
    let meta: Record<string, unknown> = {};
    try { meta = node.metadata ? JSON.parse(node.metadata) : {}; } catch { meta = {}; }
    if (meta.deep_reconsolidated) continue;

    const edges = db.prepare(`
      SELECT e.type, n.content FROM edges e
      JOIN nodes n ON (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END) = n.id
      WHERE e.source_id = ? OR e.target_id = ?
      LIMIT 10
    `).all(node.id, node.id, node.id) as Array<{ type: string; content: string }>;

    const context = edges.map(e => `${e.type}: ${e.content}`).join(', ');

    try {
      const result = await client.generateJson<{ rewritten: string }>(
        `This memory has been activated 30+ times, making it very important.
Rewrite it to be richer and more precise, but keep it concise (max 200 chars).

Original: "${node.content}"
Connected to: ${context || 'no connections'}
Type: ${node.type}

Respond with: { "rewritten": "improved version" }
Keep the same language (German if German, English if English).
Do NOT add speculation. Only refine based on the connections.`,
        { temperature: 0.2 }
      );

      if (result.rewritten && result.rewritten.length >= 10 && result.rewritten.length <= 250) {
        meta.deep_reconsolidated = true;
        meta.original_content = node.content;
        db.prepare('UPDATE nodes SET content = ?, metadata = ? WHERE id = ?')
          .run(result.rewritten, JSON.stringify(meta), node.id);
        rewritten++;
      }
    } catch { /* skip this node */ }
  }

  return rewritten;
}

// M46: Schema Formation — detect recurring workflow patterns across sessions
async function detectSchemas(client: LLMClient): Promise<number> {
  const db = getDb();

  const sessions = db.prepare(`
    SELECT id, topics FROM sessions
    WHERE ended_at IS NOT NULL AND message_count >= 5
    ORDER BY ended_at DESC LIMIT 10
  `).all() as Array<{ id: string; topics: string }>;

  if (sessions.length < 5) return 0;

  const summaries: string[] = [];
  for (const session of sessions) {
    const msgs = db.prepare(
      "SELECT role, content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp ASC LIMIT 15"
    ).all(session.id) as Array<{ role: string; content: string }>;

    const summary = msgs.map(m => {
      const prefix = m.role === 'user' ? 'U' : 'A';
      return `${prefix}: ${m.content.slice(0, 100)}`;
    }).join('\n');

    const topics = session.topics || '[]';
    summaries.push(`Session (topics: ${topics}):\n${summary}`);
  }

  const existingSchemas = db.prepare(
    "SELECT content FROM nodes WHERE type = 'schema'"
  ).all() as Array<{ content: string }>;
  const existingList = existingSchemas.map(s => s.content).join('; ');

  try {
    const result = await client.generateJson<{
      schemas: Array<{ pattern: string; frequency: number }>;
    }>(`Analyze these ${sessions.length} sessions for RECURRING workflow patterns.

${summaries.join('\n\n---\n\n')}

${existingList ? `Already known patterns: ${existingList}\nDo NOT repeat these.` : ''}

Find patterns like:
- "User reports bug → reads code → implements fix → tests"
- "User starts with architecture discussion → then implements"
- "User gives feedback → iterates → confirms"

Only report patterns that appear in 3+ sessions. Max 3 patterns.
Respond with: { "schemas": [{ "pattern": "description", "frequency": 3-10 }] }
If no clear patterns: { "schemas": [] }`, { temperature: 0.3 });

    if (!result.schemas || !Array.isArray(result.schemas)) return 0;

    let created = 0;
    for (const schema of result.schemas.slice(0, 3)) {
      if (!schema.pattern || schema.pattern.length < 10 || schema.pattern.length > 300) continue;
      if (schema.frequency < 3) continue;

      const existing = db.prepare(
        "SELECT id FROM nodes WHERE type = 'schema' AND content = ?"
      ).get(schema.pattern) as { id: string } | undefined;
      if (existing) continue;

      addNode(schema.pattern, 'schema', {
        importance: 0.8,
        confidence: Math.min(0.9, 0.5 + schema.frequency * 0.05),
        source: 'consolidation:schema',
      });
      created++;
    }
    return created;
  } catch { return 0; }
}

// M53: Default Mode Network — find hidden connections via embedding similarity (no LLM needed)
function defaultModePass(): number {
  const db = getDb();
  const entities = db.prepare(`
    SELECT n.id, n.content FROM nodes n
    JOIN embeddings e ON n.id = e.node_id
    WHERE n.type = 'entity' AND n.activation_count >= 3
    ORDER BY RANDOM() LIMIT 20
  `).all() as Array<{ id: string; content: string }>;

  if (entities.length < 2) return 0;

  let connections = 0;

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const vecA = getEmbedding(entities[i].id);
      const vecB = getEmbedding(entities[j].id);
      if (!vecA || !vecB) continue;

      const sim = cosineSimilarity(vecA, vecB);
      if (sim < 0.35 || sim > 0.8) continue;

      const existing = getEdgeBetween(entities[i].id, entities[j].id);
      if (existing) continue;

      addEdge(entities[i].id, entities[j].id, 'inferred', sim * 0.3);
      connections++;
      if (connections >= 5) return connections;
    }
  }
  return connections;
}

export async function runConsolidation(client?: LLMClient): Promise<ConsolidationResult> {
  const start = Date.now();

  // ═══ NREM PHASE: Faktische Consolidation ═══

  // Pruning — dead edges + orphans
  const pruning: PruningResult = pruneGraph();

  // Homeostatic Scaling — balance over-dominant nodes
  try { homeostaticScaling(); } catch { /* non-fatal */ }

  // Merging — deduplicate similar nodes
  const merge: MergeResult = mergeNodes();

  // Chunking — group co-activated nodes
  let chunking = { chunks_created: 0, nodes_chunked: 0 };
  try { chunking = detectAndCreateChunks(); } catch { /* non-fatal */ }

  // Abstraction Building — pattern recognition
  const abstraction: AbstractionResult = buildAbstractions();

  // M42: Tier 2 Transfer (Hippocampus → Cortex)
  let tier2Transferred = 0;
  try { tier2Transferred = transferToTier2(); } catch { /* non-fatal */ }

  // M42: Emotional Tag Review (old emotions fade)
  let emotionalReviewed = 0;
  try { emotionalReviewed = reviewEmotionalTags(); } catch { /* non-fatal */ }

  // M45: Spacing Effect (unique sessions → importance boost)
  let spacingBoosted = 0;
  try { spacingBoosted = applySpacingEffect(); } catch { /* non-fatal */ }

  // Knowledge Gap Detection (from expertise data)
  let gapsFromExpertise = 0;
  try {
    const gapResult = detectKnowledgeGaps();
    gapsFromExpertise = gapResult.gaps_detected;
  } catch { /* non-fatal */ }

  // Cluster strengthening (boost co-occurring topic clusters)
  try { runClusterStrengthening(); } catch { /* non-fatal */ }

  // Style DNA analysis (re-analyze all example categories)
  try { analyzeAllCategories(); } catch { /* non-fatal */ }

  // M53: Default Mode Network — find hidden connections via embedding similarity
  let dmnConnections = 0;
  try { dmnConnections = defaultModePass(); } catch { /* non-fatal */ }

  // ═══ REM PHASE: Kreative Consolidation (needs LLM) ═══

  let dream: DreamResult = { dream_edges: 0, gaps_found: 0, contradictions: 0 };
  let distill: DistillResult = { clusters_distilled: 0, global_updated: false };
  let replayed = 0;
  let deepReconsolidated = 0;
  let schemasFound = 0;

  if (client) {
    // Dream Phase — cross-cluster connections, gaps, contradictions
    try { dream = await dreamPhase(client); } catch { /* non-fatal */ }

    // Distillation — global profile
    try { distill = await distillKnowledge(client); } catch { /* non-fatal */ }

    // M43: Replay — re-extract recent sessions with current knowledge
    try { replayed = await replayRecentSessions(client); } catch { /* non-fatal */ }

    // M44: Deep Reconsolidation — LLM rewrites mature nodes
    try { deepReconsolidated = await deepReconsolidate(client); } catch { /* non-fatal */ }

    // M46: Schema Formation — detect workflow patterns
    try { schemasFound = await detectSchemas(client); } catch { /* non-fatal */ }
  }

  // ═══ POST-SLEEP: Snapshot + Hot Memory ═══

  try { createSnapshot(); } catch { /* non-fatal */ }

  updateHotMemoryInDb();
  updateAllProviderFiles();

  setLastConsolidation();

  return {
    edges_pruned: pruning.edges_pruned,
    orphans_found: pruning.orphans_found,
    nodes_promoted: pruning.nodes_promoted,
    nodes_decayed: pruning.nodes_decayed,
    nodes_deleted: pruning.nodes_deleted,
    nodes_merged: merge.nodes_merged,
    patterns_created: abstraction.patterns_created,
    dream_edges: dream.dream_edges,
    gaps_found: dream.gaps_found + gapsFromExpertise,
    contradictions: dream.contradictions,
    clusters_distilled: distill.clusters_distilled,
    global_profile_updated: distill.global_updated,
    chunks_created: chunking.chunks_created,
    nodes_chunked: chunking.nodes_chunked,
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
