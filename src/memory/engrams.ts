import { getDb, getNode, updateNode, type Node } from './store.js';
import { randomUUID } from 'crypto';

interface Engram {
  id: string;
  node_ids: string;
  activation_count: number;
  created_at: number;
  last_activated: number;
}

const MIN_ENGRAM_SIZE = 3;
const MAX_ENGRAM_SIZE = 8;
const ENGRAM_THRESHOLD = 3;
const MAX_ENGRAMS = 100;

export function ensureEngramTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS engrams (
      id TEXT PRIMARY KEY,
      node_ids TEXT NOT NULL,
      activation_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_activated INTEGER NOT NULL
    )
  `);
}

export function recordActivationPattern(activeNodeIds: string[]): void {
  if (activeNodeIds.length < MIN_ENGRAM_SIZE) return;
  ensureEngramTable();

  const db = getDb();
  const topNodes = activeNodeIds.slice(0, MAX_ENGRAM_SIZE);
  const topSet = new Set(topNodes);

  const engrams = db.prepare('SELECT * FROM engrams').all() as Engram[];
  let matched = false;

  for (const engram of engrams) {
    let engramNodes: string[];
    try { engramNodes = JSON.parse(engram.node_ids); } catch { continue; }

    const overlap = engramNodes.filter(id => topSet.has(id)).length;
    const ratio = overlap / engramNodes.length;

    if (ratio >= 0.5) {
      const merged = [...new Set([...engramNodes, ...topNodes])].slice(0, MAX_ENGRAM_SIZE);
      db.prepare('UPDATE engrams SET activation_count = activation_count + 1, last_activated = ?, node_ids = ? WHERE id = ?')
        .run(Date.now(), JSON.stringify(merged), engram.id);
      matched = true;
      break;
    }
  }

  if (!matched && engrams.length < MAX_ENGRAMS) {
    db.prepare('INSERT INTO engrams (id, node_ids, activation_count, created_at, last_activated) VALUES (?, ?, 1, ?, ?)')
      .run(randomUUID(), JSON.stringify(topNodes), Date.now(), Date.now());
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM engrams WHERE activation_count < 2 AND last_activated < ?').run(sevenDaysAgo);

  const total = (db.prepare('SELECT COUNT(*) as c FROM engrams').get() as { c: number }).c;
  if (total > MAX_ENGRAMS) {
    db.prepare('DELETE FROM engrams WHERE id IN (SELECT id FROM engrams ORDER BY activation_count ASC, last_activated ASC LIMIT 5)').run();
  }
}

export function completeEngrams(activatedNodes: Map<string, Node>): number {
  ensureEngramTable();
  const db = getDb();

  const engrams = db.prepare('SELECT * FROM engrams WHERE activation_count >= ?')
    .all(ENGRAM_THRESHOLD) as Engram[];

  let completed = 0;

  for (const engram of engrams) {
    let engramNodes: string[];
    try { engramNodes = JSON.parse(engram.node_ids); } catch { continue; }

    const activeCount = engramNodes.filter(id => activatedNodes.has(id)).length;
    const ratio = activeCount / engramNodes.length;

    if (ratio >= 0.5) {
      for (const id of engramNodes) {
        if (activatedNodes.has(id)) continue;
        const node = getNode(id);
        if (!node) continue;

        const fillActivation = Math.min(1.0, (node.activation || 0) + 0.15);
        updateNode(id, { activation: fillActivation, last_activated: Date.now() });
        const refreshed = getNode(id);
        if (refreshed) {
          activatedNodes.set(id, refreshed);
          completed++;
        }
      }
    }
  }

  return completed;
}
