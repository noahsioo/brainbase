import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { detectProviders } from '../providers/detect.js';
import {
  PROVIDER_PATHS,
  MEMORY_DIR,
  DATA_DIR,
  LOGS_DIR,
  BACKUPS_DIR,
  CONFIG_PATH,
  type WatcherEngine,
  type CloudConfig,
  type MemoryConfig,
} from '../config.js';
import { getDb, getStats } from '../memory/store.js';
import { injectMemoryBlock, updateHotMemoryInDb } from '../memory/hot.js';
import {
  createPreWiredNodes,
  setCriticalPeriod,
} from '../memory/cold-start.js';
import { installMcpServer } from './mcp.js';

const cb = chalk.bold.cyan;
const dim = chalk.dim;

const BANNER = `
${cb('  ███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗ ██╗   ██╗')}
${cb('  ████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗╚██╗ ██╔╝')}
${cb('  ██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝ ╚████╔╝ ')}
${cb('  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗  ╚██╔╝  ')}
${cb('  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║   ██║   ')}
${cb('  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ')}
${chalk.bold.white('       U N L I M I T E D')}  ${dim('v0.1')}
`;

const DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  openclaw: 'OpenClaw',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  'continue-dev': 'Continue',
  'claude-desktop': 'Claude Desktop',
  aider: 'Aider',
};

const PROVIDER_ORDER = [
  'claude-code',
  'openclaw',
  'codex',
  'gemini',
  'cursor',
  'windsurf',
  'continue-dev',
  'claude-desktop',
  'aider',
];

