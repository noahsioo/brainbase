import { Command } from 'commander';
import chalk from 'chalk';
import { deleteNodesByQuery, searchNodes } from '../memory/store.js';

export const forgetCommand = new Command('forget')
  .description('Delete nodes matching a query (GDPR)')
  .argument('<query>', 'Query to match nodes for deletion')
  .action((query: string) => {
    const matching = searchNodes(query);

    if (matching.length === 0) {
      console.log(chalk.yellow(`\n  No nodes found matching "${query}"\n`));
      return;
    }

    const deleted = deleteNodesByQuery(query);
    console.log(chalk.green(`\n  ✓ Deleted ${deleted} nodes matching "${query}"\n`));
  });
