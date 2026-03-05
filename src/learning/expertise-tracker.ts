import { getDb } from '../memory/store.js';

interface ExpertiseRow {
  id: string;
  domain: string;
  level: number;
  question_count: number;
  usage_count: number;
  error_count: number;
  last_assessed: number;
  trend: string;
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  react: ['react', 'jsx', 'tsx', 'usestate', 'useeffect', 'usememo', 'useref', 'component', 'props', 'hooks'],
  css: ['css', 'tailwind', 'style', 'flexbox', 'grid', 'padding', 'margin', 'responsive', 'animation'],
  typescript: ['typescript', 'ts', 'interface', 'type', 'generic', 'enum', 'readonly'],
  javascript: ['javascript', 'js', 'async', 'await', 'promise', 'callback', 'closure'],
  node: ['node', 'express', 'npm', 'package.json', 'middleware', 'server', 'api'],
  database: ['supabase', 'sql', 'postgres', 'sqlite', 'query', 'database', 'table', 'migration', 'schema'],
  git: ['git', 'commit', 'branch', 'merge', 'rebase', 'push', 'pull', 'stash'],
  python: ['python', 'pip', 'django', 'flask', 'pandas', 'numpy'],
  devops: ['docker', 'kubernetes', 'ci/cd', 'deploy', 'nginx', 'vercel', 'netlify'],
  testing: ['test', 'jest', 'vitest', 'cypress', 'playwright', 'mock', 'assert'],
};

const QUESTION_PATTERNS = [
  /^(wie|was|warum|wann|wo|wer|welche|how|what|why|when|where|which|can you|kannst du)\b/i,
  /\?$/,
  /erkl[aä]r/i,
  /explain/i,
  /what does .+ mean/i,
  /was bedeutet/i,
  /was ist/i,
  /what is/i,
];

const ERROR_PATTERNS = [
  /error/i, /fehler/i, /bug/i, /broken/i, /kaputt/i,
  /not working/i, /funktioniert nicht/i, /geht nicht/i,
  /crash/i, /fail/i,
];

function detectDomains(message: string): string[] {
  const lower = message.toLowerCase();
  const found: string[] = [];

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        found.push(domain);
        break;
      }
    }
  }

  return found;
}

function isQuestion(message: string): boolean {
  return QUESTION_PATTERNS.some(p => p.test(message));
}

function hasError(message: string): boolean {
  return ERROR_PATTERNS.some(p => p.test(message));
}

function calculateLevel(usage: number, questions: number, errors: number): number {
  if (usage === 0) return 0;
  const total = usage + questions + errors;
  return Math.min(1.0, usage / (total + 5));
}

function calculateTrend(oldLevel: number, newLevel: number): string {
  const delta = newLevel - oldLevel;
  if (delta > 0.05) return 'improving';
  if (delta < -0.05) return 'declining';
  return 'stable';
}

export function trackExpertise(message: string): void {
  const domains = detectDomains(message);
  if (domains.length === 0) return;

  const db = getDb();
  const now = Date.now();
  const question = isQuestion(message);
  const error = hasError(message);

  for (const domain of domains) {
    const existing = db.prepare('SELECT * FROM expertise WHERE domain = ?').get(domain) as ExpertiseRow | undefined;

    if (existing) {
      const newUsage = existing.usage_count + 1;
      const newQuestions = existing.question_count + (question ? 1 : 0);
      const newErrors = existing.error_count + (error ? 1 : 0);
      const newLevel = calculateLevel(newUsage, newQuestions, newErrors);
      const trend = calculateTrend(existing.level, newLevel);

      db.prepare(`
        UPDATE expertise SET
          usage_count = ?, question_count = ?, error_count = ?,
          level = ?, trend = ?, last_assessed = ?
        WHERE domain = ?
      `).run(newUsage, newQuestions, newErrors, newLevel, trend, now, domain);
    } else {
      const level = calculateLevel(1, question ? 1 : 0, error ? 1 : 0);
      db.prepare(`
        INSERT INTO expertise (id, domain, level, question_count, usage_count, error_count, last_assessed, trend)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`exp-${domain}`, domain, level, question ? 1 : 0, 1, error ? 1 : 0, now, 'stable');
    }
  }
}

export function getExpertiseMap(): ExpertiseRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM expertise ORDER BY level DESC').all() as ExpertiseRow[];
}
