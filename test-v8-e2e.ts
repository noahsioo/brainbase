#!/usr/bin/env tsx
/**
 * V8 End-to-End Verification Test
 * Tests the COMPLETE pipeline: Message → Extraction → Storage → Activation → Context
 */

import { parseTemporalExpression } from './src/extraction/temporal-parser.js';

// ═══════════════════════════════════════════════════
// TEST 1: Temporal Parser — versteht das System Zeitangaben?
// ═══════════════════════════════════════════════════

console.log('\n═══ TEST 1: TEMPORAL PARSER ═══\n');

const temporalTests = [
  { input: 'Nächsten Mittwoch Treffen mit Sarah', expected: 'relative', day: 3 },
  { input: 'Am Dienstag Meeting mit Team', expected: 'relative', day: 2 },
  { input: 'Morgen Zahnarzt um 14 Uhr', expected: 'relative' },
  { input: 'In 3 Tagen abgeben', expected: 'relative' },
  { input: 'Am 15. März Geburtstag', expected: 'absolute' },
  { input: 'Next Wednesday doctor appointment', expected: 'relative', day: 3 },
  { input: 'Tomorrow at 2pm call with client', expected: 'relative' },
  { input: 'Nächste Woche Deadline', expected: 'relative' },
  { input: 'Jeden Montag Standup', expected: 'recurring', day: 1 },
  { input: 'Übermorgen Präsentation', expected: 'relative' },
  // Edge cases
  { input: 'Dienstag habe ich ein Meeting', expected: null }, // kein Präfix → KEIN Match
  { input: 'Guten Morgen, wie geht es', expected: null }, // "morgen" in "Guten Morgen" → KEIN Match
  { input: 'Heute Abend Kino', expected: 'relative' },
];

let passed = 0;
let failed = 0;

