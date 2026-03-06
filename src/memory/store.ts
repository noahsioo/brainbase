import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { DB_PATH } from '../config.js';

// ── Interfaces ──────────────────────────────────────────────

export interface NodeMetadata {
  category?: string;
  quality?: number;
}

export interface Node {
  id: string;
  content: string;
  type: string;
  importance: number;
  activation: number;
  confidence: number;
  activation_count: number;
  emotional_tag: string | null;
  source: string;
  created_at: number;
  last_activated: number;
  chunk_id: string | null;
  abstraction_level: number;
  metadata: string | null;
}

export interface Edge {
  id: string;
  source_id: string;
  target_id: string;
  strength: number;
  type: string;
  co_activations: number;
  created_at: number;
  last_strengthened: number;
}

export interface Chunk {
  id: string;
  name: string;
  description: string;
  node_ids: string[];
  created_at: number;
}

export interface Pattern {
  id: string;
  description: string;
  type: string;
  evidence: string[];
  confidence: number;
  times_confirmed: number;
  created_at: number;
  last_confirmed: number;
}

export interface Session {
  id: string;
  provider: string;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  topics: string[];
  summary: string | null;
  mood_start: string | null;
  mood_end: string | null;
  productivity: number | null;
}

export interface RawBufferEntry {
  id: string;
  session_id: string;
  provider: string;
  role: string;
  content: string;
  timestamp: number;
  processed: boolean;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  totalPatterns: number;
  totalSessions: number;
  typeCounts: Record<string, number>;
  latestSession: Session | null;
}

// Backward-compatible alias
export interface Memory {
  id: string;
  text: string;
  category: string;
  importance: number;
  source: string;
  session_id: string | null;
  created_at: number;
  updated_at: number;
  tags: string[];
}

