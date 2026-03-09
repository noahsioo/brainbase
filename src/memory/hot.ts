import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  PROVIDER_PATHS,
  MEMORY_BLOCK_START,
  MEMORY_BLOCK_END,
  getConfig,
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


// V18 Phase 8: Provider-specific blocks with Persona-Primer + MCP instruction
export function buildProviderBlock(provider: ProviderName): string {
  if (provider === 'claude-code') return buildMemoryBlock();

  const userName = getUserName();
  const userDisplay = userName === 'User' ? 'the user' : userName;
  const userLine = userName !== 'User' ? `\nUser: ${userName}` : '';

  const coreRules = [
    `You have a persistent brain (BrainBase). You remember everything about ${userDisplay} across sessions.`,
    '',
    'RULES:',
    '1. Before responding to ANY message, call memory_process_message with the user\'s message.',
    '2. The returned context is VERIFIED KNOWLEDGE from previous conversations — treat it as FACT.',
    '3. USE this knowledge proactively. Reference it naturally.',
    '4. NEVER say "I don\'t have information about X" when X appears in the context.',
    '5. NEVER re-ask for information the context already provides.',
  ].join('\n');

  switch (provider) {
    case 'cursor':
      return `---\ndescription: BrainBase - persistent brain across sessions\nglobs:\nalwaysApply: true\n---\n# BrainBase — Persistent Brain Active\n\n${coreRules}${userLine}\n`;

    case 'codex':
      return `---\nname: brainbase\ndescription: Persistent brain — remembers everything across sessions\n---\n# BrainBase — Persistent Brain Active\n\n${coreRules}${userLine}\n`;

    default:
      return `# BrainBase — Persistent Brain Active\n\n${coreRules}${userLine}\n`;
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
  const config = getConfig();
  const targets = providers || (config.providers as ProviderName[]) || [];

  for (const provider of targets) {
    try {
      if (provider === 'claude-code') {
        // Claude Code: HTML-comment block (hooks handle dynamic context)
        const paths = PROVIDER_PATHS['claude-code'];
        if (existsSync(dirname(paths.mdFile))) {
          injectMemoryBlock(paths.mdFile);
        }
        continue;
      }

      const filePath = getProviderFilePath(provider);
      if (!filePath || !existsSync(dirname(filePath))) continue;

      const block = buildProviderBlock(provider);
      writeProviderBlock(filePath, block, provider);
    } catch { /* non-fatal */ }
  }

  updateHotMemoryInDb();
}

function getProviderFilePath(provider: ProviderName): string | undefined {
  const paths = PROVIDER_PATHS[provider];
  if ('skillFile' in paths) return paths.skillFile;
  if ('agentsFile' in paths) return paths.agentsFile;
  if ('mdFile' in paths) return paths.mdFile;
  return undefined;
}

// Shared files: Gemini's GEMINI.md, OpenClaw's AGENTS.md — contain user content, inject/replace
const SHARED_FILE_PROVIDERS = new Set<string>(['gemini', 'openclaw']);

function writeProviderBlock(filePath: string, block: string, provider: ProviderName): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (SHARED_FILE_PROVIDERS.has(provider)) {
    // Shared file: use BRAINBASE markers to inject/replace without destroying user content
    const markedBlock = `${MEMORY_BLOCK_START}\n${block}${MEMORY_BLOCK_END}`;

    let existing = '';
    if (existsSync(filePath)) {
      existing = readFileSync(filePath, 'utf-8');
    }

    // Remove ALL old BrainBase/Memory-Unlimited marker blocks (any format)
    const oldBlockRegex = /\n?<!-- (?:MEMORY-UNLIMITED|BRAINBASE):START[^>]*>[\s\S]*?(?:MEMORY-UNLIMITED|BRAINBASE):END\s*-->\n?/g;
    existing = existing.replace(oldBlockRegex, '');

    // Remove old CLEAN_INSTRUCTION style blocks (# BrainBase...no memory/repeat myself)
    const oldInstructionRegex = /\n?# BrainBase\b[^\n]*\n(?:(?!^#\s)[^\n]*\n)*?[^\n]*(?:without it you|don't ask me to repeat)[^\n]*\n?/gm;
    existing = existing.replace(oldInstructionRegex, '');

    // Remove unmarked V18 Phase 8 blocks (from earlier runs without markers)
    const v18UnmarkedRegex = /\n?# BrainBase — Persistent Brain Active\n[\s\S]*?User: [^\n]*\n?/g;
    existing = existing.replace(v18UnmarkedRegex, '');

    existing = existing.trim();

    const separator = existing ? '\n\n' : '';
    writeFileSync(filePath, existing + separator + markedBlock + '\n', 'utf-8');
  } else {
    // BrainBase-specific file (cursor brainbase.mdc, codex SKILL.md, etc.): overwrite
    writeFileSync(filePath, block, 'utf-8');
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