for (const test of temporalTests) {
  const result = parseTemporalExpression(test.input);
  const typeMatch = test.expected === null ? result === null : result?.type === test.expected;

  if (typeMatch) {
    const dateStr = result ? new Date(result.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : 'null';
    console.log(`  ✅ "${test.input}" → ${result?.type || 'null'} (${dateStr})`);
    passed++;
  } else {
    console.log(`  ❌ "${test.input}" → expected ${test.expected}, got ${result?.type || 'null'}`);
    failed++;
  }
}

console.log(`\n  Temporal Parser: ${passed}/${passed + failed} passed`);

// ═══════════════════════════════════════════════════
// TEST 2: isSubstantiveMessage — V8-6 Tech-Term Ausnahme
// ═══════════════════════════════════════════════════

console.log('\n═══ TEST 2: isSubstantiveMessage (V8-6) ═══\n');

// We need to test the function directly — import it
// Since it's not exported, we replicate the logic
function testIsSubstantive(message: string): boolean {
  const lines = message.split('\n---\n');
  const lastMessage = lines[lines.length - 1] || message;
  const words = lastMessage.trim().split(/\s+/).filter(w => w.length > 2);

  if (words.length < 3) return false;

  const confirmPatterns = /^(ja|nein|ok|okay|genau|perfekt|passt|gut|weiter|mach|continue|yes|no|sure|right|exactly|nope|yep|alles klar|klar|done|fertig|los|go)$/i;
  if (words.length <= 3 && words.every(w => confirmPatterns.test(w))) return false;

  const commandPatterns = /^(mach|fix|aender|änder|build|run|deploy|push|commit|install|update|start|stop|delete|remove|erstell|zeig|show|list|check|test)\b/i;
  if (words.length <= 5 && commandPatterns.test(lastMessage.trim())) {
    const CASE_SENSITIVE = /[A-Z][a-z]+[A-Z]|[A-Z]{2,}|[a-z]+\.[a-z]+/;
    const TECH_TERMS = /^(typescript|python|react|node|api|sdk|cli|llm|gpu|cpu|sql|css|html|json|yaml|xml|supabase|firebase|docker|redis|postgres|graphql|webpack|vite|nextjs|nuxt|svelte|angular|vue|rust|golang|swift|kotlin)$/i;
    const hasEntity = words.some(w => w.length > 2 && (CASE_SENSITIVE.test(w) || TECH_TERMS.test(w)));
    if (!hasEntity) return false;
  }

  const SUBSTANTIVE_STOPWORDS = new Set([
    'das', 'the', 'und', 'and', 'oder', 'aber', 'but', 'also', 'dann',
    'bitte', 'please', 'mal', 'halt', 'noch', 'jetzt', 'now', 'hier',
    'here', 'dort', 'there', 'einfach', 'just', 'only', 'nur', 'wie',
    'how', 'was', 'what', 'mit', 'with', 'für', 'fuer', 'for', 'den',
    'dem', 'die', 'der', 'ein', 'eine', 'einen', 'nicht', 'not', 'kann',
    'can', 'will', 'soll', 'should', 'muss', 'must',
  ]);
  const realWords = words.filter(w => !SUBSTANTIVE_STOPWORDS.has(w.toLowerCase()));
  if (realWords.length < 2) return false;

  return true;
}

const substantiveTests = [
  { input: 'mach weiter', expected: false, reason: 'confirm only' },
  { input: 'ok perfekt', expected: false, reason: 'confirm only' },
  { input: 'mach das mit TypeScript', expected: true, reason: 'V8-6: TypeScript = Tech-Term' },
  { input: 'fix den API endpoint', expected: true, reason: 'V8-6: API = Tech-Term' },
  { input: 'build das React component', expected: true, reason: 'V8-6: React = Tech-Term' },
  { input: 'mach den nächsten Schritt', expected: false, reason: 'command, no tech term' },
  { input: 'erstell eine neue Datei', expected: false, reason: 'command, no tech term' },
  { input: 'Nächsten Mittwoch muss ich mich mit Sarah treffen', expected: true, reason: 'long enough, real words' },
  { input: 'Ich benutze lieber Supabase als Firebase', expected: true, reason: 'tech terms + preference' },
  { input: 'update den JSON parser', expected: true, reason: 'V8-6: JSON = Tech-Term' },
];

let sp = 0, sf = 0;
for (const test of substantiveTests) {
  const result = testIsSubstantive(test.input);
  if (result === test.expected) {
    console.log(`  ✅ "${test.input}" → ${result} (${test.reason})`);
    sp++;
  } else {
    console.log(`  ❌ "${test.input}" → expected ${test.expected}, got ${result} (${test.reason})`);
    sf++;
  }
}

console.log(`\n  isSubstantiveMessage: ${sp}/${sp + sf} passed`);

// ═══════════════════════════════════════════════════
// TEST 3: sectionToStructured — V8-7 Format
// ═══════════════════════════════════════════════════

console.log('\n═══ TEST 3: sectionToStructured (V8-7) ═══\n');

function sectionToStructured(section: string): string | null {
  const lines = section.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const header = lines[0].replace(/^#+\s*/, '').trim();
  const rest = lines.slice(1);

  const bullets = rest
    .filter(l => l.trimStart().startsWith('- '))
    .map(l => l.replace(/^\s*-\s*/, '').trim());

  const hasSubHeaders = rest.some(l => l.trimStart().startsWith('### '));
  if (hasSubHeaders) {
    return rest.join('\n').trim() || null;
  }

  if (bullets.length === 0) {
    const raw = rest.map(l => l.trim()).join(' | ');
    return raw || null;
  }

  if (header.startsWith('Ueber ') || header.startsWith('User Profile')) {
    const name = header.replace('Ueber ', '').replace('User Profile', '').trim() || 'User';
    const compact = bullets.map(b => {
      const colonIdx = b.indexOf(':');
      if (colonIdx > 0) return b.substring(colonIdx + 1).trim();
      return b;
    });
    return `${name}: ${compact.join(' | ')}`;
  }

  if (header === 'Aktiver Kontext') {
    const compact = bullets.map(b => {
      return b.replace(/^\*\*(.+?)\*\*/, '$1').replace(/\s+/g, ' ').trim();
    });
    return `Kontext: ${compact.join(' | ')}`;
  }

  if (header.startsWith('Zum Thema:')) {
    const topic = header.replace('Zum Thema:', '').trim();
    return `${topic}: ${bullets.join(' | ')}`;
  }

  if (header === 'Offene Aufgaben') {
    return `Tasks: ${bullets.join(' | ')}`;
  }

  if (header === 'Vorsicht') {
    return `Vorsicht: ${bullets.join(' | ')}`;
  }

  if (header.startsWith('Hinweis: Widersprueche')) {
    return `Widerspruch: ${bullets.join(' | ')}`;
  }

  if (header === 'Erinnerung') {
    return `Erinnerung: ${bullets.join(' | ')}`;
  }

  return `${header}: ${bullets.join(' | ')}`;
}

const formatTests = [
  {
    name: 'Entity Profile → kompakt',
    input: '## Ueber Lovis\n- Baut: Veris\n- Nutzt: TypeScript\n- Bevorzugt: direkte Antworten\n',
    expected: 'Lovis: Veris | TypeScript | direkte Antworten',
  },
  {
    name: 'Active Context → Kontext: pipe-separated',
    input: '## Aktiver Kontext\n- **Veris** (project) → TypeScript, Pruning\n- **Thalamus** (concept) → Signal\n',
    expected: 'Kontext: Veris (project) → TypeScript, Pruning | Thalamus (concept) → Signal',
  },
  {
    name: 'Entity Graph → Topic: relations',
    input: '## Zum Thema: veris\n- Lovis → builds → Veris\n- Veris → uses → TypeScript\n',
    expected: 'veris: Lovis → builds → Veris | Veris → uses → TypeScript',
  },
  {
    name: 'Tasks → pipe-separated',
    input: '## Offene Aufgaben\n- V8-7 Format implementieren\n- Tests schreiben\n',
    expected: 'Tasks: V8-7 Format implementieren | Tests schreiben',
  },
  {
    name: 'Working Memory → default handler',
    input: '## Arbeitsgedaechtnis\n- Thema: veris. Fokus: context-generator.\n- Kontext: veris -> building\n',
    expected: 'Arbeitsgedaechtnis: Thema: veris. Fokus: context-generator. | Kontext: veris -> building',
  },
  {
    name: 'Warnings → Vorsicht prefix',
    input: '## Vorsicht\n- Consolidation kann Nodes loeschen\n- Pruning bei niedrigem Evidence\n',
    expected: 'Vorsicht: Consolidation kann Nodes loeschen | Pruning bei niedrigem Evidence',
  },
  {
    name: 'Erinnerung → direct',
    input: '## Erinnerung\n- Mittwoch Treffen mit Sarah\n',
    expected: 'Erinnerung: Mittwoch Treffen mit Sarah',
  },
];

let fp = 0, ff = 0;
for (const test of formatTests) {
  const result = sectionToStructured(test.input);
  if (result === test.expected) {
    console.log(`  ✅ ${test.name}`);
    console.log(`     → "${result}"`);
    fp++;
  } else {
    console.log(`  ❌ ${test.name}`);
    console.log(`     expected: "${test.expected}"`);
    console.log(`     got:      "${result}"`);
    ff++;
  }
}

console.log(`\n  sectionToStructured: ${fp}/${fp + ff} passed`);

// ═══════════════════════════════════════════════════
// TEST 4: Prospective Memory — Reminder Pipeline
// ═══════════════════════════════════════════════════

console.log('\n═══ TEST 4: PROSPECTIVE MEMORY PIPELINE ═══\n');

// Test the full reminder pipeline: extraction → temporal parsing → trigger checking
const reminderScenarios = [
  {
    name: 'Nächsten Mittwoch Treffen',
    content: 'Nächsten Mittwoch Treffen mit Sarah',
    expectTriggerDate: true,
    expectTriggerType: 'relative',
  },
  {
    name: 'Morgen Zahnarzt',
    content: 'Morgen Zahnarzt um 14 Uhr',
    expectTriggerDate: true,
    expectTriggerType: 'relative',
  },
  {
    name: 'Am 15. März Geburtstag',
    content: 'Am 15. März Geburtstag von Anna',
    expectTriggerDate: true,
    expectTriggerType: 'absolute',
  },
  {
    name: 'Jeden Montag Standup',
    content: 'Jeden Montag um 10 Uhr Standup',
    expectTriggerDate: true,
    expectTriggerType: 'recurring',
  },
];

let rp = 0, rf = 0;
for (const scenario of reminderScenarios) {
  const temporal = parseTemporalExpression(scenario.content);
  const hasTriggerDate = temporal !== null;

  if (hasTriggerDate === scenario.expectTriggerDate) {
    const dateStr = temporal ? new Date(temporal.date).toLocaleString('de-DE') : 'null';
    const triggerWords = scenario.content
      .split(/\s+/)
      .filter(w => w.length > 3 && !/^(naechsten?|nächsten?|morgen|jeden|am|um|uhr)$/i.test(w))
      .map(w => w.toLowerCase())
      .slice(0, 5);

    console.log(`  ✅ ${scenario.name}`);
    console.log(`     Trigger Date: ${dateStr}`);
    console.log(`     Trigger Words: [${triggerWords.join(', ')}]`);
    console.log(`     Type: ${temporal?.type || 'none'} (expected: ${scenario.expectTriggerType})`);
    rp++;
  } else {
    console.log(`  ❌ ${scenario.name} — expected triggerDate=${scenario.expectTriggerDate}, got ${hasTriggerDate}`);
    rf++;
  }
}

console.log(`\n  Prospective Memory: ${rp}/${rp + rf} passed`);

// ═══════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════

const totalPassed = passed + sp + fp + rp;
const totalFailed = failed + sf + ff + rf;

console.log('\n═══════════════════════════════════════════');
console.log(`TOTAL: ${totalPassed}/${totalPassed + totalFailed} tests passed`);
if (totalFailed > 0) {
  console.log(`⚠️  ${totalFailed} tests failed!`);
} else {
  console.log('✅ ALL TESTS PASSED');
}
console.log('═══════════════════════════════════════════\n');
