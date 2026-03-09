import { getDb, getSession } from './store.js';
import type { WorkingMemory } from './store.js';

type WorkingMemoryIntent = WorkingMemory['last_message_intent'];

export interface WorkingMemoryUpdateInput {
  sessionId: string;
  message: string;
  inferredTopic?: string;
  focusEntities?: string[];
  messageIntent?: WorkingMemoryIntent;
  references?: string[];
  degradedSemantic?: boolean;
  taskMode?: string;
  mood?: string;
  sessionLength?: number;
}

interface WorkingMemoryRow {
  session_id: string;
  current_topic: string;
  topic_history: string;
  active_entities: string;
  conversation_summary: string;
  open_questions: string;
  context_stack: string;
  references?: string;
  degraded_semantic?: number;
  last_message_intent: string;
  message_count: number;
  last_user_message: string;
  last_assistant_message: string;
  updated_at: number;
  version: number;
}

interface SummaryContext {
  taskMode?: string;
  mood?: string;
}

const MAX_ACTIVE_ENTITIES = 12;
const ENTITY_BOOST = 0.25;
const ENTITY_DECAY = 0.92;
const MIN_ENTITY_SCORE = 0.08;
const MAX_OPEN_QUESTIONS = 5;
const SUMMARY_ENTITY_LIMIT = 3;
const MAX_REFERENCES = 5;
const MAX_CONTEXT_REFERENCE_ANCHORS = 1;
const MAX_REFERENCE_HINT_LENGTH = 48;
const DISPLAY_REFERENCE_MIN_LENGTH = 5;
const QUESTION_STARTERS = ['wie', 'warum', 'was', 'wer', 'wo', 'wann', 'wieso', 'how', 'why', 'what', 'can', 'could', 'kann', 'kannst'];
const REQUEST_HINTS = ['mach', 'make', 'implement', 'fix', 'schreib', 'build', 'setz', 'baue', 'erstell'];
const FEEDBACK_HINTS = ['nein', 'falsch', 'genau', 'passt', 'perfekt', 'wrong', 'stimmt', 'gut', 'schlecht'];
const GREETING_HINTS = ['hi', 'hey', 'hallo', 'moin', 'yo', 'servus', 'guten morgen', 'guten tag', 'good morning'];
const NON_DISPLAY_REFERENCE_VALUES = new Set([
  'das', 'dies', 'diese', 'dieser', 'dieses', 'es',
  'it', 'this', 'that', 'these', 'those',
]);
const NON_DISPLAY_REFERENCE_PHRASES = new Set([
  'wie eben',
  'mach weiter',
  'continue',
  'weiter',
  'same thing',
  'same as before',
]);
const VALID_INTENTS: ReadonlySet<WorkingMemoryIntent> = new Set([
  'question',
  'statement',
  'request',
  'feedback',
  'greeting',
  'other',
]);

export function initWorkingMemory(sessionId: string): WorkingMemory {
  const existing = getWorkingMemory(sessionId);
  if (existing) return existing;

  if (!getSession(sessionId)) {
    throw new Error(`Cannot initialize working memory without session: ${sessionId}`);
  }

  const memory = createEmptyWorkingMemory(sessionId);
  saveWorkingMemory(memory);
  return memory;
}

export function getWorkingMemory(sessionId: string): WorkingMemory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM working_memory WHERE session_id = ?').get(sessionId) as WorkingMemoryRow | undefined;
  return row ? mapWorkingMemoryRow(row) : null;
}

export function saveWorkingMemory(memory: WorkingMemory): void {
  if (!getSession(memory.session_id)) {
    throw new Error(`Cannot save working memory without session: ${memory.session_id}`);
  }

  const db = getDb();
  const normalized = normalizeWorkingMemory(memory);

  db.prepare(`
    INSERT INTO working_memory (
      session_id, current_topic, topic_history, active_entities, conversation_summary,
      open_questions, context_stack, "references", degraded_semantic, last_message_intent, message_count,
      last_user_message, last_assistant_message, updated_at, version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      current_topic = excluded.current_topic,
      topic_history = excluded.topic_history,
      active_entities = excluded.active_entities,
      conversation_summary = excluded.conversation_summary,
      open_questions = excluded.open_questions,
      context_stack = excluded.context_stack,
      "references" = excluded."references",
      degraded_semantic = excluded.degraded_semantic,
      last_message_intent = excluded.last_message_intent,
      message_count = excluded.message_count,
      last_user_message = excluded.last_user_message,
      last_assistant_message = excluded.last_assistant_message,
      updated_at = excluded.updated_at,
      version = excluded.version
  `).run(
    normalized.session_id,
    normalized.current_topic,
    JSON.stringify(normalized.topic_history),
    JSON.stringify(normalized.active_entities),
    normalized.conversation_summary,
    JSON.stringify(normalized.open_questions),
    JSON.stringify(normalized.context_stack),
    JSON.stringify(normalized.references),
    normalized.degraded_semantic ? 1 : 0,
    normalized.last_message_intent,
    normalized.message_count,
    normalized.last_user_message,
    normalized.last_assistant_message,
    normalized.updated_at,
    normalized.version,
  );
}

