import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR } from '../config.js';
import { PriorityQueue } from './queue.js';
import type { LLMClient } from '../llm/types.js';
import { extractFromMessage, extractFromTranscript, extractEpisode } from './extractor.js';
import { detectTopicChange } from './topic-detector.js';
import { detectFrustration, shouldBlockMemoryWrite } from './shield.js';
import { extractTasks, hasTaskSignal, type TaskExtractionResult } from './task-watcher.js';
import { extractTacitPatterns } from '../tacit/tacit-tracker.js';
import { updateMetaProfile } from '../tacit/meta-learner.js';
import { updateHotMemoryInDb } from '../memory/hot.js';
import { getWarmMemoryForTopic } from '../memory/warm.js';
import { getDb } from '../memory/store.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { detectAndStoreExample } from '../extraction/example-detector.js';

export interface WatcherResult {
  memory: { nodes_created: number } | null;
  mood: { frustrated: boolean; level: number } | null;
  task: { tasks_created: number } | null;
  topic: { changed: boolean; newTopic: string; confidence: number } | null;
  tacit: { patterns_observed: number } | null;
}

interface DispatcherState {
  currentTopic: string;
  messageCount: number;
  topicDepth: number;
  focusStartedAt: number;
  recentTopics: string[];
}

const state: DispatcherState = {
  currentTopic: '',
  messageCount: 0,
  topicDepth: 0,
  focusStartedAt: Date.now(),
  recentTopics: [],
};

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

export function resetDispatcherState(): void {
  state.currentTopic = '';
  state.messageCount = 0;
  state.topicDepth = 0;
  state.focusStartedAt = Date.now();
  state.recentTopics = [];
}

export async function dispatchUserPrompt(
  client: LLMClient,
  queue: PriorityQueue,
  prompt: string,
  sessionId: string,
  signalFlags?: KeywordFlags,
  recentMessages?: string,
): Promise<{ ok: boolean; systemMessage?: string; frustrated?: boolean; blocked?: boolean }> {
  state.messageCount++;

  const promises: Array<Promise<unknown>> = [];
  const result: WatcherResult = {
    memory: null,
    mood: null,
    task: null,
    topic: null,
    tacit: null,
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
    detectTopicChange(client, state.currentTopic, prompt)
  ).then(topicResult => {
    result.topic = topicResult;
    if (topicResult.changed && topicResult.confidence > 0.6) {
      if (state.currentTopic) {
        state.recentTopics = [state.currentTopic, ...state.recentTopics].slice(0, 5);
      }
      state.currentTopic = topicResult.newTopic;
      state.topicDepth = 0;
      state.focusStartedAt = Date.now();
      log(`Topic changed to: ${state.currentTopic}`);

      // Persist topic to sessions table
      try {
        const db = getDb();
        const row = db.prepare('SELECT topics FROM sessions WHERE id = ?').get(sessionId) as { topics: string } | undefined;
        const topics: string[] = row ? JSON.parse(row.topics) : [];
        if (!topics.includes(topicResult.newTopic)) {
          topics.push(topicResult.newTopic);
          db.prepare('UPDATE sessions SET topics = ? WHERE id = ?').run(JSON.stringify(topics), sessionId);
        }
      } catch { /* silent */ }
    } else {
      state.topicDepth++;
    }
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
      extractFromMessage(client, recentMessages, sessionId, signalFlags)
    ).then(nodes => {
      result.memory = { nodes_created: nodes.length };
      if (nodes.length > 0) {
        log(`Extracted ${nodes.length} nodes mid-session`);
        updateHotMemoryInDb();
      }
    }).catch(err => {
      log(`memory-watcher failed: ${err}`);
    });
    promises.push(memPromise);
  }

  // Wait for all queued tasks to settle
  await Promise.allSettled(promises);

  // Check frustration blocking after mood result is available
  if (result.mood?.frustrated) {
    log(`Frustration detected (level ${result.mood.level})`);
    if (shouldBlockMemoryWrite(result.mood.level)) {
      log('Memory writes blocked due to high frustration');
      return { ok: true, frustrated: true, blocked: true };
    }
  }

  // Build system message if topic changed with warm memory
  let systemMessage: string | undefined;
  if (result.topic?.changed && result.topic.confidence > 0.6) {
    const warmMemory = getWarmMemoryForTopic(state.currentTopic);
    if (warmMemory) {
      systemMessage = warmMemory;
    }
  }

  return systemMessage ? { ok: true, systemMessage } : { ok: true };
}

export async function dispatchSessionEnd(
  client: LLMClient,
  queue: PriorityQueue,
  sessionId: string,
  transcriptPath?: string,
): Promise<{ ok: boolean; nodesExtracted: boolean }> {
  let transcriptText = '';

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

  return { ok: true, nodesExtracted: true };
}

export function getDispatcherState(): DispatcherState {
  return { ...state };
}
