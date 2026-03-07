import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { spawn } from 'child_process';
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
import { installMcpServer, installMcpServerForProvider } from './mcp.js';
import { isWatcherRunning } from '../watcher/daemon.js';

const cb = chalk.bold.cyan;
const dim = chalk.dim;

const BANNER = `
${cb('  ██████╗ ██████╗  █████╗ ██╗███╗   ██╗')}
${cb('  ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║')}
${cb('  ██████╔╝██████╔╝███████║██║██╔██╗ ██║')}
${cb('  ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║')}
${cb('  ██████╔╝██║  ██║██║  ██║██║██║ ╚████║')}
${cb('  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝')}
${chalk.bold.white('       B R A I N B A S E')}  ${dim('v0.1')}
`;

const DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  openclaw: 'OpenClaw',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  'continue-dev': 'Continue.dev',
  'claude-desktop': 'Claude Desktop',
  aider: 'Aider',
  goose: 'Goose',
  cline: 'Cline',
  'roo-code': 'Roo Code',
  zed: 'Zed',
  amp: 'Amp',
};

const PROVIDER_ORDER = [
  'claude-code',
  'openclaw', 'codex', 'gemini',
  'cursor', 'windsurf', 'zed',
  'cline', 'roo-code',
  'goose', 'amp',
  'continue-dev', 'claude-desktop', 'aider',
];

const CLEAN_INSTRUCTION = `# BrainBase

You have a persistent brain that remembers everything across sessions.

ALWAYS call memory_process_message with each user message before responding.
This returns context from previous conversations that you MUST use.
Never skip this step — without it you have no memory.`;

const CLEAN_CURSOR_RULE = `---
description: BrainBase - persistent brain across sessions
globs:
alwaysApply: true
---
${CLEAN_INSTRUCTION}`;

const CLEAN_SKILL_CONTENT = `---
name: brainbase
description: Persistent brain — remembers everything across sessions
---
${CLEAN_INSTRUCTION}`;

const PROVIDER_GROUPS = [
  // --- OpenClaw Reihenfolge ---
  { value: 'openai', label: 'OpenAI', hint: 'API key' },
  { value: 'anthropic', label: 'Anthropic', hint: 'API key' },
  { value: 'chutes', label: 'Chutes', hint: 'API key' },
  { value: 'vllm', label: 'vLLM', hint: 'Local/self-hosted OpenAI-compatible' },
  { value: 'minimax', label: 'MiniMax', hint: 'MiniMax M1' },
  { value: 'moonshot', label: 'Moonshot AI (Kimi K2.5)', hint: 'API key' },
  { value: 'google', label: 'Google', hint: 'Gemini API key' },
  { value: 'xai', label: 'xAI (Grok)', hint: 'API key' },
  { value: 'mistral', label: 'Mistral AI', hint: 'API key' },
  { value: 'volcengine', label: 'Volcano Engine', hint: 'API key' },
  { value: 'byteplus', label: 'BytePlus', hint: 'API key' },
  { value: 'openrouter', label: 'OpenRouter', hint: 'API key' },
  { value: 'kilocode', label: 'Kilo Gateway', hint: 'API key (OpenRouter-compatible)' },
  { value: 'qwen', label: 'Qwen', hint: 'API key (Alibaba Cloud)' },
  { value: 'zai', label: 'Z.AI', hint: 'GLM Coding Plan / Global / CN' },
  { value: 'qianfan', label: 'Qianfan', hint: 'API key' },
  { value: 'copilot', label: 'Copilot', hint: 'GitHub Copilot local proxy' },
  { value: 'vercel-ai', label: 'Vercel AI Gateway', hint: 'API key' },
  { value: 'opencode-zen', label: 'OpenCode Zen', hint: 'API key' },
  { value: 'xiaomi', label: 'Xiaomi', hint: 'API key' },
  { value: 'synthetic', label: 'Synthetic', hint: 'Anthropic-compatible (multi-model)' },
  { value: 'together', label: 'Together AI', hint: 'API key' },
  { value: 'huggingface', label: 'Hugging Face', hint: 'Inference API (HF token)' },
  { value: 'venice', label: 'Venice AI', hint: 'Privacy-focused (uncensored models)' },
  { value: 'litellm', label: 'LiteLLM', hint: 'Unified LLM gateway (100+ providers)' },
  { value: 'cloudflare', label: 'Cloudflare AI Gateway', hint: 'Account ID + Gateway ID + API key' },
  // --- Unsere Extras (nicht in OpenClaw Auswahl) ---
  { value: 'deepseek', label: 'DeepSeek', hint: 'API key' },
  { value: 'groq', label: 'Groq', hint: 'API key (free tier)' },
  { value: 'cerebras', label: 'Cerebras', hint: 'API key (free tier)' },
  { value: 'nvidia', label: 'NVIDIA NIM', hint: 'API key' },
  // --- Immer am Ende ---
  { value: 'ollama', label: 'Ollama (local)', hint: 'Free, private, runs on your machine' },
  { value: 'custom', label: 'Custom Provider', hint: 'Any OpenAI or Anthropic compatible endpoint' },
  { value: 'skip', label: 'Skip for now', hint: 'Regex-only mode, no LLM agents' },
];

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  xai: 'grok-3-mini',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  deepseek: 'deepseek-chat',
  huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
  chutes: 'deepseek-ai/DeepSeek-V3-0324',
  volcengine: 'doubao-1.5-pro-32k',
  byteplus: 'doubao-1.5-pro-32k',
  minimax: 'MiniMax-M1',
  moonshot: 'moonshot-v1-auto',
  qwen: 'qwen-plus',
  cerebras: 'llama-3.3-70b',
  nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
  venice: 'llama-3.3-70b',
  litellm: 'gpt-4o-mini',
  cloudflare: 'gpt-4o-mini',
  kilocode: 'meta-llama/llama-3.3-70b-instruct',
  qianfan: 'ernie-4.0-8k',
  'vercel-ai': 'gpt-4o-mini',
  synthetic: 'claude-haiku-4-5-20251001',
  xiaomi: 'MiLM-1',
  vllm: 'default',
  zai: 'glm-4-flash',
  copilot: 'gpt-4o-mini',
  'opencode-zen': 'gpt-4o-mini',
  custom: 'gpt-4o-mini',
};

