#!/usr/bin/env node

import { createInterface } from 'readline';
import { TOOL_DEFINITIONS, handleToolCall } from './tools.js';

const SERVER_NAME = 'memory-unlimited';
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

function send(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

function handleRequest(req: JsonRpcRequest): void {
  switch (req.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
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

      const result = handleToolCall(toolName, toolArgs);

      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result,
      });
      break;
    }

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
