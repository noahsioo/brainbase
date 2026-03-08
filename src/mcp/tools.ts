import { randomUUID } from 'crypto';
import { searchNodes, addNode, getStats, getDb, createSession, type Node } from '../memory/store.js';
import { activateByQuery, getActivatedNodes, autoLinkNodes } from '../memory/activation.js';
import { processMessage } from '../hooks/user-prompt.js';
import { createProspectiveMemory } from '../memory/prospective.js';
import { isPaused } from '../config.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'memory_search',
    description:
      'Search the memory brain for stored knowledge. Use this to find what the user has told you before, ' +
      'their preferences, decisions, project details, or any past context. ' +
      'Returns matching memories sorted by relevance with spreading activation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - can be keywords, topics, or natural language',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10)',
        },
        session_id: {
          type: 'string',
          description: 'Optional session identifier for session-scoped search activation',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_context',
    description:
      'Get the full memory context for the current conversation. ' +
      'Includes user identity, active context, session momentum, communication style, and more. ' +
      'Use this at the start of a conversation or when you need a comprehensive overview.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['MAXIMUM', 'STANDARD', 'LIGHT', 'MINIMAL'],
          description: 'Detail level (default: STANDARD)',
        },
        topic: {
          type: 'string',
          description: 'Optional current topic for warm memory retrieval',
        },
        provider: {
          type: 'string',
          description: 'Provider name (e.g. cursor, claude-desktop) for format optimization',
        },
        session_id: {
          type: 'string',
          description: 'Optional session identifier for session-scoped context and activation',
        },
      },
    },
  },
  {
    name: 'memory_add',
    description:
      'Store a new memory in the brain. Use this to save important information the user shares: ' +
      'preferences, decisions, project details, learnings, or anything worth remembering. ' +
      'The memory will be automatically linked to related existing memories.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store',
        },
        type: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'project', 'identity', 'skill', 'insight', 'task'],
          description: 'Memory type (default: fact)',
        },
        importance: {
          type: 'number',
          description: 'Importance 0.0-1.0 (default: 0.6)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_status',
    description:
      'Get brain statistics: total memories, connections, patterns, sessions, and memory types. ' +
      'Use this to check the health and size of the memory system.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'memory_related',
    description:
      'Find memories related to a topic using spreading activation. ' +
      'Unlike search, this follows connections in the knowledge graph to find indirectly related memories. ' +
      'Good for discovering connections the user might not expect.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Topic to find related memories for',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
        session_id: {
          type: 'string',
          description: 'Optional session identifier for session-scoped related-memory retrieval',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_remind',
    description:
      'Create a prospective memory - a reminder that triggers when certain keywords appear in future conversations. ' +
      'Use this when the user says "remind me about X when Y" or wants to remember something for a future context.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'What to remember / the reminder content',
        },
        trigger_words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords that trigger this reminder (when any appear in a message)',
        },
      },
      required: ['content', 'trigger_words'],
    },
  },
  {
    name: 'memory_process_message',
    description:
      'CRITICAL: You MUST call this with EVERY user message BEFORE you respond. ' +
      'This is your persistent brain — it remembers everything across sessions. ' +
      'Pass the full user message. Returns context you MUST incorporate in your response. ' +
      'Without this, you have NO memory of previous conversations. NEVER skip this step.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The user message to process',
        },
        provider: {
          type: 'string',
          description: 'Which AI tool is calling (cursor, windsurf, continue-dev, claude-desktop, etc.)',
        },
        session_id: {
          type: 'string',
          description: 'Optional session identifier for grouping messages',
        },
      },
      required: ['message'],
    },
  },
];

function formatNode(node: Node): string {
  const age = Date.now() - node.created_at;
  const days = Math.floor(age / (1000 * 60 * 60 * 24));
  const ageLabel = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const imp = node.importance >= 0.8 ? '!!' : node.importance >= 0.6 ? '!' : '';
  return `${imp}[${node.type}] ${node.content} (${ageLabel}, importance: ${node.importance.toFixed(1)})`;
}

function ensureOpenSession(sessionId: string, provider = 'mcp'): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ? AND ended_at IS NULL').get(sessionId);
  if (!existing) {
    createSession(provider, sessionId);
  }
}

function preparePersistentSession(requestedSessionId?: string, provider = 'mcp'): {
  sessionId: string;
  generated: boolean;
} {
  if (requestedSessionId) {
    ensureOpenSession(requestedSessionId, provider);
    return {
      sessionId: requestedSessionId,
      generated: false,
    };
  }

  const generatedSessionId = `mcp-${randomUUID()}`;
  ensureOpenSession(generatedSessionId, provider);
  return {
    sessionId: generatedSessionId,
    generated: true,
  };
}

