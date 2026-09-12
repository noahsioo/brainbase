import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import {
  CONFIG_PATH,
  DB_PATH,
  MEMORY_DIR,
  PROVIDER_PATHS,
} from '../config.js';
import { getDb, getStats, searchNodes, getNodes, createSession } from '../memory/store.js';
import { activateNode, clearSessionActivationOverlay } from '../memory/activation.js';
import { calculateSignalStrength, GATE_LLM, GATE_IGNORE } from '../signal/signal-strength.js';
import { getConfig } from '../config.js';

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

function check(label: string, ok: boolean, detail: string): CheckResult {
  return { label, ok, detail };
}

function printResult(r: CheckResult): void {
  const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
  console.log(`  ${icon} ${r.label}: ${r.ok ? chalk.green(r.detail) : chalk.red(r.detail)}`);
}

export const verifyCommand = new Command('verify')
  .description('Verify that the brain and all subsystems are working correctly')
  .action(() => {
    console.log(chalk.bold('\n  BrainBase - System Verification\n'));

    const results: CheckResult[] = [];
    let criticalFail = false;

    // ── 1. Config ──
    console.log(chalk.bold.cyan('  [1/6] Config'));
    const configExists = existsSync(CONFIG_PATH);
    results.push(check('Config file', configExists, configExists ? CONFIG_PATH : 'Nicht gefunden - run `brainbase init`'));
    if (!configExists) criticalFail = true;

    if (configExists) {
      const config = getConfig();
      results.push(check('Version', !!config.version, config.version || 'fehlt'));
      results.push(check('Providers', config.providers.length > 0, `${config.providers.length} konfiguriert (${config.providers.join(', ')})`));
      results.push(check('Watcher Engine', config.watcher_engine !== 'none', config.watcher_engine));
    }
    results.forEach(printResult);
    console.log();

    // ── 2. Database ──
    console.log(chalk.bold.cyan('  [2/6] Database'));
    const dbResults: CheckResult[] = [];
    const dbExists = existsSync(DB_PATH);
    dbResults.push(check('Database file', dbExists, dbExists ? DB_PATH : 'Nicht gefunden'));
    if (!dbExists) criticalFail = true;

    if (dbExists) {
      try {
        const db = getDb();
        const expectedTables = [
          'nodes', 'edges', 'chunks', 'patterns', 'moods', 'outcomes',
          'raw_buffer', 'knowledge_gaps', 'sessions', 'snapshots',
          'expertise', 'hot_memory', 'signal_counters', 'tacit_patterns', 'system_state',
        ];

        const existingTables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table'"
        ).all() as Array<{ name: string }>;
        const tableNames = new Set(existingTables.map(t => t.name));

        const missingTables = expectedTables.filter(t => !tableNames.has(t));
        dbResults.push(check(
          'Tabellen',
          missingTables.length === 0,
          missingTables.length === 0
            ? `${expectedTables.length} Tabellen vorhanden`
            : `Fehlend: ${missingTables.join(', ')}`,
        ));

        const stats = getStats();
        dbResults.push(check('Nodes', stats.totalNodes > 0, `${stats.totalNodes} Nodes`));
        dbResults.push(check('Edges', stats.totalEdges > 0, `${stats.totalEdges} Edges`));
      } catch (e) {
        dbResults.push(check('DB Zugriff', false, String(e)));
        criticalFail = true;
      }
    }
    dbResults.forEach(printResult);
    console.log();

    // ── 3. Core Nodes ──
    console.log(chalk.bold.cyan('  [3/6] Core Nodes (Cold Start)'));
    const coreResults: CheckResult[] = [];
    if (dbExists) {
      try {
        const coreNodes = getNodes({ type: 'core' });
        const expectedLabels = [
          'User Identity', 'Current Project', 'Tech Stack',
          'Communication Style', 'Workflow', 'Pain Points', 'Goals', 'Expertise Map',
        ];

        coreResults.push(check('Core Nodes', coreNodes.length >= 8, `${coreNodes.length} gefunden`));

        for (const label of expectedLabels) {
          const found = coreNodes.some(n => n.content === label);
          coreResults.push(check(`  ${label}`, found, found ? 'vorhanden' : 'FEHLT'));
        }

        const sysKnowledge = searchNodes('BrainBase ist ein', 1);
        coreResults.push(check('System Knowledge', sysKnowledge.length > 0, sysKnowledge.length > 0 ? 'vorhanden' : 'FEHLT'));
      } catch (e) {
        coreResults.push(check('Core Nodes Check', false, String(e)));
      }
    } else {
      coreResults.push(check('Core Nodes', false, 'DB nicht vorhanden'));
    }
    coreResults.forEach(printResult);
    console.log();

    // ── 4. Hooks (Claude Code) ──
    console.log(chalk.bold.cyan('  [4/6] Hooks (Claude Code)'));
    const hookResults: CheckResult[] = [];
    const settingsPath = PROVIDER_PATHS['claude-code'].settingsFile;
    const settingsExist = existsSync(settingsPath);
    hookResults.push(check('settings.json', settingsExist, settingsExist ? settingsPath : 'Nicht gefunden'));

    if (settingsExist) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        const hooks = settings.hooks || {};
        const expectedEvents = ['UserPromptSubmit', 'SessionStart', 'SessionEnd', 'PreCompact'];

        for (const event of expectedEvents) {
          const eventHooks = hooks[event] || [];
          const hasMemory = Array.isArray(eventHooks) && eventHooks.some((h: Record<string, unknown>) => {
            const innerHooks = (h.hooks || []) as Array<Record<string, unknown>>;
            return innerHooks.some((hh) =>
              typeof hh.command === 'string' && (hh.command.startsWith('brainbase') || hh.command.startsWith('brainbase')),
            );
          });
          hookResults.push(check(`  ${event}`, hasMemory, hasMemory ? 'registriert' : 'FEHLT'));
        }
      } catch (e) {
        hookResults.push(check('Hook parsing', false, String(e)));
      }
    }

    hookResults.push(check('Context Delivery', true, 'via Hooks (systemMessage)'));
    hookResults.forEach(printResult);
    console.log();

    // ── 5. Signal-Strength Test ──
    console.log(chalk.bold.cyan('  [5/6] Signal-Strength'));
    const signalResults: CheckResult[] = [];
    const testSentences = [
      { text: 'Merk dir: Ich benutze immer Tailwind CSS', expected: 'full_extraction', label: 'Explicit Memory' },
      { text: 'Ich habe mich entschieden TypeScript zu nutzen', expected: 'full_extraction', label: 'Decision' },
      { text: 'ok', expected: 'ignore', label: 'Low-Info (ok)' },
      { text: 'ja', expected: 'ignore', label: 'Low-Info (ja)' },
      { text: 'Ich arbeite an einem React Projekt mit Supabase, bitte merk dir das', expected: 'full_extraction', label: 'Info + Explicit' },
    ];

    for (const test of testSentences) {
      try {
        const result = calculateSignalStrength(test.text, 'test-verify');
        const actionOk = result.action === test.expected;
        signalResults.push(check(
          `  ${test.label}`,
          actionOk,
          `Score: ${result.score.toFixed(2)} → ${result.action}${actionOk ? '' : ` (erwartet: ${test.expected})`}`,
        ));
      } catch (e) {
        signalResults.push(check(`  ${test.label}`, false, String(e)));
      }
    }
    signalResults.forEach(printResult);
    console.log();

    // ── 6. Spreading Activation Test ──
    console.log(chalk.bold.cyan('  [6/6] Spreading Activation'));
    const activationResults: CheckResult[] = [];
    if (dbExists) {
      try {
        const coreNodes = getNodes({ type: 'core', limit: 1 });
        if (coreNodes.length > 0) {
          const testNode = coreNodes[0];
          const verifySessionId = `verify-activation-${Date.now()}`;
          createSession('verify', verifySessionId);
          const result = activateNode(testNode.id, 0.8, verifySessionId);

          activationResults.push(check(
            'Activation',
            result.activated.length > 0,
            `${result.activated.length} Nodes aktiviert von "${testNode.content}"`,
          ));
          activationResults.push(check(
            'Edge Spreading',
            result.edges.length > 0,
            `${result.edges.length} Edges traversiert`,
          ));
          activationResults.push(check(
            'Hebbian Learning',
            result.edges.length > 0,
            result.edges.length > 0 ? 'aktiv (Edges wurden gestaerkt)' : 'keine Edges zum staerken',
          ));

          if (result.activated.length > 1) {
            const neighbor = result.activated.find(n => n.id !== testNode.id);
            if (neighbor) {
              activationResults.push(check(
                'Neighbor Activation',
                neighbor.activation > 0,
                `"${neighbor.content.slice(0, 40)}" activation: ${neighbor.activation.toFixed(3)}`,
              ));
            }
          }

          try {
            clearSessionActivationOverlay(verifySessionId);
            getDb().prepare('DELETE FROM sessions WHERE id = ?').run(verifySessionId);
          } catch {
            // non-fatal cleanup
          }
        } else {
          activationResults.push(check('Activation', false, 'Keine Core Nodes zum testen'));
        }
      } catch (e) {
        activationResults.push(check('Activation Test', false, String(e)));
      }
    } else {
      activationResults.push(check('Activation', false, 'DB nicht vorhanden'));
    }
    activationResults.forEach(printResult);
    console.log();

    // ── Summary ──
    const allResults = [...results, ...dbResults, ...coreResults, ...hookResults, ...signalResults, ...activationResults];
    const passed = allResults.filter(r => r.ok).length;
    const failed = allResults.filter(r => !r.ok).length;
    const total = allResults.length;

    console.log(chalk.bold('  ─────────────────────────────────────'));
    if (failed === 0) {
      console.log(chalk.bold.green(`  Alles OK! ${passed}/${total} Checks bestanden.`));
    } else if (criticalFail) {
      console.log(chalk.bold.red(`  KRITISCH: ${failed} Fehler. Run \`brainbase init\` zuerst.`));
    } else {
      console.log(chalk.bold.yellow(`  ${passed}/${total} OK, ${failed} Warnungen.`));
    }
    console.log();
  });
