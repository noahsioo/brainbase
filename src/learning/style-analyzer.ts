import { getDb, addNode, updateNode, getNodes, type Node, type NodeMetadata } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';

export interface StyleDNA {
  category: string;
  avg_length: number;
  avg_sentence_length: number;
  emoji_rate: number;
  question_rate: number;
  exclamation_rate: number;
  formality: number;
  typical_opening: string;
  typical_closing: string;
  vocabulary_richness: number;
  recurring_phrases: string[];
  sample_count: number;
  confidence: number;
}

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;

const FORMAL_WORDS = new Set([
  'furthermore', 'therefore', 'however', 'consequently', 'regarding',
  'darueber hinaus', 'dementsprechend', 'hinsichtlich', 'bezueglich',
  'nevertheless', 'accordingly', 'subsequently', 'hereby',
  'diesbezueglich', 'infolgedessen', 'nichtsdestotrotz',
]);

const CASUAL_WORDS = new Set([
  'lol', 'omg', 'btw', 'tbh', 'ngl', 'fr', 'bruh', 'digga', 'alter',
  'krass', 'geil', 'mega', 'echt', 'voll', 'halt', 'so', 'nice',
  'crazy', 'sick', 'dope', 'lit', 'yo', 'bro', 'damn', 'wow',
]);

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function getSentences(text: string): string[] {
  return text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 5);
}

function countEmojis(text: string): number {
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

function countQuestions(text: string): number {
  const matches = text.match(/\?/g);
  return matches ? matches.length : 0;
}

function countExclamations(text: string): number {
  const matches = text.match(/!/g);
  return matches ? matches.length : 0;
}

function measureFormality(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let formalCount = 0;
  let casualCount = 0;

  for (const word of words) {
    if (FORMAL_WORDS.has(word)) formalCount++;
    if (CASUAL_WORDS.has(word)) casualCount++;
  }

  // Avg word length also indicates formality
  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
  const lengthScore = Math.min(1, (avgWordLen - 3) / 5); // 3-8 chars → 0-1

  if (formalCount + casualCount === 0) return Math.max(0, Math.min(1, lengthScore));

  const wordScore = formalCount / (formalCount + casualCount);
  return Math.max(0, Math.min(1, (wordScore + lengthScore) / 2));
}

function detectOpening(texts: string[]): string {
  const openings: Record<string, number> = { question: 0, hook: 0, statement: 0, greeting: 0 };

  for (const text of texts) {
    const firstLine = text.split(/[.!?\n]/)[0]?.trim() || '';
    if (/^(hi|hey|hallo|hello|guten|dear|liebe)/i.test(firstLine)) {
      openings.greeting++;
    } else if (firstLine.includes('?')) {
      openings.question++;
    } else if (/^(stell dir vor|imagine|wusstest|did you know|kennt ihr|have you)/i.test(firstLine)) {
      openings.hook++;
    } else {
      openings.statement++;
    }
  }

  return Object.entries(openings).sort((a, b) => b[1] - a[1])[0][0];
}

function detectClosing(texts: string[]): string {
  const closings: Record<string, number> = { cta: 0, question: 0, greeting: 0, summary: 0 };

  for (const text of texts) {
    const sentences = getSentences(text);
    const lastLine = sentences[sentences.length - 1] || '';
    if (/^(lg|gruss|gruss|vg|best|cheers|danke|thanks|bye)/i.test(lastLine)) {
      closings.greeting++;
    } else if (lastLine.includes('?')) {
      closings.question++;
    } else if (/(?:abonniere|subscribe|klick|click|schau|check|folge|follow|teile|share)/i.test(lastLine)) {
      closings.cta++;
    } else {
      closings.summary++;
    }
  }

  return Object.entries(closings).sort((a, b) => b[1] - a[1])[0][0];
}

function findRecurringPhrases(texts: string[], minOccurrence: number): string[] {
  if (texts.length < 2) return [];

  // Extract 2-4 word n-grams from each text
  const phraseCounts = new Map<string, number>();

  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const seenInText = new Set<string>();

    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (!seenInText.has(phrase)) {
          seenInText.add(phrase);
          phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
        }
      }
    }
  }

  return Array.from(phraseCounts.entries())
    .filter(([, count]) => count >= minOccurrence)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase]) => phrase);
}

function measureVocabularyRichness(texts: string[]): number {
  const allWords = texts.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (allWords.length === 0) return 0;
  const unique = new Set(allWords);
  return unique.size / allWords.length;
}

