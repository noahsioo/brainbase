import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { getInstalledProviders } from '../providers/detect.js';
import { CONFIG_PATH, DB_PATH, PID_PATH, PROVIDER_PATHS, MEMORY_BLOCK_START } from '../config.js';
import { getStats } from '../memory/store.js';

export const statusCommand = new Command('status')
  .description('Show Memory Unlimited system status')
  .action(() => {
    console.log(chalk.bold('\n  Memory Unlimited - Status\n'));

    const initialized = existsSync(CONFIG_PATH);
    console.log(`  ${initialized ? chalk.green('✓') : chalk.red('✗')} Initialized: ${initialized ? 'Yes' : 'No - run `memory-unlimited init`'}`);

    const dbExists = existsSync(DB_PATH);
    console.log(`  ${dbExists ? chalk.green('✓') : chalk.red('✗')} Database: ${dbExists ? DB_PATH : 'Not created'}`);

    let watcherRunning = false;
    if (existsSync(PID_PATH)) {
      try {
        const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        watcherRunning = true;
      } catch {
        watcherRunning = false;
      }
    }
    console.log(`  ${watcherRunning ? chalk.green('✓') : chalk.yellow('○')} Watcher: ${watcherRunning ? 'Running' : 'Not running'}`);

    const providers = getInstalledProviders();
    console.log(chalk.bold('\n  Providers:\n'));

    for (const p of providers) {
      const paths = PROVIDER_PATHS[p.name];
      let mdPath = '';

      if (p.name === 'claude-code' && 'mdFile' in paths) {
        mdPath = paths.mdFile;
      } else if (p.name === 'gemini' && 'mdFile' in paths) {
        mdPath = paths.mdFile;
      } else if (p.name === 'openclaw' && 'agentsFile' in paths) {
        mdPath = paths.agentsFile;
      } else if (p.name === 'codex' && 'skillFile' in paths) {
        mdPath = paths.skillFile;
      }

      let hasBlock = false;
      if (mdPath && existsSync(mdPath)) {
        const content = readFileSync(mdPath, 'utf-8');
        hasBlock = content.includes(MEMORY_BLOCK_START);
      }

      const icon = hasBlock ? chalk.green('✓') : chalk.yellow('○');
      console.log(`  ${icon} ${p.name}: ${hasBlock ? 'Memory block active' : 'Not configured'}`);
    }

    if (dbExists) {
      try {
        const stats = getStats();
        console.log(chalk.bold('\n  Brain Stats:\n'));
        console.log(`  Total Nodes:    ${chalk.cyan(stats.totalNodes.toString())}`);
        console.log(`  Total Edges:    ${chalk.cyan(stats.totalEdges.toString())}`);
        console.log(`  Total Sessions: ${chalk.cyan(stats.totalSessions.toString())}`);

        if (Object.keys(stats.typeCounts).length > 0) {
          console.log(chalk.dim('\n  By type:'));
          for (const [type, count] of Object.entries(stats.typeCounts)) {
            console.log(`    ${type}: ${count}`);
          }
        }
      } catch {
        // DB not ready
      }
    }

    console.log();
  });
