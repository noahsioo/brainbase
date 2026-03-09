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
    trigger_type?: 'time' | 'event' | 'both' | 'recurring';
  },
): Node {
  const db = getDb();

  // V10: Duplikat-Prevention — kein identischer Reminder innerhalb 1h
  const contentWords = content.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
  if (contentWords.length > 0) {
    const searchPattern = `%${contentWords.join('%')}%`;
    const existing = db.prepare(
      "SELECT id, importance FROM nodes WHERE type = 'prospective' AND LOWER(content) LIKE ? AND created_at > ?"
    ).get(searchPattern, Date.now() - 60 * 60 * 1000) as { id: string; importance: number } | undefined;
    if (existing) {
      // Bestehenden Node boosten statt Duplikat erstellen
      if (opts?.importance && opts.importance > existing.importance) {
        updateNode(existing.id, { importance: opts.importance });
      }
      return db.prepare("SELECT * FROM nodes WHERE id = ?").get(existing.id) as Node;
    }
  }

  const trigger = triggerWords.map(w => w.toLowerCase()).join(',');

  const metadata: NodeMetadata = {};
  if (opts?.trigger_date) {
    metadata.trigger_date = opts.trigger_date;
    metadata.trigger_type = opts.trigger_type || 'time';
    if (opts.trigger_type === 'recurring') {
      metadata.recurring = true;
    }
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

// V10-2: Naechstes Vorkommen fuer recurring Reminders berechnen
function calculateNextRecurrence(node: Node, meta: Record<string, unknown>): number | null {
  const triggerStr = node.emotional_tag?.replace('trigger:', '') || '';
  const content = node.content.toLowerCase();

  const WEEKDAY_MAP: Record<string, number> = {
    montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4,
    freitag: 5, samstag: 6, sonntag: 0,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6, sunday: 0,
  };

  for (const [name, day] of Object.entries(WEEKDAY_MAP)) {
    if (content.includes(name) || triggerStr.includes(name)) {
      const now = new Date();
      const current = now.getDay();
      let daysUntil = (day - current + 7) % 7;
      if (daysUntil === 0) daysUntil = 7;
      const next = new Date(now);
      next.setDate(next.getDate() + daysUntil);
      next.setHours(9, 0, 0, 0);
      return next.getTime();
    }
  }

  if (/t[aä]glich|daily/.test(content)) {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }

  if (/w[oö]chentlich|weekly/.test(content)) {
    const next = new Date();
    next.setDate(next.getDate() + 7);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }

  return null;
}

// V10-1: Upcoming Reminders — noch nicht faellig, aber bald
export function getUpcomingReminders(hoursAhead = 24): ProspectiveMatch[] {
  const db = getDb();
  const prospectiveNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'prospective'"
  ).all() as Node[];

  if (prospectiveNodes.length === 0) return [];

  const now = Date.now();
  const horizon = now + hoursAhead * 60 * 60 * 1000;
  const matches: ProspectiveMatch[] = [];

  for (const node of prospectiveNodes) {
    if (!node.metadata) continue;
    try {
      const meta = JSON.parse(node.metadata) as Record<string, unknown>;
      if (meta.dismissed) continue;
      if (!meta.trigger_date) continue;
      const triggerDate = meta.trigger_date as number;

      if (triggerDate > now && triggerDate <= horizon) {
        const hoursUntil = Math.round((triggerDate - now) / (60 * 60 * 1000));
        matches.push({
          node,
          trigger: `in ~${hoursUntil}h`,
        });
      }
    } catch { /* skip */ }
  }

  return matches;
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

            // V10-2: Recurring → neues Datum berechnen statt dismiss
            if (meta.trigger_type === 'recurring' || meta.recurring === true) {
              const nextDate = calculateNextRecurrence(node, meta);
              if (nextDate) {
                meta.trigger_date = nextDate;
                meta.last_fired = now;
                updateNode(node.id, { metadata: JSON.stringify(meta) });
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    // Event-Based: Keyword-Match (bestehendes System)
    if (!matched) {
      // Check dismissal for event triggers too
      let dismissed = false;
      if (node.metadata) {
        try {
          const meta = JSON.parse(node.metadata) as Record<string, unknown>;
          dismissed = Boolean(meta.dismissed);
        } catch { /* skip */ }
      }

      if (!dismissed) {
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

// V11-4: Aktive Life Events abfragen
export function getActiveLifeEvents(): Node[] {
  const db = getDb();
  const lifeEvents = db.prepare(
    "SELECT * FROM nodes WHERE type = 'life_event'"
  ).all() as Node[];

  return lifeEvents.filter(node => {
    if (!node.metadata) return false;
    try {
      const meta = JSON.parse(node.metadata) as Record<string, unknown>;
      return meta.event_phase === 'active';
    } catch { return false; }
  });
}

// V11-4: Upcoming Life Events (innerhalb N Tage)
export function getUpcomingLifeEvents(daysAhead = 30): Node[] {
  const db = getDb();
  const lifeEvents = db.prepare(
    "SELECT * FROM nodes WHERE type = 'life_event'"
  ).all() as Node[];

  const now = Date.now();
  const horizon = now + daysAhead * 24 * 60 * 60 * 1000;

  return lifeEvents.filter(node => {
    if (!node.metadata) return false;
    try {
      const meta = JSON.parse(node.metadata) as Record<string, unknown>;
      if (meta.event_phase !== 'upcoming') return false;
      const validFrom = meta.valid_from as number;
      return validFrom > now && validFrom <= horizon;
    } catch { return false; }
  });
}
