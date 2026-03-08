import { getDb } from './store.js';
import { getSystemState, setSystemState } from './cold-start.js';
import type { AttentionState } from '../meta/metacognition.js';
import type { ContextSignal } from '../senses/context-sense.js';
import type { ToneSignal } from '../senses/tone-sense.js';
import type { EmpathyMode, Mood } from '../signal/echo.js';
import type { TaskMode } from '../signal/thalamus.js';

const SESSION_RUNTIME_KEY_PREFIXES = {
  mood: 'session_mood_',
  taskMode: 'session_task_mode_',
  empathyMode: 'session_empathy_mode_',
  tone: 'session_tone_',
  attentionState: 'session_attention_state_',
  contextSignal: 'session_context_signal_',
} as const;

const LEGACY_RUNTIME_KEYS = {
  mood: 'current_mood',
  taskMode: 'current_task_mode',
  empathyMode: 'current_empathy_mode',
  tone: 'current_tone',
  attentionState: 'attention_state',
  contextSignal: 'context_signal',
} as const;

const MOODS = new Set<Mood>(['neutral', 'frustrated', 'excited', 'focused']);
const EMPATHY_MODES = new Set<EmpathyMode>(['affective', 'cognitive', 'neutral']);
const TASK_MODES = new Set<TaskMode>([
  'debugging',
  'learning',
  'building',
  'exploring',
  'reviewing',
  'chatting',
  'urgent',
]);

type SessionRuntimeStateKind = keyof typeof SESSION_RUNTIME_KEY_PREFIXES;

export interface SessionRuntimeStateSnapshot {
  mood: Mood;
  taskMode: TaskMode | null;
  empathyMode: EmpathyMode;
  tone: ToneSignal | null;
  attentionState: AttentionState | null;
  contextSignal: ContextSignal | null;
}

export interface SessionRuntimeStateKeys {
  mood: string;
  taskMode: string;
  empathyMode: string;
  tone: string;
  attentionState: string;
  contextSignal: string;
}

function isMood(value: string | null): value is Mood {
  return value !== null && MOODS.has(value as Mood);
}

function isEmpathyMode(value: string | null): value is EmpathyMode {
  return value !== null && EMPATHY_MODES.has(value as EmpathyMode);
}

function isTaskMode(value: string | null): value is TaskMode {
  return value !== null && TASK_MODES.has(value as TaskMode);
}

function getSessionRuntimeStateKey(kind: SessionRuntimeStateKind, sessionId: string): string {
  return `${SESSION_RUNTIME_KEY_PREFIXES[kind]}${sessionId}`;
}

function getRuntimeStateValue(kind: SessionRuntimeStateKind, sessionId?: string): string | null {
  if (sessionId) {
    const sessionValue = getSystemState(getSessionRuntimeStateKey(kind, sessionId));
    if (sessionValue !== null) {
      return sessionValue;
    }
  }

  return getSystemState(LEGACY_RUNTIME_KEYS[kind]);
}

function parseJsonValue<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getSessionRuntimeStateKeys(sessionId: string): SessionRuntimeStateKeys {
  return {
    mood: getSessionRuntimeStateKey('mood', sessionId),
    taskMode: getSessionRuntimeStateKey('taskMode', sessionId),
    empathyMode: getSessionRuntimeStateKey('empathyMode', sessionId),
    tone: getSessionRuntimeStateKey('tone', sessionId),
    attentionState: getSessionRuntimeStateKey('attentionState', sessionId),
    contextSignal: getSessionRuntimeStateKey('contextSignal', sessionId),
  };
}

export function getSessionMood(sessionId?: string): Mood {
  const raw = getRuntimeStateValue('mood', sessionId);
  return isMood(raw) ? raw : 'neutral';
}

export function setSessionMood(sessionId: string, mood: Mood): void {
  setSystemState(getSessionRuntimeStateKey('mood', sessionId), mood);
}

export function getSessionTaskMode(sessionId?: string): TaskMode | null {
  const raw = getRuntimeStateValue('taskMode', sessionId);
  return isTaskMode(raw) ? raw : null;
}

export function setSessionTaskMode(sessionId: string, taskMode: TaskMode): void {
  setSystemState(getSessionRuntimeStateKey('taskMode', sessionId), taskMode);
}

export function getSessionEmpathyMode(sessionId?: string): EmpathyMode {
  const raw = getRuntimeStateValue('empathyMode', sessionId);
  return isEmpathyMode(raw) ? raw : 'neutral';
}

export function setSessionEmpathyMode(sessionId: string, empathyMode: EmpathyMode): void {
  setSystemState(getSessionRuntimeStateKey('empathyMode', sessionId), empathyMode);
}

export function getSessionTone(sessionId?: string): ToneSignal | null {
  return parseJsonValue<ToneSignal>(getRuntimeStateValue('tone', sessionId));
}

export function setSessionTone(sessionId: string, tone: ToneSignal): void {
  setSystemState(getSessionRuntimeStateKey('tone', sessionId), JSON.stringify(tone));
}

export function getSessionAttentionState(sessionId?: string): AttentionState | null {
  return parseJsonValue<AttentionState>(getRuntimeStateValue('attentionState', sessionId));
}

export function setSessionAttentionState(sessionId: string, attentionState: AttentionState): void {
  setSystemState(getSessionRuntimeStateKey('attentionState', sessionId), JSON.stringify(attentionState));
}

export function getSessionContextSignal(sessionId?: string): ContextSignal | null {
  return parseJsonValue<ContextSignal>(getRuntimeStateValue('contextSignal', sessionId));
}

export function setSessionContextSignal(sessionId: string, contextSignal: ContextSignal): void {
  setSystemState(getSessionRuntimeStateKey('contextSignal', sessionId), JSON.stringify(contextSignal));
}

export function clearSessionRuntimeState(sessionId: string): void {
  const db = getDb();
  const keys = getSessionRuntimeStateKeys(sessionId);
  for (const key of Object.values(keys)) {
    db.prepare('DELETE FROM system_state WHERE key = ?').run(key);
  }
}

export function getSessionRuntimeStateSnapshot(sessionId?: string): SessionRuntimeStateSnapshot {
  return {
    mood: getSessionMood(sessionId),
    taskMode: getSessionTaskMode(sessionId),
    empathyMode: getSessionEmpathyMode(sessionId),
    tone: getSessionTone(sessionId),
    attentionState: getSessionAttentionState(sessionId),
    contextSignal: getSessionContextSignal(sessionId),
  };
}
