import { Command } from 'commander';
import chalk from 'chalk';
import { detectProviders } from '../providers/detect.js';

export const detectCommand = new Command('detect')
  .description('Detect installed AI coding assistant CLIs')
  .action(() => {
    const providers = detectProviders();

    console.log(chalk.bold('\n  BrainBase - Provider Detection\n'));

    for (const p of providers) {
      const icon = p.installed ? chalk.green('✓') : chalk.gray('✗');
      const name = p.installed ? chalk.white(p.name) : chalk.gray(p.name);
      const path = chalk.dim(p.path);
      console.log(`  ${icon} ${name}  ${path}`);
    }

    const installed = providers.filter((p) => p.installed);
    console.log(
      `\n  ${chalk.dim(`${installed.length} of ${providers.length} providers found`)}\n`,
    );
  });