export function updateWorkingMemory(input: WorkingMemoryUpdateInput): WorkingMemory {
  const previous = getWorkingMemory(input.sessionId) ?? initWorkingMemory(input.sessionId);
  const normalizedTopic = normalizeTopic(input.inferredTopic);
  const normalizedReferences = normalizeReferences(input.references ?? []);
  const degradedSemantic = Boolean(input.degradedSemantic);
  const topicChanged = Boolean(
    normalizedTopic &&
    previous.current_topic &&
    !isSameNormalizedValue(normalizedTopic, previous.current_topic),
  );
  const nextTopicHistory = topicChanged
    ? pushUnique(previous.topic_history, previous.current_topic)
    : [...previous.topic_history];
  const currentTopic = normalizedTopic || previous.current_topic;
  const lastMessageIntent = input.messageIntent ?? inferMessageIntent(input.message);
  const activeEntities = updateActiveEntities(previous.active_entities, input.focusEntities);
  const preserveOpenQuestions = !topicChanged || normalizedReferences.length > 0;
  const openQuestions = updateOpenQuestions(
    preserveOpenQuestions ? previous.open_questions : [],
    input.message,
    lastMessageIntent,
  );

  const memory: WorkingMemory = {
    session_id: input.sessionId,
    current_topic: currentTopic,
    topic_history: nextTopicHistory,
    active_entities: activeEntities,
    conversation_summary: '',
    open_questions: openQuestions,
    context_stack: buildContextStack(currentTopic, input.taskMode, activeEntities, normalizedReferences),
    references: normalizedReferences,
    degraded_semantic: degradedSemantic,
    last_message_intent: lastMessageIntent,
    message_count: previous.message_count + 1,
    last_user_message: normalizeMessage(input.message),
    last_assistant_message: previous.last_assistant_message,
    updated_at: Date.now(),
    version: Math.max(previous.version, 1),
  };

  memory.conversation_summary = buildConversationSummary(input.sessionId, memory, {
    taskMode: input.taskMode,
    mood: input.mood,
  });

  saveWorkingMemory(memory);
  return memory;
}

export function finalizeWorkingMemory(sessionId: string): string | null {
  const memory = getWorkingMemory(sessionId);
  if (!memory) return null;

  const topics = uniqueNonEmpty([...memory.topic_history, memory.current_topic]);
  const summaryParts = [memory.conversation_summary || buildConversationSummary(sessionId, memory)];

  if (topics.length > 0) {
    summaryParts.push(`Themenverlauf: ${topics.join(' -> ')}`);
  }

  if (memory.open_questions.length > 0) {
    summaryParts.push(`Offene Fragen: ${memory.open_questions.slice(0, 3).join(' | ')}`);
  }

  const summary = summaryParts.join('\n');
  const db = getDb();
  db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);

  // V9-4: Cross-Session Bridge — State fuer naechste Session speichern
  try {
    const bridgeState = {
      last_topic: memory.current_topic,
      top_entities: Object.entries(memory.active_entities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, score]) => ({ name, score })),
      open_questions: memory.open_questions.slice(0, 3),
      context_stack: memory.context_stack.slice(0, 3),
      intent: memory.last_message_intent,
      message_count: memory.message_count,
      timestamp: Date.now(),
    };
    db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run('session_bridge', JSON.stringify(bridgeState), Date.now());
  } catch { /* non-fatal */ }

  return summary;
}

export function deleteWorkingMemory(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM working_memory WHERE session_id = ?').run(sessionId);
}

export function inferMessageIntent(message: string): WorkingMemoryIntent {
  const normalized = normalizeMessage(message).toLowerCase();
  if (!normalized) return 'other';

  if (normalized.includes('?') || startsWithAny(normalized, QUESTION_STARTERS)) {
    return 'question';
  }

  if (containsAny(normalized, REQUEST_HINTS)) {
    return 'request';
  }

  if (containsAny(normalized, FEEDBACK_HINTS)) {
    return 'feedback';
  }

  if (normalized.split(' ').length <= 4 && startsWithAny(normalized, GREETING_HINTS)) {
    return 'greeting';
  }

  return 'statement';
}

