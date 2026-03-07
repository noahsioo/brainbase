import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';

export const MEMORY_DIR = join(homedir(), '.brainbase');
export const DATA_DIR = join(MEMORY_DIR, 'data');
export const LOGS_DIR = join(MEMORY_DIR, 'logs');
export const BACKUPS_DIR = join(MEMORY_DIR, 'backups');
export const DB_PATH = join(DATA_DIR, 'memory.db');
export const CONFIG_PATH = join(MEMORY_DIR, 'config.json');
export const PID_PATH = join(MEMORY_DIR, 'watcher.pid');
export const PAUSE_PATH = join(MEMORY_DIR, 'paused');
export const SOCKET_PATH = join(MEMORY_DIR, 'watcher.sock');

export const PROVIDER_PATHS = {
  'claude-code': {
    dir: join(homedir(), '.claude'),
    mdFile: join(homedir(), '.claude', 'CLAUDE.md'),
    settingsFile: join(homedir(), '.claude', 'settings.json'),
  },
  codex: {
    dir: join(homedir(), '.codex'),
    skillDir: join(homedir(), '.codex', 'skills', 'brainbase'),
    skillFile: join(homedir(), '.codex', 'skills', 'brainbase', 'SKILL.md'),
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
    mdFile: join(homedir(), '.cursor', 'rules', 'brainbase.mdc'),
    altDir: '/Applications/Cursor.app',
  },
  windsurf: {
    dir: join(homedir(), '.codeium'),
    mdFile: join(homedir(), '.codeium', 'windsurf', 'memories', 'brainbase.md'),
    altDir: '/Applications/Windsurf.app',
  },
  'continue-dev': {
    dir: join(homedir(), '.continue'),
    mdFile: join(homedir(), '.continue', 'brainbase.md'),
  },
  'claude-desktop': {
    dir: join(homedir(), 'Library', 'Application Support', 'Claude'),
    mdFile: join(homedir(), 'Library', 'Application Support', 'Claude', 'brainbase.md'),
  },
  aider: {
    dir: join(homedir(), '.aider'),
    confFile: join(homedir(), '.aider.conf.yml'),
    mdFile: join(homedir(), '.aider', 'brainbase.md'),
  },
  goose: {
    dir: join(homedir(), '.config', 'goose'),
  },
  cline: {
    dir: join(homedir(), '.cline'),
    altDir: join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
  },
  'roo-code': {
    dir: join(homedir(), '.roo'),
    altDir: join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline'),
  },
  zed: {
    dir: join(homedir(), '.config', 'zed'),
    altDir: '/Applications/Zed.app',
  },
  amp: {
    dir: join(homedir(), '.amp'),
  },
} as const;

export type ProviderName = keyof typeof PROVIDER_PATHS;

export type McpFormat = 'mcpServers' | 'continue' | 'gemini-cli' | 'codex-cli' | 'zed' | 'cline' | 'roo-code';

export const MCP_CONFIG_PATHS: Record<string, { file: string; format: McpFormat }> = {
  'claude-code': {
    file: join(homedir(), '.claude', 'settings.json'),
    format: 'mcpServers',
  },
  gemini: {
    file: join(homedir(), '.gemini', 'settings.json'),
    format: 'gemini-cli',
  },
  codex: {
    file: join(homedir(), '.codex', 'config.toml'),
    format: 'codex-cli',
  },
  cursor: {
    file: join(homedir(), '.cursor', 'mcp.json'),
    format: 'mcpServers',
  },
  windsurf: {
    file: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    format: 'mcpServers',
  },
  'continue-dev': {
    file: join(homedir(), '.continue', 'config.json'),
    format: 'continue',
  },
  'claude-desktop': {
    file: join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    format: 'mcpServers',
  },
  goose: {
    file: join(homedir(), '.config', 'goose', 'config.yaml'),
    format: 'mcpServers',
  },
  cline: {
    file: join(homedir(), '.cline', 'cline_mcp_settings.json'),
    format: 'cline',
  },
  'roo-code': {
    file: join(homedir(), '.roo', 'roo_mcp_settings.json'),
    format: 'roo-code',
  },
  zed: {
    file: join(homedir(), '.config', 'zed', 'settings.json'),
    format: 'zed',
  },
  amp: {
    file: join(homedir(), '.amp', 'config.json'),
    format: 'mcpServers',
  },
};

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

export type CloudProvider =
  | 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq' | 'openrouter'
  | 'xai' | 'together' | 'deepseek' | 'huggingface' | 'chutes'
  | 'volcengine' | 'byteplus' | 'minimax' | 'moonshot' | 'qwen'
  | 'cerebras' | 'litellm' | 'cloudflare' | 'venice' | 'kilocode'
  | 'qianfan' | 'vercel-ai' | 'synthetic' | 'xiaomi'
  | 'vllm' | 'zai' | 'copilot' | 'opencode-zen'
  | 'custom';

export interface CloudConfig {
  provider: CloudProvider;
  auth_method: 'api_key' | 'env_var';
  api_key?: string;
  env_var_name?: string;
  model?: string;
  base_url?: string;
  api_style?: 'openai' | 'anthropic';
}

export interface MemoryConfig {
  version: string;
  providers: string[];
  watcher_engine: WatcherEngine;
  cloud_provider?: CloudConfig;
  initialized_at: number;
}

export function isPaused(): boolean {
  return existsSync(PAUSE_PATH);
}

export function setPaused(paused: boolean): void {
  if (paused) {
    writeFileSync(PAUSE_PATH, new Date().toISOString());
  } else {
    if (existsSync(PAUSE_PATH)) unlinkSync(PAUSE_PATH);
  }
}

export function getConfig(): MemoryConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: '0.1.0', providers: [], watcher_engine: 'none', initialized_at: 0 };
  }
}
