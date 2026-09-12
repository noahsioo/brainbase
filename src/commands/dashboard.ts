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

function getExpertiseData() {
  const db = getDb();
  return db.prepare('SELECT * FROM expertise ORDER BY level DESC').all();
}

function getSessionsData() {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50').all();
}

function getPatternsData() {
  const db = getDb();
  return db.prepare('SELECT * FROM patterns ORDER BY confidence DESC LIMIT 20').all();
}

function getSnapshotsData() {
  const db = getDb();
  return db.prepare('SELECT * FROM snapshots ORDER BY date ASC').all();
}

function getActivityData() {
  const db = getDb();
  const recentNodes = db.prepare('SELECT * FROM nodes ORDER BY created_at DESC LIMIT 20').all();
  const recentEdges = db.prepare(`
    SELECT e.*, n1.content as source_content, n2.content as target_content
    FROM edges e
    LEFT JOIN nodes n1 ON e.source_id = n1.id
    LEFT JOIN nodes n2 ON e.target_id = n2.id
    ORDER BY e.created_at DESC LIMIT 20
  `).all();
  const recentOutcomes = db.prepare(`
    SELECT o.*, n.content as problem_content
    FROM outcomes o
    LEFT JOIN nodes n ON o.problem_node_id = n.id
    ORDER BY o.timestamp DESC LIMIT 10
  `).all();
  return { nodes: recentNodes, edges: recentEdges, outcomes: recentOutcomes };
}

function getHealthData() {
  const db = getDb();
  const totalNodes = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
  const totalEdges = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as any).c;

  if (totalNodes === 0) return { connectivity: 0, freshness: 0, coherence: 1, score: 0 };

  const nodesWithManyEdges = db.prepare(`
    SELECT node_id, COUNT(*) as cnt FROM (
      SELECT source_id as node_id FROM edges
      UNION ALL
      SELECT target_id as node_id FROM edges
    ) GROUP BY node_id HAVING cnt >= 3
  `).all() as any[];
  const connectivity = nodesWithManyEdges.length / totalNodes;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const freshNodes = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE last_activated > ?').get(sevenDaysAgo) as any).c;
  const freshness = freshNodes / totalNodes;

  const contradictsEdges = (db.prepare("SELECT COUNT(*) as c FROM edges WHERE type = 'contradicts'").get() as any).c;
  const coherence = 1 - contradictsEdges / Math.max(totalEdges, 1);

  const score = Math.round(((connectivity + freshness + coherence) / 3) * 100);

  return { connectivity, freshness, coherence, score };
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
      const url = req.url || '/';

      if (url === '/api/graph') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getGraphData()));
        return;
      }

      if (url === '/api/expertise') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getExpertiseData()));
        return;
      }

      if (url === '/api/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getSessionsData()));
        return;
      }

      if (url === '/api/patterns') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getPatternsData()));
        return;
      }

      if (url === '/api/snapshots') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getSnapshotsData()));
        return;
      }

      if (url === '/api/activity') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getActivityData()));
        return;
      }

      if (url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getHealthData()));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(html);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`\n  Dashboard is already running on http://localhost:${port}\n`);
        console.log(`  Open the URL above in your browser.\n`);
        process.exit(0);
      } else {
        console.error(`\n  Error starting dashboard: ${err.message}\n`);
        process.exit(1);
      }
    });

    server.listen(port, () => {
      console.log(`\n  BrainBase - Brain Dashboard\n`);
      console.log(`  http://localhost:${port}\n`);
      console.log(`  Press Ctrl+C to stop.\n`);
    });
  });