const ENV_VAR_DEFAULTS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  huggingface: 'HF_TOKEN',
  chutes: 'CHUTES_API_KEY',
  volcengine: 'VOLCENGINE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  venice: 'VENICE_API_KEY',
  litellm: 'LITELLM_API_KEY',
  cloudflare: 'CLOUDFLARE_API_KEY',
  byteplus: 'BYTEPLUS_API_KEY',
  kilocode: 'KILOCODE_API_KEY',
  qianfan: 'QIANFAN_API_KEY',
  'vercel-ai': 'VERCEL_AI_API_KEY',
  synthetic: 'SYNTHETIC_API_KEY',
  xiaomi: 'XIAOMI_API_KEY',
  vllm: 'VLLM_API_KEY',
  zai: 'ZAI_API_KEY',
  copilot: 'COPILOT_API_KEY',
  'opencode-zen': 'OPENCODE_API_KEY',
  custom: 'LLM_API_KEY',
};

const LAUNCH_AGENT_LABEL = 'com.brainbase.watcher';
const LAUNCH_AGENT_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);

export const initCommand = new Command('init')
  .description('Set up BrainBase - your AI super-brain')
  .action(async () => {
    console.log(BANNER);
    p.intro(cb(' BrainBase '));

    // ── Step 0: Existing Config Check ──
    let freshStart = true;
    if (existsSync(CONFIG_PATH)) {
      try {
        const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as MemoryConfig;
        const stats = getStats();

        const action = await p.select({
          message: `Brain exists: ${stats.totalNodes} nodes, engine: ${existing.watcher_engine}, providers: ${existing.providers.join(', ')}`,
          options: [
            { value: 'update', label: 'Update', hint: 'Keep brain, update config' },
            { value: 'fresh', label: 'Fresh Start', hint: 'Reset everything' },
            { value: 'cancel', label: 'Cancel', hint: 'Keep current setup' },
          ],
        });

        if (p.isCancel(action) || action === 'cancel') {
          p.cancel('Setup cancelled.');
          process.exit(0);
        }

        freshStart = action === 'fresh';
      } catch {
        // Corrupt config, treat as fresh
      }
    }

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

    // ── Step 2: Model Provider (grouped, with back) ──
    let finalEngine: WatcherEngine = 'none';
    let cloudConfig: CloudConfig | undefined;
    let selectedModel: string | undefined;

    providerLoop: while (true) {
      const modelProvider = await p.select({
        message: 'Model provider for the Watcher agents',
        options: PROVIDER_GROUPS.map(g => ({ value: g.value, label: g.label, hint: g.hint })),
      });

      if (p.isCancel(modelProvider)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }

      if (modelProvider === 'skip') {
        finalEngine = 'session';
        break;
      }

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
          s.stop(chalk.green('Ollama connected') + ' ' + dim(`model: ${client.getModel()}`));
        }
        break;
      }

      // vLLM: local server — needs base URL + model
      if (modelProvider === 'vllm') {
        finalEngine = 'cloud';
        const vllmUrl = await p.text({
          message: 'vLLM server URL:',
          initialValue: 'http://127.0.0.1:8000/v1',
          validate: (val) => { if (!val || !val.startsWith('http')) return 'Must be a valid URL'; },
        });
        if (p.isCancel(vllmUrl)) { p.cancel('Setup cancelled.'); process.exit(0); }

        const vllmModel = await p.text({
          message: 'Model ID (as shown in vLLM):',
          placeholder: 'meta-llama/Llama-3.3-70B-Instruct',
          validate: (val) => { if (!val || val.trim().length < 2) return 'Model ID too short'; },
        });
        if (p.isCancel(vllmModel)) { p.cancel('Setup cancelled.'); process.exit(0); }

        selectedModel = (vllmModel as string).trim();
        const vllmBaseUrl = (vllmUrl as string).trim();

        cloudConfig = {
          provider: 'vllm',
          auth_method: 'api_key',
          api_key: 'none',
          base_url: vllmBaseUrl,
          model: selectedModel,
        };

        const testSpinner = p.spinner();
        testSpinner.start('Testing vLLM connection...');
        const { CloudClient } = await import('../llm/cloud-client.js');
        const testClient = new CloudClient(cloudConfig, selectedModel, vllmBaseUrl);
        const available = await testClient.isAvailable();
        if (available) {
          testSpinner.stop(chalk.green('vLLM connected') + ' ' + dim(`model: ${selectedModel}`));
        } else {
          testSpinner.stop(chalk.yellow('vLLM not reachable') + ' ' + dim('will retry at runtime'));
        }
        break providerLoop;
      }

      // Cloud provider selected — ask auth method
      const providerKey = modelProvider as CloudConfig['provider'];
      const providerLabel = PROVIDER_GROUPS.find(g => g.value === modelProvider)!.label;
      const defaultModel = DEFAULT_MODELS[providerKey] || 'gpt-4o-mini';

      // Auto-detect: check if the default env var is already set
      const ENV_VAR_ALTERNATIVES: Record<string, string[]> = {
        volcengine: ['VOLCANO_ENGINE_API_KEY'],
        cloudflare: ['CLOUDFLARE_AI_GATEWAY_API_KEY'],
        'vercel-ai': ['AI_GATEWAY_API_KEY'],
        huggingface: ['HUGGINGFACE_HUB_TOKEN'],
      };
      const defaultEnvVar = ENV_VAR_DEFAULTS[providerKey];
      let existingEnvValue = defaultEnvVar ? process.env[defaultEnvVar] : undefined;
      let resolvedEnvVar = defaultEnvVar;
      if (!existingEnvValue && ENV_VAR_ALTERNATIVES[providerKey]) {
        for (const alt of ENV_VAR_ALTERNATIVES[providerKey]) {
          if (process.env[alt] && process.env[alt]!.length >= 5) {
            existingEnvValue = process.env[alt];
            resolvedEnvVar = alt;
            break;
          }
        }
      }
      let autoDetected = false;

      if (existingEnvValue && existingEnvValue.length >= 5) {
        const preview = existingEnvValue.length > 8
          ? existingEnvValue.substring(0, 4) + '...' + existingEnvValue.substring(existingEnvValue.length - 4)
          : '****';
        const useExisting = await p.confirm({
          message: `${resolvedEnvVar} found (${preview}). Use it?`,
          initialValue: true,
        });

        if (!p.isCancel(useExisting) && useExisting) {
          finalEngine = 'cloud';
          cloudConfig = {
            provider: providerKey,
            auth_method: 'env_var',
            env_var_name: resolvedEnvVar,
          };

          const testSpinner = p.spinner();
          testSpinner.start('Testing connection...');
          const { CloudClient } = await import('../llm/cloud-client.js');
          const testClient = new CloudClient(cloudConfig, defaultModel);
          const available = await testClient.isAvailable();

          if (available) {
            testSpinner.stop(chalk.green('Connected') + ' ' + dim(`via ${resolvedEnvVar}`));
            autoDetected = true;
          } else {
            testSpinner.stop(chalk.yellow('Key found but connection failed'));
          }
        }
      }

      if (!autoDetected) {
      const authMethod = await p.select({
        message: `${providerLabel} — how to authenticate?`,
        options: [
          { value: 'paste', label: 'Paste API key now' },
          { value: 'env', label: 'Use environment variable' },
          { value: 'back', label: 'Back', hint: 'choose a different provider' },
        ],
      });

      if (p.isCancel(authMethod)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      if (authMethod === 'back') continue;

      finalEngine = 'cloud';

      // Cloudflare needs base_url
      let customBaseUrl: string | undefined;
      if (modelProvider === 'cloudflare') {
        const accountId = await p.text({
          message: 'Cloudflare Account ID:',
          validate: (val) => { if (!val || val.trim().length < 5) return 'Account ID too short'; },
        });
        if (p.isCancel(accountId)) { p.cancel('Setup cancelled.'); process.exit(0); }
        const gatewayId = await p.text({
          message: 'Gateway ID:',
          validate: (val) => { if (!val || val.trim().length < 2) return 'Gateway ID too short'; },
        });
        if (p.isCancel(gatewayId)) { p.cancel('Setup cancelled.'); process.exit(0); }
        customBaseUrl = `https://gateway.ai.cloudflare.com/v1/${(accountId as string).trim()}/${(gatewayId as string).trim()}/openai`;
      }

      // Custom endpoint: Compatibility Choice + Base URL + Model
      let customApiStyle: 'openai' | 'anthropic' | undefined;
      if (modelProvider === 'custom') {
        const baseUrlInput = await p.text({
          message: 'Base URL:',
          placeholder: 'https://your-api.example.com/v1',
          validate: (val) => { if (!val || !val.startsWith('http')) return 'Must be a valid URL'; },
        });
        if (p.isCancel(baseUrlInput)) { p.cancel('Setup cancelled.'); process.exit(0); }
        customBaseUrl = (baseUrlInput as string).trim();

        // Azure auto-detection
        if (customBaseUrl.includes('.openai.azure.com')) {
          const azureMatch = customBaseUrl.match(/https:\/\/([^.]+)\.openai\.azure\.com/);
          if (azureMatch && !customBaseUrl.includes('/openai/')) {
            customBaseUrl = `${customBaseUrl.replace(/\/$/, '')}/openai`;
            p.log.info(`Azure detected — adjusted URL: ${customBaseUrl}`);
          }
        }

        const compatibility = await p.select({
          message: 'Endpoint compatibility:',
          options: [
            { value: 'openai', label: 'OpenAI-compatible', hint: 'Uses /chat/completions' },
            { value: 'anthropic', label: 'Anthropic-compatible', hint: 'Uses /messages' },
            { value: 'auto', label: 'Auto-detect', hint: 'Probes both endpoints' },
          ],
        });
        if (p.isCancel(compatibility)) { p.cancel('Setup cancelled.'); process.exit(0); }

        if (compatibility === 'auto') {
          const detectSpinner = p.spinner();
          detectSpinner.start('Probing endpoint compatibility...');
          let detected: 'openai' | 'anthropic' | null = null;
          try {
            const openaiRes = await fetch(`${customBaseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
              body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
              signal: AbortSignal.timeout(8000),
            });
            if (openaiRes.ok || openaiRes.status === 401 || openaiRes.status === 400 || openaiRes.status === 403) {
              detected = 'openai';
            }
          } catch { /* not OpenAI */ }
          if (!detected) {
            try {
              const anthroRes = await fetch(`${customBaseUrl.replace(/\/v1\/?$/, '')}/v1/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': 'test', 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: 'test', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
                signal: AbortSignal.timeout(8000),
              });
              if (anthroRes.ok || anthroRes.status === 401 || anthroRes.status === 400 || anthroRes.status === 403) {
                detected = 'anthropic';
              }
            } catch { /* not Anthropic */ }
          }
          if (detected) {
            detectSpinner.stop(chalk.green(`Detected: ${detected}-compatible`));
            customApiStyle = detected;
          } else {
            detectSpinner.stop(chalk.yellow('Could not auto-detect'));
            const fallbackCompat = await p.select({
              message: 'Which API style does this endpoint use?',
              options: [
                { value: 'openai', label: 'OpenAI-compatible' },
                { value: 'anthropic', label: 'Anthropic-compatible' },
              ],
            });
            if (p.isCancel(fallbackCompat)) { p.cancel('Setup cancelled.'); process.exit(0); }
            customApiStyle = fallbackCompat as 'openai' | 'anthropic';
          }
        } else {
          customApiStyle = compatibility as 'openai' | 'anthropic';
        }

        const customModelId = await p.text({
          message: 'Model ID:',
          placeholder: customApiStyle === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini',
          validate: (val) => { if (!val || val.trim().length < 2) return 'Model ID too short'; },
        });
        if (p.isCancel(customModelId)) { p.cancel('Setup cancelled.'); process.exit(0); }
        selectedModel = (customModelId as string).trim();
      }

      if (authMethod === 'paste') {
        let connectionValid = false;

        while (!connectionValid) {
          const apiKey = await p.text({
            message: `${providerLabel} API Key:`,
            placeholder: providerKey === 'anthropic' ? 'sk-ant-...' : 'sk-...',
            validate: (val) => {
              if (!val || val.trim().length < 5) return 'API key too short';
            },
          });

          if (p.isCancel(apiKey)) {
            p.cancel('Setup cancelled.');
            process.exit(0);
          }

          cloudConfig = {
            provider: providerKey,
            auth_method: 'api_key',
            api_key: apiKey as string,
            ...(customBaseUrl ? { base_url: customBaseUrl } : {}),
            ...(customApiStyle ? { api_style: customApiStyle } : {}),
          };

          const testSpinner = p.spinner();
          testSpinner.start('Testing connection...');

          const { CloudClient } = await import('../llm/cloud-client.js');
          const testClient = new CloudClient(cloudConfig, selectedModel || defaultModel);
          const available = await testClient.isAvailable();

          if (available) {
            testSpinner.stop(chalk.green('Connected') + ' ' + dim(`provider: ${providerLabel}`));
            connectionValid = true;
          } else {
            testSpinner.stop(chalk.red('Connection failed'));

            if (modelProvider === 'custom') {
              const retryAction = await p.select({
                message: 'What would you like to change?',
                options: [
                  { value: 'key', label: 'Change API key' },
                  { value: 'url', label: 'Change base URL' },
                  { value: 'model', label: 'Change model' },
                  { value: 'both', label: 'Change URL + model' },
                  { value: 'cancel', label: 'Cancel' },
                ],
              });
              if (p.isCancel(retryAction) || retryAction === 'cancel') {
                p.cancel('Setup cancelled.');
                process.exit(0);
              }
              if (retryAction === 'url' || retryAction === 'both') {
                const newUrl = await p.text({
                  message: 'New base URL:',
                  initialValue: customBaseUrl || '',
                  validate: (val) => { if (!val || !val.startsWith('http')) return 'Must be a valid URL'; },
                });
                if (p.isCancel(newUrl)) { p.cancel('Setup cancelled.'); process.exit(0); }
                customBaseUrl = (newUrl as string).trim();
              }
              if (retryAction === 'model' || retryAction === 'both') {
                const newModel = await p.text({
                  message: 'New model ID:',
                  initialValue: selectedModel || '',
                  validate: (val) => { if (!val || val.trim().length < 2) return 'Model ID too short'; },
                });
                if (p.isCancel(newModel)) { p.cancel('Setup cancelled.'); process.exit(0); }
                selectedModel = (newModel as string).trim();
              }
            } else {
              const retry = await p.confirm({
                message: 'API key seems invalid. Try again?',
                initialValue: true,
              });
              if (p.isCancel(retry) || !retry) {
                p.cancel('Setup cancelled.');
                process.exit(0);
              }
            }
          }
        }
      }

      if (authMethod === 'env') {
        const defaultEnvVar = ENV_VAR_DEFAULTS[providerKey] || 'LLM_API_KEY';
        const envVarName = await p.text({
          message: 'Environment variable name:',
          initialValue: defaultEnvVar,
          validate: (val) => {
            if (!val || val.trim().length < 2) return 'Variable name too short';
          },
        });

        if (p.isCancel(envVarName)) {
          p.cancel('Setup cancelled.');
          process.exit(0);
        }

        const envValue = process.env[envVarName as string];
        if (envValue) {
          const envPreview = envValue.length > 8
            ? envValue.substring(0, 4) + '...' + envValue.substring(envValue.length - 4)
            : '****';
          p.log.success(`${envVarName} is set (${envPreview})`);
        } else {
          p.log.warn(`${envVarName} is not set in current environment — will be resolved at runtime`);
        }

        cloudConfig = {
          provider: providerKey,
          auth_method: 'env_var',
          env_var_name: envVarName as string,
          ...(customBaseUrl ? { base_url: customBaseUrl } : {}),
          ...(customApiStyle ? { api_style: customApiStyle } : {}),
        };

        // Connection test if env var is available
        if (envValue) {
          const testSpinner = p.spinner();
          testSpinner.start('Testing connection...');
          const { CloudClient } = await import('../llm/cloud-client.js');
          const testClient = new CloudClient(cloudConfig, selectedModel || defaultModel);
          const available = await testClient.isAvailable();
          if (available) {
            testSpinner.stop(chalk.green('Connected') + ' ' + dim(`provider: ${providerLabel}`));
          } else {
            testSpinner.stop(chalk.yellow('Connection failed — check your key'));
          }
        }
      }
      } // end if (!autoDetected)

      // Model selection (skip for custom, already asked above)
      if (modelProvider !== 'custom') {
        const modelChoice = await p.select({
          message: 'Model',
          options: [
            { value: 'default', label: `${defaultModel}`, hint: 'recommended' },
            { value: 'custom', label: 'Enter manually', hint: 'custom model ID' },
          ],
        });

        if (p.isCancel(modelChoice)) {
          p.cancel('Setup cancelled.');
          process.exit(0);
        }

        if (modelChoice === 'custom') {
          const customModel = await p.text({
            message: 'Model ID:',
            placeholder: defaultModel,
            validate: (val) => {
              if (!val || val.trim().length < 2) return 'Model ID too short';
            },
          });
          if (p.isCancel(customModel)) {
            p.cancel('Setup cancelled.');
            process.exit(0);
          }
          selectedModel = customModel as string;
        } else {
          selectedModel = defaultModel;
        }
      }

      if (cloudConfig) {
        cloudConfig.model = selectedModel;
      }
      break providerLoop;
    }

    // ── Step 3: Build Brain + Connect ──
    const brainSpinner = p.spinner();
    brainSpinner.start('Building neural architecture...');

    for (const dir of [MEMORY_DIR, DATA_DIR, LOGS_DIR, BACKUPS_DIR]) {
      mkdirSync(dir, { recursive: true });
    }
    getDb();

    const stats = getStats();
    if (stats.totalNodes === 0 || freshStart) {
      createPreWiredNodes();
      setCriticalPeriod();
    }

    await new Promise((r) => setTimeout(r, 300));
    const afterStats = getStats();
    brainSpinner.stop(chalk.green('Neural architecture online'));

    const subsystems = [
      [`Core Neurons`, `${afterStats.totalNodes} nodes wired`],
      [`Synaptic Pathways`, `${afterStats.totalEdges} edges connected`],
      [`Signal-Strength`, `6 factors, 3 gates`],
      [`Spreading Activation`, `Hebbian learning enabled`],
      [`Critical Period`, `aggressive learning for 20 sessions`],
      [`Consolidation`, `prune > merge > abstract > dream > distill`],
    ];
    for (const [name, detail] of subsystems) {
      await new Promise((r) => setTimeout(r, 80));
      console.log(`  ${chalk.green('│')}  ${dim(name.padEnd(24))} ${chalk.white(detail)}`);
    }
    console.log();

    for (const providerName of selectedProviders as string[]) {
      const provSpinner = p.spinner();
      const display = DISPLAY_NAMES[providerName] || providerName;
      provSpinner.start(`Connecting ${display}...`);
      await setupProvider(providerName);
      await new Promise((r) => setTimeout(r, 200));
      provSpinner.stop(chalk.green(display) + ' ' + dim(getProviderDesc(providerName)));
    }

    // MCP Server (auto-install for Claude Code — other providers get MCP via setupProvider)
    if ((selectedProviders as string[]).includes('claude-code')) {
      const mcpSpinner = p.spinner();
      mcpSpinner.start('Registering MCP Server...');
      try {
        installMcpServer();
        await new Promise((r) => setTimeout(r, 200));
        mcpSpinner.stop(chalk.green('MCP Server') + ' ' + dim('6 tools registered'));
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

    // ── Step 5: Watcher Auto-Start ──
    let watcherStarted = false;
    if (finalEngine !== 'none') {
      const watcherSpinner = p.spinner();
      watcherSpinner.start('Starting Watcher daemon...');

      try {
        if (!isWatcherRunning()) {
          const binPath = process.argv[1];
          const child = spawn(process.argv[0], [binPath, 'watcher', 'start'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();

          // Wait for daemon to come up
          let retries = 10;
          while (retries > 0) {
            await new Promise((r) => setTimeout(r, 500));
            try {
              const res = await fetch('http://127.0.0.1:7899', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'ping', data: {} }),
                signal: AbortSignal.timeout(2000),
              });
              if (res.ok || res.status === 200 || res.status === 500) {
                watcherStarted = true;
                break;
              }
            } catch {
              // not ready yet
            }
            retries--;
          }
        } else {
          watcherStarted = true;
        }

        if (watcherStarted) {
          const modelLabel = selectedModel || (finalEngine === 'ollama' ? 'llama3.2:3b' : '?');
          watcherSpinner.stop(chalk.green('Watcher Collective online') + ' ' + dim(`model: ${modelLabel}`));

          const agents = [
            ['Memory Extractor', 'extracts knowledge from conversations'],
            ['Topic Detector', 'tracks context switches'],
            ['Frustration Shield', 'filters noise and frustration'],
            ['Task Watcher', 'detects TODOs and blockers'],
            ['Tacit Knowledge', 'learns your hidden patterns'],
            ['Meta-Learner', 'learns how you learn'],
          ];
          for (const [name, desc] of agents) {
            await new Promise((r) => setTimeout(r, 60));
            console.log(`  ${chalk.green('│')}  ${dim(name.padEnd(24))} ${chalk.white(desc)}`);
          }
          console.log();
        } else {
          watcherSpinner.stop(chalk.yellow('Watcher not responding') + ' ' + dim('run: brainbase watcher start'));
        }
      } catch {
        watcherSpinner.stop(chalk.yellow('Watcher start failed') + ' ' + dim('run: brainbase watcher start'));
      }

      // macOS: Register LaunchAgent for auto-start at login
      if (platform() === 'darwin') {
        try {
          registerLaunchAgent();
        } catch {
          // non-critical
        }
      }
    }

    // ── Step 6: Summary ──
    const finalStats = getStats();
    const engineLabel = finalEngine === 'none'
      ? 'None (regex-only)'
      : finalEngine === 'ollama'
        ? 'Ollama (local)'
        : `${cloudConfig?.provider || '?'} (${selectedModel || '?'})`;

    const watcherLabel = finalEngine === 'none'
      ? dim('skipped')
      : watcherStarted
        ? chalk.green('running')
        : chalk.yellow('not started');

    p.note(
      `${cb('Brain')}     ${finalStats.totalNodes} neurons, ${finalStats.totalEdges} synapses\n` +
      `${cb('Engine')}    ${engineLabel}\n` +
      `${cb('Watcher')}   ${watcherLabel}\n` +
      `${cb('Providers')} ${(selectedProviders as string[]).map(n => DISPLAY_NAMES[n] || n).join(', ')}\n` +
      '\n' +
      chalk.bold.white('What your brain does:\n') +
      `  ${dim('Remembers decisions, preferences, and patterns')}\n` +
      `  ${dim('Learns your coding style across sessions')}\n` +
      `  ${dim('Activates relevant context automatically')}\n` +
      `  ${dim('Works across all your AI tools simultaneously')}\n` +
      `  ${dim('Consolidates and strengthens memories over time')}\n` +
      `  ${dim('Gets smarter with every session')}\n` +
      '\n' +
      dim('Commands:\n') +
      dim('  brainbase stats         Brain statistics\n') +
      dim('  brainbase search        Search memories\n') +
      dim('  brainbase dashboard     3D brain visualization\n') +
      dim('  brainbase insights      Learning patterns\n') +
      dim('  brainbase verify        Full system check\n') +
      dim('  brainbase consolidate   Manual consolidation'),
      'Brain is live'
    );

    p.outro(dim('Start a new session. The brain is listening.'));
  });