export function buildConversationSummary(
  _sessionId: string,
  memory: WorkingMemory,
  ctx?: SummaryContext,
): string {
  const parts: string[] = [];
  const topEntities = getTopEntities(memory.active_entities, SUMMARY_ENTITY_LIMIT);
  const displayReference = getPrimaryDisplayReference(memory.references, memory.current_topic);

  if (memory.current_topic) {
    parts.push(`Thema: ${memory.current_topic}`);
  }

  if (topEntities.length > 0) {
    const entityStr = topEntities.join(', ');
    if (entityStr !== memory.current_topic) {
      parts.push(`Fokus: ${entityStr}`);
    }
  }

  if (displayReference) {
    parts.push(`Verweis: ${displayReference}`);
  }

  return `${parts.join('. ')}.`;
}

export function extractOpenQuestions(message: string): string[] {
  const normalized = normalizeMessage(message);
  if (!normalized) return [];

  const questions = normalized
    .split('?')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `${part}?`);

  if (questions.length > 0) {
    return uniqueNonEmpty(questions).slice(0, MAX_OPEN_QUESTIONS);
  }

  if (startsWithAny(normalized.toLowerCase(), QUESTION_STARTERS)) {
    return [normalized];
  }

  return [];
}

function createEmptyWorkingMemory(sessionId: string): WorkingMemory {
  return {
    session_id: sessionId,
    current_topic: '',
    topic_history: [],
    active_entities: {},
    conversation_summary: '',
    open_questions: [],
    context_stack: [],
    references: [],
    degraded_semantic: false,
    last_message_intent: 'other',
    message_count: 0,
    last_user_message: '',
    last_assistant_message: '',
    updated_at: Date.now(),
    version: 1,
  };
}

function mapWorkingMemoryRow(row: WorkingMemoryRow): WorkingMemory {
  return normalizeWorkingMemory({
    session_id: row.session_id,
    current_topic: row.current_topic || '',
    topic_history: parseStringArray(row.topic_history),
    active_entities: parseEntityMap(row.active_entities),
    conversation_summary: row.conversation_summary || '',
    open_questions: parseStringArray(row.open_questions),
    context_stack: parseStringArray(row.context_stack),
    references: parseStringArray(row.references || '[]'),
    degraded_semantic: parseBooleanFlag(row.degraded_semantic),
    last_message_intent: normalizeIntent(row.last_message_intent),
    message_count: Number(row.message_count) || 0,
    last_user_message: row.last_user_message || '',
    last_assistant_message: row.last_assistant_message || '',
    updated_at: Number(row.updated_at) || Date.now(),
    version: Number(row.version) || 1,
  });
}

function normalizeWorkingMemory(memory: WorkingMemory): WorkingMemory {
  return {
    session_id: memory.session_id,
    current_topic: normalizeTopic(memory.current_topic),
    topic_history: uniqueNonEmpty(memory.topic_history.map(normalizeTopic)),
    active_entities: pruneActiveEntities(memory.active_entities),
    conversation_summary: normalizeMessage(memory.conversation_summary),
    open_questions: uniqueNonEmpty(memory.open_questions.map(normalizeMessage)).slice(0, MAX_OPEN_QUESTIONS),
    context_stack: uniqueNonEmpty(memory.context_stack.map(normalizeTopic)),
    references: normalizeReferences(memory.references || []),
    degraded_semantic: Boolean(memory.degraded_semantic),
    last_message_intent: normalizeIntent(memory.last_message_intent),
    message_count: Math.max(0, Math.floor(memory.message_count || 0)),
    last_user_message: normalizeMessage(memory.last_user_message),
    last_assistant_message: normalizeMessage(memory.last_assistant_message),
    updated_at: memory.updated_at || Date.now(),
    version: Math.max(1, Math.floor(memory.version || 1)),
  };
}

function updateActiveEntities(
  existing: Record<string, number>,
  focusEntities: string[] | undefined,
): Record<string, number> {
  const decayedEntries = Object.entries(existing).map(([entity, score]) => [entity, score * ENTITY_DECAY] as const);
  const next = new Map<string, number>();

  for (const [entity, score] of decayedEntries) {
    if (score >= MIN_ENTITY_SCORE) {
      next.set(entity, score);
    }
  }

  for (const entity of uniqueNonEmpty((focusEntities || []).map(normalizeTopic))) {
    const previous = next.get(entity) || 0;
    next.set(entity, Math.min(1, previous + ENTITY_BOOST));
  }

  return pruneActiveEntities(Object.fromEntries(next.entries()));
}

function updateOpenQuestions(
  existing: string[],
  message: string,
  intent: WorkingMemoryIntent,
): string[] {
  const next = [...existing];

  if (intent === 'question') {
    for (const question of extractOpenQuestions(message)) {
      if (!next.some(existingQuestion => isSameNormalizedValue(existingQuestion, question))) {
        next.push(question);
      }
    }
  }

  return uniqueNonEmpty(next).slice(-MAX_OPEN_QUESTIONS);
}