// ── Database ────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH, { fileMustExist: false });
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  migrateSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'fact',
      importance REAL DEFAULT 0.5,
      activation REAL DEFAULT 0.0,
      confidence REAL DEFAULT 1.0,
      activation_count INTEGER DEFAULT 0,
      emotional_tag TEXT,
      source TEXT DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      last_activated INTEGER NOT NULL,
      chunk_id TEXT,
      abstraction_level INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      strength REAL DEFAULT 0.5,
      type TEXT DEFAULT 'related',
      co_activations INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_strengthened INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      node_ids TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      type TEXT DEFAULT 'behavioral',
      evidence TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      times_confirmed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_confirmed INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moods (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      timestamp INTEGER NOT NULL,
      mood TEXT NOT NULL,
      intensity REAL DEFAULT 0.5,
      trigger TEXT
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id TEXT PRIMARY KEY,
      problem_node_id TEXT,
      attempt TEXT NOT NULL,
      success INTEGER DEFAULT 0,
      session_id TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_buffer (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS knowledge_gaps (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      description TEXT NOT NULL,
      node_count INTEGER DEFAULT 0,
      priority REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      filled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      message_count INTEGER DEFAULT 0,
      topics TEXT DEFAULT '[]',
      summary TEXT,
      mood_start TEXT,
      mood_end TEXT,
      productivity REAL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      node_count INTEGER DEFAULT 0,
      edge_count INTEGER DEFAULT 0,
      pattern_count INTEGER DEFAULT 0,
      top_topics TEXT DEFAULT '[]',
      state_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS expertise (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      level REAL DEFAULT 0.0,
      question_count INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      last_assessed INTEGER,
      trend TEXT DEFAULT 'stable'
    );

    CREATE TABLE IF NOT EXISTS hot_memory (
      id TEXT PRIMARY KEY DEFAULT 'current',
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      token_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_importance ON nodes(importance);
    CREATE INDEX IF NOT EXISTS idx_nodes_created ON nodes(created_at);
    CREATE INDEX IF NOT EXISTS idx_nodes_activation ON nodes(activation);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE TABLE IF NOT EXISTS signal_counters (
      entity TEXT PRIMARY KEY,
      count INTEGER DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      sessions TEXT DEFAULT '[]',
      co_entities TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tacit_patterns (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      observations INTEGER DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      promoted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      node_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      model TEXT DEFAULT 'text-embedding-3-small',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_raw_buffer_processed ON raw_buffer(processed);
    CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
    CREATE INDEX IF NOT EXISTS idx_signal_counters_count ON signal_counters(count);
    CREATE INDEX IF NOT EXISTS idx_tacit_patterns_category ON tacit_patterns(category);
    CREATE INDEX IF NOT EXISTS idx_tacit_patterns_observations ON tacit_patterns(observations);
  `);
}

function migrateSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>;
  const hasAbstractionLevel = columns.some(c => c.name === 'abstraction_level');
  if (!hasAbstractionLevel) {
    db.exec("ALTER TABLE nodes ADD COLUMN abstraction_level INTEGER DEFAULT 0");
  }
  const hasMetadata = columns.some(c => c.name === 'metadata');
  if (!hasMetadata) {
    db.exec("ALTER TABLE nodes ADD COLUMN metadata TEXT");
  }
}

// ── Node CRUD ───────────────────────────────────────────────

export function addNode(
  content: string,
  type: string,
  opts?: {
    importance?: number;
    confidence?: number;
    emotional_tag?: string;
    source?: string;
    chunk_id?: string;
    abstraction_level?: number;
    metadata?: NodeMetadata;
  },
): Node {
  const db = getDb();
  const now = Date.now();
  const metadataStr = opts?.metadata ? JSON.stringify(opts.metadata) : null;
  const node: Node = {
    id: randomUUID(),
    content,
    type,
    importance: opts?.importance ?? 0.5,
    activation: 0.0,
    confidence: opts?.confidence ?? 1.0,
    activation_count: 0,
    emotional_tag: opts?.emotional_tag ?? null,
    source: opts?.source ?? 'unknown',
    created_at: now,
    last_activated: now,
    chunk_id: opts?.chunk_id ?? null,
    abstraction_level: opts?.abstraction_level ?? 0,
    metadata: metadataStr,
  };

  db.prepare(`
    INSERT INTO nodes (id, content, type, importance, activation, confidence,
      activation_count, emotional_tag, source, created_at, last_activated, chunk_id, abstraction_level, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id, node.content, node.type, node.importance, node.activation,
    node.confidence, node.activation_count, node.emotional_tag, node.source,
    node.created_at, node.last_activated, node.chunk_id, node.abstraction_level,
    node.metadata,
  );

  return node;
}

export function getNode(id: string): Node | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Node) ?? null;
}

export function getNodes(opts?: {
  type?: string;
  minImportance?: number;
  limit?: number;
}): Node[] {
  const db = getDb();
  let query = 'SELECT * FROM nodes WHERE 1=1';
  const params: unknown[] = [];

  if (opts?.type) {
    query += ' AND type = ?';
    params.push(opts.type);
  }
  if (opts?.minImportance !== undefined) {
    query += ' AND importance >= ?';
    params.push(opts.minImportance);
  }

  query += ' ORDER BY importance DESC, last_activated DESC';

  if (opts?.limit) {
    query += ' LIMIT ?';
    params.push(opts.limit);
  }

  return db.prepare(query).all(...params) as Node[];
}

export function updateNode(id: string, updates: Partial<Pick<Node, 'content' | 'type' | 'importance' | 'activation' | 'confidence' | 'emotional_tag' | 'chunk_id' | 'activation_count' | 'last_activated' | 'abstraction_level' | 'metadata'>>): void {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    params.push(value);
  }

  if (fields.length === 0) return;

  params.push(id);
  db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  // Invalidate embedding if content changed (will be re-embedded by queue)
  if (updates.content !== undefined) {
    db.prepare('DELETE FROM embeddings WHERE node_id = ?').run(id);
  }
}

export function deleteNode(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  return result.changes > 0;
}

const SEARCH_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
  'von', 'zu', 'in', 'auf', 'an', 'den', 'dem', 'des',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'nicht', 'kein', 'aber', 'auch', 'noch', 'schon', 'nur',
  'the', 'a', 'an', 'is', 'and', 'or', 'with', 'of', 'to', 'in',
  'on', 'for', 'at', 'by', 'it', 'he', 'she', 'we', 'you', 'they',
  'not', 'no', 'but', 'also', 'just', 'only', 'if', 'then', 'so',
  'have', 'has', 'had', 'was', 'were', 'can', 'will', 'would', 'should',
  'do', 'does', 'did', 'this', 'that', 'my', 'your', 'his', 'her',
  'wie', 'was', 'wo', 'wer', 'wann', 'hab', 'hat', 'bin', 'sind',
  'mal', 'halt', 'lass', 'bitte', 'ja', 'nein', 'ok', 'okay',
]);

