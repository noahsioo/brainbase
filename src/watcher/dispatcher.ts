import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR } from '../config.js';
import { PriorityQueue } from './queue.js';
import type { LLMClient } from '../llm/types.js';
import {
  extractFromMessageDetailed,
  extractFromTranscript,
  extractEpisode,
  type WatcherSemanticPayload,
} from './extractor.js';
import { detectTopicChange } from './topic-detector.js';
import { detectFrustration, shouldBlockMemoryWrite } from './shield.js';
import { extractTasks, hasTaskSignal, type TaskExtractionResult } from './task-watcher.js';
import { extractTacitPatterns } from '../tacit/tacit-tracker.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { getWarmMemoryForTopic, getWarmMemoryForTopicAsync } from '../memory/warm.js';
import { getDb } from '../memory/store.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { detectAndStoreExample } from '../extraction/example-detector.js';

const SEMANTIC_TOPIC_MIN_CONFIDENCE = 0.55;
const DETECTOR_TOPIC_MIN_CONFIDENCE = 0.6;
const INVALID_TOPIC_NAMES = new Set([
  'conversation', 'session', 'message', 'request', 'topic', 'thema',
  'project', 'projekt', 'task', 'aufgabe', 'general', 'allgemein',
]);

export interface WatcherResult {
  memory: { nodes_created: number } | null;
  mood: { frustrated: boolean; level: number } | null;
  task: { tasks_created: number } | null;
  topic: { changed: boolean; newTopic: string; confidence: number } | null;
  tacit: { patterns_observed: number } | null;
  semantic: WatcherSemanticPayload | null;
}

export interface DispatchUserPromptResult {
  ok: boolean;
  systemMessage?: string;
  frustrated?: boolean;
  blocked?: boolean;
  semantic?: WatcherSemanticPayload | null;
}

interface DispatcherState {
  currentTopic: string;
  messageCount: number;
  topicDepth: number;
  focusStartedAt: number;
  recentTopics: string[];
}

const dispatcherStates = new Map<string, DispatcherState>();

function createEmptyDispatcherState(): DispatcherState {
  return {
    currentTopic: '',
    messageCount: 0,
    topicDepth: 0,
    focusStartedAt: Date.now(),
    recentTopics: [],
  };
}

function getOrCreateDispatcherState(sessionId: string): DispatcherState {
  const existing = dispatcherStates.get(sessionId);
  if (existing) return existing;

  const created = createEmptyDispatcherState();
  dispatcherStates.set(sessionId, created);
  return created;
}

interface TopicResult {
  changed: boolean;
  newTopic: string;
  confidence: number;
}

