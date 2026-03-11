import { Command } from 'commander';
import { execSync } from 'child_process';

export const siteCommand = new Command('site')
  .description('Open the Veris website')
  .action(() => {
    const url = 'https://veris.dev';
    console.log(`\n  Opening ${url}\n`);
    try {
      execSync(`open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null || start "${url}" 2>/dev/null`);
    } catch {
      console.log(`  Visit: ${url}\n`);
    }
  });