export function searchNodes(query: string, limit = 20): Node[] {
  const db = getDb();

  // Try semantic search first if embeddings available
  const semanticResults = semanticSearch(query, limit);
  if (semanticResults) return semanticResults;

  // Fallback: keyword search
  return keywordSearchNodes(query, limit);
}

function keywordSearchNodes(query: string, limit: number): Node[] {
  const db = getDb();
  const words = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !SEARCH_STOPWORDS.has(w));

  if (words.length === 0) {
    return db.prepare(`
      SELECT * FROM nodes WHERE content LIKE ?
      ORDER BY importance DESC, last_activated DESC LIMIT ?
    `).all(`%${query}%`, limit) as Node[];
  }

  const scores = new Map<string, { node: Node; matchCount: number }>();

  for (const word of words) {
    const hits = db.prepare('SELECT * FROM nodes WHERE LOWER(content) LIKE ?')
      .all(`%${word}%`) as Node[];
    for (const hit of hits) {
      const existing = scores.get(hit.id);
      if (existing) {
        existing.matchCount++;
      } else {
        scores.set(hit.id, { node: hit, matchCount: 1 });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.node.importance - a.node.importance;
    })
    .slice(0, limit)
    .map(s => s.node);
}

// ── Semantic Search ────────────────────────────────────────

let _queryEmbeddingCache: Map<string, Float32Array> = new Map();

export function setQueryEmbedding(query: string, vector: Float32Array): void {
  _queryEmbeddingCache.set(query.toLowerCase().trim(), vector);
  if (_queryEmbeddingCache.size > 50) {
    const firstKey = _queryEmbeddingCache.keys().next().value;
    if (firstKey) _queryEmbeddingCache.delete(firstKey);
  }
}

export function clearQueryEmbeddingCache(): void {
  _queryEmbeddingCache.clear();
}

function semanticSearch(query: string, limit: number): Node[] | null {
  const queryKey = query.toLowerCase().trim();
  const queryVec = _queryEmbeddingCache.get(queryKey);
  if (!queryVec) return null;

  const allEmbeddings = getAllEmbeddings();
  if (allEmbeddings.length === 0) return null;

  const db = getDb();

  // Compute cosine similarity for all embedded nodes
  const scored: Array<{ node_id: string; similarity: number }> = [];
  for (const emb of allEmbeddings) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < queryVec.length; i++) {
      dot += queryVec[i] * emb.vector[i];
      normA += queryVec[i] * queryVec[i];
      normB += emb.vector[i] * emb.vector[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    const sim = denom === 0 ? 0 : dot / denom;
    if (sim > 0.15) {
      scored.push({ node_id: emb.node_id, similarity: sim });
    }
  }

  // Also get keyword hits for hybrid scoring
  const keywordHits = new Set<string>();
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !SEARCH_STOPWORDS.has(w));
  for (const word of words) {
    const hits = db.prepare('SELECT id FROM nodes WHERE LOWER(content) LIKE ?')
      .all(`%${word}%`) as Array<{ id: string }>;
    for (const h of hits) keywordHits.add(h.id);
  }

  // Hybrid score: 0.7 * semantic + 0.3 * keyword
  const finalScores = scored.map(s => ({
    node_id: s.node_id,
    score: 0.7 * s.similarity + (keywordHits.has(s.node_id) ? 0.3 : 0),
  }));

  // Add keyword-only hits that weren't in semantic results
  for (const kid of keywordHits) {
    if (!finalScores.some(f => f.node_id === kid)) {
      finalScores.push({ node_id: kid, score: 0.3 });
    }
  }

  finalScores.sort((a, b) => b.score - a.score);
  const topIds = finalScores.slice(0, limit).map(f => f.node_id);

  if (topIds.length === 0) return null;

  const nodes: Node[] = [];
  for (const id of topIds) {
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Node | undefined;
    if (node) nodes.push(node);
  }

  return nodes;
}

