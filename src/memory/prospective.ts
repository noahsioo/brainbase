import { getDb, addNode, getNodes, updateNode, type Node, type NodeMetadata } from './store.js';
import { getActivatedNodes } from './activation.js';
import { autoLinkNodes } from './activation.js';

export interface ProspectiveMatch {
  node: Node;
  trigger: string;
}

export function createProspectiveMemory(
  content: string,
  triggerWords: string[],
  opts?: {
    importance?: number;
    source?: string;
    trigger_date?: number;
    trigger_type?: 'time' | 'event' | 'both';
  },
): Node {
  const trigger = triggerWords.map(w => w.toLowerCase()).join(',');

  const metadata: NodeMetadata = {};
  if (opts?.trigger_date) {
    metadata.trigger_date = opts.trigger_date;
    metadata.trigger_type = opts.trigger_type || 'time';
  }

  const node = addNode(content, 'prospective', {
    importance: opts?.importance ?? 0.8,
    emotional_tag: `trigger:${trigger}`,
    source: opts?.source ?? 'prospective',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  autoLinkNodes(node.id);
  return node;
}

export function checkProspectiveTriggers(message: string): ProspectiveMatch[] {
  const db = getDb();
  const prospectiveNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'prospective'"
  ).all() as Node[];

  if (prospectiveNodes.length === 0) return [];

  const lower = message.toLowerCase();
  const now = Date.now();
  const matches: ProspectiveMatch[] = [];

  for (const node of prospectiveNodes) {
    let matched = false;
    let trigger = '';

    // V6-2: Time-Based — ist das Datum erreicht/ueberschritten?
    if (node.metadata) {
      try {
        const meta = JSON.parse(node.metadata) as Record<string, unknown>;
        if (meta.trigger_date && !meta.dismissed) {
          if (now >= (meta.trigger_date as number)) {
            matched = true;
            trigger = 'time';
          }
        }
      } catch { /* skip */ }
    }

    // Event-Based: Keyword-Match (bestehendes System)
    if (!matched) {
      const triggerStr = node.emotional_tag?.replace('trigger:', '') || '';
      const triggerWords = triggerStr.split(',').filter(w => w.length > 0);
      for (const tw of triggerWords) {
        if (lower.includes(tw)) {
          matched = true;
          trigger = tw;
          break;
        }
      }
    }

    if (matched) {
      matches.push({ node, trigger });
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

  // Use session-local activation as the live source of what just mattered.
  const recentNodes = getActivatedNodes(10, sessionId)
    .filter(node =>
      node.activation > 0.1 &&
      !['core', 'system_knowledge', 'failure'].includes(node.type),
    )
    .slice(0, 5)
    .map(node => ({ content: node.content, type: node.type }));

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

export function getRelevantFailures(message: string, sessionId?: string, limit = 3): Node[] {
  const db = getDb();
  const failureNodes = sessionId
    ? db.prepare(
        "SELECT * FROM nodes WHERE type = 'failure' AND source = ? ORDER BY created_at DESC LIMIT 20"
      ).all(`failure-tracker:${sessionId}`) as Node[]
    : db.prepare(
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
