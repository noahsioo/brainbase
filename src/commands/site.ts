import { Command } from 'commander';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const siteCommand = new Command('site')
  .description('Open the Memory Unlimited landing page')
  .option('-p, --port <port>', 'Port number', '7878')
  .action((opts) => {
    const port = parseInt(opts.port, 10);

    const htmlPath = join(__dirname, '..', 'landing', 'index.html');
    let html: string;
    try {
      html = readFileSync(htmlPath, 'utf-8');
    } catch {
      console.error('Landing page HTML not found at:', htmlPath);
      process.exit(1);
    }

    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });

    server.listen(port, () => {
      console.log(`\n  Memory Unlimited - Landing Page\n`);
      console.log(`  http://localhost:${port}\n`);
      console.log(`  Press Ctrl+C to stop.\n`);
    });
  });
