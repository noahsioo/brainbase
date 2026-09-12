import { Command } from 'commander';
import chalk from 'chalk';
import { getNodes } from '../memory/store.js';

export const listCommand = new Command('list')
  .description('List nodes in the brain')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --limit <n>', 'Max results', '20')
  .action((opts: { type?: string; limit: string }) => {
    const nodes = getNodes({
      type: opts.type,
      limit: parseInt(opts.limit, 10),
    });

    if (nodes.length === 0) {
      console.log(chalk.yellow('\n  No nodes yet. Add some with `brainbase add`.\n'));
      return;
    }

    console.log(chalk.bold(`\n  ${nodes.length} nodes:\n`));

    for (const n of nodes) {
      const importance = n.importance >= 0.7
        ? chalk.red('●')
        : n.importance >= 0.4
          ? chalk.yellow('●')
          : chalk.dim('●');
      const type = chalk.dim(`[${n.type}]`);
      const date = chalk.dim(new Date(n.created_at).toLocaleDateString());
      const id = chalk.dim(n.id.substring(0, 8));
      const confidence = chalk.dim(`c:${n.confidence}`);
      console.log(`  ${importance} ${id} ${type} ${n.content} ${date} ${confidence}`);
    }
    console.log();
  });
