// V7: Knowledge Hunger v2 — smarte Wissensluecken-Erkennung
// Statt generischer "wir wissen nichts" Impulse → spezifische Fragen basierend auf Graph-Struktur
// Laeuft nur conditional (Topic-Change, neue Entity, Cooldown)

import { getDb, getAllEntities, getEdgesForNode, getNode, getSessionActivationRows, type Node, type Edge } from './store.js';

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

// ── 9.1: Knowledge Gap Detection ─────────────────────────────

export function detectHungerZones(sessionId?: string): HungerZone[] {
  const db = getDb();
  const sessionCandidates = sessionId ? getSessionEntityCandidates(sessionId, 50) : [];
  const entities = sessionId ? sessionCandidates.map(candidate => candidate.node) : getAllEntities(50);
  const zones: HungerZone[] = [];

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

  zones.sort((a, b) => b.hunger_score - a.hunger_score);
  return zones.slice(0, 3);
}

// ── 9.2 v2: Spezifische Impulse basierend auf Graph-Struktur ──

export function generateSpecificImpulse(entity: string, entityId: string): string | null {
  const edges = getEdgesForNode(entityId);
  const edgeTypes = new Set(edges.map((e: Edge) => e.type));

  const hasUses = edgeTypes.has('uses') || edgeTypes.has('works_with') || edgeTypes.has('builds');
  const hasPrefers = edgeTypes.has('prefers') || edgeTypes.has('likes') || edgeTypes.has('dislikes');
  const hasContext = edgeTypes.has('part_of') || edgeTypes.has('member_of') || edgeTypes.has('is_a');
  const hasSkill = edgeTypes.has('knows') || edgeTypes.has('has_skill') || edgeTypes.has('interested_in');

  if (edges.length === 0) {
    return `"${entity}" wurde erwaehnt — mehr Kontext wuerde dem System helfen.`;
  }
  if (!hasContext && !hasUses) {
    return `In welchem Zusammenhang steht "${entity}"?`;
  }
  if (hasUses && !hasPrefers) {
    return `"${entity}" wird genutzt — gibt es bestimmte Praeferenzen oder Besonderheiten?`;
  }
  if (!hasSkill && edges.length >= 2) {
    return `Wie tief ist die Erfahrung mit "${entity}"?`;
  }

  return null;
}

// V1-kompatible Funktion (wird nicht mehr direkt aufgerufen, aber Export beibehalten)
export function generateCuriosityImpulses(zones: HungerZone[]): string[] {
  const impulses: string[] = [];
  for (const zone of zones.slice(0, 2)) {
    const impulse = generateSpecificImpulse(zone.entity, zone.entity_id);
    if (impulse) impulses.push(impulse);
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

// ── Cooldown Management ──────────────────────────────────────

export function getHungerCooldown(sessionId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_state WHERE key = ?')
    .get(`hunger_cooldown_${sessionId}`) as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

export function setHungerCooldown(sessionId: string, count: number): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(`hunger_cooldown_${sessionId}`, String(count), Date.now());
}

export function decrementHungerCooldown(sessionId: string): void {
  const current = getHungerCooldown(sessionId);
  if (current > 0) {
    setHungerCooldown(sessionId, current - 1);
  }
}

// ── Track ignored impulses ───────────────────────────────────

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
