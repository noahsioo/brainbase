import { getDb, addNode, getNodes, updateNode, type Node } from './store.js';
import { autoLinkNodes } from './activation.js';

export interface ProspectiveMatch {
  node: Node;
  trigger: string;
}

export function createProspectiveMemory(
  content: string,
  triggerWords: string[],
  opts?: { importance?: number; source?: string },
): Node {
  const trigger = triggerWords.map(w => w.toLowerCase()).join(',');

  const node = addNode(content, 'prospective', {
    importance: opts?.importance ?? 0.8,
    emotional_tag: `trigger:${trigger}`,
    source: opts?.source ?? 'prospective',
  });

  autoLinkNodes(node.id);
  return node;
}

export function checkProspectiveTriggers(message: string): ProspectiveMatch[] {
  const db = getDb();
  const prospectiveNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'prospective' AND emotional_tag LIKE 'trigger:%'"
  ).all() as Node[];

  if (prospectiveNodes.length === 0) return [];

  const lower = message.toLowerCase();
  const matches: ProspectiveMatch[] = [];

  for (const node of prospectiveNodes) {
    const triggerStr = node.emotional_tag?.replace('trigger:', '') || '';
    const triggerWords = triggerStr.split(',').filter(w => w.length > 0);

    for (const trigger of triggerWords) {
      if (lower.includes(trigger)) {
        matches.push({ node, trigger });
        break;
      }
    }
  }

  return matches;
}

export function dismissProspectiveMemory(nodeId: string): void {
  updateNode(nodeId, { type: 'fact', emotional_tag: 'dismissed_prospective' });
}

// --- Failure Prevention ---

export function trackFailure(message: string, sessionId: string): Node | null {
  const db = getDb();

  // Get recently activated nodes as context for what went wrong
  const recentNodes = db.prepare(`
    SELECT content, type FROM nodes
    WHERE last_activated > ? AND activation > 0.1
    AND type NOT IN ('core', 'system_knowledge', 'failure')
    ORDER BY activation DESC LIMIT 5
  `).all(Date.now() - 5 * 60 * 1000) as Array<{ content: string; type: string }>;

  if (recentNodes.length === 0) return null;

  const contextSummary = recentNodes
    .map(n => n.content.slice(0, 50))
    .join('; ');

  const failureContent = `Negative feedback bei: ${contextSummary}`;

  // Don't create duplicate failures
  const existing = db.prepare(
    "SELECT id FROM nodes WHERE type = 'failure' AND content LIKE ? AND created_at > ?"
  ).get(`%${contextSummary.slice(0, 30)}%`, Date.now() - 60 * 60 * 1000) as { id: string } | undefined;

  if (existing) return null;

  const node = addNode(failureContent, 'failure', {
    importance: 0.7,
    confidence: 0.6,
    source: `failure-tracker:${sessionId}`,
  });

  autoLinkNodes(node.id);
  return node;
}

export function getRelevantFailures(message: string, limit = 3): Node[] {
  const db = getDb();
  const failureNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'failure' ORDER BY created_at DESC LIMIT 20"
  ).all() as Node[];

  if (failureNodes.length === 0) return [];

  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 3);

  const scored = failureNodes.map(node => {
    const nodeWords = node.content.toLowerCase().split(/\s+/);
    let matchCount = 0;
    for (const w of words) {
      if (nodeWords.some(nw => nw.includes(w))) matchCount++;
    }
    return { node, score: matchCount };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.node);
}
