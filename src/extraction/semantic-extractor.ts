import type {
  ExtractedEntity,
  ExtractedFact,
  ExtractedRelation,
  SemanticIntent,
} from './verification.js';

export type SemanticExtractionSource = 'watcher_llm' | 'heuristic_fallback';

export interface SemanticEntity {
  name: string;
  type: string;
  confidence: number;
}

export interface SemanticRelation {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface SemanticFact {
  content: string;
  type: string;
  confidence: number;
}

export interface SemanticExtraction {
  source: SemanticExtractionSource;
  degraded: boolean;
  nothing_new: boolean;
  entities: SemanticEntity[];
  relations: SemanticRelation[];
  topic: string;
  topic_confidence: number;
  intent: SemanticIntent;
  facts: SemanticFact[];
  references: string[];
}

export interface SemanticExtractionInput {
  message: string;
  sessionId: string;
  provider: string;
  watcherResponse?: Record<string, unknown> | null;
  fallbackTopic?: string;
  fallbackEntities?: string[];
}

interface WatcherSemanticPayload {
  nothing_new?: unknown;
  entities?: unknown;
  relations?: unknown;
  topic?: unknown;
  topic_confidence?: unknown;
  intent?: unknown;
  facts?: unknown;
  references?: unknown;
}

const INVALID_TOPIC_NAMES = new Set([
  'conversation', 'session', 'message', 'request', 'topic', 'thema',
  'project', 'projekt', 'task', 'aufgabe', 'general', 'allgemein',
]);
const GENERIC_ENTITY_NAMES = new Set([
  'das', 'dies', 'diese', 'dieser', 'es', 'it', 'this', 'that',
  'thing', 'stuff', 'idea', 'system', 'conversation', 'session',
  'message', 'request', 'problem', 'issue', 'task', 'project',
]);
const QUESTION_WORDS = [
  'wie', 'was', 'warum', 'wieso', 'weshalb', 'wann', 'wo', 'wer',
  'welche', 'welcher', 'welches', 'how', 'what', 'why', 'when',
  'where', 'who', 'which',
];
const REQUEST_PREFIXES = [
  'mach', 'baue', 'schreib', 'fix', 'ueberarbeite', 'aktualisiere',
  'continue', 'please', 'pls', 'can you', 'could you', 'implement',
  'add', 'remove', 'refactor', 'rewrite',
];
const FEEDBACK_PREFIXES = [
  'ok', 'okay', 'passt', 'gut', 'nice', 'cool', 'top', 'perfekt',
  'danke', 'thanks', 'thx', 'yes', 'ja', 'nein', 'no',
];
const GREETING_PREFIXES = [
  'hi', 'hey', 'hallo', 'hello', 'moin', 'servus',
];
const REFERENCE_PATTERNS = [
  /\b(das|dies|diese|dieser|es)\b/gi,
  /\b(this|that|it|those|these)\b/gi,
  /\b(der bug|die loesung|die lösung|der fehler|the bug|the issue|the fix)\b/gi,
];
const LANGUAGE_NAMES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'kotlin',
  'swift', 'php', 'ruby', 'c', 'c++', 'c#',
]);
const FRAMEWORK_NAMES = new Set([
  'next.js', 'react', 'vue', 'angular', 'svelte', 'nuxt', 'nestjs',
  'express', 'fastify', 'tailwind', 'remix',
]);
const LIBRARY_NAMES = new Set([
  'prisma', 'redux', 'zod', 'trpc', 'drizzle', 'nextauth',
]);
const SERVICE_NAMES = new Set([
  'supabase', 'firebase', 'vercel', 'netlify', 'stripe', 'openai',
  'anthropic', 'postgres', 'postgresql', 'mysql', 'sqlite', 'redis',
]);

const VALID_INTENTS: ReadonlySet<SemanticIntent> = new Set([
  'question',
  'statement',
  'request',
  'feedback',
  'greeting',
  'other',
]);

export function buildSemanticExtraction(input: SemanticExtractionInput): SemanticExtraction {
  const watcherSemantic = extractWatcherSemantic(input.watcherResponse);
  if (watcherSemantic) {
    return watcherSemantic;
  }

  return buildHeuristicSemanticFallback(input);
}

