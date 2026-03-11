import { Command } from 'commander';
import chalk from 'chalk';
import { getDb } from '../memory/store.js';

interface SnapshotRow {
  id: string;
  date: string;
  node_count: number;
  edge_count: number;
  pattern_count: number;
  top_topics: string;
  state_hash: string | null;
}

export const snapshotCommand = new Command('snapshot')
  .description('View historical brain snapshots')
  .option('-n, --count <number>', 'Number of snapshots to show', '10')
  .action((opts) => {
    const limit = parseInt(opts.count, 10) || 10;
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM snapshots ORDER BY date DESC LIMIT ?'
    ).all(limit) as SnapshotRow[];

    if (rows.length === 0) {
      console.log(chalk.yellow('\n  No snapshots yet. Run: veris consolidate\n'));
      return;
    }

    console.log(chalk.bold('\n  Brain Timeline\n'));
    console.log(chalk.dim('  Date           Nodes  Edges  Patterns  Topics'));
    console.log(chalk.dim('  ─────────────  ─────  ─────  ────────  ──────'));

    for (const snap of rows) {
      let topics: string[] = [];
      try { topics = JSON.parse(snap.top_topics); } catch { /* */ }
      const topicsStr = topics.slice(0, 3).join(', ') || '-';

      console.log(
        `  ${chalk.cyan(snap.date)}  ${String(snap.node_count).padStart(5)}  ` +
        `${String(snap.edge_count).padStart(5)}  ${String(snap.pattern_count).padStart(8)}  ${topicsStr}`
      );
    }

    console.log();
  });
