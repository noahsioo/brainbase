import { getDb, getNodes, type Node } from './store.js';
import { getActivatedNodes } from './activation.js';
import { getSystemState } from './cold-start.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { buildGhostContext } from './ghost-context.js';

export type DetailMode = 'MAXIMUM' | 'STANDARD' | 'LIGHT' | 'MINIMAL';

interface ContextBudget {
  coreIdentity: number;
  activeContext: number;
  sessionMomentum: number;
  communicationStyle: number;
  warmMemory: number;
  serendipity: number;
}

const BUDGETS: Record<DetailMode, ContextBudget> = {
  MAXIMUM: {
    coreIdentity: 400,
    activeContext: 2400,
    sessionMomentum: 400,
    communicationStyle: 400,
    warmMemory: 2000,
    serendipity: 400,
  },
  STANDARD: {
    coreIdentity: 200,
    activeContext: 1000,
    sessionMomentum: 200,
    communicationStyle: 200,
    warmMemory: 1000,
    serendipity: 200,
  },
  LIGHT: {
    coreIdentity: 200,
    activeContext: 400,
    sessionMomentum: 100,
    communicationStyle: 100,
    warmMemory: 400,
    serendipity: 100,
  },
  MINIMAL: {
    coreIdentity: 100,
    activeContext: 150,
    sessionMomentum: 50,
    communicationStyle: 50,
    warmMemory: 100,
    serendipity: 50,
  },
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

function buildCoreIdentitySlot(budget: number): string {
  // First try high importance, then fallback to lower threshold
  let coreNodes = getNodes({ type: 'core', minImportance: 0.9, limit: 10 });
  let facts = getNodes({ type: 'fact', minImportance: 0.9, limit: 5 });
  let prefs = getNodes({ type: 'preference', minImportance: 0.9, limit: 3 });

  let allCore = [...coreNodes, ...facts, ...prefs];

  const PLACEHOLDER_NAMES = ['User Identity', 'Communication Style', 'Current Project', 'Tech Stack', 'Workflow', 'Pain Points', 'Goals', 'Expertise Map'];
  // Fallback: lower threshold if nothing meaningful found at 0.9
  if (allCore.filter(n => !PLACEHOLDER_NAMES.includes(n.content)).length === 0) {
    coreNodes = getNodes({ type: 'core', minImportance: 0.5, limit: 10 });
    facts = getNodes({ type: 'fact', minImportance: 0.5, limit: 10 });
    prefs = getNodes({ type: 'preference', minImportance: 0.5, limit: 5 });
    const identityNodes = getNodes({ type: 'identity', minImportance: 0.5, limit: 5 });
    const projectNodes = getNodes({ type: 'project', minImportance: 0.5, limit: 5 });
    allCore = [...coreNodes, ...facts, ...prefs, ...identityNodes, ...projectNodes];
  }

  // Filter out empty placeholders
  const meaningful = allCore.filter(n =>
    n.content !== 'User Identity' &&
    n.content !== 'Communication Style' &&
    n.content !== 'Current Project' &&
    n.content !== 'Tech Stack' &&
    n.content !== 'Workflow' &&
    n.content !== 'Pain Points' &&
    n.content !== 'Goals' &&
    n.content !== 'Expertise Map'
  );

  if (meaningful.length === 0) return '';

  let text = '## Ueber den User\n';
  for (const node of meaningful) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

function buildActiveContextSlot(budget: number): string {
  const activated = getActivatedNodes(30);

  // Fallback: if no activated nodes, show recent high-importance nodes
  let nodes = activated;
  if (nodes.length === 0) {
    nodes = getNodes({ minImportance: 0.6, limit: 15 });
  }

  if (nodes.length === 0) return '';

  let text = '## Aktiver Kontext\n';
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'core') continue;
    // Filter out placeholder core nodes
    if (node.content === 'User Identity' || node.content === 'Communication Style') continue;
    if (seen.has(node.content)) continue;
    seen.add(node.content);
    const importance = node.importance >= 0.7 ? '!' : '';
    const line = `- ${importance}[${node.type}] ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Aktiver Kontext\n') return '';

  return truncateToTokens(text, budget);
}

function buildSessionMomentumSlot(budget: number): string {
  const db = getDb();
  const lastSession = db.prepare(
    'SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
  ).get() as { mood_end: string | null; productivity: number | null; topics: string } | undefined;

  if (!lastSession) return '';

  let text = '## Letzte Session\n';

  if (lastSession.mood_end) {
    text += `- Stimmung: ${lastSession.mood_end}\n`;
  }
  if (lastSession.productivity !== null) {
    const prodLabel = lastSession.productivity > 0.7 ? 'hoch' :
      lastSession.productivity > 0.4 ? 'mittel' : 'niedrig';
    text += `- Produktivitaet: ${prodLabel}\n`;
  }

  try {
    const topics = JSON.parse(lastSession.topics);
    if (Array.isArray(topics) && topics.length > 0) {
      text += `- Themen: ${topics.join(', ')}\n`;
    }
  } catch {
    // skip
  }

  return truncateToTokens(text, budget);
}

function buildCommunicationStyleSlot(budget: number): string {
  const commNodes = getNodes({ type: 'preference', limit: 5 });
  const styleNodes = commNodes.filter(n =>
    n.content.toLowerCase().includes('kommunikation') ||
    n.content.toLowerCase().includes('stil') ||
    n.content.toLowerCase().includes('style') ||
    n.content.toLowerCase().includes('direkt') ||
    n.content.toLowerCase().includes('ausfuehrlich')
  );

  if (styleNodes.length === 0) return '';

  let text = '## Kommunikation\n';
  for (const node of styleNodes) {
    text += `- ${node.content}\n`;
  }

  return truncateToTokens(text, budget);
}

function buildWarmMemorySlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const activated = getActivatedNodes(20);
  const relevant = activated.filter(n => {
    const content = n.content.toLowerCase();
    return content.includes(topic.toLowerCase());
  });

  if (relevant.length === 0) return '';

  let text = `## Zum Thema: ${topic}\n`;
  for (const node of relevant) {
    const line = `- [${node.type}] ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

function buildDistilledProfileSlot(budget: number): string {
  const profile = getSystemState('user_profile_distilled');
  if (!profile) return '';

  const text = `## User Profile\n${profile}\n`;
  return truncateToTokens(text, budget);
}

function buildSerendipitySlot(budget: number): string {
  const sessionCount = getSystemState('sessions_count');
  const count = sessionCount ? parseInt(sessionCount, 10) : 0;

  if (count % 20 !== 0 || count === 0) return '';

  const db = getDb();
  const randomNode = db.prepare(`
    SELECT * FROM nodes
    WHERE type NOT IN ('core')
    AND importance > 0.3
    ORDER BY RANDOM()
    LIMIT 1
  `).get() as Node | undefined;

  if (!randomNode) return '';

  return truncateToTokens(
    `## Kreative Verbindung\n- ${randomNode.content}\n`,
    budget,
  );
}

function buildTaskReminderSlot(budget: number): string {
  const tasks = getOpenTasks();
  if (tasks.length === 0) return '';

  let text = '## Offene Aufgaben\n';
  for (const task of tasks) {
    const deadline = task.emotional_tag?.startsWith('deadline:')
      ? ` (${task.emotional_tag.replace('deadline:', '')})`
      : '';
    const prio = task.importance >= 0.9 ? '!!' : task.importance >= 0.7 ? '!' : '';
    const line = `- ${prio}${task.content}${deadline}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

function buildGhostContextSlot(budget: number, currentTopic?: string): string {
  if (!currentTopic) return '';
  const ghost = buildGhostContext(currentTopic);
  if (!ghost) return '';
  const text = `## Expertise-Hinweis\n- ${ghost}\n`;
  return truncateToTokens(text, budget);
}

function buildMetaInsightSlot(budget: number): string {
  const profile = getMetaProfile();
  if (profile.dominant_type === 'unknown') return '';

  const hints: Record<string, string> = {
    pointer: 'User ist ein "Zeiger" - beobachte Verhalten statt auf Erklaerungen zu warten',
    explicit: 'User erklaert Praeferenzen direkt - achte auf explizite Anweisungen',
    corrector: 'User korrigiert oft - tracke Korrekturen als negative Signale',
  };

  const hint = hints[profile.dominant_type];
  if (!hint) return '';

  const text = `## Lernhinweis\n- ${hint}\n`;
  return truncateToTokens(text, budget);
}

export function generateContext(
  mode: DetailMode = 'STANDARD',
  currentTopic?: string,
): string {
  const budget = BUDGETS[mode];
  const sections: string[] = [];

  const distilledProfile = buildDistilledProfileSlot(budget.coreIdentity);
  if (distilledProfile) sections.push(distilledProfile);

  const coreIdentity = buildCoreIdentitySlot(budget.coreIdentity);
  if (coreIdentity) sections.push(coreIdentity);

  const activeContext = buildActiveContextSlot(budget.activeContext);
  if (activeContext) sections.push(activeContext);

  const momentum = buildSessionMomentumSlot(budget.sessionMomentum);
  if (momentum) sections.push(momentum);

  const commStyle = buildCommunicationStyleSlot(budget.communicationStyle);
  if (commStyle) sections.push(commStyle);

  const warmMemory = buildWarmMemorySlot(budget.warmMemory, currentTopic);
  if (warmMemory) sections.push(warmMemory);

  const serendipity = buildSerendipitySlot(budget.serendipity);
  if (serendipity) sections.push(serendipity);

  if (mode === 'MAXIMUM' || mode === 'STANDARD') {
    const ghostCtx = buildGhostContextSlot(budget.communicationStyle, currentTopic);
    if (ghostCtx) sections.unshift(ghostCtx);

    const taskReminder = buildTaskReminderSlot(budget.sessionMomentum);
    if (taskReminder) sections.push(taskReminder);

    const metaInsight = buildMetaInsightSlot(budget.communicationStyle);
    if (metaInsight) sections.push(metaInsight);
  }

  if (sections.length === 0) {
    return 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.';
  }

  return sections.join('\n');
}

export function getContextTokenCount(mode: DetailMode = 'STANDARD'): number {
  const context = generateContext(mode);
  return estimateTokens(context);
}
