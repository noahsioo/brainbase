import { Command } from 'commander';
import { isPaused } from '../config.js';
import { handleSessionStart } from '../hooks/session-start.js';
import { handleUserPrompt } from '../hooks/user-prompt.js';
import { handleSessionEnd } from '../hooks/session-end.js';
import { handlePreCompact } from '../hooks/pre-compact.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const done = (result: string) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    if (process.stdin.isTTY) {
      done('{}');
      return;
    }

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', () => done('{}'));

    setTimeout(() => done(data || '{}'), 3000);

    process.stdin.resume();
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

    if (isPaused()) {
      return;
    }

    switch (event) {
      case 'session-start': {
        const startSessionId = (input.session_id || input.sessionId) as string | undefined;
        const transcriptPath = (input.transcript_path || input.transcriptPath) as string | undefined;
        await handleSessionStart({ session_id: startSessionId, transcript_path: transcriptPath });
        break;
      }
      case 'user-prompt': {
        const userPrompt = (input.prompt || input.user_prompt || input.message || input.input || input.query || input.content) as string | undefined;
        const sessionId = (input.session_id || input.sessionId) as string | undefined;
        await handleUserPrompt({ session_id: sessionId, user_prompt: userPrompt });
        break;
      }
      case 'session-end': {
        const endSessionId = (input.session_id || input.sessionId) as string | undefined;
        const endTranscriptPath = (input.transcript_path || input.transcriptPath) as string | undefined;
        await handleSessionEnd({ session_id: endSessionId, transcript_path: endTranscriptPath });
        break;
      }
      case 'pre-compact':
        await handlePreCompact({
          session_id: (input.session_id || input.sessionId) as string | undefined,
        });
        break;
      default:
        process.stderr.write(`Unknown hook event: ${event}\n`);
        process.exit(1);
    }
  });
