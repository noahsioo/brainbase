import { getDb, getAllEntities, getEdgesForNode, type Node } from './store.js';

// ── Types ────────────────────────────────────────────────────

export interface HungerZone {
  entity: string;
  entity_id: string;
  hunger_score: number;
  mentions: number;
  edges: number;
  ignore_count: number;
}

// ── 9.1: Knowledge Gap Detection ─────────────────────────────

export function detectHungerZones(): HungerZone[] {
  const db = getDb();
  const entities = getAllEntities(50);
  const zones: HungerZone[] = [];

  for (const entity of entities) {
    const edges = getEdgesForNode(entity.id);
    const edgeCount = edges.length;

    // Get mention count from signal_counters
    const counter = db.prepare('SELECT count FROM signal_counters WHERE entity = ?')
      .get(entity.content.toLowerCase()) as { count: number } | undefined;
    const mentions = counter?.count || 1;

    // hunger = mentions / (edges + 1) — high = hungrig
    const hunger = mentions / (edgeCount + 1);

    // Only hungry if mentioned multiple times but few connections
    if (hunger > 1.5 && edgeCount < 3) {
      // Check ignore count
      const ignoreRow = db.prepare("SELECT value FROM system_state WHERE key = ?")
        .get(`hunger_ignore_${entity.id}`) as { value: string } | undefined;
      const ignoreCount = ignoreRow ? parseInt(ignoreRow.value, 10) : 0;

      // 9.2: Impulse die 3x ignoriert wurden: Prioritaet senken
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
  }

  // 15.1: FOK → Hunger
  try {
    const fokRow = db.prepare("SELECT value FROM system_state WHERE key = 'fok_signal'")
      .get() as { value: string } | undefined;
    if (fokRow) {
      const fok = JSON.parse(fokRow.value);
      if (fok.has_fragments && fok.fok_score > 0.6) {
        const topicWords = (fok.topic as string).split(/\s+/).filter((w: string) => w.length > 3);
        for (const word of topicWords.slice(0, 2)) {
          if (zones.find(z => z.entity.toLowerCase() === word.toLowerCase())) continue;
          const entityRow = db.prepare(
            "SELECT id, content FROM nodes WHERE type = 'entity' AND LOWER(content) = LOWER(?) LIMIT 1"
          ).get(word) as { id: string; content: string } | undefined;
          if (entityRow) {
            zones.push({
              entity: entityRow.content, entity_id: entityRow.id,
              hunger_score: fok.fok_score * 1.5,
              mentions: fok.weakly_activated, edges: 0, ignore_count: 0,
            });
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  // Sort by hunger_score descending, return top 3
  zones.sort((a, b) => b.hunger_score - a.hunger_score);
  const topZones = zones.slice(0, 3);

  // Persist to system_state
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('hunger_zones', JSON.stringify(topZones), Date.now());

  return topZones;
}

// ── 9.2: Question Generation / Curiosity Impulse ─────────────

export function generateCuriosityImpulses(zones: HungerZone[]): string[] {
  const impulses: string[] = [];

  for (const zone of zones.slice(0, 2)) {
    if (zone.edges === 0) {
      impulses.push(`Zu "${zone.entity}" weiss das System fast nichts — mehr Kontext wuerde helfen.`);
    } else {
      impulses.push(`"${zone.entity}" wird oft erwaehnt, aber Zusammenhaenge fehlen — Details wuerden das Bild vervollstaendigen.`);
    }
  }

  return impulses;
}

// ── 9.3: Dopamin-Reward bei neuem Wissen ─────────────────────

export function applyDopaminReward(entityName: string): void {
  const db = getDb();

  // Find matching hunger zone
  const zonesRow = db.prepare("SELECT value FROM system_state WHERE key = 'hunger_zones'")
    .get() as { value: string } | undefined;
  if (!zonesRow) return;

  const zones: HungerZone[] = JSON.parse(zonesRow.value);
  const matchedZone = zones.find(z =>
    z.entity.toLowerCase() === entityName.toLowerCase()
  );

  if (!matchedZone) return;

  // Satiate this zone: reset ignore count, lower hunger
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run(`hunger_ignore_${matchedZone.entity_id}`, '0', Date.now());

  // Mark as recently satiated (won't show as hungry for a while)
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
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
      // All entities in this message are potential new knowledge
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
    db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run(`hunger_ignore_${zone.entity_id}`, String(newCount), Date.now());
  }
}

// ── Get current hunger zones (from cache) ────────────────────

export function getHungerZones(): HungerZone[] {
  const db = getDb();
  const row = db.prepare("SELECT value FROM system_state WHERE key = 'hunger_zones'")
    .get() as { value: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.value) as HungerZone[];
  } catch {
    return [];
  }
}
