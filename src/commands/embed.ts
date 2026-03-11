import { Command } from 'commander';
import chalk from 'chalk';
import { getEmbeddingCount, getNodesWithoutEmbeddings, saveEmbedding } from '../memory/store.js';
import { createEmbeddingClient, invalidateEmbeddingCache } from '../llm/embeddings.js';

export const embedCommand = new Command('embed')
  .description('Manage embeddings for semantic search');

embedCommand
  .command('status')
  .description('Show embedding coverage')
  .action(() => {
    const count = getEmbeddingCount();
    const pct = count.total > 0 ? Math.round((count.embedded / count.total) * 100) : 0;
    console.log(chalk.bold(`Embeddings: ${count.embedded}/${count.total} nodes (${pct}%)`));

    if (count.embedded < count.total) {
      console.log(chalk.gray(`Run 'veris embed backfill' to embed remaining ${count.total - count.embedded} nodes`));
    } else {
      console.log(chalk.green('All nodes embedded!'));
    }
  });

embedCommand
  .command('backfill')
  .description('Create embeddings for all nodes without one')
  .option('-b, --batch <size>', 'Batch size', '50')
  .action(async (opts) => {
    const client = createEmbeddingClient();
    if (!client) {
      console.log(chalk.red('No embedding client available. Configure a cloud provider with an API key.'));
      return;
    }

    const available = await client.isAvailable();
    if (!available) {
      console.log(chalk.red('Embedding API not reachable. Check your API key and connection.'));
      return;
    }

    const batchSize = parseInt(opts.batch, 10);
    let totalEmbedded = 0;

    while (true) {
      const nodes = getNodesWithoutEmbeddings(batchSize);
      if (nodes.length === 0) break;

      const count = getEmbeddingCount();
      console.log(`Embedding ${totalEmbedded + 1}-${totalEmbedded + nodes.length} of ${count.total} nodes...`);

      try {
        const vectors = await client.embedBatch(nodes.map(n => n.content));
        for (let i = 0; i < nodes.length; i++) {
          saveEmbedding(nodes[i].id, vectors[i]);
        }
        totalEmbedded += nodes.length;
      } catch (err) {
        console.log(chalk.red(`Error: ${(err as Error).message}`));
        break;
      }

      // Brief pause between batches
      if (nodes.length === batchSize) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    invalidateEmbeddingCache();
    const final = getEmbeddingCount();
    console.log(chalk.green(`Done! ${final.embedded}/${final.total} nodes embedded.`));
  });
