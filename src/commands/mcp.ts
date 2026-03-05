import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startServer } from '../mcp/server.js';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

function getServerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = dirname(dirname(thisFile));
  return join(distDir, 'mcp', 'server.js');
}

export function installMcpServer(): boolean {
  let settings: Record<string, unknown> = {};

  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>;
  const serverPath = getServerPath();

  mcpServers['memory-unlimited'] = {
    command: 'node',
    args: [serverPath],
  };

  settings.mcpServers = mcpServers;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
}

export function uninstallMcpServer(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return false;
  }

  const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>;
  if (!mcpServers['memory-unlimited']) return false;

  delete mcpServers['memory-unlimited'];
  settings.mcpServers = mcpServers;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
}

export const mcpCommand = new Command('mcp')
  .description('MCP Server - connect the brain directly to your AI')
  .addCommand(
    new Command('install')
      .description('Register MCP server in Claude Code settings')
      .action(() => {
        const serverPath = getServerPath();

        if (!existsSync(serverPath)) {
          console.log(chalk.red('MCP server not built. Run `npm run build` first.'));
          process.exit(1);
        }

        installMcpServer();
        console.log(chalk.green('MCP Server registered in Claude Code.'));
        console.log(chalk.dim(`  Server: ${serverPath}`));
        console.log(chalk.dim(`  Settings: ${SETTINGS_PATH}`));
        console.log();
        console.log(chalk.bold('Restart Claude Code to activate the MCP tools.'));
      }),
  )
  .addCommand(
    new Command('uninstall')
      .description('Remove MCP server from Claude Code settings')
      .action(() => {
        const removed = uninstallMcpServer();
        if (removed) {
          console.log(chalk.green('MCP Server removed from Claude Code.'));
        } else {
          console.log(chalk.yellow('MCP Server was not registered.'));
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
