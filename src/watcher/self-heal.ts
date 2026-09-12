import { watch, type FSWatcher } from 'chokidar';
import { existsSync, readFileSync } from 'fs';
import { PROVIDER_PATHS, MEMORY_BLOCK_START } from '../config.js';
import { injectMemoryBlock } from '../memory/hot.js';
import { appendFileSync, mkdirSync } from 'fs';
import { LOGS_DIR } from '../config.js';
import { join } from 'path';

let watcher: FSWatcher | null = null;

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [self-heal] ${msg}\n`;
  const logFile = join(LOGS_DIR, 'self-heal.log');

  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(logFile, logLine);
  } catch {
    // silent
  }
}

function checkAndRestore(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes(MEMORY_BLOCK_START)) {
    log(`Memory block missing from ${filePath} - restoring...`);
    injectMemoryBlock(filePath);
    log(`Memory block restored in ${filePath}`);
  }
}

function checkHooksIntact(): void {
  const settingsPath = PROVIDER_PATHS['claude-code'].settingsFile;
  if (!existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks || {};

    const requiredEvents = ['UserPromptSubmit', 'SessionStart', 'SessionEnd', 'PreCompact'];
    let needsRepair = false;

    for (const event of requiredEvents) {
      const eventHooks = hooks[event] || [];
      const hasOurs = eventHooks.some((h: Record<string, unknown>) => {
        const innerHooks = (h.hooks || []) as Array<Record<string, unknown>>;
        return innerHooks.some((hh) =>
          typeof hh.command === 'string' && (hh.command.startsWith('brainbase') || hh.command.startsWith('brainbase')),
        );
      });

      if (!hasOurs) {
        needsRepair = true;
        break;
      }
    }

    if (needsRepair) {
      log(`Hooks missing from settings.json - will be restored on next init`);
    }
  } catch {
    // Corrupted settings - don't touch
  }
}

export function startSelfHealing(): void {
  if (watcher) return;

  const filesToWatch: string[] = [];

  const claudeMd = PROVIDER_PATHS['claude-code'].mdFile;
  if (existsSync(claudeMd)) filesToWatch.push(claudeMd);

  const geminiMd = PROVIDER_PATHS.gemini.mdFile;
  if (existsSync(geminiMd)) filesToWatch.push(geminiMd);

  const settingsJson = PROVIDER_PATHS['claude-code'].settingsFile;
  if (existsSync(settingsJson)) filesToWatch.push(settingsJson);

  if (filesToWatch.length === 0) {
    log('No files to watch for self-healing');
    return;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watcher = watch(filesToWatch, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', (path) => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      if (path.endsWith('.md')) {
        checkAndRestore(path);
      } else if (path.endsWith('settings.json')) {
        checkHooksIntact();
      }
    }, 1000);
  });

  log(`Self-healing watcher started for ${filesToWatch.length} files`);
}

export function stopSelfHealing(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    log('Self-healing watcher stopped');
  }
}