interface ResolvedTopicDecision extends TopicResult {
  source: 'semantic' | 'detector';
}

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [dispatcher] ${msg}\n`;
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(join(LOGS_DIR, 'watcher.log'), logLine);
  } catch {
    // silent
  }
  if (process.env.MEMORY_DEBUG) {
    process.stderr.write(logLine);
  }
}

export function resetDispatcherState(sessionId?: string): void {
  if (sessionId) {
    dispatcherStates.delete(sessionId);
    return;
  }

  dispatcherStates.clear();
}

function normalizeTopicName(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSemanticTopicDecision(
  semantic: WatcherSemanticPayload | null,
  currentTopic: string,
): ResolvedTopicDecision | null {
  const topic = normalizeTopicName(semantic?.topic);
  if (!topic || INVALID_TOPIC_NAMES.has(topic)) return null;

  const confidence = typeof semantic?.topic_confidence === 'number'
    ? semantic.topic_confidence
    : 0;
  if (confidence < SEMANTIC_TOPIC_MIN_CONFIDENCE) return null;

  return {
    changed: topic !== normalizeTopicName(currentTopic),
    newTopic: topic,
    confidence,
    source: 'semantic',
  };
}

function getDetectorTopicDecision(topic: TopicResult | null): ResolvedTopicDecision | null {
  if (!topic) return null;

  const normalizedTopic = normalizeTopicName(topic.newTopic);
  return {
    changed: Boolean(topic.changed),
    newTopic: normalizedTopic || normalizeTopicName(topic.newTopic),
    confidence: topic.confidence,
    source: 'detector',
  };
}

function resolveTopicDecision(
  currentTopic: string,
  detectorTopic: TopicResult | null,
  semantic: WatcherSemanticPayload | null,
): ResolvedTopicDecision | null {
  const semanticDecision = getSemanticTopicDecision(semantic, currentTopic);
  if (semanticDecision) return semanticDecision;
  return getDetectorTopicDecision(detectorTopic);
}

function persistSessionTopic(sessionId: string, topic: string): void {
  try {
    const db = getDb();
    const row = db.prepare('SELECT topics FROM sessions WHERE id = ?').get(sessionId) as { topics: string } | undefined;
    const topics: string[] = row ? JSON.parse(row.topics) : [];
    if (!topics.includes(topic)) {
      topics.push(topic);
      db.prepare('UPDATE sessions SET topics = ? WHERE id = ?').run(JSON.stringify(topics), sessionId);
    }
  } catch { /* silent */ }
}

function applyResolvedTopic(
  sessionId: string,
  dispatcherState: DispatcherState,
  resolvedTopic: ResolvedTopicDecision | null,
): TopicResult | null {
  if (!resolvedTopic) return null;

  const minConfidence = resolvedTopic.source === 'semantic'
    ? SEMANTIC_TOPIC_MIN_CONFIDENCE
    : DETECTOR_TOPIC_MIN_CONFIDENCE;

  if (resolvedTopic.changed && resolvedTopic.confidence >= minConfidence && resolvedTopic.newTopic) {
    if (dispatcherState.currentTopic) {
      dispatcherState.recentTopics = [dispatcherState.currentTopic, ...dispatcherState.recentTopics].slice(0, 5);
    }
    dispatcherState.currentTopic = resolvedTopic.newTopic;
    dispatcherState.topicDepth = 0;
    dispatcherState.focusStartedAt = Date.now();
    log(`Topic changed to: ${dispatcherState.currentTopic} (source: ${resolvedTopic.source}, session: ${sessionId})`);
    persistSessionTopic(sessionId, resolvedTopic.newTopic);
  } else {
    dispatcherState.topicDepth++;
  }

  return {
    changed: resolvedTopic.changed,
    newTopic: resolvedTopic.newTopic,
    confidence: resolvedTopic.confidence,
  };
}

export async function dispatchUserPrompt(
  client: LLMClient,
  queue: PriorityQueue,
  prompt: string,
  sessionId: string,
  signalFlags?: KeywordFlags,
  recentMessages?: string,
): Promise<DispatchUserPromptResult> {
  const dispatcherState = getOrCreateDispatcherState(sessionId);
  dispatcherState.messageCount++;

  const promises: Array<Promise<unknown>> = [];
  const result: WatcherResult = {
    memory: null,
    mood: null,
    task: null,
    topic: null,
    tacit: null,
    semantic: null,
  };

  // Mood Watcher: only if frustration signal detected
  if (signalFlags?.frustration) {
    const moodPromise = queue.enqueue('medium', 'mood-watcher', () =>
      detectFrustration(client, prompt)
    ).then(frustration => {
      result.mood = frustration;
    }).catch(err => {
      log(`mood-watcher failed: ${err}`);
    });
    promises.push(moodPromise);
  }

  // Topic Detection via queue
  const topicPromise = queue.enqueue('high', 'topic-detector', () =>
    detectTopicChange(client, dispatcherState.currentTopic, prompt)
  ).then(topicResult => {
    result.topic = topicResult;
  }).catch(err => {
    log(`topic-detector failed: ${err}`);
  });
  promises.push(topicPromise);

  // Task Watcher: only if task keywords detected
  if (hasTaskSignal(prompt)) {
    const taskPromise = queue.enqueue('medium', 'task-watcher', () =>
      extractTasks(client, prompt, sessionId)
    ).then((taskResult: TaskExtractionResult) => {
      result.task = taskResult;
      if (taskResult.tasks_created > 0) {
        log(`Tasks created: ${taskResult.tasks_created}`);
      }
    }).catch(err => {
      log(`task-watcher failed: ${err}`);
    });
    promises.push(taskPromise);
  }

  // Example Detector: code-based, no LLM needed, runs instantly
  const example = detectAndStoreExample(prompt, sessionId);
  if (example) {
    log(`Example detected (${example.category}): ${example.content.slice(0, 60)}...`);
  }

  // Memory Watcher: extract from every message (LLM is the Hippocampus)
  if (recentMessages) {
    const memPromise = queue.enqueue('high', 'memory-watcher', () =>
      extractFromMessageDetailed(client, recentMessages, sessionId, signalFlags)
    ).then(extractionResult => {
      result.semantic = extractionResult.semantic;
      result.memory = { nodes_created: extractionResult.nodes.length };
      if (extractionResult.nodes.length > 0) {
        log(`Extracted ${extractionResult.nodes.length} nodes mid-session`);
        updateHotMemoryInDb();
      }
    }).catch(err => {
      log(`memory-watcher failed: ${err}`);
    });
    promises.push(memPromise);
  }

  // Wait for all queued tasks to settle
  await Promise.allSettled(promises);

  result.topic = applyResolvedTopic(
    sessionId,
    dispatcherState,
    resolveTopicDecision(dispatcherState.currentTopic, result.topic, result.semantic),
  );

  // Check frustration blocking after mood result is available
  if (result.mood?.frustrated) {
    log(`Frustration detected (level ${result.mood.level})`);
    if (shouldBlockMemoryWrite(result.mood.level)) {
      log('Memory writes blocked due to high frustration');
      return { ok: true, frustrated: true, blocked: true, semantic: result.semantic };
    }
  }

  // Build system message if topic changed with warm memory
  let systemMessage: string | undefined;
  if (result.topic?.changed && result.topic.confidence > 0.6) {
    const warmMemory = await getWarmMemoryForTopicAsync(dispatcherState.currentTopic, sessionId);
    if (warmMemory) {
      systemMessage = warmMemory;
    }
  }

  if (systemMessage) {
    return { ok: true, systemMessage, semantic: result.semantic };
  }

  return { ok: true, semantic: result.semantic };
}

export async function dispatchSessionEnd(
  client: LLMClient,
  queue: PriorityQueue,
  sessionId: string,
  transcriptPath?: string,
): Promise<{ ok: boolean; nodesExtracted: boolean }> {
  let transcriptText = '';

  try {
    // Memory extraction from transcript
    if (transcriptPath) {
      log(`Extracting from transcript: ${transcriptPath}`);

      const memPromise = queue.enqueue('high', 'memory-watcher-end', () =>
        extractFromTranscript(client, transcriptPath, sessionId)
      );

      try {
        const nodes = await memPromise;
        log(`Extracted ${nodes.length} nodes from session`);
        if (nodes.length > 0) {
          updateHotMemoryInDb();
          log('Hot memory updated');
        }
      } catch (err) {
        log(`memory-watcher-end failed: ${err}`);
      }

      try {
        if (existsSync(transcriptPath)) {
          transcriptText = readFileSync(transcriptPath, 'utf-8');
        }
      } catch {
        // silent
      }
    }

    if (transcriptText) {
      // Episode extraction: summarize the session as a diary-like entry
      const episodePromise = queue.enqueue('high', 'episode-watcher', () =>
        extractEpisode(client, transcriptText, sessionId)
      );

      try {
        const episode = await episodePromise;
        if (episode) {
          log(`Episode created: ${episode.content.slice(0, 80)}...`);
        }
      } catch (err) {
        log(`episode-watcher failed: ${err}`);
      }

      // Tacit extraction via queue
      const tacitPromise = queue.enqueue('medium', 'tacit-watcher', () =>
        extractTacitPatterns(client, transcriptText)
      );

      try {
        const tacitResult = await tacitPromise;
        log(`Tacit: ${tacitResult.patterns_observed} observed, ${tacitResult.patterns_promoted} promoted`);
      } catch (err) {
        log(`tacit-watcher failed: ${err}`);
      }

      // Meta-learning: inline, no LLM needed
      try {
        const lines = transcriptText.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'human') {
              const text = typeof entry.message === 'string'
                ? entry.message
                : entry.message?.content || '';
              if (text) updateMetaProfile(text);
            }
          } catch {
            // skip unparseable lines
          }
        }
        log('Meta-learner updated from transcript');
      } catch (err) {
        log(`Meta-learner update failed: ${err}`);
      }
    }

    // Light consolidation at session end (pruning only, no LLM)
    try {
      const { runLightConsolidation } = await import('../consolidation/consolidation-runner.js');
      const consolidationResult = await runLightConsolidation();
      log(`Session-End consolidation: ${consolidationResult.nodes_pruned} pruned, ${consolidationResult.nodes_merged} merged`);
    } catch (err) {
      log(`Session-End consolidation failed: ${err}`);
    }

    return { ok: true, nodesExtracted: true };
  } finally {
    resetDispatcherState(sessionId);
  }
}

export function getDispatcherState(sessionId: string): DispatcherState {
  const state = dispatcherStates.get(sessionId);
  return state ? { ...state } : createEmptyDispatcherState();
}