export function deleteNodesByQuery(query: string): number {
  const db = getDb();
  const pattern = `%${query}%`;
  const result = db.prepare('DELETE FROM nodes WHERE content LIKE ?').run(pattern);
  return result.changes;
}

// ── Edge CRUD ───────────────────────────────────────────────

export function addEdge(sourceId: string, targetId: string, type: string, strength = 0.5): Edge {
  const db = getDb();
  const now = Date.now();
  const edge: Edge = {
    id: randomUUID(),
    source_id: sourceId,
    target_id: targetId,
    strength,
    type,
    co_activations: 0,
    created_at: now,
    last_strengthened: now,
  };

  db.prepare(`
    INSERT INTO edges (id, source_id, target_id, strength, type, co_activations,
      created_at, last_strengthened)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id, edge.source_id, edge.target_id, edge.strength, edge.type,
    edge.co_activations, edge.created_at, edge.last_strengthened,
  );

  return edge;
}

export function getEdgesForNode(nodeId: string): Edge[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM edges WHERE source_id = ? OR target_id = ?
  `).all(nodeId, nodeId) as Edge[];
}

export function getEdgeBetween(sourceId: string, targetId: string): Edge | null {
  const db = getDb();
  return (db.prepare(`
    SELECT * FROM edges
    WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
  `).get(sourceId, targetId, targetId, sourceId) as Edge) ?? null;
}

export function strengthenEdge(id: string, increment: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE edges SET strength = MIN(1.0, strength + ?),
    co_activations = co_activations + 1,
    last_strengthened = ?
    WHERE id = ?
  `).run(increment, Date.now(), id);
}

export function weakenEdge(id: string, decrement: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE edges SET strength = MAX(0.0, strength - ?) WHERE id = ?
  `).run(decrement, id);
}

// ── Raw Buffer ──────────────────────────────────────────────

const MAX_RAW_BUFFER = 5000;
const PRUNE_BATCH = 500;

export function addToRawBuffer(entry: Omit<RawBufferEntry, 'id' | 'processed'>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO raw_buffer (id, session_id, provider, role, content, timestamp, processed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(randomUUID(), entry.session_id, entry.provider, entry.role, entry.content, entry.timestamp);

  const count = db.prepare('SELECT COUNT(*) as c FROM raw_buffer').get() as { c: number };
  if (count.c > MAX_RAW_BUFFER) {
    db.prepare(`DELETE FROM raw_buffer WHERE id IN (
      SELECT id FROM raw_buffer ORDER BY timestamp ASC LIMIT ?
    )`).run(PRUNE_BATCH);
  }
}

export function getUnprocessedBuffer(limit = 50): RawBufferEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM raw_buffer WHERE processed = 0
    ORDER BY timestamp ASC LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string,
    session_id: r.session_id as string,
    provider: r.provider as string,
    role: r.role as string,
    content: r.content as string,
    timestamp: r.timestamp as number,
    processed: (r.processed as number) === 1,
  }));
}

export function markBufferProcessed(id: string): void {
  const db = getDb();
  db.prepare('UPDATE raw_buffer SET processed = 1 WHERE id = ?').run(id);
}

// ── Sessions ────────────────────────────────────────────────

export function createSession(provider: string, sessionId?: string): Session {
  const db = getDb();
  const session: Session = {
    id: sessionId || randomUUID(),
    provider,
    started_at: Date.now(),
    ended_at: null,
    message_count: 0,
    topics: [],
    summary: null,
    mood_start: null,
    mood_end: null,
    productivity: null,
  };

  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, provider, started_at, ended_at, message_count,
      topics, summary, mood_start, mood_end, productivity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.provider, session.started_at, session.ended_at,
    session.message_count, JSON.stringify(session.topics), session.summary,
    session.mood_start, session.mood_end, session.productivity,
  );

  return session;
}

export function endSession(id: string): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id);
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as (Session & { topics: string }) | undefined;
  if (!row) return null;
  return { ...row, topics: JSON.parse(row.topics as string) };
}

// ── Hot Memory ──────────────────────────────────────────────

export function getHotMemoryContent(): string {
  const db = getDb();
  const row = db.prepare("SELECT content FROM hot_memory WHERE id = 'current'").get() as { content: string } | undefined;
  return row?.content || '';
}

