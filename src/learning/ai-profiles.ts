import { getDb } from '../memory/store.js';

export type ContextStyle = 'structured' | 'narrative' | 'minimal';

export interface ProviderProfile {
  provider: string;
  context_style: ContextStyle;
  budget_multiplier: number;
  max_chunks: number;
  positive_count: number;
  negative_count: number;
  total_contexts: number;
  last_used: number;
}

const DEFAULT_PROFILES: Record<string, Partial<ProviderProfile>> = {
  'claude-code': { context_style: 'structured', budget_multiplier: 1.0, max_chunks: 7 },
  'cursor':      { context_style: 'minimal',   budget_multiplier: 0.5, max_chunks: 4 },
  'windsurf':    { context_style: 'minimal',   budget_multiplier: 0.6, max_chunks: 5 },
  'aider':       { context_style: 'minimal',   budget_multiplier: 0.5, max_chunks: 4 },
  'claude-desktop': { context_style: 'structured', budget_multiplier: 1.3, max_chunks: 9 },
  'continue-dev':   { context_style: 'structured', budget_multiplier: 0.7, max_chunks: 5 },
  'codex':       { context_style: 'minimal',   budget_multiplier: 0.5, max_chunks: 4 },
  'gemini':      { context_style: 'structured', budget_multiplier: 0.8, max_chunks: 6 },
  'openclaw':    { context_style: 'structured', budget_multiplier: 0.8, max_chunks: 6 },
};

export function ensureProfileTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_profiles (
      provider TEXT PRIMARY KEY,
      context_style TEXT NOT NULL DEFAULT 'narrative',
      budget_multiplier REAL NOT NULL DEFAULT 1.0,
      max_chunks INTEGER NOT NULL DEFAULT 7,
      positive_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      total_contexts INTEGER NOT NULL DEFAULT 0,
      last_used INTEGER NOT NULL DEFAULT 0
    )
  `);
}

export function getProviderProfile(provider: string): ProviderProfile {
  ensureProfileTable();
  const db = getDb();

  const row = db.prepare('SELECT * FROM ai_profiles WHERE provider = ?')
    .get(provider) as ProviderProfile | undefined;

  if (row) return row;

  const defaults = DEFAULT_PROFILES[provider] || {};
  const profile: ProviderProfile = {
    provider,
    context_style: defaults.context_style || 'narrative',
    budget_multiplier: defaults.budget_multiplier || 1.0,
    max_chunks: defaults.max_chunks || 7,
    positive_count: 0,
    negative_count: 0,
    total_contexts: 0,
    last_used: 0,
  };

  db.prepare(`
    INSERT INTO ai_profiles (provider, context_style, budget_multiplier, max_chunks, positive_count, negative_count, total_contexts, last_used)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0)
  `).run(provider, profile.context_style, profile.budget_multiplier, profile.max_chunks);

  return profile;
}

export function peekProviderProfile(provider: string): ProviderProfile {
  const db = getDb();

  try {
    const row = db.prepare('SELECT * FROM ai_profiles WHERE provider = ?')
      .get(provider) as ProviderProfile | undefined;
    if (row) return row;
  } catch {
    // Table may not exist yet on a fresh DB. Fall back to defaults without creating anything.
  }

  const defaults = DEFAULT_PROFILES[provider] || {};
  return {
    provider,
    context_style: defaults.context_style || 'narrative',
    budget_multiplier: defaults.budget_multiplier || 1.0,
    max_chunks: defaults.max_chunks || 7,
    positive_count: 0,
    negative_count: 0,
    total_contexts: 0,
    last_used: 0,
  };
}

export function recordContextDelivery(provider: string): void {
  ensureProfileTable();
  const db = getDb();
  db.prepare(`
    UPDATE ai_profiles SET total_contexts = total_contexts + 1, last_used = ? WHERE provider = ?
  `).run(Date.now(), provider);
}

function applyEffectivenessLearning(provider: string): void {
  ensureProfileTable();
  const db = getDb();
  const profile = getProviderProfile(provider);

  const total = profile.positive_count + profile.negative_count;
  if (total < 10) return;

  const effectiveness = profile.positive_count / total;

  if (effectiveness < 0.3 && profile.budget_multiplier > 0.3) {
    db.prepare('UPDATE ai_profiles SET budget_multiplier = ? WHERE provider = ?')
      .run(Math.max(0.3, profile.budget_multiplier - 0.05), provider);
  }

  if (effectiveness > 0.7 && profile.budget_multiplier < 1.5) {
    db.prepare('UPDATE ai_profiles SET budget_multiplier = ? WHERE provider = ?')
      .run(Math.min(1.5, profile.budget_multiplier + 0.03), provider);
  }
}

export function recordProviderFeedback(provider: string, positive: boolean): void {
  ensureProfileTable();
  const db = getDb();
  const field = positive ? 'positive_count' : 'negative_count';
  db.prepare(`UPDATE ai_profiles SET ${field} = ${field} + 1 WHERE provider = ?`).run(provider);
  applyEffectivenessLearning(provider);
}
