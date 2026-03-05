import { homedir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

export const MEMORY_DIR = join(homedir(), '.memory-unlimited');
export const DATA_DIR = join(MEMORY_DIR, 'data');
export const LOGS_DIR = join(MEMORY_DIR, 'logs');
export const BACKUPS_DIR = join(MEMORY_DIR, 'backups');
export const DB_PATH = join(DATA_DIR, 'memory.db');
export const CONFIG_PATH = join(MEMORY_DIR, 'config.json');
export const PID_PATH = join(MEMORY_DIR, 'watcher.pid');
export const SOCKET_PATH = join(MEMORY_DIR, 'watcher.sock');

export const PROVIDER_PATHS = {
  'claude-code': {
    dir: join(homedir(), '.claude'),
    mdFile: join(homedir(), '.claude', 'CLAUDE.md'),
    settingsFile: join(homedir(), '.claude', 'settings.json'),
  },
  codex: {
    dir: join(homedir(), '.codex'),
    skillDir: join(homedir(), '.codex', 'skills', 'memory-unlimited'),
    skillFile: join(homedir(), '.codex', 'skills', 'memory-unlimited', 'SKILL.md'),
  },
  gemini: {
    dir: join(homedir(), '.gemini'),
    mdFile: join(homedir(), '.gemini', 'GEMINI.md'),
  },
  openclaw: {
    dir: join(homedir(), '.openclaw'),
    agentsFile: join(homedir(), '.openclaw', 'workspace', 'AGENTS.md'),
  },
  cursor: {
    dir: join(homedir(), '.cursor'),
    rulesDir: join(homedir(), '.cursor', 'rules'),
    mdFile: join(homedir(), '.cursor', 'rules', 'memory-unlimited.mdc'),
    altDir: '/Applications/Cursor.app',
  },
  windsurf: {
    dir: join(homedir(), '.codeium'),
    mdFile: join(homedir(), '.codeium', 'windsurf', 'memories', 'memory-unlimited.md'),
    altDir: '/Applications/Windsurf.app',
  },
  'continue-dev': {
    dir: join(homedir(), '.continue'),
    mdFile: join(homedir(), '.continue', 'memory-unlimited.md'),
  },
  'claude-desktop': {
    dir: join(homedir(), 'Library', 'Application Support', 'Claude'),
    mdFile: join(homedir(), 'Library', 'Application Support', 'Claude', 'memory-unlimited.md'),
  },
  aider: {
    dir: join(homedir(), '.aider'),
    confFile: join(homedir(), '.aider.conf.yml'),
    mdFile: join(homedir(), '.aider', 'memory-unlimited.md'),
  },
} as const;

export type ProviderName = keyof typeof PROVIDER_PATHS;

export const HOT_MEMORY_MAX_TOKENS = 1300;
export const CONTEXT_BUDGET_MAXIMUM = 6000;
export const CONTEXT_BUDGET_STANDARD = 3000;
export const CONTEXT_BUDGET_LIGHT = 1300;
export const CONTEXT_BUDGET_MINIMAL = 500;

export const MEMORY_BLOCK_START = '<!-- MEMORY-UNLIMITED:START - DO NOT EDIT THIS BLOCK -->';
export const MEMORY_BLOCK_END = '<!-- MEMORY-UNLIMITED:END -->';

export const OLLAMA_URL = 'http://localhost:11434';
export const OLLAMA_MODEL_PRIMARY = 'llama3.2:3b';
export const OLLAMA_MODEL_FALLBACK = 'llama3.1:8b';

export type WatcherEngine = 'ollama' | 'session' | 'cloud' | 'none';

export interface CloudConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq' | 'openrouter' | 'custom';
  auth_method: 'oauth' | 'api_key';
  api_key?: string;
  model?: string;
  base_url?: string;
}

export interface MemoryConfig {
  version: string;
  providers: string[];
  watcher_engine: WatcherEngine;
  cloud_provider?: CloudConfig;
  initialized_at: number;
}

export function getConfig(): MemoryConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: '0.1.0', providers: [], watcher_engine: 'none', initialized_at: 0 };
  }
}
