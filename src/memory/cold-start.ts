import { addNode, addEdge, getDb, type Node } from './store.js';

export interface CoreNode {
  label: string;
  type: string;
  importance: number;
  content: string;
}

export interface QuickProfile {
  name?: string;
  project?: string;
  techStack?: string;
}

const PRE_WIRED_NODES: CoreNode[] = [
  { label: 'user_identity', type: 'core', importance: 1.0, content: 'User Identity' },
  { label: 'current_project', type: 'core', importance: 0.9, content: 'Current Project' },
  { label: 'tech_stack', type: 'core', importance: 0.8, content: 'Tech Stack' },
  { label: 'communication', type: 'core', importance: 0.9, content: 'Communication Style' },
  { label: 'workflow', type: 'core', importance: 0.7, content: 'Workflow' },
  { label: 'pain_points', type: 'core', importance: 0.8, content: 'Pain Points' },
  { label: 'goals', type: 'core', importance: 0.8, content: 'Goals' },
  { label: 'expertise_map', type: 'core', importance: 0.7, content: 'Expertise Map' },
  { label: 'system_knowledge', type: 'system_knowledge', importance: 0.6,
    content: 'BrainBase ist ein KI-Gedaechtnissystem. Knowledge Graph mit Nodes und Edges. Spreading Activation findet relevante Erinnerungen. Signal-Strength entscheidet was gespeichert wird. Alles lokal. Free and source-available. Commands: brainbase dashboard, stats, search, insights.' },
];

export function createPreWiredNodes(profile?: QuickProfile): Map<string, Node> {
  const nodeMap = new Map<string, Node>();

  const nodes = PRE_WIRED_NODES.map(def => {
    if (profile?.name && def.label === 'user_identity') {
      return { ...def, content: profile.name };
    }
    if (profile?.project && def.label === 'current_project') {
      return { ...def, content: profile.project };
    }
    if (profile?.techStack && def.label === 'tech_stack') {
      return { ...def, content: profile.techStack };
    }
    return def;
  });

  for (const def of nodes) {
    const node = addNode(def.content, def.type, {
      importance: def.importance,
      source: 'cold-start',
      confidence: 1.0,
    });
    nodeMap.set(def.label, node);
  }

  const identity = nodeMap.get('user_identity')!;
  const project = nodeMap.get('current_project')!;
  const stack = nodeMap.get('tech_stack')!;
  const comm = nodeMap.get('communication')!;
  const workflow = nodeMap.get('workflow')!;
  const painPoints = nodeMap.get('pain_points')!;
  const goals = nodeMap.get('goals')!;
  const expertise = nodeMap.get('expertise_map')!;
  const sysKnowledge = nodeMap.get('system_knowledge')!;

  addEdge(identity.id, project.id, 'related_to', 0.7);
  addEdge(identity.id, comm.id, 'related_to', 0.8);
  addEdge(project.id, stack.id, 'part_of', 0.9);
  addEdge(project.id, goals.id, 'related_to', 0.7);
  addEdge(stack.id, expertise.id, 'related_to', 0.6);
  addEdge(workflow.id, painPoints.id, 'related_to', 0.5);
  addEdge(goals.id, painPoints.id, 'related_to', 0.4);
  addEdge(sysKnowledge.id, identity.id, 'related_to', 0.3);

  return nodeMap;
}


export function setCriticalPeriod(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES ('critical_period', 'true', ?)
  `).run(Date.now());

  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES ('sessions_count', '0', ?)
  `).run(Date.now());
}

export function isCriticalPeriod(): boolean {
  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT value FROM system_state WHERE key = 'sessions_count'"
    ).get() as { value: string } | undefined;
    if (!row) return true;
    return parseInt(row.value, 10) < 20;
  } catch {
    return true;
  }
}

// 18.1: Entwicklungsphasen — Kind bis Weise
export type DevelopmentPhase = 'infant' | 'child' | 'teen' | 'adult' | 'wise';

export interface DevelopmentState {
  phase: DevelopmentPhase;
  session_count: number;
  gate_multiplier: number;
  quality_multiplier: number;
  pruning_multiplier: number;
  plasticity: number;
  stability: number;
}

export function getDevelopmentPhase(): DevelopmentState {
  const db = getDb();
  let sessionCount = 0;
  try {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'sessions_count'")
      .get() as { value: string } | undefined;
    if (row) sessionCount = parseInt(row.value, 10);
  } catch {}

  if (sessionCount < 10) {
    return { phase: 'infant', session_count: sessionCount, gate_multiplier: 0.5, quality_multiplier: 0.6, pruning_multiplier: 0.2, plasticity: 1.0, stability: 0.1 };
  } else if (sessionCount < 50) {
    return { phase: 'child', session_count: sessionCount, gate_multiplier: 0.7, quality_multiplier: 0.8, pruning_multiplier: 0.6, plasticity: 0.8, stability: 0.3 };
  } else if (sessionCount < 200) {
    return { phase: 'teen', session_count: sessionCount, gate_multiplier: 1.0, quality_multiplier: 1.0, pruning_multiplier: 1.0, plasticity: 0.6, stability: 0.5 };
  } else if (sessionCount < 1000) {
    return { phase: 'adult', session_count: sessionCount, gate_multiplier: 1.2, quality_multiplier: 1.2, pruning_multiplier: 1.3, plasticity: 0.4, stability: 0.8 };
  } else {
    return { phase: 'wise', session_count: sessionCount, gate_multiplier: 1.3, quality_multiplier: 1.3, pruning_multiplier: 1.5, plasticity: 0.3, stability: 0.9 };
  }
}

export function incrementSessionCount(): number {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const row = db.prepare(
      "SELECT value FROM system_state WHERE key = 'sessions_count'"
    ).get() as { value: string } | undefined;
    const current = row ? parseInt(row.value, 10) : 0;
    const next = current + 1;
    db.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES ('sessions_count', ?, ?)
    `).run(String(next), Date.now());
    return next;
  } catch {
    return 0;
  }
}

export function getSystemState(key: string): string | null {
  const db = getDb();
  try {
    const row = db.prepare(
      'SELECT value FROM system_state WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setSystemState(key: string, value: string): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, Date.now());
}
