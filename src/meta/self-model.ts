import { getDb } from '../memory/store.js';

// Global by design: the self-model represents whole-brain development,
// not the state of a single live conversation.

export interface SelfModel {
  total_nodes: number;
  total_edges: number;
  total_sessions: number;
  cortical_ratio: number;
  avg_evidence: number;
  entity_count: number;
  domain_count: number;
  learning_rate: number;
  accuracy: number;
  strongest_domains: string[];
  weakest_areas: string[];
  fok_frequency: number;
  hunger_zone_count: number;
  updated_at: number;
}

export function buildSelfModel(): SelfModel {
  const db = getDb();

  const totalNodes = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  const totalEdges = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;

  const corticalNodes = (db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE metadata LIKE '%\"memory_tier\":\"cortical\"%'"
  ).get() as { c: number }).c;
  const corticalRatio = totalNodes > 0 ? corticalNodes / totalNodes : 0;

  const entityCount = (db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE type = 'entity'"
  ).get() as { c: number }).c;

  let avgEvidence = 1;
  try {
    const row = db.prepare(
      "SELECT AVG(CAST(json_extract(metadata, '$.evidence_count') AS REAL)) as avg FROM nodes WHERE metadata LIKE '%evidence_count%'"
    ).get() as { avg: number | null };
    avgEvidence = row?.avg || 1;
  } catch { /* json_extract fallback */ }

  let learningRate = 0;
  try {
    const recent = db.prepare(`
      SELECT s.id,
        (SELECT COUNT(*) FROM nodes n WHERE n.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, ?)) as nc
      FROM sessions s WHERE s.ended_at IS NOT NULL
      ORDER BY s.ended_at DESC LIMIT 5
    `).all(Date.now()) as Array<{ id: string; nc: number }>;
    if (recent.length > 0) learningRate = recent.reduce((s, r) => s + r.nc, 0) / recent.length;
  } catch { /* non-fatal */ }

  let accuracy = 0.5;
  try {
    const fb = db.prepare(
      "SELECT SUM(positive_count) as p, SUM(negative_count) as n FROM ai_profiles"
    ).get() as { p: number; n: number };
    const total = (fb.p || 0) + (fb.n || 0);
    if (total > 0) accuracy = (fb.p || 0) / total;
  } catch { /* ai_profiles may not exist */ }

  let strongestDomains: string[] = [];
  try {
    strongestDomains = (db.prepare(`
      SELECT content FROM nodes WHERE type = 'entity' AND metadata LIKE '%evidence_count%'
      ORDER BY CAST(json_extract(metadata, '$.evidence_count') AS INTEGER) DESC LIMIT 3
    `).all() as Array<{ content: string }>).map(r => r.content);
  } catch { /* json_extract fallback */ }

  let weakestAreas: string[] = [];
  try {
    const hz = db.prepare("SELECT value FROM system_state WHERE key = 'hunger_zones'")
      .get() as { value: string } | undefined;
    if (hz) weakestAreas = (JSON.parse(hz.value) as Array<{ entity: string }>).slice(0, 3).map(z => z.entity);
  } catch { /* non-fatal */ }

  let domainCount = 0;
  try {
    domainCount = (db.prepare("SELECT COUNT(DISTINCT domain) as c FROM expertise").get() as { c: number }).c;
  } catch { /* expertise table may not exist */ }

  let hungerCount = 0;
  try {
    const hr = db.prepare("SELECT value FROM system_state WHERE key = 'hunger_zones'")
      .get() as { value: string } | undefined;
    if (hr) hungerCount = (JSON.parse(hr.value) as unknown[]).length;
  } catch { /* non-fatal */ }

  return {
    total_nodes: totalNodes,
    total_edges: totalEdges,
    total_sessions: totalSessions,
    cortical_ratio: Math.round(corticalRatio * 100) / 100,
    avg_evidence: Math.round(avgEvidence * 10) / 10,
    entity_count: entityCount,
    domain_count: domainCount,
    learning_rate: Math.round(learningRate * 10) / 10,
    accuracy: Math.round(accuracy * 100) / 100,
    strongest_domains: strongestDomains,
    weakest_areas: weakestAreas,
    fok_frequency: 0,
    hunger_zone_count: hungerCount,
    updated_at: Date.now(),
  };
}

export function updateSelfModel(): void {
  const model = buildSelfModel();
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)")
    .run('self_model', JSON.stringify(model), Date.now());
}

export function getSelfModel(): SelfModel | null {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'self_model'")
      .get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch { /* non-fatal */ }
  return null;
}

// 19.4: Meta-Calibration — Confidence an Evidenz koppeln
export function calibrateConfidence(): { adjusted: number; direction: 'up' | 'down' | 'stable' } {
  const model = getSelfModel();
  if (!model) return { adjusted: 0, direction: 'stable' };

  let direction: 'up' | 'down' | 'stable' = 'stable';
  let adjustment = 0;

  if (model.accuracy > 0.7 && model.avg_evidence < 2 && model.total_sessions > 20) {
    direction = 'down';
    adjustment = 0.05;
  } else if (model.accuracy < 0.4 && model.avg_evidence > 3) {
    direction = 'down';
    adjustment = 0.03;
  } else if (model.accuracy > 0.8 && model.avg_evidence > 3) {
    direction = 'up';
    adjustment = 0.03;
  }

  return { adjusted: adjustment, direction };
}
