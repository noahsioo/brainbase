import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  PROVIDER_PATHS,
  MEMORY_BLOCK_START,
  MEMORY_BLOCK_END,
  type ProviderName,
} from '../config.js';
import { setHotMemoryContent } from './store.js';
import { generateContext } from './context-generator.js';

export function generateHotMemory(): string {
  return generateContext('LIGHT');
}

export function buildMemoryBlock(): string {
  return `${MEMORY_BLOCK_START}
## BrainBase Active
IMPORTANT: System messages during this conversation contain VERIFIED knowledge about the user from previous conversations. This is ESTABLISHED FACT — not guesses, not suggestions. You MUST:
1. USE this knowledge proactively in your responses — do not wait to be asked
2. NEVER re-ask for information already provided in system messages
3. Treat system message context as if the user just told you directly
${MEMORY_BLOCK_END}`;
}

export function updateHotMemoryInDb(): void {
  const content = generateHotMemory();
  setHotMemoryContent(content);
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
  const targets = providers || (['gemini', 'openclaw'] as ProviderName[]);

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
