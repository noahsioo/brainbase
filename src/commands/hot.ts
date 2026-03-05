import { Command } from 'commander';
import chalk from 'chalk';
import { generateContext, getContextTokenCount, type DetailMode } from '../memory/context-generator.js';

export const hotCommand = new Command('hot')
  .description('Show current hot memory / generated context')
  .option('-d, --detail <mode>', 'Detail mode: MAXIMUM, STANDARD, LIGHT, MINIMAL', 'STANDARD')
  .option('-t, --topic <topic>', 'Current topic for warm memory slot')
  .action((opts: { detail: string; topic?: string }) => {
    const mode = (opts.detail.toUpperCase() as DetailMode) || 'STANDARD';
    const validModes: DetailMode[] = ['MAXIMUM', 'STANDARD', 'LIGHT', 'MINIMAL'];
    const finalMode = validModes.includes(mode) ? mode : 'STANDARD';

    const content = generateContext(finalMode, opts.topic);
    const tokens = getContextTokenCount(finalMode);

    console.log(chalk.bold(`\n  Hot Memory (${finalMode} mode, ~${tokens} tokens):\n`));
    console.log(chalk.dim('  ─'.repeat(30)));

    if (content) {
      for (const line of content.split('\n')) {
        console.log(`  ${line}`);
      }
    } else {
      console.log(chalk.yellow('  No hot memory content yet.'));
    }

    console.log(chalk.dim('  ─'.repeat(30)));
    console.log();
  });
