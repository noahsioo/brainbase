async function test() {
  const { processMessage } = require('./dist/hooks/user-prompt.js');
  const sid = 'v13-final-' + Date.now();

  console.log('=== MSG 1: React Button ===');
  const r1 = await processMessage({
    message: 'Ich arbeite gerade an meinem React Projekt mit Tailwind. Der Button Component braucht einen Hover-Effekt.',
    session_id: sid, provider: 'claude-code',
  });
  console.log('LENGTH:', (r1.context||'').length, 'chars');
  console.log(r1.context || '(leer)');

  console.log('\n\n=== MSG 2: Button Loading State ===');
  const r2 = await processMessage({
    message: 'Und der Button soll auch einen Loading-State haben mit Spinner. Kannst du mir da helfen?',
    session_id: sid, provider: 'claude-code',
  });
  console.log('LENGTH:', (r2.context||'').length, 'chars');
  console.log(r2.context || '(leer)');

  console.log('\n\n=== MSG 3: SWITCH → Bewerbung ===');
  const r3 = await processMessage({
    message: 'Uebrigens, wie laeuft das mit meiner Bewerbung bei Google? Muss ich da noch was machen?',
    session_id: sid, provider: 'claude-code',
  });
  console.log('LENGTH:', (r3.context||'').length, 'chars');
  console.log(r3.context || '(leer)');

  console.log('\n\n=== MSG 4: SWITCH → Pruefung ===');
  const r4 = await processMessage({
    message: 'Ach und die Pruefungsphase naechste Woche, hast du da irgendwelche Tipps fuer mich?',
    session_id: sid, provider: 'claude-code',
  });
  console.log('LENGTH:', (r4.context||'').length, 'chars');
  console.log(r4.context || '(leer)');

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
