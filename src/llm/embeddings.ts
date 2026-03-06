import { getConfig, type CloudConfig } from '../config.js';
import { saveEmbedding, getEmbedding } from '../memory/store.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100;

const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'openai', 'groq', 'together', 'mistral', 'openrouter', 'deepseek',
  'xai', 'cerebras', 'nvidia', 'litellm', 'custom',
]);

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  litellm: 'http://localhost:4000/v1',
};

// ── Vector Operations ──────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function findSimilar(
  query: Float32Array,
  candidates: Array<{ node_id: string; vector: Float32Array }>,
  topK: number,
): Array<{ node_id: string; similarity: number }> {
  const scored = candidates.map(c => ({
    node_id: c.node_id,
    similarity: cosineSimilarity(query, c.vector),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

// ── Embedding Client ───────────────────────────────────────

export interface EmbeddingClient {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isAvailable(): Promise<boolean>;
}

class OpenAIEmbeddingClient implements EmbeddingClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${text}`);
      }

      const data = await res.json() as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      data.data.sort((a, b) => a.index - b.index);
      for (const item of data.data) {
        results.push(new Float32Array(item.embedding));
      }
    }

    return results;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: 'test',
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Factory ────────────────────────────────────────────────

let _client: EmbeddingClient | null | undefined;

export function createEmbeddingClient(): EmbeddingClient | null {
  if (_client !== undefined) return _client;

  const config = getConfig();
  if (!config.cloud_provider) {
    _client = null;
    return null;
  }

  const cloud = config.cloud_provider;

  if (!OPENAI_COMPATIBLE_PROVIDERS.has(cloud.provider)) {
    _client = null;
    return null;
  }

  let apiKey: string;
  if (cloud.auth_method === 'env_var' && cloud.env_var_name) {
    apiKey = process.env[cloud.env_var_name] || '';
  } else {
    apiKey = cloud.api_key || '';
  }

  if (!apiKey) {
    _client = null;
    return null;
  }

  const baseUrl = cloud.base_url || BASE_URLS[cloud.provider] || BASE_URLS.openai;

  _client = new OpenAIEmbeddingClient(apiKey, baseUrl);
  return _client;
}

export function resetEmbeddingClient(): void {
  _client = undefined;
}

// ── Embedding Queue ────────────────────────────────────────

const _queue: Array<{ nodeId: string; content: string }> = [];
let _queueTimer: ReturnType<typeof setInterval> | null = null;

export function queueEmbedding(nodeId: string, content: string): void {
  if (_queue.some(q => q.nodeId === nodeId)) return;
  _queue.push({ nodeId, content });

  if (!_queueTimer) {
    _queueTimer = setInterval(processEmbeddingQueue, 2000);
  }
}

async function processEmbeddingQueue(): Promise<void> {
  if (_queue.length === 0) {
    if (_queueTimer) {
      clearInterval(_queueTimer);
      _queueTimer = null;
    }
    return;
  }

  const client = createEmbeddingClient();
  if (!client) {
    _queue.length = 0;
    if (_queueTimer) {
      clearInterval(_queueTimer);
      _queueTimer = null;
    }
    return;
  }

  const batch = _queue.splice(0, 20);

  try {
    const vectors = await client.embedBatch(batch.map(b => b.content));
    for (let i = 0; i < batch.length; i++) {
      saveEmbedding(batch[i].nodeId, vectors[i]);
    }
    invalidateEmbeddingCache();
  } catch {
    // Silently fail - nodes work without embeddings
  }
}

// ── Embedding Cache ────────────────────────────────────────

import { getAllEmbeddings } from '../memory/store.js';

let _embeddingCache: Map<string, Float32Array> | null = null;
let _cacheVersion = 0;
let _loadedVersion = -1;

export function getEmbeddingCache(): Map<string, Float32Array> {
  if (_embeddingCache && _loadedVersion === _cacheVersion) {
    return _embeddingCache;
  }

  const all = getAllEmbeddings();
  _embeddingCache = new Map();
  for (const row of all) {
    _embeddingCache.set(row.node_id, row.vector);
  }
  _loadedVersion = _cacheVersion;
  return _embeddingCache;
}

export function invalidateEmbeddingCache(): void {
  _cacheVersion++;
}
