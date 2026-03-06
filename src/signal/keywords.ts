export interface KeywordEntry {
  word: string;
  intensity: number;
}

export interface KeywordFlags {
  frustration: boolean;
  decision: boolean;
  explicit_memory: boolean;
  task: boolean;
  emotion_intensity: number;
  self_generated: boolean;
}

// Frustrations-Keywords (DE + EN)
export const FRUSTRATION_KEYWORDS: KeywordEntry[] = [
  // DE - stark
  { word: 'scheisse', intensity: 0.9 },
  { word: 'scheiße', intensity: 0.9 },
  { word: 'fuck', intensity: 0.9 },
  { word: 'verdammt', intensity: 0.8 },
  { word: 'kotzt mich an', intensity: 0.9 },
  { word: 'nervt', intensity: 0.7 },
  { word: 'hasse', intensity: 0.8 },
  { word: 'frustriert', intensity: 0.7 },
  { word: 'klappt nicht', intensity: 0.7 },
  { word: 'geht nicht', intensity: 0.6 },
  { word: 'funktioniert nicht', intensity: 0.7 },
  { word: 'kapiert nicht', intensity: 0.6 },
  { word: 'versteh nicht', intensity: 0.5 },
  { word: 'problem', intensity: 0.4 },
  { word: 'fehler', intensity: 0.5 },
  { word: 'bug', intensity: 0.5 },
  { word: 'kaputt', intensity: 0.6 },
  { word: 'broken', intensity: 0.6 },
  { word: 'stuck', intensity: 0.5 },
  { word: 'stecke fest', intensity: 0.5 },

  // EN - strong
  { word: 'shit', intensity: 0.9 },
  { word: 'damn', intensity: 0.7 },
  { word: 'frustrated', intensity: 0.7 },
  { word: 'annoying', intensity: 0.6 },
  { word: 'hate this', intensity: 0.8 },
  { word: 'doesn\'t work', intensity: 0.7 },
  { word: 'not working', intensity: 0.7 },
  { word: 'broken', intensity: 0.6 },
  { word: 'can\'t figure', intensity: 0.6 },
  { word: 'impossible', intensity: 0.7 },
  { word: 'giving up', intensity: 0.8 },
  { word: 'waste of time', intensity: 0.8 },
];

// Decision-Keywords (DE + EN)
export const DECISION_KEYWORDS: KeywordEntry[] = [
  // DE
  { word: 'entschieden', intensity: 0.9 },
  { word: 'entscheidung', intensity: 0.8 },
  { word: 'wir nehmen', intensity: 0.8 },
  { word: 'wir machen', intensity: 0.6 },
  { word: 'ich will', intensity: 0.7 },
  { word: 'lass uns', intensity: 0.6 },
  { word: 'ab jetzt', intensity: 0.8 },
  { word: 'ab sofort', intensity: 0.8 },
  { word: 'endgueltig', intensity: 0.9 },
  { word: 'endgültig', intensity: 0.9 },
  { word: 'final', intensity: 0.8 },
  { word: 'festgelegt', intensity: 0.8 },
  { word: 'beschlossen', intensity: 0.9 },
  { word: 'statt', intensity: 0.5 },
  { word: 'anstatt', intensity: 0.5 },
  { word: 'gewechselt zu', intensity: 0.7 },
  { word: 'umgestiegen auf', intensity: 0.7 },

  // EN
  { word: 'decided', intensity: 0.9 },
  { word: 'decision', intensity: 0.8 },
  { word: 'we\'ll use', intensity: 0.8 },
  { word: 'we\'ll go with', intensity: 0.8 },
  { word: 'let\'s go with', intensity: 0.7 },
  { word: 'from now on', intensity: 0.8 },
  { word: 'switching to', intensity: 0.7 },
  { word: 'instead of', intensity: 0.5 },
  { word: 'final choice', intensity: 0.9 },
  { word: 'committed to', intensity: 0.8 },
  { word: 'locked in', intensity: 0.8 },
];

