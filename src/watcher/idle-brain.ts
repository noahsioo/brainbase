import { getDb, getNode } from '../memory/store.js';
import { getSessionActivationValue, setSessionActivationValue } from '../memory/activation.js';
import { measureSystemHealth } from '../senses/interoception.js';
import { detectHungerZones } from '../memory/knowledge-hunger.js';
import { updateSelfModel } from '../meta/self-model.js';
import { defaultModePass } from '../consolidation/consolidation-runner.js';
import { calculateSystemMood } from '../senses/interoception.js';
import { getUpcomingReminders } from '../memory/prospective.js';

export interface IdleResult {
  health_updated: boolean;
  hunger_checked: boolean;
  self_model_updated: boolean;
  dmn_connections: number;
  decay_applied: number;
  pre_warmed: number;
  upcoming_reminders: number;
}

export function runIdleTick(): IdleResult {
  const result: IdleResult = {
    health_updated: false, hunger_checked: false,
    self_model_updated: false, dmn_connections: 0, decay_applied: 0,
    pre_warmed: 0, upcoming_reminders: 0,
  };

  const db = getDb();

  // 1. System Health aktualisieren
  try {
    const health = measureSystemHealth();
    db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
      .run('system_health', JSON.stringify({ ...health, _ts: Date.now() }), Date.now());
    result.health_updated = true;
  } catch { /* non-fatal */ }

  // 1b. System-Mood aktualisieren
  try { calculateSystemMood(); } catch { /* non-fatal */ }

  // 2. Hunger Zones pruefen
  try {
    detectHungerZones();
    for (const sessionId of getActiveSessionIds(5)) {
      detectHungerZones(sessionId);
    }
    result.hunger_checked = true;
  } catch { /* non-fatal */ }

  // 3. Self-Model updaten
  try {
    updateSelfModel();
    result.self_model_updated = true;
  } catch { /* non-fatal */ }

  // 4. Leichter Activation Decay — Nodes die nicht mehr relevant sind, klingen ab
  try {
    const decayed = db.prepare(
      "UPDATE session_activations SET activation = activation * 0.95 WHERE activation > 0.01 AND activation < 0.3"
    ).run();
    result.decay_applied = decayed.changes;
  } catch { /* non-fatal */ }

  // 5. Pre-Warm Context — Session-relevante Nodes vorwaermen
  try {
    result.pre_warmed = preWarmContext();
  } catch { /* non-fatal */ }

  // 6. V10-3: Prospective Memory — upcoming Reminders vorwaermen
  try {
    const upcoming = getUpcomingReminders(6);
    for (const match of upcoming) {
      for (const sessionId of getActiveSessionIds()) {
        const current = getSessionActivationValue(match.node.id, sessionId);
        if (current < 0.1) {
          setSessionActivationValue(match.node.id, sessionId, 0.1);
        }
      }
    }
    result.upcoming_reminders = upcoming.length;
  } catch { /* non-fatal */ }

  return result;
}

function parseFocusEntities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, 3);
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, number>)
        .filter(([key, value]) => key.length > 0 && typeof value === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key]) => key);
    }
  } catch { /* ignore */ }
  return [];
}

function getActiveSessionIds(limit = 3): string[] {
  const db = getDb();
  return db.prepare(
    'SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT ?',
  ).all(limit).map((row) => (row as { id: string }).id);
}

// 17.2: Proaktive Context-Vorbereitung — Session-Focus Entities vorwaermen
export function preWarmContext(): number {
  const db = getDb();
  let warmed = 0;

  try {
    const sessionIds = getActiveSessionIds();
    for (const sessionId of sessionIds) {
      const focusRow = db.prepare(
        'SELECT value FROM system_state WHERE key = ?',
      ).get(`session_focus_${sessionId}`) as { value: string } | undefined;
      if (!focusRow) continue;

      const focusEntities = parseFocusEntities(focusRow.value);
      for (const entityName of focusEntities) {
        const entities = db.prepare(
          "SELECT id FROM nodes WHERE type = 'entity' AND LOWER(content) = LOWER(?) LIMIT 1"
        ).all(entityName) as Array<{ id: string }>;

        for (const entity of entities) {
          const currentActivation = getSessionActivationValue(entity.id, sessionId);
          const newActivation = Math.min(0.15, currentActivation + 0.05);
          if (newActivation > currentActivation) {
            setSessionActivationValue(entity.id, sessionId, newActivation);
            warmed++;
          }

          const edges = db.prepare(
            "SELECT target_id, source_id FROM edges WHERE (source_id = ? OR target_id = ?) AND strength > 0.3 LIMIT 5"
          ).all(entity.id, entity.id) as Array<{ target_id: string; source_id: string }>;

          for (const edge of edges) {
            const neighborId = edge.source_id === entity.id ? edge.target_id : edge.source_id;
            const neighbor = getNode(neighborId);
            if (!neighbor) continue;
            const neighborActivation = getSessionActivationValue(neighborId, sessionId);
            const warmActivation = Math.min(0.08, neighborActivation + 0.03);
            if (warmActivation > neighborActivation) {
              setSessionActivationValue(neighborId, sessionId, warmActivation);
              warmed++;
            }
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  return warmed;
}

// 17.3: DMN-Pass — kreative Verbindungen (nur alle 30min)
let _lastDmnRun = 0;
const DMN_COOLDOWN = 30 * 60 * 1000;

export function runDmnIdlePass(): number {
  if (Date.now() - _lastDmnRun < DMN_COOLDOWN) return 0;
  try {
    const connections = defaultModePass();
    _lastDmnRun = Date.now();
    return connections;
  } catch { return 0; }
}