export function buildHeuristicSemanticFallback(input: SemanticExtractionInput): SemanticExtraction {
  const message = normalizeText(input.message);
  const intent = inferHeuristicIntent(message);
  const references = extractHeuristicReferences(message);
  const entities = buildHeuristicEntities(input.fallbackEntities, message);
  const topic = inferHeuristicTopic(input.fallbackTopic, entities);
  const topicConfidence = topic ? inferHeuristicTopicConfidence(input.fallbackTopic, entities) : 0;
  const nothingNew = inferHeuristicNothingNew(message, intent, topic, entities, references);

  return {
    source: 'heuristic_fallback',
    degraded: true,
    nothing_new: nothingNew,
    entities,
    relations: [],
    topic,
    topic_confidence: topicConfidence,
    intent,
    facts: [],
    references,
  };
}

export function extractSemanticFocusEntities(result: SemanticExtraction): string[] {
  return result.entities
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(entity => entity.name);
}

export function getPreferredSemanticTopic(result: SemanticExtraction): string | undefined {
  const topic = normalizeText(result.topic).toLowerCase();
  return topic || undefined;
}

export function getPreferredSemanticIntent(result: SemanticExtraction): SemanticIntent {
  return normalizeIntent(result.intent);
}

function extractWatcherSemantic(
  watcherResponse: Record<string, unknown> | null | undefined,
): SemanticExtraction | null {
  if (!watcherResponse || typeof watcherResponse !== 'object') {
    return null;
  }

  const raw = watcherResponse.semantic;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const payload = raw as WatcherSemanticPayload;
  return {
    source: 'watcher_llm',
    degraded: false,
    nothing_new: Boolean(payload.nothing_new),
    entities: normalizeEntities(payload.entities),
    relations: normalizeRelations(payload.relations),
    topic: normalizeText(payload.topic).toLowerCase(),
    topic_confidence: normalizeConfidence(payload.topic_confidence),
    intent: normalizeIntent(payload.intent),
    facts: normalizeFacts(payload.facts),
    references: normalizeReferences(payload.references),
  };
}

function normalizeEntities(value: unknown): SemanticEntity[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeEntity(item))
    .filter((item): item is SemanticEntity => item !== null);
}

function normalizeEntity(value: unknown): SemanticEntity | null {
  if (!value || typeof value !== 'object') return null;

  const entity = value as Partial<ExtractedEntity>;
  const name = normalizeText(entity.name);
  if (!name) return null;

  return {
    name,
    type: normalizeText(entity.type) || 'concept',
    confidence: normalizeConfidence(entity.confidence),
  };
}

function normalizeRelations(value: unknown): SemanticRelation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeRelation(item))
    .filter((item): item is SemanticRelation => item !== null);
}

function normalizeRelation(value: unknown): SemanticRelation | null {
  if (!value || typeof value !== 'object') return null;

  const relation = value as Partial<ExtractedRelation>;
  const subject = normalizeText(relation.from);
  const predicate = normalizeText(relation.type);
  const object = normalizeText(relation.to);

  if (!subject || !predicate || !object) return null;

  return {
    subject,
    predicate,
    object,
    confidence: normalizeConfidence(relation.confidence),
  };
}

function normalizeFacts(value: unknown): SemanticFact[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeFact(item))
    .filter((item): item is SemanticFact => item !== null);
}

function normalizeFact(value: unknown): SemanticFact | null {
  if (!value || typeof value !== 'object') return null;

  const fact = value as Partial<ExtractedFact>;
  const content = normalizeText(fact.content);
  if (!content) return null;

  return {
    content,
    type: normalizeText(fact.type) || 'fact',
    confidence: normalizeConfidence(fact.confidence),
  };
}

function normalizeReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(value.map(item => normalizeText(String(item))));
}

function normalizeIntent(value: unknown): SemanticIntent {
  const intent = normalizeText(String(value || '')).toLowerCase() as SemanticIntent;
  return VALID_INTENTS.has(intent) ? intent : 'other';
}

function normalizeConfidence(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0.3;
  return Math.max(0, Math.min(1, confidence));
}