function getProviderDesc(name: string): string {
  const descs: Record<string, string> = {
    'claude-code': 'Hooks + MCP + Resources (100%)',
    codex: 'MCP + Instruction',
    gemini: 'MCP + Instruction',
    openclaw: 'Instruction',
    cursor: 'MCP + Rules',
    windsurf: 'MCP + Resources',
    'continue-dev': 'MCP',
    'claude-desktop': 'MCP + Resources',
    aider: 'Instruction',
    goose: 'MCP',
    cline: 'MCP',
    'roo-code': 'MCP',
    zed: 'MCP (context_servers)',
    amp: 'MCP',
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
    case 'goose':
      await setupGoose();
      break;
    case 'cline':
      await setupCline();
      break;
    case 'roo-code':
      await setupRooCode();
      break;
    case 'zed':
      await setupZed();
      break;
    case 'amp':
      await setupAmp();
      break;
  }
}

async function setupClaudeCode(): Promise<void> {
  const paths = PROVIDER_PATHS['claude-code'];
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
        command: 'brainbase hook user-prompt',
        timeout: 5,
      }],
    }],
    SessionStart: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'brainbase hook session-start',
        timeout: 10,
      }],
    }],
    SessionEnd: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'brainbase hook session-end',
        timeout: 30,
      }],
    }],
    PreCompact: [{
      matcher: '',
      hooks: [{
        type: 'command' as const,
        command: 'brainbase hook pre-compact',
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
        typeof hh.command === 'string' && hh.command.startsWith('brainbase'),
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
  installMcpServerForProvider('gemini');
  const paths = PROVIDER_PATHS.gemini;
  writeCleanInstruction(paths.mdFile);
}

async function setupCodex(): Promise<void> {
  installMcpServerForProvider('codex');
  const paths = PROVIDER_PATHS.codex;
  mkdirSync(paths.skillDir, { recursive: true });
  writeFileSync(paths.skillFile, CLEAN_SKILL_CONTENT, 'utf-8');
}

async function setupOpenClaw(): Promise<void> {
  const paths = PROVIDER_PATHS.openclaw;
  appendCleanInstruction(paths.agentsFile);
}

async function setupCursor(): Promise<void> {
  const paths = PROVIDER_PATHS.cursor;
  mkdirSync(paths.rulesDir, { recursive: true });
  writeFileSync(paths.mdFile, CLEAN_CURSOR_RULE, 'utf-8');
  installMcpServerForProvider('cursor');
}

async function setupWindsurf(): Promise<void> {
  installMcpServerForProvider('windsurf');
}

async function setupContinueDev(): Promise<void> {
  installMcpServerForProvider('continue-dev');
}

async function setupClaudeDesktop(): Promise<void> {
  installMcpServerForProvider('claude-desktop');
}

async function setupAider(): Promise<void> {
  const paths = PROVIDER_PATHS.aider;
  injectMemoryBlock(paths.mdFile);
}

async function setupGoose(): Promise<void> {
  installMcpServerForProvider('goose');
}

async function setupCline(): Promise<void> {
  installMcpServerForProvider('cline');
}

async function setupRooCode(): Promise<void> {
  installMcpServerForProvider('roo-code');
}

async function setupZed(): Promise<void> {
  installMcpServerForProvider('zed');
}

async function setupAmp(): Promise<void> {
  installMcpServerForProvider('amp');
}

function writeCleanInstruction(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8');
  }

  // Remove old memory block if present
  const blockRegex = /<!-- (?:MEMORY-UNLIMITED|BRAINBASE):START[\s\S]*?(?:MEMORY-UNLIMITED|BRAINBASE):END -->\n?/g;
  existing = existing.replace(blockRegex, '').trim();

  // Only add if not already present
  if (!existing.includes('memory_process_message')) {
    const separator = existing ? '\n\n' : '';
    writeFileSync(filePath, existing + separator + CLEAN_INSTRUCTION + '\n', 'utf-8');
  }
}

function appendCleanInstruction(filePath: string): void {
  if (!existsSync(filePath)) return;

  let existing = readFileSync(filePath, 'utf-8');

  // Remove old memory block if present
  const blockRegex = /<!-- (?:MEMORY-UNLIMITED|BRAINBASE):START[\s\S]*?(?:MEMORY-UNLIMITED|BRAINBASE):END -->\n?/g;
  existing = existing.replace(blockRegex, '').trim();

  // Only add if not already present
  if (!existing.includes('memory_process_message')) {
    writeFileSync(filePath, existing + '\n\n' + CLEAN_INSTRUCTION + '\n', 'utf-8');
  } else {
    writeFileSync(filePath, existing + '\n', 'utf-8');
  }
}

function registerLaunchAgent(): void {
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
  mkdirSync(launchAgentsDir, { recursive: true });

  const binPath = process.argv[1];
  const nodePath = process.argv[0];

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${binPath}</string>
    <string>watcher</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(LOGS_DIR, 'launchd-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(LOGS_DIR, 'launchd-stderr.log')}</string>
</dict>
</plist>`;

  writeFileSync(LAUNCH_AGENT_PATH, plist, 'utf-8');
}