export function analyzeStyle(texts: string[], category: string): StyleDNA {
  const wordCounts = texts.map(countWords);
  const avgLength = wordCounts.reduce((a, b) => a + b, 0) / (texts.length || 1);

  const allSentences = texts.flatMap(getSentences);
  const sentenceWordCounts = allSentences.map(countWords);
  const avgSentenceLength = sentenceWordCounts.reduce((a, b) => a + b, 0) / (sentenceWordCounts.length || 1);

  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const totalEmojis = texts.reduce((sum, t) => sum + countEmojis(t), 0);
  const emojiRate = totalWords > 0 ? (totalEmojis / totalWords) * 100 : 0;

  const totalQuestions = texts.reduce((sum, t) => sum + countQuestions(t), 0);
  const questionRate = totalQuestions / (texts.length || 1);

  const totalExclamations = texts.reduce((sum, t) => sum + countExclamations(t), 0);
  const exclamationRate = totalExclamations / (texts.length || 1);

  const formalities = texts.map(measureFormality);
  const formality = formalities.reduce((a, b) => a + b, 0) / (formalities.length || 1);

  const minOccurrence = Math.max(2, Math.ceil(texts.length * 0.5));
  const recurringPhrases = findRecurringPhrases(texts, minOccurrence);

  // Confidence scales with sample count
  let confidence = 0;
  if (texts.length >= 10) confidence = 0.8;
  else if (texts.length >= 5) confidence = 0.6;
  else if (texts.length >= 3) confidence = 0.4;
  else confidence = 0.2;

  return {
    category,
    avg_length: Math.round(avgLength),
    avg_sentence_length: Math.round(avgSentenceLength * 10) / 10,
    emoji_rate: Math.round(emojiRate * 100) / 100,
    question_rate: Math.round(questionRate * 100) / 100,
    exclamation_rate: Math.round(exclamationRate * 100) / 100,
    formality: Math.round(formality * 100) / 100,
    typical_opening: detectOpening(texts),
    typical_closing: detectClosing(texts),
    vocabulary_richness: Math.round(measureVocabularyRichness(texts) * 100) / 100,
    recurring_phrases: recurringPhrases,
    sample_count: texts.length,
    confidence,
  };
}

export function getExamplesByCategory(category: string): Node[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM nodes WHERE type = 'example' AND metadata LIKE ?
    ORDER BY created_at DESC
  `).all(`%"category":"${category}"%`) as Node[];
}

export function getAllExampleCategories(): string[] {
  const db = getDb();
  const examples = db.prepare(
    "SELECT metadata FROM nodes WHERE type = 'example' AND metadata IS NOT NULL"
  ).all() as Array<{ metadata: string }>;

  const categories = new Set<string>();
  for (const ex of examples) {
    try {
      const meta = JSON.parse(ex.metadata) as NodeMetadata;
      if (meta.category) categories.add(meta.category);
    } catch { /* skip */ }
  }
  return Array.from(categories);
}

export function analyzeStyleForCategory(category: string): StyleDNA | null {
  const examples = getExamplesByCategory(category);
  if (examples.length < 3) return null;

  const texts = examples.map(e => e.content);
  const dna = analyzeStyle(texts, category);

  // Store or update the style_dna node
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM nodes WHERE type = 'style_dna' AND metadata LIKE ?"
  ).get(`%"category":"${category}"%`) as Node | undefined;

  const content = formatStyleDNA(dna);

  if (existing) {
    updateNode(existing.id, {
      content,
      metadata: JSON.stringify({ category }),
      importance: 0.8,
    });
  } else {
    const node = addNode(content, 'style_dna', {
      importance: 0.8,
      confidence: dna.confidence,
      source: 'style-analyzer',
      metadata: { category },
    });
    autoLinkNodes(node.id);
  }

  return dna;
}

function formatStyleDNA(dna: StyleDNA): string {
  const parts: string[] = [];
  parts.push(`Style: ${dna.category.replace(/_/g, ' ')}`);
  parts.push(`~${dna.avg_length} words`);

  if (dna.emoji_rate > 0.5) parts.push('uses emojis');
  if (dna.question_rate > 1) parts.push('asks questions');
  if (dna.exclamation_rate > 1) parts.push('exclamatory');

  if (dna.formality < 0.3) parts.push('casual tone');
  else if (dna.formality > 0.7) parts.push('formal tone');

  parts.push(`opens with ${dna.typical_opening}`);
  parts.push(`closes with ${dna.typical_closing}`);

  if (dna.recurring_phrases.length > 0) {
    parts.push(`recurring: "${dna.recurring_phrases.slice(0, 3).join('", "')}"`);
  }

  parts.push(`(${dna.sample_count} samples, confidence ${dna.confidence})`);

  return parts.join(' | ');
}

export function analyzeAllCategories(): Map<string, StyleDNA> {
  const results = new Map<string, StyleDNA>();
  const categories = getAllExampleCategories();

  for (const category of categories) {
    const dna = analyzeStyleForCategory(category);
    if (dna) results.set(category, dna);
  }

  return results;
}

export function getStyleDNA(category: string): StyleDNA | null {
  const db = getDb();
  const node = db.prepare(
    "SELECT * FROM nodes WHERE type = 'style_dna' AND metadata LIKE ?"
  ).get(`%"category":"${category}"%`) as Node | undefined;

  if (!node) return null;

  // Parse the stored DNA from the node content - re-analyze from examples
  const examples = getExamplesByCategory(category);
  if (examples.length < 3) return null;

  return analyzeStyle(examples.map(e => e.content), category);
}
