import { createServer, type Server } from 'http';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { PID_PATH, LOGS_DIR, MEMORY_DIR } from '../config.js';
import type { LLMClient } from '../llm/types.js';
import { getLLMClient } from '../llm/factory.js';
import { startSelfHealing, stopSelfHealing } from './self-heal.js';
import { createSession, endSession } from '../memory/store.js';
import { runConsolidation } from '../consolidation/consolidation-runner.js';
import { PriorityQueue } from './queue.js';
import { dispatchUserPrompt, dispatchSessionEnd, resetDispatcherState } from './dispatcher.js';
import type { KeywordFlags } from '../signal/keywords.js';

const PORT = 7899;
let server: Server | null = null;
let client: LLMClient | null = null;
let queue: PriorityQueue | null = null;

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [watcher] ${msg}\n`;

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

async function handleEvent(event: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!client || !queue) {
    return { error: 'LLM client not initialized' };
  }

  switch (event) {
    case 'session-start': {
      const sessionId = (data.session_id as string) || `session-${Date.now()}`;
      createSession('claude-code', sessionId);
      resetDispatcherState();
      log(`Session started: ${sessionId}`);
      return { ok: true, session_id: sessionId };
    }

    case 'user-prompt': {
      const prompt = (data.user_prompt as string) || '';
      const sessionId = (data.session_id as string) || `session-${Date.now()}`;
      const signalFlags = data.signal_flags as KeywordFlags | undefined;
      const recentMessages = data._recentMessages as string | undefined;

      const result = await dispatchUserPrompt(
        client, queue, prompt, sessionId, signalFlags, recentMessages,
      );

      return result;
    }

    case 'session-end': {
      const sessionId = data.session_id as string;
      if (sessionId) {
        endSession(sessionId);
      }

      const transcriptPath = data.transcript_path as string | undefined;
      const result = await dispatchSessionEnd(client, queue, sessionId, transcriptPath);

      return result;
    }

    case 'pre-compact': {
      return { ok: true };
    }

    case 'consolidate': {
      log('Consolidation triggered via daemon (with LLM for dream+distill)');
      const consolidationResult = await runConsolidation(client ?? undefined);
      log(`Consolidation done: ${consolidationResult.edges_pruned} pruned, ${consolidationResult.nodes_merged} merged, ${consolidationResult.patterns_created} patterns, ${consolidationResult.dream_edges} dreamed, ${consolidationResult.clusters_distilled} distilled`);
      return { ok: true, ...consolidationResult };
    }

    default:
      return { error: `Unknown event: ${event}` };
  }
}

export async function startDaemon(): Promise<void> {
  mkdirSync(MEMORY_DIR, { recursive: true });

  if (existsSync(PID_PATH)) {
    try {
      const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
      process.kill(pid, 0);
      log(`Watcher already running (PID: ${pid})`);
      console.log(`Watcher already running (PID: ${pid})`);
      return;
    } catch {
      unlinkSync(PID_PATH);
    }
  }

  try {
    client = await getLLMClient();
  } catch (err) {
    console.error(`Failed to create LLM client: ${err}`);
    process.exit(1);
  }
  queue = new PriorityQueue();
  const available = await client.isAvailable();

  if (!available) {
    console.error('LLM provider is not reachable! Check your config.');
    process.exit(1);
  }

  const model = client.getModel();
  log(`Using model: ${model}`);

  startSelfHealing();
  log('Self-healing started');
  log('Priority queue initialized');

  server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { event, data } = JSON.parse(body);
        const result = await handleEvent(event, data || {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        log(`Error handling request: ${err}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    writeFileSync(PID_PATH, String(process.pid));
    log(`Watcher daemon started on port ${PORT} (PID: ${process.pid})`);
    console.log(`Watcher daemon started (PID: ${process.pid}, port: ${PORT}, model: ${model})`);
  });

  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
}

function shutdown(): void {
  log('Shutting down...');
  if (queue) {
    const stats = queue.getStats();
    log(`Queue stats: ${stats.enqueued} enqueued, ${stats.completed} completed, ${stats.dropped} dropped`);
  }
  stopSelfHealing();

  if (server) {
    server.close();
  }

  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
  }

  log('Watcher daemon stopped');
  process.exit(0);
}

export async function stopDaemon(): Promise<boolean> {
  if (!existsSync(PID_PATH)) {
    return false;
  }

  try {
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    unlinkSync(PID_PATH);
    return true;
  } catch {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
    return false;
  }
}

export async function sendToWatcher(event: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isWatcherRunning(): boolean {
  if (!existsSync(PID_PATH)) return false;
  try {
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
