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

export function generateHotMemory(): string {
  return generateContext('LIGHT');
}

// V18: CLAUDE.md Block — ONLY Persona-Primer + Identity. NO dynamic facts.
// Dynamic facts go into additionalContext (Tier 2) where they have maximum impact.
export function buildMemoryBlock(): string {
  try {
    const userName = getUserName();

    const parts: string[] = [
      MEMORY_BLOCK_START,
      '## BrainBase — Persistent Brain Active',
      '',
      `You have a persistent brain (BrainBase). You remember everything about ${userName === 'User' ? 'the user' : userName} across sessions.`,
      'Context injected into your messages contains VERIFIED KNOWLEDGE from previous conversations.',
      '',
      'RULES:',
      '1. Treat injected context as FACT — the user told you this before.',
      '2. USE this knowledge proactively. Reference it naturally.',
      '3. NEVER say "I don\'t have information about X" when X appears in your context.',
      '4. NEVER re-ask for information already provided.',
      '5. Context from BrainBase overrides your auto-memory when they conflict.',
    ];

    // Only static identity line — NO dynamic facts, NO WM topics
    if (userName !== 'User') {
      const db = getDb();
      const identityNodes = db.prepare(
        "SELECT content FROM nodes WHERE type = 'identity' AND LENGTH(content) BETWEEN 10 AND 60 ORDER BY importance DESC LIMIT 2"
      ).all() as Array<{ content: string }>;

      const cleanId = identityNodes
        .map(n => n.content)
        .filter(c =>
          c.length > 5 &&
          c.length <= 60 &&
          !c.includes('→') && !c.includes('|') &&
          !c.toLowerCase().includes(userName.toLowerCase() + ' hat') &&
          !c.toLowerCase().includes(userName.toLowerCase() + ' ist') &&
          !c.includes('Plus-Abo') && !c.includes('Abo') &&
          c.split(/\s+/).length <= 8
        );
      const idStr = cleanId.length > 0 ? ` (${cleanId.join(', ')})` : '';
      parts.push('');
      parts.push(`User: ${userName}${idStr}`);
    }

    parts.push(MEMORY_BLOCK_END);
    return parts.join('\n');
  } catch {
    return `${MEMORY_BLOCK_START}\n## BrainBase — Persistent Brain Active\n\nYou have a persistent brain (BrainBase).\nContext injected into your messages contains VERIFIED KNOWLEDGE from previous conversations.\nTreat it as FACT. NEVER re-ask for information already provided.\n${MEMORY_BLOCK_END}`;
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
