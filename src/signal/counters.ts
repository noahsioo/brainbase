import { getDb, addNode } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';

export interface EntityCounter {
  entity: string;
  count: number;
  first_seen: number;
  last_seen: number;
  sessions: string[];
  co_entities: Record<string, number>;
}

const AUTO_NODE_THRESHOLD = 10;

const STOP_WORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
  'von', 'zu', 'in', 'auf', 'an', 'fuer', 'für', 'den', 'dem', 'des',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein',
  'nicht', 'kein', 'keine', 'aber', 'auch', 'noch', 'schon', 'nur',
  'wenn', 'dann', 'weil', 'dass', 'wie', 'was', 'wo', 'wer', 'wann',
  'hab', 'hat', 'bin', 'bist', 'sind', 'war', 'will', 'kann', 'muss',
  'the', 'a', 'an', 'is', 'and', 'or', 'with', 'of', 'to', 'in',
  'on', 'for', 'at', 'by', 'it', 'he', 'she', 'we', 'you', 'they',
  'not', 'no', 'but', 'also', 'just', 'only', 'if', 'then', 'so',
  'have', 'has', 'had', 'was', 'were', 'can', 'will', 'would', 'should',
  'do', 'does', 'did', 'this', 'that', 'these', 'those', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'here', 'there', 'all', 'some',
  'be', 'been', 'being', 'am', 'are', 'get', 'got', 'let', 'make',
  'mach', 'mal', 'halt', 'lass', 'bitte', 'ja', 'nein', 'ok', 'okay',
  'please', 'yes', 'yeah', 'yep', 'nope',
  'mhm', 'ähm', 'äh', 'hmm', 'also', 'ding', 'sozusagen', 'eigentlich',
  'einfach', 'bisschen', 'vielleicht', 'genau', 'quasi', 'irgendwie',
  'like', 'actually', 'basically', 'stuff', 'thing', 'things',
  'really', 'very', 'quite', 'gonna', 'wanna', 'kinda',
]);

export function extractEntities(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s\-_.]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const entities: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      entities.push(word);
    }
  }

  // Bigrams (2-word combinations for multi-word entities)
  const rawWords = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  for (let i = 0; i < rawWords.length - 1; i++) {
    const bigram = `${rawWords[i]} ${rawWords[i + 1]}`;
    const cleanBigram = bigram.replace(/[^a-zäöüß0-9\s\-_.]/g, '').trim();
    if (cleanBigram.length > 5 && !STOP_WORDS.has(rawWords[i]) && !STOP_WORDS.has(rawWords[i + 1])) {
      if (!seen.has(cleanBigram)) {
        seen.add(cleanBigram);
        entities.push(cleanBigram);
      }
    }
  }

  return entities;
}

export function updateCounters(entities: string[], sessionId: string): EntityCounter[] {
  const db = getDb();
  const now = Date.now();
  const updated: EntityCounter[] = [];

  const getStmt = db.prepare('SELECT * FROM signal_counters WHERE entity = ?');
  const insertStmt = db.prepare(`
    INSERT INTO signal_counters (entity, count, first_seen, last_seen, sessions, co_entities)
    VALUES (?, 1, ?, ?, ?, '{}')
  `);
  const updateStmt = db.prepare(`
    UPDATE signal_counters SET count = ?, last_seen = ?, sessions = ?, co_entities = ?
    WHERE entity = ?
  `);

  for (const entity of entities) {
    const existing = getStmt.get(entity) as {
      entity: string; count: number; first_seen: number;
      last_seen: number; sessions: string; co_entities: string;
    } | undefined;

    if (existing) {
      const sessions: string[] = JSON.parse(existing.sessions);
      if (!sessions.includes(sessionId)) {
        sessions.push(sessionId);
        if (sessions.length > 50) sessions.shift();
      }

      const coEntities: Record<string, number> = JSON.parse(existing.co_entities);
      for (const other of entities) {
        if (other !== entity) {
          coEntities[other] = (coEntities[other] || 0) + 1;
        }
      }

      const newCount = existing.count + 1;
      updateStmt.run(newCount, now, JSON.stringify(sessions), JSON.stringify(coEntities), entity);

      updated.push({
        entity,
        count: newCount,
        first_seen: existing.first_seen,
        last_seen: now,
        sessions,
        co_entities: coEntities,
      });
    } else {
      const sessions = [sessionId];
      insertStmt.run(entity, now, now, JSON.stringify(sessions));

      updated.push({
        entity,
        count: 1,
        first_seen: now,
        last_seen: now,
        sessions,
        co_entities: {},
      });
    }
  }

  return updated;
}

export function checkAutoNodeCreation(counters: EntityCounter[]): number {
  // Disabled: auto_topic created garbage nodes from filler words ("jetzt", "wirklich", "machen")
  // Counter tracking still runs for signal-strength, but no nodes are created
  return 0;

  let nodesCreated = 0;

  for (const counter of counters) {
    if (counter.count === AUTO_NODE_THRESHOLD) {
      if (counter.entity.length < 4 || STOP_WORDS.has(counter.entity)) continue;
      const node = addNode(
        counter.entity,
        'auto_topic',
        {
          importance: 0.6,
          source: 'signal:auto_counter',
          confidence: 0.7,
        },
      );
      autoLinkNodes(node.id);
      nodesCreated++;
    }
  }

  return nodesCreated;
}

export function getRepetitionScore(entities: string[]): number {
  if (entities.length === 0) return 0;

  const db = getDb();
  const stmt = db.prepare('SELECT count FROM signal_counters WHERE entity = ?');

  let maxCount = 0;
  let totalRepeated = 0;

  for (const entity of entities) {
    const row = stmt.get(entity) as { count: number } | undefined;
    if (row && row.count > 1) {
      totalRepeated++;
      maxCount = Math.max(maxCount, row.count);
    }
  }

  const ratioScore = totalRepeated / entities.length;
  const countScore = Math.min(1.0, maxCount / 10);

  return Math.min(1.0, (ratioScore * 0.4 + countScore * 0.6));
}

export function getCoOccurrenceScore(entities: string[]): number {
  if (entities.length < 2) return 0;

  const db = getDb();
  const stmt = db.prepare('SELECT co_entities FROM signal_counters WHERE entity = ?');

  let maxCoOccurrence = 0;

  for (const entity of entities) {
    const row = stmt.get(entity) as { co_entities: string } | undefined;
    if (!row) continue;

    const coEntities: Record<string, number> = JSON.parse(row.co_entities);
    for (const other of entities) {
      if (other !== entity && coEntities[other]) {
        maxCoOccurrence = Math.max(maxCoOccurrence, coEntities[other]);
      }
    }
  }

  return Math.min(1.0, maxCoOccurrence / 5);
}
