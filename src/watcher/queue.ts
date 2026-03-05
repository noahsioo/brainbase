import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR } from '../config.js';

export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'idle';

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  idle: 0,
};

const DEFAULT_TIMEOUTS: Record<Priority, number> = {
  critical: 10000,
  high: 8000,
  medium: 5000,
  low: 3000,
  idle: 2000,
};

const MAX_QUEUE_SIZE = 20;

interface QueueItem {
  id: string;
  priority: Priority;
  label: string;
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  added_at: number;
  timeout: number;
}

function queueLog(msg: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [queue] ${msg}\n`;
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

let itemCounter = 0;

export class PriorityQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private stats = { enqueued: 0, completed: 0, dropped: 0 };

  enqueue<T>(
    priority: Priority,
    label: string,
    fn: () => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUTS[priority];
    const id = `${label}-${++itemCounter}`;

    this.dropOverflow();

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem = {
        id,
        priority,
        label,
        execute: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        added_at: Date.now(),
        timeout: effectiveTimeout,
      };

      this.queue.push(item);
      this.queue.sort((a, b) => {
        const pDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (pDiff !== 0) return pDiff;
        return a.added_at - b.added_at;
      });

      this.stats.enqueued++;
      queueLog(`enqueue [${priority}] ${label} (id=${id}, queue=${this.queue.length})`);

      this.process();
    });
  }

  private dropOverflow(): void {
    while (this.queue.length >= MAX_QUEUE_SIZE) {
      const dropIdx = this.findLowestPriorityIndex();
      if (dropIdx === -1) break;
      const dropped = this.queue.splice(dropIdx, 1)[0];
      dropped.reject(new Error(`dropped: queue overflow (${dropped.label})`));
      this.stats.dropped++;
      queueLog(`drop [${dropped.priority}] ${dropped.label} (overflow)`);
    }
  }

  private findLowestPriorityIndex(): number {
    let lowestIdx = -1;
    let lowestPriority = Infinity;
    let oldestTime = Infinity;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const item = this.queue[i];
      const p = PRIORITY_ORDER[item.priority];
      if (p < lowestPriority || (p === lowestPriority && item.added_at < oldestTime)) {
        lowestPriority = p;
        oldestTime = item.added_at;
        lowestIdx = i;
      }
    }
    return lowestIdx;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this.dropExpired();
      if (this.queue.length === 0) break;

      const item = this.queue.shift()!;
      const waited = Date.now() - item.added_at;

      if (waited > item.timeout) {
        item.reject(new Error(`dropped: timeout after ${waited}ms (${item.label})`));
        this.stats.dropped++;
        queueLog(`drop [${item.priority}] ${item.label} (timeout ${waited}ms)`);
        continue;
      }

      queueLog(`start [${item.priority}] ${item.label} (waited ${waited}ms)`);

      try {
        const result = await item.execute();
        item.resolve(result);
        this.stats.completed++;
        queueLog(`done [${item.priority}] ${item.label}`);
      } catch (err) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
        queueLog(`error [${item.priority}] ${item.label}: ${err}`);
      }
    }

    this.processing = false;
  }

  private dropExpired(): void {
    const now = Date.now();
    const expired: number[] = [];

    for (let i = 0; i < this.queue.length; i++) {
      if (now - this.queue[i].added_at > this.queue[i].timeout) {
        expired.push(i);
      }
    }

    for (let i = expired.length - 1; i >= 0; i--) {
      const item = this.queue.splice(expired[i], 1)[0];
      item.reject(new Error(`dropped: timeout (${item.label})`));
      this.stats.dropped++;
      queueLog(`drop [${item.priority}] ${item.label} (expired in queue)`);
    }
  }

  getStats(): { enqueued: number; completed: number; dropped: number; pending: number } {
    return { ...this.stats, pending: this.queue.length };
  }

  get size(): number {
    return this.queue.length;
  }
}
