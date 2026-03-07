import { getDb } from '../memory/store.js';
import { generateContext } from '../memory/context-generator.js';

export async function handlePreCompact(): Promise<void> {
  try {
    const db = getDb();

    const topActivated = db.prepare(
      "SELECT content, type FROM nodes WHERE activation > 0.1 ORDER BY activation DESC LIMIT 5"
    ).all() as Array<{ content: string; type: string }>;

    const moodRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_mood'")
      .get() as { value: string } | undefined;
    const taskRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_task_mode'")
      .get() as { value: string } | undefined;
    const empathyRow = db.prepare("SELECT value FROM system_state WHERE key = 'current_empathy_mode'")
      .get() as { value: string } | undefined;

    let focusEntities: string[] = [];
    try {
      const focusRow = db.prepare(
        "SELECT value FROM system_state WHERE key LIKE 'session_focus_%' ORDER BY updated_at DESC LIMIT 1"
      ).get() as { value: string } | undefined;
      if (focusRow) {
        const focusMap = JSON.parse(focusRow.value) as Record<string, number>;
        focusEntities = Object.entries(focusMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([e]) => e);
      }
    } catch { /* no focus data */ }

    let briefing = '[Memory System — Post-Compact Reconnect]\n\n';

    if (moodRow?.value) {
      briefing += `Stimmung: ${moodRow.value}\n`;
    }
    if (taskRow?.value) {
      briefing += `Modus: ${taskRow.value}\n`;
    }
    if (empathyRow?.value) {
      briefing += `Empathie: ${empathyRow.value}\n`;
    }
    if (focusEntities.length > 0) {
      briefing += `Fokus: ${focusEntities.join(', ')}\n`;
    }
    if (topActivated.length > 0) {
      briefing += `\nAktiv im Kopf:\n`;
      for (const node of topActivated) {
        briefing += `- ${node.content} (${node.type})\n`;
      }
    }

    const context = generateContext('LIGHT');
    if (context && !context.startsWith('Noch keine Memories')) {
      briefing += '\n' + context;
    }

    const output = JSON.stringify({ systemMessage: briefing });
    process.stdout.write(output);
  } catch {
    const fallback = JSON.stringify({ systemMessage: '[Memory System Active]' });
    process.stdout.write(fallback);
  }
}
