import { Command } from 'commander';
import chalk from 'chalk';
import { searchNodes } from '../memory/store.js';
import { activateByQuery } from '../memory/activation.js';

export const searchCommand = new Command('search')
  .description('Search nodes in the brain')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '20')
  .action((query: string, opts: { limit: string }) => {
    const results = searchNodes(query, parseInt(opts.limit, 10));
    activateByQuery(query);

    if (results.length === 0) {
      console.log(chalk.yellow(`\n  No nodes found for "${query}"\n`));
      return;
    }

    console.log(chalk.bold(`\n  Found ${results.length} nodes:\n`));

    for (const n of results) {
      const importance = n.importance >= 0.7
        ? chalk.red('●')
        : n.importance >= 0.4
          ? chalk.yellow('●')
          : chalk.dim('●');
      const type = chalk.dim(`[${n.type}]`);
      const date = chalk.dim(new Date(n.created_at).toLocaleDateString());
      console.log(`  ${importance} ${type} ${n.content} ${date}`);
    }
    console.log();
  });