export function setHotMemoryContent(content: string): void {
  const db = getDb();
  const tokenEstimate = Math.ceil(content.length / 4);
  db.prepare(`
    INSERT OR REPLACE INTO hot_memory (id, content, updated_at, token_count)
    VALUES ('current', ?, ?, ?)
  `).run(content, Date.now(), tokenEstimate);
}

// ── Stats ───────────────────────────────────────────────────

export function getStats(): GraphStats {
  const db = getDb();

  const totalNodes = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
  const totalEdges = (db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }).count;
  const totalPatterns = (db.prepare('SELECT COUNT(*) as count FROM patterns').get() as { count: number }).count;
  const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;

  const types = db.prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type').all() as Array<{ type: string; count: number }>;
  const typeCounts: Record<string, number> = {};
  for (const t of types) {
    typeCounts[t.type] = t.count;
  }

  const latestRow = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1').get() as (Session & { topics: string }) | undefined;
  const latestSession = latestRow ? { ...latestRow, topics: JSON.parse(latestRow.topics as string) } : null;

  return { totalNodes, totalEdges, totalPatterns, totalSessions, typeCounts, latestSession };
}

// ── Backward-Compatible Wrappers ────────────────────────────

export function addMemory(mem: Omit<Memory, 'id' | 'created_at' | 'updated_at'>): Memory {
  const node = addNode(mem.text, mem.category, {
    importance: mem.importance,
    source: mem.source,
  });

  return {
    id: node.id,
    text: node.content,
    category: node.type,
    importance: node.importance,
    source: node.source,
    session_id: mem.session_id,
    created_at: node.created_at,
    updated_at: node.created_at,
    tags: mem.tags || [],
  };
}

export function getMemories(opts?: {
  category?: string;
  limit?: number;
  minImportance?: number;
}): Memory[] {
  const nodes = getNodes({
    type: opts?.category,
    minImportance: opts?.minImportance,
    limit: opts?.limit,
  });

  return nodes.map(n => ({
    id: n.id,
    text: n.content,
    category: n.type,
    importance: n.importance,
    source: n.source,
    session_id: null,
    created_at: n.created_at,
    updated_at: n.last_activated,
    tags: [n.type],
  }));
}

export function searchMemories(query: string, limit = 20): Memory[] {
  const nodes = searchNodes(query, limit);
  return nodes.map(n => ({
    id: n.id,
    text: n.content,
    category: n.type,
    importance: n.importance,
    source: n.source,
    session_id: null,
    created_at: n.created_at,
    updated_at: n.last_activated,
    tags: [n.type],
  }));
}

export function deleteMemory(id: string): boolean {
  return deleteNode(id);
}

export function deleteMemoriesByQuery(query: string): number {
  return deleteNodesByQuery(query);
}

// ── Embeddings ─────────────────────────────────────────────

export function saveEmbedding(nodeId: string, vector: Float32Array): void {
  const db = getDb();
  const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db.prepare(`
    INSERT OR REPLACE INTO embeddings (node_id, vector, created_at)
    VALUES (?, ?, ?)
  `).run(nodeId, buffer, Date.now());
}

export function getEmbedding(nodeId: string): Float32Array | null {
  const db = getDb();
  const row = db.prepare('SELECT vector FROM embeddings WHERE node_id = ?').get(nodeId) as { vector: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
}

export function getAllEmbeddings(): Array<{ node_id: string; vector: Float32Array }> {
  const db = getDb();
  const rows = db.prepare('SELECT node_id, vector FROM embeddings').all() as Array<{ node_id: string; vector: Buffer }>;
  return rows.map(r => ({
    node_id: r.node_id,
    vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
  }));
}

export function deleteEmbedding(nodeId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM embeddings WHERE node_id = ?').run(nodeId);
}

export function getEmbeddingCount(): { embedded: number; total: number } {
  const db = getDb();
  const embedded = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }).c;
  const total = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  return { embedded, total };
}

export function getNodesWithoutEmbeddings(limit = 50): Node[] {
  const db = getDb();
  return db.prepare(`
    SELECT n.* FROM nodes n
    LEFT JOIN embeddings e ON n.id = e.node_id
    WHERE e.node_id IS NULL
    LIMIT ?
  `).all(limit) as Node[];
}
