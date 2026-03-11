import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { PID_PATH, getConfig } from '../config.js';
import { startDaemon, stopDaemon, isWatcherRunning } from '../watcher/daemon.js';
import { getLLMClient } from '../llm/factory.js';

export const watcherCommand = new Command('watcher')
  .description('Manage the watcher daemon (LLM supervisor)')
  .argument('<action>', 'start, stop, or status')
  .action(async (action: string) => {
    switch (action) {
      case 'start':
        await watcherStart();
        break;
      case 'stop':
        await watcherStop();
        break;
      case 'status':
        await watcherStatus();
        break;
      default:
        console.log(chalk.red(`\n  Unknown action: ${action}. Use start, stop, or status.\n`));
    }
  });

async function watcherStart(): Promise<void> {
  console.log(chalk.bold('\n  Starting Veris Watcher...\n'));

  const config = getConfig();
  if (config.watcher_engine === 'none') {
    console.log(chalk.red('  ✗ No LLM engine configured!'));
    console.log(chalk.dim('  Run: veris init\n'));
    return;
  }

  try {
    const client = await getLLMClient();
    const available = await client.isAvailable();

    if (!available) {
      console.log(chalk.red('  ✗ LLM provider is not reachable!'));
      if (config.watcher_engine === 'ollama') {
        console.log(chalk.dim('  Start Ollama first:'));
        console.log(chalk.cyan('    ollama serve'));
        console.log(chalk.dim('  Then pull a model:'));
        console.log(chalk.cyan('    ollama pull llama3.2:3b\n'));
      } else {
        console.log(chalk.dim('  Check your API key and provider config.\n'));
      }
      return;
    }

    console.log(chalk.green(`  ✓ LLM connected (engine: ${config.watcher_engine}, model: ${client.getModel()})`));
  } catch (err) {
    console.log(chalk.red(`  ✗ Failed to create LLM client: ${err}`));
    return;
  }

  await startDaemon();
}

async function watcherStop(): Promise<void> {
  const stopped = await stopDaemon();
  if (stopped) {
    console.log(chalk.green('\n  ✓ Watcher stopped\n'));
  } else {
    console.log(chalk.yellow('\n  ○ Watcher was not running\n'));
  }
}

async function watcherStatus(): Promise<void> {
  console.log(chalk.bold('\n  Watcher Status\n'));

  const running = isWatcherRunning();
  const config = getConfig();

  if (running) {
    const pid = readFileSync(PID_PATH, 'utf-8').trim();
    console.log(chalk.green(`  ✓ Watcher is running (PID: ${pid})`));
  } else {
    console.log(chalk.yellow('  ○ Watcher is not running'));
  }

  console.log(chalk.dim(`  Engine: ${config.watcher_engine}`));

  if (config.watcher_engine !== 'none') {
    try {
      const client = await getLLMClient();
      const available = await client.isAvailable();
      if (available) {
        console.log(chalk.green(`  ✓ LLM available (model: ${client.getModel()})`));
      } else {
        console.log(chalk.red('  ✗ LLM not reachable'));
      }
    } catch {
      console.log(chalk.red('  ✗ LLM client error'));
    }
  }

  console.log();
}
