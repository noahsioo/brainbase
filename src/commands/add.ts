import { Command } from 'commander';
import chalk from 'chalk';
import { addNode } from '../memory/store.js';
import { updateHotMemoryInDb, updateAllProviderFiles } from '../memory/hot.js';
import { autoLinkNodes } from '../memory/activation.js';

export const addCommand = new Command('add')
  .description('Add a node to the brain')
  .argument('<text>', 'Node content')
  .option('-t, --type <type>', 'Type: fact, preference, decision, task, project, skill, person, event', 'fact')
  .option('-i, --importance <n>', 'Importance 0.0-1.0', '0.7')
  .option('-s, --source <src>', 'Source: manual, watcher, explicit', 'manual')
  .option('-c, --confidence <n>', 'Confidence 0.0-1.0', '1.0')
  .action((text: string, opts: { type: string; importance: string; source: string; confidence: string }) => {
    const node = addNode(text, opts.type, {
      importance: parseFloat(opts.importance),
      source: opts.source,
      confidence: parseFloat(opts.confidence),
    });

    const linkedEdges = autoLinkNodes(node.id);

    updateHotMemoryInDb();
    updateAllProviderFiles();

    console.log(chalk.green(`\n  ✓ Node added: ${node.content}`));
    console.log(chalk.dim(`    ID: ${node.id.substring(0, 8)} | Type: ${opts.type} | Importance: ${opts.importance}`));
    if (linkedEdges.length > 0) {
      console.log(chalk.dim(`    Auto-linked: ${linkedEdges.length} edge(s) created`));
      for (const e of linkedEdges.slice(0, 5)) {
        console.log(chalk.dim(`      → ${e.type} (strength: ${e.strength.toFixed(2)})`));
      }
    }
    console.log();
  });
