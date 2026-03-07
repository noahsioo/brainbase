import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { startServer } from '../mcp/server.js';
import { MCP_CONFIG_PATHS } from '../config.js';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

function getServerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = dirname(dirname(thisFile));
  return join(distDir, 'mcp', 'server.js');
}

export function installMcpServer(): boolean {
  return installMcpServerForProvider('claude-code');
}

export function uninstallMcpServer(): boolean {
  return uninstallMcpServerForProvider('claude-code');
}

export function installMcpServerForProvider(provider: string): boolean {
  const mcpConfig = MCP_CONFIG_PATHS[provider];
  if (!mcpConfig) return false;

  const serverPath = getServerPath();
  const configDir = dirname(mcpConfig.file);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config: Record<string, unknown> = {};
  if (existsSync(mcpConfig.file)) {
    try {
      config = JSON.parse(readFileSync(mcpConfig.file, 'utf-8'));
    } catch {
      config = {};
    }
  }

  // Format: gemini-cli — via `gemini mcp add` CLI command
  if (mcpConfig.format === 'gemini-cli') {
    try {
      execSync('gemini mcp remove brainbase 2>/dev/null', { stdio: 'ignore' });
      execSync(`gemini mcp add brainbase node ${serverPath} --scope user --transport stdio --trust`, { stdio: 'ignore' });
    } catch { /* gemini not installed */ }
    return true;
  }

  // Format: codex-cli — via `codex mcp add` CLI command
  if (mcpConfig.format === 'codex-cli') {
    try {
      execSync('codex mcp remove brainbase 2>/dev/null', { stdio: 'ignore' });
      execSync(`codex mcp add brainbase -- node ${serverPath}`, { stdio: 'ignore' });
    } catch { /* codex not installed */ }
    return true;
  }

  // Format: zed — context_servers in settings.json
  if (mcpConfig.format === 'zed') {
    const contextServers = (config.context_servers || {}) as Record<string, unknown>;
    contextServers['brainbase'] = {
      command: { path: 'node', args: [serverPath] },
      settings: {},
    };
    config.context_servers = contextServers;
    writeFileSync(mcpConfig.file, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  }

  // Format: cline / roo-code — mcpServers with disabled field
  if (mcpConfig.format === 'cline' || mcpConfig.format === 'roo-code') {
    const mcpServers = (config.mcpServers || {}) as Record<string, unknown>;
    mcpServers['brainbase'] = {
      command: 'node',
      args: [serverPath],
      disabled: false,
    };
    config.mcpServers = mcpServers;
    writeFileSync(mcpConfig.file, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  }

  if (mcpConfig.format === 'continue') {
    const experimental = (config.experimental || {}) as Record<string, unknown>;
    const servers = (experimental.modelContextProtocolServers || []) as Array<Record<string, unknown>>;

    const existing = servers.findIndex(
      (s) => {
        const transport = s.transport as Record<string, unknown> | undefined;
        if (transport) {
          const args = transport.args as string[] | undefined;
          return args?.some((a) => a.includes('brainbase'));
        }
        return false;
      },
    );

    const entry = {
      transport: {
        type: 'stdio',
        command: 'node',
        args: [serverPath],
      },
    };

    if (existing >= 0) {
      servers[existing] = entry;
    } else {
      servers.push(entry);
    }

    experimental.modelContextProtocolServers = servers;
    config.experimental = experimental;
  } else {
    const mcpServers = (config.mcpServers || {}) as Record<string, unknown>;
    mcpServers['brainbase'] = {
      command: 'node',
      args: [serverPath],
    };
    config.mcpServers = mcpServers;
  }

  writeFileSync(mcpConfig.file, JSON.stringify(config, null, 2), 'utf-8');
  return true;
}

export function uninstallMcpServerForProvider(provider: string): boolean {
  const mcpConfig = MCP_CONFIG_PATHS[provider];
  if (!mcpConfig) return false;
  if (!existsSync(mcpConfig.file)) return false;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(mcpConfig.file, 'utf-8'));
  } catch {
    return false;
  }

  if (mcpConfig.format === 'continue') {
    const experimental = (config.experimental || {}) as Record<string, unknown>;
    const servers = (experimental.modelContextProtocolServers || []) as Array<Record<string, unknown>>;

    const filtered = servers.filter((s) => {
      const transport = s.transport as Record<string, unknown> | undefined;
      if (transport) {
        const args = transport.args as string[] | undefined;
        return !args?.some((a) => a.includes('brainbase'));
      }
      return true;
    });

    if (filtered.length === servers.length) return false;

    experimental.modelContextProtocolServers = filtered;
    config.experimental = experimental;
  } else {
    const mcpServers = (config.mcpServers || {}) as Record<string, unknown>;
    if (!mcpServers['brainbase']) return false;
    delete mcpServers['brainbase'];
    config.mcpServers = mcpServers;
  }

  writeFileSync(mcpConfig.file, JSON.stringify(config, null, 2), 'utf-8');
  return true;
}

export const mcpCommand = new Command('mcp')
  .description('MCP Server - connect the brain directly to your AI')
  .addCommand(
    new Command('install')
      .description('Register MCP server in Claude Code settings')
      .option('-p, --provider <provider>', 'Target provider (claude-code, cursor, windsurf, continue-dev, claude-desktop)')
      .action((opts) => {
        const serverPath = getServerPath();

        if (!existsSync(serverPath)) {
          console.log(chalk.red('MCP server not built. Run `npm run build` first.'));
          process.exit(1);
        }

        const provider = opts.provider || 'claude-code';
        const success = installMcpServerForProvider(provider);

        if (success) {
          const mcpConfig = MCP_CONFIG_PATHS[provider];
          console.log(chalk.green(`MCP Server registered for ${provider}.`));
          console.log(chalk.dim(`  Server: ${serverPath}`));
          console.log(chalk.dim(`  Config: ${mcpConfig?.file}`));
          console.log();
          console.log(chalk.bold(`Restart ${provider} to activate the MCP tools.`));
        } else {
          console.log(chalk.red(`Unknown provider: ${provider}`));
          console.log(chalk.dim(`Available: ${Object.keys(MCP_CONFIG_PATHS).join(', ')}`));
        }
      }),
  )
  .addCommand(
    new Command('uninstall')
      .description('Remove MCP server from settings')
      .option('-p, --provider <provider>', 'Target provider (claude-code, cursor, windsurf, continue-dev, claude-desktop)')
      .action((opts) => {
        const provider = opts.provider || 'claude-code';
        const removed = uninstallMcpServerForProvider(provider);
        if (removed) {
          console.log(chalk.green(`MCP Server removed from ${provider}.`));
        } else {
          console.log(chalk.yellow(`MCP Server was not registered for ${provider}.`));
        }
      }),
  )
  .addCommand(
    new Command('start')
      .description('Start MCP server directly (for debugging)')
      .action(() => {
        startServer();
      }),
  );
