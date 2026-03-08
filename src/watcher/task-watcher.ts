import type { LLMClient } from '../llm/types.js';
import { addNode, searchNodes, getNodes, type Node } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import { createProspectiveMemory } from '../memory/prospective.js';

export interface TaskExtractionResult {
  tasks_created: number;
}

interface LLMTaskResponse {
  tasks: Array<{
    description: string;
    deadline: 'today' | 'tomorrow' | 'this_week' | 'someday' | null;
    priority: 'high' | 'medium' | 'low';
  }>;
}

const TASK_KEYWORDS_DE = [
  'muss', 'todo', 'deadline', 'morgen', 'spaeter', 'später',
  'nicht vergessen', 'erinnerung', 'erinnere', 'bis heute',
  'bis morgen', 'diese woche', 'naechste woche', 'nächste woche',
  'dringend', 'aufgabe', 'to-do', 'noch machen', 'muss noch',
];

const TASK_KEYWORDS_EN = [
  'must', 'need to', 'have to', 'todo', 'to-do', 'deadline',
  'tomorrow', 'later', 'reminder', 'don\'t forget', 'by today',
  'by tomorrow', 'this week', 'next week', 'urgent', 'asap',
  'should do', 'gotta', 'needs to be done',
];

const ALL_TASK_KEYWORDS = [...TASK_KEYWORDS_DE, ...TASK_KEYWORDS_EN];

const PRIORITY_IMPORTANCE: Record<string, number> = {
  high: 0.9,
  medium: 0.7,
  low: 0.5,
};

const TASK_SYSTEM_PROMPT = `You extract tasks and to-dos from user messages.
A task is something the user wants to DO, REMEMBER to do, or has a DEADLINE for.
Do NOT extract coding instructions (like "create a function") - those are immediate work, not tasks.
Only extract things the user wants to remember for LATER.

Rules:
- Max 2 tasks per message
- Keep descriptions short (max 100 chars)
- deadline: "today", "tomorrow", "this_week", "someday", or null
- priority: "high" (urgent/deadline), "medium" (should do), "low" (nice to have)

Respond with JSON:
{
  "tasks": [
    { "description": "short task description", "deadline": "today|tomorrow|this_week|someday|null", "priority": "high|medium|low" }
  ]
}

If no real tasks found: { "tasks": [] }`;

export function hasTaskSignal(message: string): boolean {
  const lower = message.toLowerCase();
  return ALL_TASK_KEYWORDS.some(kw => lower.includes(kw));
}

export async function extractTasks(
  client: LLMClient,
  message: string,
  sessionId: string,
): Promise<TaskExtractionResult> {
  const result: TaskExtractionResult = { tasks_created: 0 };

  if (!hasTaskSignal(message)) {
    return result;
  }

  let response: LLMTaskResponse;
  try {
    const prompt = `User message: "${message.substring(0, 500)}"\n\nExtract any tasks or to-dos from this message.`;
    response = await client.generateJson<LLMTaskResponse>(prompt, {
      system: TASK_SYSTEM_PROMPT,
      temperature: 0.1,
    });
  } catch {
    return result;
  }

  if (!response?.tasks || !Array.isArray(response.tasks)) {
    return result;
  }

  const tasks = response.tasks.slice(0, 2);

  for (const task of tasks) {
    if (!task.description || task.description.length < 3 || task.description.length > 200) continue;

    const priority = PRIORITY_IMPORTANCE[task.priority] ? task.priority : 'medium';
    const importance = PRIORITY_IMPORTANCE[priority];

    const existing = searchNodes(task.description, 5);
    const isDuplicate = existing.some(n =>
      n.type === 'task' && isSimilarTask(n.content, task.description)
    );
    if (isDuplicate) continue;

    const deadlineTag = task.deadline ? `deadline:${task.deadline}` : undefined;

    const node = addNode(task.description.trim(), 'task', {
      importance,
      confidence: 0.7,
      emotional_tag: deadlineTag,
      source: `task-watcher:${sessionId}`,
    });

    autoLinkNodes(node.id);

    // V6-7: Tasks mit Deadline → Prospective Memory Bridge
    if (task.deadline && task.deadline !== 'someday') {
      const triggerDate = deadlineToTimestamp(task.deadline);
      const words = task.description.split(/\s+/)
        .filter(w => w.length > 3)
        .map(w => w.toLowerCase())
        .slice(0, 3);

      createProspectiveMemory(task.description, words, {
        importance,
        source: `task-bridge:${sessionId}`,
        trigger_date: triggerDate,
        trigger_type: 'both',
      });
    }

    result.tasks_created++;
  }

  return result;
}

function deadlineToTimestamp(deadline: string): number {
  const now = new Date();
  switch (deadline) {
    case 'today': {
      const eod = new Date(now);
      eod.setHours(18, 0, 0, 0);
      return eod.getTime();
    }
    case 'tomorrow': {
      const tmr = new Date(now);
      tmr.setDate(tmr.getDate() + 1);
      tmr.setHours(9, 0, 0, 0);
      return tmr.getTime();
    }
    case 'this_week': {
      const fri = new Date(now);
      const daysUntilFri = (5 - fri.getDay() + 7) % 7 || 7;
      fri.setDate(fri.getDate() + daysUntilFri);
      fri.setHours(9, 0, 0, 0);
      return fri.getTime();
    }
    default:
      return Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
}

function isSimilarTask(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union > 0.6;
}

export function getOpenTasks(sessionId?: string): Node[] {
  const taskNodes = getNodes({ type: 'task', limit: 50 });
  return taskNodes.filter(n => {
    if (sessionId && n.source !== `task-watcher:${sessionId}`) return false;
    const content = n.content.toLowerCase();
    return !content.startsWith('[done]') && !content.startsWith('[erledigt]');
  });
}
