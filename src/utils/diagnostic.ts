import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR } from '../config.js';

const DIAGNOSTIC_ENABLED = process.env.BRAINBASE_DIAGNOSTIC === '1';
const LOG_FILE = join(LOGS_DIR, 'diagnostic.log');

export function diagnosticLog(tag: string, data: Record<string, unknown>): void {
  if (!DIAGNOSTIC_ENABLED) return;
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${tag}] ${JSON.stringify(data)}\n`;
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line);
  } catch { /* silent */ }
}