// Explicit Memory Request Keywords (DE + EN)
export const EXPLICIT_MEMORY_KEYWORDS: KeywordEntry[] = [
  // DE
  { word: 'merk dir', intensity: 1.0 },
  { word: 'merke dir', intensity: 1.0 },
  { word: 'vergiss nicht', intensity: 0.9 },
  { word: 'wichtig', intensity: 0.7 },
  { word: 'denk dran', intensity: 0.9 },
  { word: 'erinner dich', intensity: 1.0 },
  { word: 'speicher', intensity: 1.0 },
  { word: 'notier', intensity: 0.9 },
  { word: 'behalte', intensity: 0.8 },
  { word: 'fuer spaeter', intensity: 0.7 },
  { word: 'für später', intensity: 0.7 },

  // EN
  { word: 'remember', intensity: 1.0 },
  { word: 'don\'t forget', intensity: 0.9 },
  { word: 'important', intensity: 0.7 },
  { word: 'keep in mind', intensity: 0.9 },
  { word: 'note that', intensity: 0.8 },
  { word: 'save this', intensity: 1.0 },
  { word: 'store this', intensity: 1.0 },
  { word: 'for later', intensity: 0.7 },
  { word: 'always use', intensity: 0.8 },
  { word: 'never use', intensity: 0.8 },
];

// Task-Keywords (DE + EN)
export const TASK_KEYWORDS: KeywordEntry[] = [
  // DE
  { word: 'mach', intensity: 0.6 },
  { word: 'erstelle', intensity: 0.7 },
  { word: 'baue', intensity: 0.7 },
  { word: 'fixe', intensity: 0.7 },
  { word: 'reparier', intensity: 0.7 },
  { word: 'aendere', intensity: 0.6 },
  { word: 'ändere', intensity: 0.6 },
  { word: 'fuege hinzu', intensity: 0.6 },
  { word: 'füge hinzu', intensity: 0.6 },
  { word: 'loesche', intensity: 0.6 },
  { word: 'lösche', intensity: 0.6 },
  { word: 'implementier', intensity: 0.8 },
  { word: 'refactor', intensity: 0.7 },

  // EN
  { word: 'create', intensity: 0.7 },
  { word: 'build', intensity: 0.7 },
  { word: 'fix', intensity: 0.7 },
  { word: 'add', intensity: 0.6 },
  { word: 'remove', intensity: 0.6 },
  { word: 'delete', intensity: 0.6 },
  { word: 'implement', intensity: 0.8 },
  { word: 'change', intensity: 0.6 },
  { word: 'update', intensity: 0.6 },
  { word: 'modify', intensity: 0.6 },
];

// M38: Self-Generated Insight Patterns (DE + EN)
const SELF_GENERATED_PATTERNS = [
  /\b(ich glaub|ich denk|mein plan|ich hab verstanden|ah,? ich|mir ist klar)/i,
  /\b(ich bin der meinung|meiner meinung nach|mein fazit|ich schliesse daraus)/i,
  /\b(i think|i believe|my plan|i understand|oh,? i see|i realized|my takeaway)/i,
  /\b(i figured out|it clicked|now i get|my conclusion|i learned that)/i,
];

export function detectKeywordFlags(text: string): KeywordFlags {
  const lower = text.toLowerCase();

  let frustration = false;
  let decision = false;
  let explicit_memory = false;
  let task = false;
  let maxEmotion = 0;

  for (const kw of FRUSTRATION_KEYWORDS) {
    if (lower.includes(kw.word)) {
      frustration = true;
      maxEmotion = Math.max(maxEmotion, kw.intensity);
    }
  }

  for (const kw of DECISION_KEYWORDS) {
    if (lower.includes(kw.word)) {
      decision = true;
      maxEmotion = Math.max(maxEmotion, kw.intensity * 0.5);
    }
  }

  for (const kw of EXPLICIT_MEMORY_KEYWORDS) {
    if (lower.includes(kw.word)) {
      explicit_memory = true;
    }
  }

  for (const kw of TASK_KEYWORDS) {
    if (lower.includes(kw.word)) {
      task = true;
    }
  }

  let self_generated = false;
  for (const pattern of SELF_GENERATED_PATTERNS) {
    if (pattern.test(text)) {
      self_generated = true;
      break;
    }
  }

  return {
    frustration,
    decision,
    explicit_memory,
    task,
    emotion_intensity: maxEmotion,
    self_generated,
  };
}