function inferHeuristicIntent(message: string): SemanticIntent {
  const lower = normalizeText(message).toLowerCase();
  if (!lower) return 'other';

  if (matchesPrefix(lower, GREETING_PREFIXES)) {
    return 'greeting';
  }

  if (matchesPrefix(lower, FEEDBACK_PREFIXES) && !lower.includes('?')) {
    return 'feedback';
  }

  if (lower.includes('?') || startsWithWord(lower, QUESTION_WORDS)) {
    return 'question';
  }

  if (matchesPrefix(lower, REQUEST_PREFIXES)) {
    return 'request';
  }

  return 'statement';
}

function buildHeuristicEntities(
  fallbackEntities: string[] | undefined,
  message: string,
): SemanticEntity[] {
  const topicHints = new Set(normalizeText(message).toLowerCase().split(/\s+/).filter(Boolean));

  return uniqueNonEmpty(fallbackEntities || [])
    .filter(name => !GENERIC_ENTITY_NAMES.has(name.toLowerCase()))
    .slice(0, 5)
    .map(name => ({
      name,
      type: inferHeuristicEntityType(name),
      confidence: topicHints.has(name.toLowerCase()) ? 0.45 : 0.35,
    }));
}

function inferHeuristicTopic(
  fallbackTopic: string | undefined,
  entities: SemanticEntity[],
): string {
  const normalizedFallback = normalizeText(fallbackTopic).toLowerCase();
  if (normalizedFallback && !INVALID_TOPIC_NAMES.has(normalizedFallback)) {
    return normalizedFallback;
  }

  const entityTopic = entities
    .map(entity => entity.name.toLowerCase())
    .filter(name => !INVALID_TOPIC_NAMES.has(name))
    .slice(0, 2)
    .join(' ')
    .trim();

  return entityTopic;
}

function inferHeuristicTopicConfidence(
  fallbackTopic: string | undefined,
  entities: SemanticEntity[],
): number {
  const normalizedFallback = normalizeText(fallbackTopic).toLowerCase();
  if (normalizedFallback && !INVALID_TOPIC_NAMES.has(normalizedFallback)) {
    return 0.35;
  }

  return entities.length > 0 ? 0.25 : 0;
}

function inferHeuristicNothingNew(
  message: string,
  intent: SemanticIntent,
  topic: string,
  entities: SemanticEntity[],
  references: string[],
): boolean {
  const lower = normalizeText(message).toLowerCase();
  if (!lower) return true;

  const shortFeedback =
    (intent === 'feedback' || intent === 'greeting') &&
    lower.split(/\s+/).length <= 4 &&
    entities.length === 0 &&
    !topic;

  if (shortFeedback) return true;

  if (references.length > 0) return false;
  if (intent === 'question' || intent === 'request') return false;
  if (entities.length > 0 || topic) return false;

  return lower.length <= 12;
}

function extractHeuristicReferences(message: string): string[] {
  const references: string[] = [];

  for (const pattern of REFERENCE_PATTERNS) {
    const matches = message.match(pattern) || [];
    for (const match of matches) {
      const normalized = normalizeText(match);
      if (!normalized) continue;
      if (references.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
        continue;
      }
      references.push(normalized);
      if (references.length >= 5) return references;
    }
  }

  return references;
}

function inferHeuristicEntityType(name: string): string {
  const lower = normalizeText(name).toLowerCase();
  if (FRAMEWORK_NAMES.has(lower)) return 'framework';
  if (LANGUAGE_NAMES.has(lower)) return 'language';
  if (LIBRARY_NAMES.has(lower)) return 'library';
  if (SERVICE_NAMES.has(lower)) return 'service';
  if (/[./_-]/.test(lower) || /\b(js|ts|sql)\b/.test(lower)) return 'technology';
  return 'concept';
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (result.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
      continue;
    }
    result.push(normalized);
  }

  return result;
}

function matchesPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some(prefix =>
    value === prefix ||
    value.startsWith(`${prefix} `) ||
    value.startsWith(`${prefix},`) ||
    value.startsWith(`${prefix}.`)
  );
}

function startsWithWord(value: string, words: string[]): boolean {
  return words.some(word =>
    value === word ||
    value.startsWith(`${word} `) ||
    value.startsWith(`${word}?`)
  );
}
