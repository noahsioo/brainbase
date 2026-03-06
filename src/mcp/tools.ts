import { searchNodes, addNode, getStats, type Node } from '../memory/store.js';
import { activateByQuery, getActivatedNodes, autoLinkNodes } from '../memory/activation.js';
import { generateContext, type DetailMode } from '../memory/context-generator.js';
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
      'Process a user message through the brain. Call this with every user message to feed the brain ' +
      'and get relevant context back. This enables the brain to learn from conversations in any AI tool. ' +
      'Returns context that should be used to inform your responses.',
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

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (isPaused()) {
    return { content: [{ type: 'text', text: 'Memory system is paused. Use the dashboard or CLI to resume.' }] };
  }

  try {
    switch (name) {
      case 'memory_search':
        return handleSearch(args);
      case 'memory_context':
        return handleContext(args);
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

  const directHits = searchNodes(query, limit);
  const activation = activateByQuery(query, 0.5);

  const seen = new Set(directHits.map(n => n.id));
  const combined = [...directHits];
  for (const node of activation.activated) {
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
}

function handleContext(args: Record<string, unknown>): ToolResult {
  const mode = (args.mode as DetailMode) || 'STANDARD';
  const topic = args.topic as string | undefined;
  const context = generateContext(mode, topic);
  return { content: [{ type: 'text', text: context }] };
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

  activateByQuery(query, 0.8);
  const activated = getActivatedNodes(limit);

  if (activated.length === 0) {
    return { content: [{ type: 'text', text: `No related memories found for "${query}".` }] };
  }

  const lines = activated.map(formatNode);
  const text = `${activated.length} related memories for "${query}" (via spreading activation):\n\n${lines.join('\n')}`;
  return { content: [{ type: 'text', text }] };
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
  const sessionId = (args.session_id as string) || undefined;

  const result = await processMessage({
    message,
    provider,
    session_id: sessionId,
  });

  if (result.context) {
    const text = `[Signal: ${result.signal_score.toFixed(2)} / ${result.signal_action}]\n\n${result.context}`;
    return { content: [{ type: 'text', text }] };
  }

  return { content: [{ type: 'text', text: `Message processed. Signal: ${result.signal_score.toFixed(2)} / ${result.signal_action}. No relevant context yet.` }] };
}
