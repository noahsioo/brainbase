import { getDb } from '../memory/store.js';
import { getWorkingMemory } from '../memory/working-memory.js';
import { refreshClaudeMdContext } from '../memory/hot.js';

interface PreCompactInput {
  session_id?: string;
}

// V18: PreCompact CANNOT use additionalContext (Zod schema doesn't support it).
// Strategy: Save state to DB → SessionStart(source="compact") loads it via additionalContext.
export async function handlePreCompact(input: PreCompactInput = {}): Promise<void> {
  try {
    const db = getDb();
    const sessionId = input.session_id;
    const workingMemory = sessionId ? getWorkingMemory(sessionId) : null;

    // 1. Save state to DB (SessionStart with source="compact" will load this)
    if (sessionId && workingMemory) {
      const compactState = {
        topic: workingMemory.current_topic,
        summary: workingMemory.conversation_summary,
        last_message: workingMemory.last_user_message,
        open_questions: workingMemory.open_questions?.slice(0, 3),
        timestamp: Date.now(),
      };
      db.prepare(
        "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)"
      ).run('pre_compact_state', JSON.stringify(compactState), Date.now());
    }

    // 2. Refresh CLAUDE.md (survives compaction)
    try { refreshClaudeMdContext(); } catch { /* non-fatal */ }

    // 3. Minimal systemMessage (only thing PreCompact can output)
    const topic = workingMemory?.current_topic || 'unknown';
    process.stdout.write(JSON.stringify({
      systemMessage: `Conversation compressed. Topic: ${topic}. Veris will restore context.`,
    }));
  } catch {
    process.stdout.write(JSON.stringify({
      systemMessage: 'Conversation compressed. Veris will restore context.',
    }));
  }
}
