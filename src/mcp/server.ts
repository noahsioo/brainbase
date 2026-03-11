#!/usr/bin/env node

import { createInterface } from 'readline';
import { TOOL_DEFINITIONS, handleToolCall } from './tools.js';
import { generateContext } from '../memory/context-generator.js';
import { getDb } from '../memory/store.js';

const SERVER_NAME = 'veris';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseMemoryResourceUri(uri: string): { baseUri: string; sessionId?: string } {
  try {
    const parsed = new URL(uri);
    return {
      baseUri: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
      sessionId: parsed.searchParams.get('session_id') || undefined,
    };
  } catch {
    return { baseUri: uri };
  }
}

function send(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          tools: TOOL_DEFINITIONS,
        },
      });
      break;

    case 'tools/call': {
      const params = req.params || {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, unknown>;

      const result = await handleToolCall(toolName, toolArgs);

      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result,
      });
      break;
    }

    case 'resources/list':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          resources: [
            {
              uri: 'memory://brain/context',
              name: 'Brain Context',
              description: 'Current memory context — identity, active memories, session state. Auto-loaded at conversation start.',
              mimeType: 'text/plain',
            },
            {
              uri: 'memory://brain/identity',
              name: 'User Identity',
              description: 'User profile, preferences, and tech stack from persistent memory.',
              mimeType: 'text/plain',
            },
          ],
        },
      });
      break;

    case 'resources/read': {
      const uri = (req.params?.uri as string) || '';
      const { baseUri, sessionId } = parseMemoryResourceUri(uri);
      let resourceContent = '';

      if (baseUri === 'memory://brain/context') {
        try {
          resourceContent = generateContext('STANDARD', undefined, undefined, undefined, undefined, undefined, undefined, sessionId, true);
        } catch {
          resourceContent = 'No context yet — we haven\'t talked before. Start a conversation and I\'ll remember everything.';
        }
      } else if (baseUri === 'memory://brain/identity') {
        try {
          const db = getDb();
          const identityNodes = db.prepare(
            "SELECT content FROM nodes WHERE type IN ('identity', 'preference', 'core') ORDER BY importance DESC LIMIT 10"
          ).all() as Array<{ content: string }>;
          resourceContent = identityNodes.length > 0
            ? identityNodes.map(n => `- ${n.content}`).join('\n')
            : 'No identity information stored yet.';
        } catch {
          resourceContent = 'We haven\'t met yet. Tell me about yourself.';
        }
      } else {
        send({
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: { code: -32602, message: `Unknown resource: ${uri}` },
        });
        break;
      }

      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          contents: [{
            uri,
            mimeType: 'text/plain',
            text: resourceContent,
          }],
        },
      });
      break;
    }

    case 'prompts/list':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          prompts: [{
            name: 'brain-briefing',
            description: 'Get a full briefing from your persistent brain — identity, recent context, active memories',
          }],
        },
      });
      break;

    case 'prompts/get': {
      let briefingContent = '';
      const promptArgs = (req.params?.arguments || {}) as Record<string, unknown>;
      const sessionId = promptArgs.session_id as string | undefined;
      try {
        briefingContent = generateContext('MAXIMUM', undefined, undefined, undefined, undefined, undefined, undefined, sessionId, true);
      } catch {
        briefingContent = 'We haven\'t talked yet. Send me a message and I\'ll start remembering.';
      }

      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `${briefingContent}\n\nEverything above is from my previous conversations. Use it — don't ask me to repeat any of it.`,
            },
          }],
        },
      });
      break;
    }

    case 'resources/subscribe':
    case 'resources/unsubscribe':
      send({ jsonrpc: '2.0', id: req.id ?? null, result: {} });
      break;

    case 'ping':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {},
      });
      break;

    default:
      if (req.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        });
      }
  }
}

export function startServer(): void {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      const req = JSON.parse(line) as JsonRpcRequest;
      handleRequest(req);
    } catch (e) {
      send({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
        },
      });
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Direct execution
const isDirectRun = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isDirectRun) {
  startServer();
}
