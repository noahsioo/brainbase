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

    let briefing = '[Memory System — Post-Compact Reconnect]\n\n';
    if (!sessionId) {
      briefing += 'Kein session-spezifischer Reconnect-State verfuegbar.\n';
      const output = JSON.stringify({ systemMessage: briefing });
      process.stdout.write(output);
      return;
    }

    if (runtimeState.mood && runtimeState.mood !== 'neutral') {
      briefing += `Stimmung: ${runtimeState.mood}\n`;
    }
    if (runtimeState.taskMode) {
      briefing += `Modus: ${runtimeState.taskMode}\n`;
    }
    if (runtimeState.empathyMode && runtimeState.empathyMode !== 'neutral') {
      briefing += `Empathie: ${runtimeState.empathyMode}\n`;
    }
    if (workingMemory?.current_topic) {
      briefing += `Thema: ${workingMemory.current_topic}\n`;
    }
    if (focusEntities.length > 0) {
      briefing += `Fokus: ${focusEntities.join(', ')}\n`;
    }
    if (workingMemory?.references && workingMemory.references.length > 0) {
      const displayReference = workingMemory.references.find(reference => {
        const normalized = reference.trim().toLowerCase();
        return normalized && !['das', 'dies', 'diese', 'dieser', 'dieses', 'es', 'it', 'this', 'that'].includes(normalized);
      });
      if (displayReference) {
        briefing += `Verweis: ${displayReference}\n`;
      }
    }
    if (workingMemory?.context_stack && workingMemory.context_stack.length > 0) {
      briefing += `Kontext: ${workingMemory.context_stack.slice(0, 4).join(' -> ')}\n`;
    }
    if (workingMemory?.open_questions && workingMemory.open_questions.length > 0) {
      briefing += `Offene Loops: ${workingMemory.open_questions.slice(0, 3).join(' | ')}\n`;
    }
    if (workingMemory?.last_user_message) {
      briefing += `Letzter Nutzerimpuls: ${workingMemory.last_user_message}\n`;
    }
    if (workingMemory?.conversation_summary) {
      briefing += `\nSession-Kern:\n- ${workingMemory.conversation_summary}\n`;
    }
    if (topActivated.length > 0) {
      briefing += '\nAktiv im Kopf:\n';
      for (const node of topActivated) {
        briefing += `- ${node.content} (${node.type})\n`;
      }
    }
    if (!workingMemory && focusEntities.length === 0 && topActivated.length === 0) {
      briefing += '\nLokaler Reconnect-State ist noch duenn. Nutze die aktuelle Session-ID weiter, damit das System wieder an denselben Fokus anknuepft.\n';
    }

    const output = JSON.stringify({ systemMessage: briefing });
    process.stdout.write(output);
  } catch {
    const fallback = JSON.stringify({ systemMessage: '[Memory System Active]' });
    process.stdout.write(fallback);
  }
}
