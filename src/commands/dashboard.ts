import { Command } from 'commander';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, getStats, type Node, type Edge } from '../memory/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAllNodes(): Node[] {
  const db = getDb();
  return db.prepare('SELECT * FROM nodes ORDER BY importance DESC').all() as Node[];
}

function getAllEdges(): Edge[] {
  const db = getDb();
  return db.prepare('SELECT * FROM edges ORDER BY strength DESC').all() as Edge[];
}

function getGraphData() {
  const nodes = getAllNodes();
  const edges = getAllEdges();
  const stats = getStats();
  return { nodes, edges, stats };
}

export const dashboardCommand = new Command('dashboard')
  .description('Open the Brain Dashboard (3D visualization)')
  .option('-p, --port <port>', 'Port number', '7877')
  .action((opts) => {
    const port = parseInt(opts.port, 10);

    const htmlPath = join(__dirname, '..', 'dashboard', 'index.html');
    let html: string;
    try {
      html = readFileSync(htmlPath, 'utf-8');
    } catch {
      console.error('Dashboard HTML not found at:', htmlPath);
      process.exit(1);
    }

    const server = createServer((req, res) => {
      if (req.url === '/api/graph') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getGraphData()));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });

    server.listen(port, () => {
      console.log(`\n  Memory Unlimited - Brain Dashboard\n`);
      console.log(`  http://localhost:${port}\n`);
      console.log(`  Press Ctrl+C to stop.\n`);
    });
  });
