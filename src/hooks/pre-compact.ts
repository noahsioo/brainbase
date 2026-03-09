import { getActivatedNodes } from '../memory/activation.js';
import { getDb } from '../memory/store.js';
import { getSessionRuntimeStateSnapshot } from '../memory/session-runtime-state.js';
import { getWorkingMemory } from '../memory/working-memory.js';

interface PreCompactInput {
  session_id?: string;
}

export async function handlePreCompact(input: PreCompactInput = {}): Promise<void> {
  try {
    const db = getDb();
    const sessionId = input.session_id;
    const runtimeState = getSessionRuntimeStateSnapshot(sessionId);
    const workingMemory = sessionId ? getWorkingMemory(sessionId) : null;

    const topActivated = getActivatedNodes(5, sessionId)
      .map(node => ({ content: node.content, type: node.type }));

    let focusEntities: string[] = [];
    if (sessionId) {
      try {
        const key = `session_focus_${sessionId}`;
        const scopedFocusRow = db.prepare(
          'SELECT value FROM system_state WHERE key = ?'
        ).get(key) as { value: string } | undefined;
        if (scopedFocusRow) {
          const focusMap = JSON.parse(scopedFocusRow.value) as Record<string, number>;
          focusEntities = Object.entries(focusMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([e]) => e);
        }
      } catch { /* no focus data */ }
    }

    if (!sessionId) {
      const output = JSON.stringify({ systemMessage: 'IMPORTANT — Conversation was compressed. No session-specific state available.' });
      process.stdout.write(output);
      return;
    }

    const parts: string[] = ['IMPORTANT — Conversation was compressed. Here is what you were discussing:'];

    // Build narrative reconnect state
    const stateParts: string[] = [];
    if (workingMemory?.current_topic) {
      stateParts.push(`topic: ${workingMemory.current_topic}`);
    }
    if (focusEntities.length > 0) {
      stateParts.push(`focus: ${focusEntities.join(', ')}`);
    }
    if (runtimeState.mood && runtimeState.mood !== 'neutral') {
      stateParts.push(`user mood: ${runtimeState.mood}`);
    }
    if (runtimeState.taskMode) {
      stateParts.push(`mode: ${runtimeState.taskMode}`);
    }
    if (stateParts.length > 0) {
      parts.push(`Current state: ${stateParts.join(', ')}.`);
    }

    if (workingMemory?.conversation_summary) {
      parts.push(`Session so far: ${workingMemory.conversation_summary}`);
    }
    if (workingMemory?.open_questions && workingMemory.open_questions.length > 0) {
      parts.push(`Open questions: ${workingMemory.open_questions.slice(0, 3).join(' | ')}`);
    }
    if (workingMemory?.last_user_message) {
      parts.push(`Last user message: ${workingMemory.last_user_message}`);
    }
    if (topActivated.length > 0) {
      const activeKnowledge = topActivated
        .filter(n => n.type !== 'entity' && n.type !== 'core')
        .map(n => n.content);
      const activeEntities = topActivated
        .filter(n => n.type === 'entity')
        .map(n => n.content);
      if (activeEntities.length > 0) {
        parts.push(`Key entities: ${activeEntities.join(', ')}`);
      }
      if (activeKnowledge.length > 0) {
        parts.push(`You know: ${activeKnowledge.join('. ')}`);
      }
    }

    parts.push('\nContinue the conversation naturally. Use the above context — NEVER re-ask for it.');

    const briefing = parts.join('\n');

    const output = JSON.stringify({ systemMessage: briefing });
    process.stdout.write(output);
  } catch {
    const fallback = JSON.stringify({ systemMessage: 'IMPORTANT — Conversation was compressed. Continue naturally.' });
    process.stdout.write(fallback);
  }
}
