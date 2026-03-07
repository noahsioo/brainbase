import { Command } from 'commander';
import chalk from 'chalk';
import { getStats, getDb } from '../memory/store.js';
import { getActivatedNodes } from '../memory/activation.js';
import { getSystemState } from '../memory/cold-start.js';

export const statsCommand = new Command('stats')
  .description('Show brain statistics')
  .action(() => {
    const stats = getStats();

    console.log(chalk.bold('\n  BrainBase - Brain Statistics\n'));
    const activeNodes = getActivatedNodes();

    console.log(`  Total Nodes:     ${chalk.cyan(stats.totalNodes.toString())}`);
    console.log(`  Total Edges:     ${chalk.cyan(stats.totalEdges.toString())}`);
    console.log(`  Active Nodes:    ${chalk.yellow(activeNodes.length.toString())}`);
    console.log(`  Total Patterns:  ${chalk.cyan(stats.totalPatterns.toString())}`);
    console.log(`  Total Sessions:  ${chalk.cyan(stats.totalSessions.toString())}`);

    const sessionCount = getSystemState('sessions_count');
    if (sessionCount) {
      const count = parseInt(sessionCount, 10);
      const critical = count < 20;
      console.log(`  Session Count:   ${chalk.cyan(count.toString())}${critical ? chalk.yellow(' (Critical Period - aggressive learning)') : ''}`);
    }

    if (Object.keys(stats.typeCounts).length > 0) {
      console.log(chalk.bold('\n  By Type:\n'));
      for (const [type, count] of Object.entries(stats.typeCounts)) {
        const bar = chalk.magenta('█'.repeat(Math.min(count, 30)));
        console.log(`  ${type.padEnd(12)} ${bar} ${count}`);
      }
    }

    try {
      const db = getDb();
      const edgeTypes = db.prepare(
        'SELECT type, COUNT(*) as count FROM edges GROUP BY type ORDER BY count DESC'
      ).all() as Array<{ type: string; count: number }>;

      if (edgeTypes.length > 0) {
        console.log(chalk.bold('\n  Edge Types:\n'));
        for (const et of edgeTypes) {
          const bar = chalk.blue('█'.repeat(Math.min(et.count, 30)));
          console.log(`  ${et.type.padEnd(14)} ${bar} ${et.count}`);
        }
      }
    } catch {
      // skip
    }

    if (stats.latestSession) {
      console.log(chalk.bold('\n  Latest Session:\n'));
      console.log(`  Provider:  ${stats.latestSession.provider}`);
      console.log(`  Started:   ${new Date(stats.latestSession.started_at).toLocaleString()}`);
      if (stats.latestSession.ended_at) {
        console.log(`  Ended:     ${new Date(stats.latestSession.ended_at).toLocaleString()}`);
      }
      console.log(`  Messages:  ${stats.latestSession.message_count}`);
    }

    console.log();
  });