function prepareEphemeralScope(
  requestedSessionId?: string,
  prefix = 'mcp-read',
): { sessionId: string; cleanup: () => void } {
  if (requestedSessionId) {
    ensureOpenSession(requestedSessionId, 'mcp');
    return {
      sessionId: requestedSessionId,
      cleanup: () => {},
    };
  }

  const ephemeralSessionId = `${prefix}-${randomUUID()}`;
  ensureOpenSession(ephemeralSessionId, 'mcp');
  return {
    sessionId: ephemeralSessionId,
    cleanup: () => {
      const db = getDb();
      db.prepare('DELETE FROM sessions WHERE id = ?').run(ephemeralSessionId);
    },
  };
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (isPaused()) {
    return { content: [{ type: 'text', text: 'Memory system is paused. Use the dashboard or CLI to resume.' }] };
  }

  try {
    switch (name) {
      case 'memory_search':
        return handleSearch(args);
      case 'memory_context':
        return await handleContext(args);
      case 'memory_add':
        return handleAdd(args);
      case 'memory_status':
        return handleStatus();
      case 'memory_related':
        return handleRelated(args);
      case 'memory_remind':
        return handleRemind(args);
      case 'memory_process_message':
        return await handleProcessMessage(args);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

function handleSearch(args: Record<string, unknown>): ToolResult {
  const query = args.query as string;
  const limit = (args.limit as number) || 10;
  const requestedSessionId = args.session_id as string | undefined;

  const directHits = searchNodes(query, limit);
  const { sessionId, cleanup } = prepareEphemeralScope(requestedSessionId, 'mcp-search');

  try {
    const activation = activateByQuery(query, 0.5, sessionId);
    const activated = getActivatedNodes(limit, sessionId);

    const seen = new Set(directHits.map(n => n.id));
    const combined = [...directHits];
    for (const node of [...activation.activated, ...activated]) {
      if (!seen.has(node.id)) {
        combined.push(node);
        seen.add(node.id);
      }
      if (combined.length >= limit) break;
    }

    if (combined.length === 0) {
      return { content: [{ type: 'text', text: `No memories found for "${query}".` }] };
    }

    const lines = combined.slice(0, limit).map(formatNode);
    const text = `Found ${combined.length} memories for "${query}":\n\n${lines.join('\n')}`;
    return { content: [{ type: 'text', text }] };
  } finally {
    cleanup();
  }
}

async function handleContext(args: Record<string, unknown>): Promise<ToolResult> {
  const topic = args.topic as string | undefined;
  const provider = (args.provider as string) || 'mcp';
  const requestedSessionId = args.session_id as string | undefined;
  const { sessionId, generated } = preparePersistentSession(requestedSessionId, provider);

  const result = await processMessage({
    message: topic || 'context request',
    provider,
    session_id: sessionId,
    context_only: true,
  });

  const sessionHint = generated ? `Session ID: ${sessionId}\n\n` : '';
  return { content: [{ type: 'text', text: `${sessionHint}${result.context || 'No context available.'}` }] };
}

function handleAdd(args: Record<string, unknown>): ToolResult {
  const content = args.content as string;
  const type = (args.type as string) || 'fact';
  const importance = (args.importance as number) ?? 0.6;

  const node = addNode(content, type, { importance, source: 'mcp' });
  const edges = autoLinkNodes(node.id);

  const text = `Memory stored (id: ${node.id.slice(0, 8)}). ` +
    `Type: ${type}, importance: ${importance}. ` +
    `Auto-linked to ${edges.length} existing memories.`;
  return { content: [{ type: 'text', text }] };
}

function handleStatus(): ToolResult {
  const stats = getStats();

  const typeLines = Object.entries(stats.typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `  ${type}: ${count}`)
    .join('\n');

  const text =
    `Brain Statistics:\n` +
    `  Neurons (nodes): ${stats.totalNodes}\n` +
    `  Synapses (edges): ${stats.totalEdges}\n` +
    `  Patterns: ${stats.totalPatterns}\n` +
    `  Sessions: ${stats.totalSessions}\n\n` +
    `Memory types:\n${typeLines}`;

  return { content: [{ type: 'text', text }] };
}

function handleRelated(args: Record<string, unknown>): ToolResult {
  const query = args.query as string;
  const limit = (args.limit as number) || 10;
  const requestedSessionId = args.session_id as string | undefined;
  const { sessionId, cleanup } = prepareEphemeralScope(requestedSessionId, 'mcp-related');

  try {
    activateByQuery(query, 0.8, sessionId);
    const activated = getActivatedNodes(limit, sessionId);

    if (activated.length === 0) {
      return { content: [{ type: 'text', text: `No related memories found for "${query}".` }] };
    }

    const lines = activated.map(formatNode);
    const text = `${activated.length} related memories for "${query}" (via spreading activation):\n\n${lines.join('\n')}`;
    return { content: [{ type: 'text', text }] };
  } finally {
    cleanup();
  }
}

function handleRemind(args: Record<string, unknown>): ToolResult {
  const content = args.content as string;
  const triggerWords = args.trigger_words as string[];

  if (!content || !triggerWords || triggerWords.length === 0) {
    return { content: [{ type: 'text', text: 'Error: content and trigger_words are required' }], isError: true };
  }

  const node = createProspectiveMemory(content, triggerWords);
  const text = `Reminder set (id: ${node.id.slice(0, 8)}). ` +
    `Triggers: ${triggerWords.join(', ')}. ` +
    `Will surface when any trigger word appears in a message.`;
  return { content: [{ type: 'text', text }] };
}

async function handleProcessMessage(args: Record<string, unknown>): Promise<ToolResult> {
  const message = args.message as string;
  if (!message) {
    return { content: [{ type: 'text', text: 'Error: message is required' }], isError: true };
  }

  const provider = (args.provider as string) || 'mcp';
  const requestedSessionId = args.session_id as string | undefined;
  const { sessionId, generated } = preparePersistentSession(requestedSessionId, provider);

  const result = await processMessage({
    message,
    provider,
    session_id: sessionId,
  });

  const sessionHint = generated ? `Session ID: ${sessionId}\n\n` : '';
  if (result.context) {
    const text = `${sessionHint}[Signal: ${result.signal_score.toFixed(2)} / ${result.signal_action}]\n\n${result.context}`;
    return { content: [{ type: 'text', text }] };
  }

  return {
    content: [{
      type: 'text',
      text: `${sessionHint}Message processed. Signal: ${result.signal_score.toFixed(2)} / ${result.signal_action}. No relevant context yet.`,
    }],
  };
}
