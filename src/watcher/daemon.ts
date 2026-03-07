import { createServer, type Server } from 'http';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { PID_PATH, LOGS_DIR, MEMORY_DIR, isPaused, setPaused } from '../config.js';
import type { LLMClient } from '../llm/types.js';
import { getLLMClient } from '../llm/factory.js';
import { startSelfHealing, stopSelfHealing } from './self-heal.js';
import { runIdleTick, runDmnIdlePass } from './idle-brain.js';
import { createSession, endSession } from '../memory/store.js';
import { runConsolidation, getLastConsolidation } from '../consolidation/consolidation-runner.js';
import { PriorityQueue } from './queue.js';
import { dispatchUserPrompt, dispatchSessionEnd, resetDispatcherState } from './dispatcher.js';
import type { KeywordFlags } from '../signal/keywords.js';

const PORT = 7899;
let server: Server | null = null;
let client: LLMClient | null = null;
let queue: PriorityQueue | null = null;
let startedAt = Date.now();
let messagesProcessed = 0;
let nodesCreated = 0;
let lastExtractionAt: string | null = null;

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

  if (isPaused()) {
    return { status: 'paused' };
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

      messagesProcessed++;
      const result = await dispatchUserPrompt(
        client, queue, prompt, sessionId, signalFlags, recentMessages,
      );

      if (result.ok) {
        lastExtractionAt = new Date().toISOString();
      }

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
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({
        status: isPaused() ? 'paused' : 'ok',
        model: client?.getModel() || 'unknown',
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        messages_processed: messagesProcessed,
        nodes_created: nodesCreated,
        last_extraction: lastExtractionAt,
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/pause') {
      setPaused(true);
      log('Watcher paused by user');
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ status: 'paused' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/resume') {
      setPaused(false);
      log('Watcher resumed by user');
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(404, corsHeaders);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { event, data } = JSON.parse(body);
        const result = await handleEvent(event, data || {});

        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify(result));
      } catch (err) {
        log(`Error handling request: ${err}`);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    writeFileSync(PID_PATH, String(process.pid));
    startedAt = Date.now();
    log(`Watcher daemon started on port ${PORT} (PID: ${process.pid})`);
    console.log(`Watcher daemon started (PID: ${process.pid}, port: ${PORT}, model: ${model})`);
  });

  // M41: Active Consolidation: check every hour, run if 6h+ since last (like sleep cycles)
  const CONSOLIDATION_INTERVAL = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const lastConsolidation = getLastConsolidation();
      if (Date.now() - lastConsolidation > CONSOLIDATION_INTERVAL) {
        log('Auto-consolidation triggered (6h interval)');
        const result = await runConsolidation(client ?? undefined);
        log(`Auto-consolidation done: ${result.nodes_merged} merged, ${result.edges_pruned} pruned, ${result.dream_edges} dreamed`);
      }
    } catch (err) {
      log(`Auto-consolidation failed: ${err}`);
    }
  }, 60 * 60 * 1000);

  // 17.1: Idle Brain — leichte Wartungsaufgaben alle 5 Minuten
  setInterval(() => {
    try {
      const result = runIdleTick();
      if (result.decay_applied > 0) {
        log(`Idle tick: ${result.decay_applied} nodes decayed`);
      }
      const dmnNew = runDmnIdlePass();
      if (dmnNew > 0) {
        log(`Idle DMN: ${dmnNew} new connections`);
      }
    } catch { /* non-fatal */ }
  }, 5 * 60 * 1000);

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
