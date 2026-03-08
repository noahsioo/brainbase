import { getDb, getAllEntities, getEdgesForNode, getNode, getSessionActivationRows, type Node } from './store.js';
import type { FOKSignal } from '../meta/metacognition.js';

// ── Types ────────────────────────────────────────────────────

export interface HungerZone {
  entity: string;
  entity_id: string;
  hunger_score: number;
  mentions: number;
  edges: number;
  ignore_count: number;
}

function getHungerZonesKey(sessionId?: string): string {
  return sessionId ? `hunger_zones_${sessionId}` : 'hunger_zones';
}

function getFokSignalKeys(sessionId?: string): string[] {
  return sessionId ? [`fok_signal_${sessionId}`, 'fok_signal'] : ['fok_signal'];
}

function readFokSignal(sessionId?: string): FOKSignal | null {
  const db = getDb();

  for (const key of getFokSignalKeys(sessionId)) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;

      const parsed = JSON.parse(row.value) as FOKSignal;
      if (parsed && typeof parsed.topic === 'string') return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

function getSessionEntityCandidates(
  sessionId: string,
  limit = 50,
): Array<{ node: Node; activation: number }> {
  const rows = getSessionActivationRows(sessionId, limit * 4, 0.02);
  const bestByNodeId = new Map<string, { node: Node; activation: number }>();

  for (const row of rows) {
    const node = getNode(row.node_id);
    if (!node || node.type !== 'entity') continue;

    const existing = bestByNodeId.get(node.id);
    if (!existing || row.activation > existing.activation) {
      bestByNodeId.set(node.id, { node, activation: row.activation });
    }
  }

  return Array.from(bestByNodeId.values())
    .sort((a, b) => b.activation - a.activation)
    .slice(0, limit);
}

function getIgnoreCount(entityId: string): number {
  const db = getDb();
  const ignoreRow = db.prepare('SELECT value FROM system_state WHERE key = ?')
    .get(`hunger_ignore_${entityId}`) as { value: string } | undefined;
  return ignoreRow ? parseInt(ignoreRow.value, 10) : 0;
}

function boostZonesFromFok(zones: HungerZone[], sessionId?: string): HungerZone[] {
  const db = getDb();
  const fok = readFokSignal(sessionId);
  if (!fok || !fok.has_fragments || fok.fok_score <= 0.6) return zones;

  const boosted = [...zones];
  const topicWords = fok.topic.split(/\s+/).filter((word: string) => word.length > 3);

  for (const word of topicWords.slice(0, 2)) {
    if (boosted.find(zone => zone.entity.toLowerCase() === word.toLowerCase())) continue;

    const entityRow = db.prepare(
      "SELECT id, content FROM nodes WHERE type = 'entity' AND LOWER(content) = LOWER(?) LIMIT 1"
    ).get(word) as { id: string; content: string } | undefined;

    if (!entityRow) continue;

    boosted.push({
      entity: entityRow.content,
      entity_id: entityRow.id,
      hunger_score: fok.fok_score * 1.5,
      mentions: fok.weakly_activated,
      edges: 0,
      ignore_count: 0,
    });
  }

  return boosted;
}

// ── 9.1: Knowledge Gap Detection ─────────────────────────────

export function detectHungerZones(sessionId?: string): HungerZone[] {
  const db = getDb();
  const sessionCandidates = sessionId ? getSessionEntityCandidates(sessionId, 50) : [];
  const entities = sessionId ? sessionCandidates.map(candidate => candidate.node) : getAllEntities(50);
  let zones: HungerZone[] = [];

  for (const [index, entity] of entities.entries()) {
    const edges = getEdgesForNode(entity.id);
    const edgeCount = edges.length;
    const activation = sessionId ? (sessionCandidates[index]?.activation || 0) : 0;

    const counter = db.prepare('SELECT count FROM signal_counters WHERE entity = ?')
      .get(entity.content.toLowerCase()) as { count: number } | undefined;

    const mentions = sessionId
      ? Math.max(1, Math.round(((counter?.count || 1) * 0.3) + activation * 12))
      : (counter?.count || 1);

    const hunger = mentions / (edgeCount + 1);
    const minHunger = sessionId ? 0.9 : 1.5;
    if (hunger <= minHunger || edgeCount >= 3) continue;

    const ignoreCount = getIgnoreCount(entity.id);
    if (ignoreCount >= 3) continue;

    zones.push({
      entity: entity.content,
      entity_id: entity.id,
      hunger_score: hunger * (1 - ignoreCount * 0.25),
      mentions,
      edges: edgeCount,
      ignore_count: ignoreCount,
    });
  }

  zones = boostZonesFromFok(zones, sessionId);
  zones.sort((a, b) => b.hunger_score - a.hunger_score);
  const topZones = zones.slice(0, 3);

  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(getHungerZonesKey(sessionId), JSON.stringify(topZones), Date.now());

  return topZones;
}

// ── 9.2: Question Generation / Curiosity Impulse ─────────────

export function generateCuriosityImpulses(zones: HungerZone[]): string[] {
  const impulses: string[] = [];

  for (const zone of zones.slice(0, 2)) {
    if (zone.edges === 0) {
      impulses.push(`Zu "${zone.entity}" weiss das System fast nichts - mehr Kontext wuerde helfen.`);
    } else {
      impulses.push(`"${zone.entity}" wird oft erwaehnt, aber Zusammenhaenge fehlen - Details wuerden das Bild vervollstaendigen.`);
    }
  }

  return impulses;
}

// ── 9.3: Dopamin-Reward bei neuem Wissen ─────────────────────

export function applyDopaminReward(entityName: string, sessionId?: string): void {
  const db = getDb();
  const zones = getHungerZones(sessionId);
  const matchedZone = zones.find(zone => zone.entity.toLowerCase() === entityName.toLowerCase());
  if (!matchedZone) return;

  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(`hunger_ignore_${matchedZone.entity_id}`, '0', Date.now());

  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(`hunger_satiated_${matchedZone.entity_id}`, String(Date.now()), Date.now());
}

// ── 9.4: Active Information Seeking ──────────────────────────

const LEARNING_OPPORTUNITY_PATTERNS = [
  /\b(neues? projekt|new project)\b/i,
  /\b(angefangen mit|started with|learning|lerne gerade)\b/i,
  /\b(umgestiegen auf|switched to|wechsel zu)\b/i,
  /\b(neue[sr]? (job|arbeit|firma|team|kollege))\b/i,
  /\b(heisst|name is|ich bin)\b/i,
];

export function detectLearningOpportunity(text: string, entities: string[]): string[] {
  const newTopics: string[] = [];

  for (const pattern of LEARNING_OPPORTUNITY_PATTERNS) {
    if (pattern.test(text)) {
      newTopics.push(...entities.slice(0, 3));
      break;
    }
  }

  return [...new Set(newTopics)];
}

// ── 9.2 continued: Track ignored impulses ────────────────────

export function markImpulseIgnored(zones: HungerZone[]): void {
  const db = getDb();
  for (const zone of zones) {
    const newCount = zone.ignore_count + 1;
    db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run(`hunger_ignore_${zone.entity_id}`, String(newCount), Date.now());
  }
}

// ── Get current hunger zones (from cache) ────────────────────

export function getHungerZones(sessionId?: string): HungerZone[] {
  const db = getDb();
  const keys = sessionId ? [getHungerZonesKey(sessionId), getHungerZonesKey()] : [getHungerZonesKey()];

  for (const key of keys) {
    try {
      const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
      if (!row) continue;
      return JSON.parse(row.value) as HungerZone[];
    } catch {
      continue;
    }
  }

  return [];
}
