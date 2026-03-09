const VERB_MAP: Record<string, string> = {
  bevorzugt: 'I prefer', nutzt: 'I use', plant: 'I plan to', will: 'I want to',
  möchte: 'I want to', hat: 'I have', ist: 'I am', arbeitet: 'I work on',
  baut: 'I build', mag: 'I like', braucht: 'I need', verwendet: 'I use',
  kennt: 'I know', macht: 'I do', sagt: 'I said', findet: 'I find',
  denkt: 'I think', meint: 'I mean', benutzt: 'I use', schreibt: 'I write',
  erstellt: 'I create', entwickelt: 'I develop', testet: 'I test',
  prefers: 'I prefer', uses: 'I use', wants: 'I want to', has: 'I have',
  is: 'I am', works: 'I work on', builds: 'I build', likes: 'I like',
  needs: 'I need', knows: 'I know', thinks: 'I think', said: 'I said',
};

const VERB_PATTERN_DE = Object.keys(VERB_MAP).filter(v => /[äöü]/.test(v) || v.endsWith('t') || v.endsWith('ht')).join('|');
const VERB_PATTERN_EN = Object.keys(VERB_MAP).filter(v => !/[äöü]/.test(v) && !v.endsWith('t')).join('|');
const ALL_VERBS = [...new Set([VERB_PATTERN_DE, VERB_PATTERN_EN])].filter(Boolean).join('|');

export function toFirstPerson(content: string, userName: string): string {
  if (!userName || userName === 'User') return content;

  const nameRegex = new RegExp(`^${escapeRegex(userName)}\\s+(${ALL_VERBS})\\b`, 'i');
  const match = content.match(nameRegex);
  if (match) {
    const verb = match[1].toLowerCase();
    const replacement = VERB_MAP[verb] || `I ${verb}`;
    return content.replace(nameRegex, replacement);
  }

  const midRegex = new RegExp(`\\b${escapeRegex(userName)}\\b`, 'gi');
  if (midRegex.test(content) && !content.startsWith('I ')) {
    return content.replace(midRegex, 'I');
  }

  return content;
}

export function isCleanUserFact(content: string): boolean {
  if (content.includes('→') || content.includes('|') || content.includes('⏺')) return false;
  if (content.startsWith('->') || content.startsWith('//')) return false;
  if (/^[a-zäöü]/.test(content) && !content.includes(':') && !content.startsWith('I ')) return false;
  const words = content.split(/\s+/).filter(w => w.length > 2);
  if (words.length < 4) return false;
  if (/watcher|daemon|prozess|gekillt|socket|port \d|compile|tsc |npm |dist\/|node_modules/i.test(content)) return false;
  if (/^(als|und|oder|aber|wenn|dass|weil|ob|woran|wobei|dabei)\s/i.test(content)) return false;
  return true;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
