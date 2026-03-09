async function test() {
  const { processMessage } = require('./dist/hooks/user-prompt.js');
  const db = require('better-sqlite3')(require('os').homedir() + '/.brainbase/data/memory.db');

  // ============================================
  // PHASE 1: LERNEN — 3 Messages mit echtem Content
  // ============================================
  const learnSession = 'learn-' + Date.now();
  console.log('=== PHASE 1: LERNEN ===');
  console.log('Session:', learnSession);

  console.log('\nMSG 1: Technische Praeferenzen...');
  await processMessage({
    message: 'Ich nutze immer Zustand statt Redux fuer State Management in React. Redux ist mir zu verbose. Und fuer Styling nehme ich immer Tailwind, niemals styled-components.',
    session_id: learnSession,
    provider: 'claude-code',
  });

  await new Promise(r => setTimeout(r, 6000));

  console.log('MSG 2: Projekt-Details...');
  await processMessage({
    message: 'Mein aktuelles Projekt heisst CloudDash, das ist ein Dashboard fuer AWS Monitoring. Backend in Go, Frontend in Next.js 14 mit App Router.',
    session_id: learnSession,
    provider: 'claude-code',
  });

  await new Promise(r => setTimeout(r, 6000));

  console.log('MSG 3: Arbeitsweise...');
  await processMessage({
    message: 'Ich teste immer mit Vitest statt Jest, und fuer E2E nutze ich Playwright. CI/CD laeuft ueber GitHub Actions.',
    session_id: learnSession,
    provider: 'claude-code',
  });

  await new Promise(r => setTimeout(r, 8000));

  // ============================================
  // PHASE 2: PRUEFEN — Was wurde gespeichert?
  // ============================================
  console.log('\n\n=== PHASE 2: WAS WURDE GESPEICHERT? ===');

  const checks = [
    'Zustand', 'Redux', 'styled-components', 'CloudDash', 'AWS',
    'Go', 'App Router', 'Vitest', 'Jest', 'Playwright', 'GitHub Actions',
  ];

  for (const term of checks) {
    const found = db.prepare("SELECT type, content FROM nodes WHERE LOWER(content) LIKE LOWER(?)").all('%' + term + '%');
    const status = found.length > 0 ? 'FOUND' : 'MISSING';
    const detail = found.length > 0 ? found.map(f => `[${f.type}] ${f.content.slice(0,60)}`).join(' | ') : '';
    console.log(`  ${term.padEnd(18)} ${status}  ${detail}`);
  }

  // Check for preferences/patterns
  console.log('\n  --- Preferences/Patterns ---');
  const prefs = db.prepare("SELECT type, content FROM nodes WHERE type IN ('preference', 'pattern', 'identity') AND created_at > ?")
    .all(Date.now() - 30000);
  if (prefs.length > 0) {
    prefs.forEach(p => console.log(`  [${p.type}] ${p.content.slice(0,80)}`));
  } else {
    console.log('  KEINE neuen Preferences/Patterns gespeichert!');
  }

  // Check edges
  const recentEdges = db.prepare(`
    SELECT e.type, n1.content as src, n2.content as tgt
    FROM edges e JOIN nodes n1 ON e.source_id=n1.id JOIN nodes n2 ON e.target_id=n2.id
    WHERE e.created_at > ?
  `).all(Date.now() - 30000);
  console.log('\n  --- Neue Beziehungen ---');
  const meaningful = recentEdges.filter(e => e.type !== 'co_mentioned' && e.type !== 'similar_to');
  if (meaningful.length > 0) {
    meaningful.slice(0, 10).forEach(e => console.log(`  ${e.src.slice(0,25).padEnd(27)} -(${e.type})-> ${e.tgt.slice(0,30)}`));
  } else {
    console.log('  KEINE neuen Beziehungen!');
  }

  // ============================================
  // PHASE 3: NUTZEN — Neue Session, wird es benutzt?
  // ============================================
  console.log('\n\n=== PHASE 3: NUTZEN — Neue Session ===');
  const useSession = 'use-' + Date.now();

  console.log('\nTest A: "Hilf mir beim State Management in React"');
  const a = await processMessage({
    message: 'Hilf mir beim State Management in meiner React App. Was soll ich nehmen?',
    session_id: useSession,
    provider: 'claude-code',
  });
  console.log('CONTEXT (' + (a.context||'').length + ' chars):');
  console.log(a.context || '(leer)');

  console.log('\n\nTest B: "Wie teste ich mein Projekt am besten?"');
  const b = await processMessage({
    message: 'Wie soll ich mein Projekt am besten testen? Unit Tests und E2E?',
    session_id: useSession,
    provider: 'claude-code',
  });
  console.log('CONTEXT (' + (b.context||'').length + ' chars):');
  console.log(b.context || '(leer)');

  console.log('\n\nTest C: "Ich arbeite an CloudDash weiter"');
  const c = await processMessage({
    message: 'Ich arbeite jetzt an CloudDash weiter, das AWS Dashboard.',
    session_id: useSession,
    provider: 'claude-code',
  });
  console.log('CONTEXT (' + (c.context||'').length + ' chars):');
  console.log(c.context || '(leer)');

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
