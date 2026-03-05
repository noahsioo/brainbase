import { Command } from 'commander';
import { handleSessionStart } from '../hooks/session-start.js';
import { handleUserPrompt } from '../hooks/user-prompt.js';
import { handleSessionEnd } from '../hooks/session-end.js';
import { handlePreCompact } from '../hooks/pre-compact.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));

    // If stdin is a TTY (no piped input), resolve immediately
    if (process.stdin.isTTY) {
      resolve('{}');
    }
  });
}

async function parseStdinJson(): Promise<Record<string, unknown>> {
  const raw = await readStdin();
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export const hookCommand = new Command('hook')
  .description('Handle Claude Code hook events (internal)')
  .argument('<event>', 'Hook event: session-start, user-prompt, session-end, pre-compact')
  .action(async (event: string) => {
    const input = await parseStdinJson();

    switch (event) {
      case 'session-start':
        await handleSessionStart(input as { session_id?: string; transcript_path?: string });
        break;
      case 'user-prompt':
        await handleUserPrompt(input as { session_id?: string; user_prompt?: string });
        break;
      case 'session-end':
        await handleSessionEnd(input as { session_id?: string; transcript_path?: string });
        break;
      case 'pre-compact':
        await handlePreCompact();
        break;
      default:
        process.stderr.write(`Unknown hook event: ${event}\n`);
        process.exit(1);
    }
  });