function buildContextStack(
  currentTopic: string,
  taskMode: string | undefined,
  activeEntities: Record<string, number>,
  references: string[] = [],
): string[] {
  const stack: string[] = [];
  const displayReferenceAnchors = getDisplayReferenceAnchors(references, currentTopic);

  if (currentTopic) {
    stack.push(currentTopic);
  }

  for (const referenceAnchor of displayReferenceAnchors) {
    if (!stack.some(entry => isSameNormalizedValue(entry, referenceAnchor))) {
      stack.push(referenceAnchor);
    }
  }

  if (taskMode) {
    stack.push(normalizeTopic(taskMode));
  }

  for (const entity of getTopEntities(activeEntities, 2)) {
    if (!stack.some(entry => isSameNormalizedValue(entry, entity))) {
      stack.push(entity);
    }
  }

  return stack;
}

function pruneActiveEntities(entities: Record<string, number>): Record<string, number> {
  const sorted = Object.entries(entities)
    .map(([entity, score]) => [normalizeTopic(entity), Number(score)] as const)
    .filter(([entity, score]) => entity && Number.isFinite(score) && score >= MIN_ENTITY_SCORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ACTIVE_ENTITIES);

  return Object.fromEntries(sorted.map(([entity, score]) => [entity, Math.min(1, Math.max(0, score))]));
}

function getTopEntities(entities: Record<string, number>, limit: number): string[] {
  return Object.entries(entities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([entity]) => entity);
}

function normalizeTopic(value: string | undefined): string {
  return normalizeMessage(value).toLowerCase();
}

function normalizeMessage(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIntent(value: unknown): WorkingMemoryIntent {
  const normalized = String(value || '').toLowerCase() as WorkingMemoryIntent;
  return VALID_INTENTS.has(normalized) ? normalized : 'other';
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueNonEmpty(parsed.map(item => normalizeMessage(String(item))));
  } catch {
    return [];
  }
}

function parseEntityMap(value: string): Record<string, number> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([key, score]) => [normalizeTopic(key), Number(score)] as const)
      .filter(([entity, score]) => entity && Number.isFinite(score));

    return pruneActiveEntities(Object.fromEntries(entries));
  } catch {
    return {};
  }
}

function normalizeReferences(values: string[]): string[] {
  return uniqueNonEmpty(values.map(normalizeMessage)).slice(0, MAX_REFERENCES);
}

function getDisplayReferenceAnchors(references: string[] | undefined, currentTopic?: string): string[] {
  return normalizeReferences(references || [])
    .filter(reference => isDisplayWorthyReference(reference, currentTopic))
    .map(formatDisplayReference)
    .slice(0, MAX_CONTEXT_REFERENCE_ANCHORS);
}

function getPrimaryDisplayReference(references: string[] | undefined, currentTopic?: string): string | undefined {
  return getDisplayReferenceAnchors(references, currentTopic)[0];
}

function isDisplayWorthyReference(reference: string, currentTopic?: string): boolean {
  const normalized = normalizeMessage(reference);
  const lowered = normalized.toLowerCase();
  if (!lowered) return false;
  if (currentTopic && isSameNormalizedValue(lowered, currentTopic)) return false;
  if (NON_DISPLAY_REFERENCE_VALUES.has(lowered) || NON_DISPLAY_REFERENCE_PHRASES.has(lowered)) {
    return false;
  }

  const tokens = lowered.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const informativeTokens = tokens.filter(token => !NON_DISPLAY_REFERENCE_VALUES.has(token));
  if (informativeTokens.length === 0) return false;

  if (tokens.length > 1) {
    return informativeTokens.some(token => token.length > 2);
  }

  return normalized.length >= DISPLAY_REFERENCE_MIN_LENGTH;
}

function formatDisplayReference(reference: string): string {
  const normalized = normalizeMessage(reference);
  if (normalized.length <= MAX_REFERENCE_HINT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_REFERENCE_HINT_LENGTH - 3).trimEnd()}...`;
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }
  return false;
}

function pushUnique(list: string[], value: string): string[] {
  const normalizedValue = normalizeTopic(value);
  if (!normalizedValue) return [...list];
  if (list.some(entry => isSameNormalizedValue(entry, normalizedValue))) {
    return [...list];
  }
  return [...list, normalizedValue];
}

function uniqueNonEmpty(values: string[]): string[] {
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizeMessage(value);
    if (!normalized) continue;
    if (unique.some(entry => isSameNormalizedValue(entry, normalized))) continue;
    unique.push(normalized);
  }

  return unique;
}

function isSameNormalizedValue(a: string, b: string): boolean {
  return normalizeTopic(a) === normalizeTopic(b);
}

function startsWithAny(value: string, candidates: string[]): boolean {
  return candidates.some(candidate => value.startsWith(candidate));
}

function containsAny(value: string, candidates: string[]): boolean {
  return candidates.some(candidate => value.includes(candidate));
}
