const db = require('better-sqlite3')(require('os').homedir() + '/.brainbase/data/memory.db');

// Fix entity name pollution — remove "(+ Negative feedback bei:)" from entity content
const polluted = db.prepare("SELECT id, content FROM nodes WHERE content LIKE '%(+ Negative feedback%'").all();
console.log('Polluted entity names:', polluted.length);
for (const p of polluted) {
  const clean = p.content.replace(/\s*\(\+\s*Negative feedback bei:\)/, '').trim();
  if (clean.length >= 2 && clean !== p.content) {
    db.prepare('UPDATE nodes SET content = ? WHERE id = ?').run(clean, p.id);
    console.log('  Fixed:', p.content.slice(0,40), '→', clean);
  }
}

// Check reminder scores for debugging
const { scoreReminderRelevance } = require('./dist/memory/prospective.js');
const reminders = db.prepare("SELECT * FROM nodes WHERE type = 'prospective'").all();
const topic = 'button hover effect';
console.log('\nReminder scores for topic "' + topic + '":');
for (const r of reminders) {
  const score = scoreReminderRelevance(r, topic, []);
  console.log('  [' + score.toFixed(2) + '] ' + r.content.slice(0, 60));
}

// Check: what does getUpcomingReminders return?
const { getUpcomingReminders } = require('./dist/memory/prospective.js');
const upcoming = getUpcomingReminders(48);
console.log('\ngetUpcomingReminders(48):', upcoming.length, 'items');
upcoming.forEach(m => {
  const score = scoreReminderRelevance(m.node, topic, []);
  console.log('  [score=' + score.toFixed(2) + '] ' + m.node.content.slice(0, 60));
});