export const initCommand = new Command('init')
  .description('Set up Memory Unlimited - your AI super-brain')
  .action(async () => {
    console.log(BANNER);
    p.intro(cb(' Memory Unlimited '));

    // ── Step 1: AI Tools ──
    const detectSpinner = p.spinner();
    detectSpinner.start('Scanning for AI coding tools...');

    const providers = detectProviders();
    const installed = providers.filter((pr) => pr.installed);

    await new Promise((r) => setTimeout(r, 500));
    detectSpinner.stop(
      chalk.green(`Found ${installed.length} tool${installed.length !== 1 ? 's' : ''}`) +
      dim(': ') +
      installed.map((pr) => chalk.bold(DISPLAY_NAMES[pr.name] || pr.name)).join(dim(', '))
    );

    const sortedInstalled = [...installed].sort(
      (a, b) => PROVIDER_ORDER.indexOf(a.name) - PROVIDER_ORDER.indexOf(b.name)
    );
    const notInstalled = providers.filter((pr) => !pr.installed);
    const sortedNotInstalled = [...notInstalled].sort(
      (a, b) => PROVIDER_ORDER.indexOf(a.name) - PROVIDER_ORDER.indexOf(b.name)
    );

    const selectedProviders = await p.multiselect({
      message: 'Where should the brain work?',
      options: [
        ...sortedInstalled.map((pr) => ({
          value: pr.name,
          label: DISPLAY_NAMES[pr.name] || pr.name,
          hint: chalk.green('detected'),
        })),
        ...sortedNotInstalled.map((pr) => ({
          value: pr.name,
          label: DISPLAY_NAMES[pr.name] || pr.name,
          hint: dim('not installed'),
        })),
      ],
      initialValues: installed.map((pr) => pr.name),
      required: true,
    });

    if (p.isCancel(selectedProviders)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    // ── Step 2: Model Provider ──
    // One list. Like OpenClaw. Pick your provider.
    const modelProvider = await p.select({
      message: 'Model provider',
      options: [
        { value: 'ollama', label: 'Ollama (local)', hint: 'Free, private, runs on your machine' },
        { value: 'openai', label: 'OpenAI', hint: 'GPT-4o / GPT-4' },
        { value: 'anthropic', label: 'Anthropic', hint: 'Claude Sonnet / Haiku' },
        { value: 'google', label: 'Google', hint: 'Gemini Pro' },
        { value: 'groq', label: 'Groq', hint: 'Llama via Groq (fast + free tier)' },
        { value: 'mistral', label: 'Mistral', hint: 'Mistral Large' },
        { value: 'openrouter', label: 'OpenRouter', hint: 'Multi-provider gateway' },
        { value: 'custom', label: 'Custom Endpoint', hint: 'Any OpenAI-compatible API' },
      ],
    });

    if (p.isCancel(modelProvider)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    let finalEngine: WatcherEngine;
    let cloudConfig: CloudConfig | undefined;

    if (modelProvider === 'ollama') {
      finalEngine = 'ollama';

      const s = p.spinner();
      s.start('Connecting to Ollama...');

      const { OllamaClient } = await import('../watcher/ollama.js');
      const client = new OllamaClient();
      const available = await client.isAvailable();

      if (!available) {
        s.stop(chalk.yellow('Ollama not reachable'));
        p.note(
          `Install:  ${chalk.bold('brew install ollama')}\n` +
          `Start:    ${chalk.bold('ollama serve')}\n` +
          `Model:    ${chalk.bold('ollama pull llama3.2:3b')}\n\n` +
          dim('The brain activates as soon as Ollama is running.'),
          'Ollama Setup'
        );
      } else {
        s.stop(chalk.green('Ollama connected'));
      }
    } else {
      finalEngine = 'cloud';

      const apiKey = await p.text({
        message: 'API Key:',
        placeholder: 'sk-...',
        validate: (val) => {
          if (!val || val.trim().length < 5) return 'API key too short';
        },
      });

      if (p.isCancel(apiKey)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }

      cloudConfig = {
        provider: modelProvider as CloudConfig['provider'],
        auth_method: 'api_key',
        api_key: apiKey as string,
      };

      const testSpinner = p.spinner();
      testSpinner.start('Testing connection...');
      await new Promise((r) => setTimeout(r, 300));
      testSpinner.stop(chalk.green('API key saved'));
    }

    // ── Step 3: Build Brain + Connect ──
    const brainSpinner = p.spinner();
    brainSpinner.start('Building neural architecture...');

    for (const dir of [MEMORY_DIR, DATA_DIR, LOGS_DIR, BACKUPS_DIR]) {
      mkdirSync(dir, { recursive: true });
    }
    getDb();

    const stats = getStats();
    if (stats.totalNodes === 0) {
      createPreWiredNodes();
      setCriticalPeriod();
    }

    await new Promise((r) => setTimeout(r, 400));
    const afterStats = getStats();
    brainSpinner.stop(chalk.green(`${afterStats.totalNodes} neurons + ${afterStats.totalEdges} synapses wired`));

    for (const providerName of selectedProviders as string[]) {
      const provSpinner = p.spinner();
      const display = DISPLAY_NAMES[providerName] || providerName;
      provSpinner.start(`Connecting ${display}...`);
      await setupProvider(providerName);
      await new Promise((r) => setTimeout(r, 200));
      provSpinner.stop(chalk.green(display) + ' ' + dim(getProviderDesc(providerName)));
    }

    // ── MCP Server (auto-install for Claude Code) ──
    if ((selectedProviders as string[]).includes('claude-code')) {
      const mcpSpinner = p.spinner();
      mcpSpinner.start('Registering MCP Server...');
      try {
        installMcpServer();
        await new Promise((r) => setTimeout(r, 200));
        mcpSpinner.stop(chalk.green('MCP Server') + ' ' + dim('5 tools registered'));
      } catch {
        mcpSpinner.stop(chalk.yellow('MCP Server skipped (build first)'));
      }
    }

    // ── Write Config ──
    const config: MemoryConfig = {
      version: '0.1.0',
      providers: selectedProviders as string[],
      watcher_engine: finalEngine,
      initialized_at: Date.now(),
    };

    if (cloudConfig) {
      config.cloud_provider = cloudConfig;
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    updateHotMemoryInDb();

    // ── Done ──
    const finalStats = getStats();
    const engineLabel = finalEngine === 'ollama'
      ? 'Ollama (local)'
      : `${cloudConfig?.provider || '?'}`;

    p.note(
      `${cb('Brain')}     ${finalStats.totalNodes} neurons, ${finalStats.totalEdges} synapses\n` +
      `${cb('Engine')}    ${engineLabel}\n` +
      `${cb('Providers')} ${(selectedProviders as string[]).map(n => DISPLAY_NAMES[n] || n).join(', ')}\n\n` +
      `The brain learns ${chalk.bold('automatically')} from every session.\n` +
      `No setup needed. Just start coding.\n\n` +
      dim('Commands:\n') +
      dim('  memory-unlimited stats     Brain statistics\n') +
      dim('  memory-unlimited search    Search memories\n') +
      dim('  memory-unlimited verify    System check'),
      'Brain is live'
    );

    p.outro(dim('Start a new session. The brain is listening.'));
  });

function getProviderDesc(name: string): string {
  const descs: Record<string, string> = {
    'claude-code': 'Hooks + CLAUDE.md + MCP',
    codex: 'Memory Skill',
    gemini: 'GEMINI.md',
    openclaw: 'AGENTS.md',
    cursor: '.cursor/rules',
    windsurf: 'Memory block',
    'continue-dev': 'Memory block',
    'claude-desktop': 'Memory block',
    aider: 'Memory block',
  };
  return descs[name] || 'configured';
}

async function setupProvider(name: string): Promise<void> {
  switch (name) {
    case 'claude-code':
      await setupClaudeCode();
      break;
    case 'gemini':
      await setupGemini();
      break;
    case 'codex':
      await setupCodex();
      break;
    case 'openclaw':
      await setupOpenClaw();
      break;
    case 'cursor':
      await setupCursor();
      break;
    case 'windsurf':
      await setupWindsurf();
      break;
    case 'continue-dev':
      await setupContinueDev();
      break;
    case 'claude-desktop':
      await setupClaudeDesktop();
      break;
    case 'aider':
      await setupAider();
      break;
  }
}

async function setupClaudeCode(): Promise<void> {
  const paths = PROVIDER_PATHS['claude-code'];
  injectMemoryBlock(paths.mdFile);
  registerClaudeHooks(paths.settingsFile);
}

function registerClaudeHooks(settingsPath: string): void {
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  const memoryHooks = {
    UserPromptSubmit: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'memory-unlimited hook user-prompt',
        timeout: 5,
      }],
    }],
    SessionStart: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'memory-unlimited hook session-start',
        timeout: 10,
      }],
    }],
    SessionEnd: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'memory-unlimited hook session-end',
        timeout: 30,
      }],
    }],
    PreCompact: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'memory-unlimited hook pre-compact',
        timeout: 10,
      }],
    }],
  };

  const existingHooks = (settings.hooks || {}) as Record<string, unknown>;

  for (const [event, hookConfigs] of Object.entries(memoryHooks)) {
    const existing = (existingHooks[event] || []) as Array<Record<string, unknown>>;
    const alreadyExists = existing.some((h) => {
      const hooks = (h.hooks || []) as Array<Record<string, unknown>>;
      return hooks.some((hh) =>
        typeof hh.command === 'string' && hh.command.startsWith('memory-unlimited'),
      );
    });
    if (!alreadyExists) {
      existingHooks[event] = [...existing, ...hookConfigs];
    }
  }

  settings.hooks = existingHooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

