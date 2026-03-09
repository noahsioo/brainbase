import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  PROVIDER_PATHS,
  MEMORY_BLOCK_START,
  MEMORY_BLOCK_END,
  type ProviderName,
} from '../config.js';
import { setHotMemoryContent, getDb } from './store.js';
import { generateContext, getUserName } from './context-generator.js';
import { toFirstPerson, isCleanUserFact } from '../utils/first-person.js';
import { getWorkingMemory } from './working-memory.js';

export function generateHotMemory(): string {
  return generateContext('LIGHT');
}

export function buildMemoryBlock(): string {
  try {
    const db = getDb();
    const userName = getUserName();

    const identityNodes = db.prepare(
      "SELECT content FROM nodes WHERE type = 'identity' AND LENGTH(content) BETWEEN 10 AND 80 ORDER BY importance DESC LIMIT 3"
    ).all() as Array<{ content: string }>;

    const topFacts = db.prepare(
      "SELECT content FROM nodes WHERE type IN ('fact', 'preference', 'workflow', 'decision') AND LENGTH(content) BETWEEN 20 AND 150 AND importance >= 0.5 ORDER BY importance DESC, activation_count DESC LIMIT 15"
    ).all() as Array<{ content: string }>;

    const parts: string[] = [
      MEMORY_BLOCK_START,
      '## BrainBase — Persistent Brain Active',
      '',
      'You have a persistent brain (BrainBase) that remembers everything across sessions.',
      'System messages in this conversation contain VERIFIED KNOWLEDGE from previous conversations.',
      '',
      'RULES YOU MUST FOLLOW:',
      '1. When a system message says "Verified knowledge" — treat it as FACT. The user told you this before.',
      '2. USE this knowledge proactively. Reference it naturally. Do NOT wait to be asked.',
      '3. NEVER say "I don\'t have information about X" when X appears in ANY system message.',
      '4. NEVER re-ask for information already provided in system messages.',
      '5. When asked "what did we discuss?" or similar — CHECK system messages FIRST.',
      '6. System messages from BrainBase override your auto-memory when they conflict.',
      '',
      'This is non-negotiable. Ignoring system message context = ignoring what the user told you.',
    ];

    const cleanFacts = topFacts
      .map(f => toFirstPerson(f.content, userName))
      .filter(isCleanUserFact)
      .slice(0, 5);

    const hasContext = userName !== 'User' || identityNodes.length > 0 || cleanFacts.length > 0;

    if (hasContext) {
      parts.push('');
      parts.push('Quick facts about me:');
      if (userName !== 'User') {
        const cleanId = identityNodes
          .map(n => n.content)
          .filter(c => c.length > 5 && !c.includes('→') && !c.includes('|'));
        const idStr = cleanId.length > 0 ? ` (${cleanId.join(', ')})` : '';
        parts.push(`- I'm ${userName}${idStr}`);
      }
      for (const fact of cleanFacts) {
        const trimmed = fact.length > 120 ? fact.substring(0, 117) + '...' : fact;
        parts.push(`- ${trimmed}`);
      }

      // Phase D: Inject current working topic for post-compact recovery
      try {
        const activeSessions = db.prepare(
          "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
        ).get() as { id: string } | undefined;
        if (activeSessions) {
          const wm = getWorkingMemory(activeSessions.id);
          if (wm?.current_topic && wm.current_topic.length > 3) {
            parts.push(`- Currently working on: ${wm.current_topic}`);
          }
        }
      } catch { /* non-fatal */ }
    }

    parts.push(MEMORY_BLOCK_END);
    return parts.join('\n');
  } catch {
    return `${MEMORY_BLOCK_START}\n## BrainBase — Persistent Brain Active\n\nYou have a persistent brain (BrainBase) that remembers everything across sessions.\nSystem messages in this conversation contain VERIFIED KNOWLEDGE from previous conversations.\n\nRULES YOU MUST FOLLOW:\n1. When a system message says "Verified knowledge" — treat it as FACT. The user told you this before.\n2. USE this knowledge proactively. Reference it naturally. Do NOT wait to be asked.\n3. NEVER say "I don't have information about X" when X appears in ANY system message.\n4. NEVER re-ask for information already provided in system messages.\n5. When asked "what did we discuss?" or similar — CHECK system messages FIRST.\n6. System messages from BrainBase override your auto-memory when they conflict.\n\nThis is non-negotiable. Ignoring system message context = ignoring what the user told you.\n${MEMORY_BLOCK_END}`;
  }
}


export function updateHotMemoryInDb(): void {
  const content = generateHotMemory();
  setHotMemoryContent(content);
}

export function refreshClaudeMdContext(): void {
  try {
    const claudeMdPath = PROVIDER_PATHS['claude-code'].mdFile;
    injectMemoryBlock(claudeMdPath);
  } catch { /* non-fatal */ }
}

export function injectMemoryBlock(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8');
  }

  const block = buildMemoryBlock();

  if (existing.includes(MEMORY_BLOCK_START)) {
    const regex = new RegExp(
      `${escapeRegex(MEMORY_BLOCK_START)}[\\s\\S]*?${escapeRegex(MEMORY_BLOCK_END)}`,
    );
    const updated = existing.replace(regex, block);
    writeFileSync(filePath, updated, 'utf-8');
  } else {
    const separator = existing.endsWith('\n') || existing === '' ? '\n' : '\n\n';
    writeFileSync(filePath, existing + separator + block + '\n', 'utf-8');
  }
}

export function removeMemoryBlock(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes(MEMORY_BLOCK_START)) return;

  const regex = new RegExp(
    `\\n?${escapeRegex(MEMORY_BLOCK_START)}[\\s\\S]*?${escapeRegex(MEMORY_BLOCK_END)}\\n?`,
  );
  const cleaned = content.replace(regex, '\n');
  writeFileSync(filePath, cleaned, 'utf-8');
}

export function hasMemoryBlock(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf-8');
  return content.includes(MEMORY_BLOCK_START);
}

export function updateAllProviderFiles(providers?: ProviderName[]): void {
  const targets = providers || (['claude-code', 'gemini', 'openclaw'] as ProviderName[]);

  for (const provider of targets) {
    const paths = PROVIDER_PATHS[provider];
    let mdFile: string | undefined;

    if (provider === 'claude-code' && 'mdFile' in paths) {
      mdFile = paths.mdFile;
    } else if (provider === 'gemini' && 'mdFile' in paths) {
      mdFile = paths.mdFile;
    } else if (provider === 'openclaw' && 'agentsFile' in paths) {
      mdFile = paths.agentsFile;
    } else if (provider === 'codex' && 'skillFile' in paths) {
      mdFile = paths.skillFile;
    }

    if (mdFile && existsSync(dirname(mdFile))) {
      injectMemoryBlock(mdFile);
    }
  }

  updateHotMemoryInDb();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
