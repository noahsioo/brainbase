#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { detectCommand } from './commands/detect.js';
import { hookCommand } from './commands/hook.js';
import { searchCommand } from './commands/search.js';
import { listCommand } from './commands/list.js';
import { forgetCommand } from './commands/forget.js';
import { hotCommand } from './commands/hot.js';
import { statsCommand } from './commands/stats.js';
import { watcherCommand } from './commands/watcher.js';
import { addCommand } from './commands/add.js';
import { consolidateCommand } from './commands/consolidate.js';
import { verifyCommand } from './commands/verify.js';
import { snapshotCommand } from './commands/snapshot.js';
import { mcpCommand } from './commands/mcp.js';
import { dashboardCommand } from './commands/dashboard.js';
import { siteCommand } from './commands/site.js';
import { embedCommand } from './commands/embed.js';

const program = new Command();

program
  .name('memory-unlimited')
  .description('Cross-provider persistent memory system for AI coding assistants')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(detectCommand);
program.addCommand(hookCommand);
program.addCommand(searchCommand);
program.addCommand(listCommand);
program.addCommand(forgetCommand);
program.addCommand(hotCommand);
program.addCommand(statsCommand);
program.addCommand(watcherCommand);
program.addCommand(addCommand);
program.addCommand(consolidateCommand);
program.addCommand(verifyCommand);
program.addCommand(snapshotCommand);
program.addCommand(mcpCommand);
program.addCommand(dashboardCommand);
program.addCommand(siteCommand);
program.addCommand(embedCommand);

program.parse();
