import { getDb, getNodes, getEmbedding, type Node, type NodeMetadata } from './store.js';
import { getStyleDNA } from '../learning/style-analyzer.js';
import { getActivatedNodes } from './activation.js';
import { getSystemState } from './cold-start.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getOpenTasks } from '../watcher/task-watcher.js';
import { buildGhostContext } from './ghost-context.js';
import { getChunksForContext } from './chunking.js';
import { getRelevantFailures } from './prospective.js';
import { cosineSimilarity, getEmbeddingCache } from '../llm/embeddings.js';

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

const DISPLAY_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'und', 'oder', 'mit',
  'von', 'zu', 'in', 'auf', 'an', 'fuer', 'für', 'the', 'a', 'is',
  'and', 'or', 'with', 'of', 'to', 'in', 'on', 'for', 'at', 'by',
  'also', 'halt', 'mal', 'ding', 'einfach', 'eigentlich', 'bisschen',
  'vielleicht', 'sozusagen', 'like', 'just', 'actually', 'basically',
  'stuff', 'thing', 'really', 'very', 'quite',
]);

function isDisplayWorthy(node: Node): boolean {
  if (node.content.length < 15) return false;
  if (node.type === 'auto_topic') return false;
  if (node.content.includes('(+')) return false;
  const words = node.content.toLowerCase().split(/\s+/);
  const realWords = words.filter(w => !DISPLAY_STOPWORDS.has(w));
  if (realWords.length < 2) return false;
  if (node.content.toLowerCase().startsWith('recurring topic:')) {
    const topic = node.content.replace(/^recurring topic:\s*/i, '').trim();
    if (topic.length < 4 || DISPLAY_STOPWORDS.has(topic.toLowerCase())) return false;
  }
  return true;
}

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

  const meaningful = allCore.filter(n =>
    n.content !== 'User Identity' &&
    n.content !== 'Communication Style' &&
    n.content !== 'Current Project' &&
    n.content !== 'Tech Stack' &&
    n.content !== 'Workflow' &&
    n.content !== 'Pain Points' &&
    n.content !== 'Goals' &&
    n.content !== 'Expertise Map' &&
    isDisplayWorthy(n)
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

// Types that always pass through regardless of topic (core identity stuff)
const UNIVERSAL_TYPES = new Set(['core', 'identity', 'preference', 'style_dna']);

// Session topic embedding, set before context generation
let _sessionTopicVec: Float32Array | null = null;

export function setSessionTopicEmbedding(vector: Float32Array | null): void {
  _sessionTopicVec = vector;
}

function isTopicRelevant(node: Node, topic: string | undefined): boolean {
  if (!topic) return true;
  if (UNIVERSAL_TYPES.has(node.type)) return true;

  // Try semantic relevance first
  const nodeVec = getEmbedding(node.id);
  if (nodeVec && _sessionTopicVec) {
    const sim = cosineSimilarity(nodeVec, _sessionTopicVec);
    if (sim > 0.4) return true;
    if (sim < 0.15) return false;
    // In between: fall through to keyword check
  }

  // Fallback: keyword matching
  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
  const contentLower = node.content.toLowerCase();

  if (contentLower.includes(topicLower)) return true;
  if (topicWords.some(w => contentLower.includes(w))) return true;

  return false;
}

function buildActiveContextSlot(budget: number, sessionTopic?: string): string {
  const activated = getActivatedNodes(30);

  // Fallback: if no activated nodes, show recent high-importance nodes
  let nodes = activated;
  if (nodes.length === 0) {
    nodes = getNodes({ minImportance: 0.6, limit: 15 });
  }

  if (nodes.length === 0) return '';

  // Session isolation: prioritize topic-relevant nodes, then universal, then others
  if (sessionTopic) {
    const relevant = nodes.filter(n => isTopicRelevant(n, sessionTopic));
    const irrelevant = nodes.filter(n => !isTopicRelevant(n, sessionTopic));
    // Show relevant first, then fill remaining budget with other nodes
    nodes = [...relevant, ...irrelevant];
  }

  let text = '## Aktiver Kontext\n';
  const seen = new Set<string>();

  // Show chunks first (coherent groups)
  const chunks = getChunksForContext(5);
  const chunkedNodeIds = new Set<string>();

  for (const chunk of chunks) {
    // Only show chunks that have at least one activated node
    const hasActivated = chunk.nodes.some(n => activated.some(a => a.id === n.id));
    if (!hasActivated && activated.length > 0) continue;

    const chunkHeader = `- **${chunk.name}**: `;
    const chunkContent = chunk.nodes
      .filter(n => isDisplayWorthy(n))
      .map(n => n.content.slice(0, 60))
      .join(' | ');

    if (!chunkContent) continue;

    const line = chunkHeader + chunkContent + '\n';
    if (estimateTokens(text + line) > budget) break;
    text += line;

    for (const n of chunk.nodes) {
      chunkedNodeIds.add(n.id);
      seen.add(n.content);
    }
  }

  // Then show individual (non-chunked) nodes
  for (const node of nodes) {
    if (chunkedNodeIds.has(node.id)) continue;
    if (node.type === 'core') continue;
    if (node.content === 'User Identity' || node.content === 'Communication Style') continue;
    if (!isDisplayWorthy(node)) continue;
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

function buildFailureWarningSlot(budget: number, topic: string): string {
  const failures = getRelevantFailures(topic);
  if (failures.length === 0) return '';

  let text = '## Vorsicht\n';
  for (const node of failures) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  return truncateToTokens(text, budget);
}

function buildMetaInsightSlot(budget: number): string {
  const profile = getMetaProfile();

  const lines: string[] = [];

  // Communication type hint
  if (profile.dominant_type !== 'unknown') {
    const hints: Record<string, string> = {
      pointer: 'User ist ein "Zeiger" - beobachte Verhalten statt auf Erklaerungen zu warten',
      explicit: 'User erklaert Praeferenzen direkt - achte auf explizite Anweisungen',
      corrector: 'User korrigiert oft - tracke Korrekturen als negative Signale',
    };
    const hint = hints[profile.dominant_type];
    if (hint) lines.push(hint);
  }

  // Learning profile hints (only if enough data collected)
  const lp = profile.learning_profile;
  if (lp && profile.total_messages_analyzed >= 20) {
    const dominant = [
      { key: 'examples', val: lp.learns_by_examples, hint: 'User lernt am besten durch Beispiele. Gib konkrete Beispiele.' },
      { key: 'doing', val: lp.learns_by_doing, hint: 'User lernt durch Machen. Weniger erklaeren, mehr umsetzen.' },
      { key: 'explanation', val: lp.learns_by_explanation, hint: 'User will Hintergruende verstehen. Erklaere das Warum.' },
      { key: 'vision', val: lp.learns_by_vision, hint: 'User denkt in grossen Visionen. Big Picture zuerst, dann Details.' },
    ].sort((a, b) => b.val - a.val);

    if (dominant[0].val > 0.6) {
      lines.push(dominant[0].hint);
    }

    if (lp.prefers_direct > 0.65) {
      lines.push('User bevorzugt direkte, knappe Antworten.');
    } else if (lp.prefers_detailed > 0.65) {
      lines.push('User mag ausfuehrliche Erklaerungen.');
    }
  }

  if (lines.length === 0) return '';

  let text = '## Lernhinweis\n';
  for (const line of lines) {
    text += `- ${line}\n`;
  }
  return truncateToTokens(text, budget);
}

function buildEpisodeSlot(budget: number, topic?: string): string {
  const db = getDb();
  const episodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'episode' ORDER BY created_at DESC LIMIT 10"
  ).all() as Node[];

  if (episodes.length === 0) return '';

  // If topic given, find relevant episodes
  let relevant = episodes;
  if (topic) {
    const topicLower = topic.toLowerCase();
    const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);
    const matched = episodes.filter(ep => {
      const content = ep.content.toLowerCase();
      return topicWords.some(w => content.includes(w));
    });
    if (matched.length > 0) relevant = matched;
  }

  // Show max 2 most relevant episodes
  const toShow = relevant.slice(0, 2);
  let text = '## Fruehere Sessions\n';
  for (const ep of toShow) {
    const date = new Date(ep.created_at).toLocaleDateString('de-DE');
    const preview = ep.content.slice(0, 300);
    const line = `### ${date}\n${preview}\n\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Fruehere Sessions\n') return '';
  return truncateToTokens(text, budget);
}

function buildStyleSlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const db = getDb();
  const styleDnaNodes = db.prepare(
    "SELECT * FROM nodes WHERE type = 'style_dna' ORDER BY importance DESC LIMIT 10"
  ).all() as Node[];

  if (styleDnaNodes.length === 0) return '';

  const topicLower = topic.toLowerCase().replace(/\s+/g, '_');

  // Find style DNA nodes relevant to current topic
  const relevant = styleDnaNodes.filter(n => {
    if (!n.metadata) return false;
    try {
      const meta = JSON.parse(n.metadata) as NodeMetadata;
      if (!meta.category) return false;
      return topicLower.includes(meta.category) || meta.category.includes(topicLower);
    } catch { return false; }
  });

  if (relevant.length === 0) return '';

  let text = '## Stil-Parameter\n';
  for (const node of relevant) {
    const line = `- ${node.content}\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Stil-Parameter\n') return '';
  return truncateToTokens(text, budget);
}

function buildExamplesSlot(budget: number, topic?: string): string {
  if (!topic) return '';

  const db = getDb();
  const examples = db.prepare(`
    SELECT * FROM nodes WHERE type = 'example'
    ORDER BY importance DESC, last_activated DESC LIMIT 20
  `).all() as Node[];

  if (examples.length === 0) return '';

  // Find examples relevant to the topic
  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);

  const relevant = examples.filter(ex => {
    const contentLower = ex.content.toLowerCase();
    // Check content match
    if (contentLower.includes(topicLower)) return true;
    if (topicWords.some(w => contentLower.includes(w))) return true;
    // Check metadata category match
    if (ex.metadata) {
      try {
        const meta = JSON.parse(ex.metadata) as NodeMetadata;
        if (meta.category && topicLower.includes(meta.category.replace(/_/g, ' '))) return true;
        if (meta.category && meta.category.includes(topicLower.replace(/\s+/g, '_'))) return true;
      } catch { /* skip */ }
    }
    return false;
  });

  if (relevant.length === 0) return '';

  let text = '## Beispiele\n';
  // Show max 2 examples, full content
  for (const ex of relevant.slice(0, 2)) {
    let label = '';
    if (ex.metadata) {
      try {
        const meta = JSON.parse(ex.metadata) as NodeMetadata;
        if (meta.category) label = ` (${meta.category.replace(/_/g, ' ')})`;
      } catch { /* skip */ }
    }
    const line = `### Beispiel${label}\n${ex.content}\n\n`;
    if (estimateTokens(text + line) > budget) break;
    text += line;
  }

  if (text === '## Beispiele\n') return '';
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

  const activeContext = buildActiveContextSlot(budget.activeContext, currentTopic);
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

    if (currentTopic) {
      const failureWarning = buildFailureWarningSlot(budget.communicationStyle, currentTopic);
      if (failureWarning) sections.push(failureWarning);
    }

    const metaInsight = buildMetaInsightSlot(budget.communicationStyle);
    if (metaInsight) sections.push(metaInsight);

    // Episodes: show relevant past session summaries
    const episodes = buildEpisodeSlot(budget.warmMemory, currentTopic);
    if (episodes) sections.push(episodes);

    // Style DNA: show style parameters when topic matches
    const styleDna = buildStyleSlot(budget.communicationStyle, currentTopic);
    if (styleDna) sections.push(styleDna);

    // Examples: show relevant examples when topic matches
    const exampleBudget = mode === 'MAXIMUM' ? 2000 : 1000;
    const examples = buildExamplesSlot(exampleBudget, currentTopic);
    if (examples) sections.push(examples);
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