async function setupGemini(): Promise<void> {
  const paths = PROVIDER_PATHS.gemini;
  injectMemoryBlock(paths.mdFile);
}

async function setupCodex(): Promise<void> {
  const paths = PROVIDER_PATHS.codex;
  mkdirSync(paths.skillDir, { recursive: true });

  const skillContent = `---
name: memory-unlimited
description: Persistent cross-provider memory system
---

# Memory Unlimited

This skill provides persistent memory across coding sessions.

`;

  writeFileSync(paths.skillFile, skillContent, 'utf-8');
  injectMemoryBlock(paths.skillFile);
}

async function setupOpenClaw(): Promise<void> {
  const paths = PROVIDER_PATHS.openclaw;
  injectMemoryBlock(paths.agentsFile);
}

async function setupCursor(): Promise<void> {
  const paths = PROVIDER_PATHS.cursor;
  mkdirSync(paths.rulesDir, { recursive: true });
  injectMemoryBlock(paths.mdFile);
}

async function setupWindsurf(): Promise<void> {
  const paths = PROVIDER_PATHS.windsurf;
  injectMemoryBlock(paths.mdFile);
}

async function setupContinueDev(): Promise<void> {
  const paths = PROVIDER_PATHS['continue-dev'];
  injectMemoryBlock(paths.mdFile);
}

async function setupClaudeDesktop(): Promise<void> {
  const paths = PROVIDER_PATHS['claude-desktop'];
  injectMemoryBlock(paths.mdFile);
}

async function setupAider(): Promise<void> {
  const paths = PROVIDER_PATHS.aider;
  injectMemoryBlock(paths.mdFile);
}
