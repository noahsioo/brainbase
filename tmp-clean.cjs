const db = require('better-sqlite3')(require('os').homedir() + '/.veris/data/memory.db');

// Find garbage preference nodes
const prefs = db.prepare("SELECT id, content FROM nodes WHERE type = 'preference'").all();
console.log('Preference nodes:');
for (const p of prefs) {
  const isGarbage = p.content.includes('Schei') || p.content.includes('verfick') || p.content.includes('was los mit dir') || p.content.length > 200;
  console.log('  ' + (isGarbage ? 'GARBAGE' : 'OK') + ': ' + p.content.slice(0, 80));
  if (isGarbage) {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(p.id);
    db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(p.id, p.id);
    db.prepare('DELETE FROM embeddings WHERE node_id = ?').run(p.id);
    console.log('    DELETED');
  }
}

// Also clean example nodes that are just raw user messages
const examples = db.prepare("SELECT id, content FROM nodes WHERE type = 'example'").all();
console.log('\nExample nodes:');
for (const e of examples) {
  const isGarbage = e.content.includes('Schei') || e.content.includes('stehen geblieben') || e.content.includes('schnell f') || e.content.length > 500;
  console.log('  ' + (isGarbage ? 'GARBAGE' : 'OK') + ': ' + e.content.slice(0, 80));
  if (isGarbage) {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(e.id);
    db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(e.id, e.id);
    db.prepare('DELETE FROM embeddings WHERE node_id = ?').run(e.id);
    console.log('    DELETED');
  }
}

// Review all remaining nodes
const allNodes = db.prepare('SELECT id, type, content FROM nodes ORDER BY type, created_at DESC').all();
console.log('\nAll remaining nodes (' + allNodes.length + '):');
let lastType = '';
for (const n of allNodes) {
  if (n.type !== lastType) {
    console.log('\n[' + n.type + ']');
    lastType = n.type;
  }
  console.log('  ' + n.content.slice(0, 100));
}
