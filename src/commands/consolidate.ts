import { Command } from 'commander';
import chalk from 'chalk';
import { runConsolidation } from '../consolidation/consolidation-runner.js';

export const consolidateCommand = new Command('consolidate')
  .description('Run full consolidation pipeline (pruning, merging, abstraction, dream, distill)')
  .action(async () => {
    console.log(chalk.bold('\n  BrainBase - Consolidation Pipeline\n'));
    console.log('  Running full sleep-cycle consolidation...\n');

    const result = await runConsolidation();

    console.log(chalk.bold('  Tiefschlaf (Deep Sleep):'));
    console.log(`    Edges pruned:      ${chalk.red(result.edges_pruned.toString())}`);
    console.log(`    Orphans found:     ${chalk.yellow(result.orphans_found.toString())}`);
    console.log(`    Nodes promoted:    ${chalk.green(result.nodes_promoted.toString())}`);
    console.log(`    Nodes decayed:     ${chalk.dim(result.nodes_decayed.toString())}`);
    console.log(`    Nodes deleted:     ${chalk.red(result.nodes_deleted.toString())}`);

    console.log(chalk.bold('\n  Merging:'));
    console.log(`    Nodes merged:      ${chalk.cyan(result.nodes_merged.toString())}`);

    console.log(chalk.bold('\n  Abstraction:'));
    console.log(`    Patterns created:  ${chalk.magenta(result.patterns_created.toString())}`);

    console.log(chalk.bold('\n  REM/Dream Phase:'));
    console.log(`    Dream edges:       ${chalk.blue(result.dream_edges.toString())}`);
    console.log(`    Knowledge gaps:    ${chalk.yellow(result.gaps_found.toString())}`);
    console.log(`    Contradictions:    ${chalk.red(result.contradictions.toString())}`);

    console.log(chalk.bold('\n  Destillation:'));
    console.log(`    Clusters distilled: ${chalk.green(result.clusters_distilled.toString())}`);
    console.log(`    Global profile:     ${result.global_profile_updated ? chalk.green('updated') : chalk.dim('unchanged')}`);

    console.log(chalk.dim(`\n  Completed in ${result.duration_ms}ms`));
    console.log();
  });
