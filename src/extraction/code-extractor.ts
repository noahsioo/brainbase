import { addNode, addEdge, searchNodes, getDb, type Node, type NodeMetadata } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import { type KeywordFlags } from '../signal/keywords.js';
import { calculateQualityScore, isGarbage } from './verification.js';

// M36+M38+M39+M40: Read encoding signal from system_state
interface EncodingSignal {
  novelty: number;
  prediction_error: number;
  self_generated: boolean;
  emotion_intensity: number;
  session_topic?: string;
  mood: string;
  provider: string;
  message_index: number;
}

function readEncodingSignal(sessionId: string): EncodingSignal | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_state WHERE key = ?")
      .get(`encoding_signal_${sessionId}`) as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch { /* skip */ }
  return null;
}

function calculateImportanceBoost(signal: EncodingSignal | null): number {
  if (!signal) return 0;
  let boost = 0;
  if (signal.self_generated) boost += 0.2;          // M38
  if (signal.novelty > 0.8) boost += 0.15;          // M39
  if (signal.novelty < 0.2) boost -= 0.1;           // M39
  if (signal.prediction_error > 0.7) boost += 0.15; // M40
  return boost;
}

export interface ExtractionResult {
  nodes_created: number;
  nodes_activated: number;
  edges_created: number;
}

interface PatternDef {
  regex: RegExp;
  type: string;
  importance: number;
  emotional_tag?: string;
}

const PATTERNS: PatternDef[] = [
  // Identity
  { regex: /(?:ich bin|ich heisse|ich heiße|mein name ist|i'm|my name is)\s+([A-ZÄÖÜa-zäöü][a-zäöüß]+(?:\s[A-ZÄÖÜa-zäöü][a-zäöüß]+)?)/i,
    type: 'identity', importance: 0.95 },

  // Age
  { regex: /(?:ich bin)\s+(\d{1,3})\s+(?:jahre alt|years old)/i,
    type: 'identity', importance: 0.9 },

  // Preferences (positive)
  { regex: /(?:ich bevorzuge|ich mag|ich nutze|ich liebe|i prefer|i like|i use|i love)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'preference', importance: 0.8 },

  // Preferences (negative)
  { regex: /(?:ich hasse|ich mag nicht|ich will kein|i hate|i don't like|i dislike)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'preference', importance: 0.8, emotional_tag: 'negative' },

  // Explicit memory requests ("merk dir", "remember that", "wichtig:")
  { regex: /(?:merk dir|merke dir|vergiss nicht|remember(?:\s+that)?|wichtig|important)\s*(?:bitte)?[:\s]+(.+?)(?:\.|!|$)/i,
    type: 'preference', importance: 0.9 },

  // Tech/Tools
  { regex: /(?:wir nutzen|wir verwenden|wir arbeiten mit|we use|we're using|our stack includes?|unser stack ist|unser stack besteht aus)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'fact', importance: 0.7 },

  // Decisions
  { regex: /(?:wir haben uns (?:fuer|für)|we decided on|we chose|we picked|entschieden (?:fuer|für))\s+(.+?)(?:\.|,|!|$)/i,
    type: 'decision', importance: 0.8 },

  // Projects (named)
  { regex: /(?:mein projekt|unser projekt|das projekt|my project|the project)\s+(?:heisst|heißt|ist|is(?: called)?)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'project', importance: 0.8 },

  // Working on
  { regex: /(?:ich arbeite an|wir bauen|i'm working on|i am working on|we're building|we are building)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'project', importance: 0.7 },

  // Tech stack mentions (standalone framework/tool names)
  { regex: /(?:mit|using|in|verwende|nutze)\s+(React|Vue|Angular|Svelte|Next\.?js|Nuxt|Remix|Astro|SolidJS|Qwik)(?:\s|,|\.|!|$)/i,
    type: 'fact', importance: 0.7 },
  { regex: /(?:mit|using|in|verwende|nutze)\s+(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|C#|Ruby|PHP|Swift|Kotlin)(?:\s|,|\.|!|$)/i,
    type: 'fact', importance: 0.7 },
  { regex: /(?:mit|using|in|verwende|nutze)\s+(Docker|Kubernetes|AWS|GCP|Azure|Vercel|Netlify|Supabase|Firebase|PostgreSQL|MongoDB|Redis|MySQL)(?:\s|,|\.|!|$)/i,
    type: 'fact', importance: 0.65 },
  { regex: /(?:mit|using|in|verwende|nutze)\s+(Tailwind|shadcn|MUI|Chakra|Bootstrap|Styled.?Components)(?:\s|,|\.|!|$)/i,
    type: 'fact', importance: 0.6 },

  // Error/Problem mentions
  { regex: /(?:fehler|error|bug|problem|issue|crash|kaputt|broken|failing|failed)(?:\s+(?:bei|with|in|at))?\s+(.+?)(?:\.|,|!|$)/i,
    type: 'fact', importance: 0.65, emotional_tag: 'frustration' },

  // Learning/wanting to learn
  { regex: /(?:ich lerne|ich will lernen|i'm learning|i want to learn|learning)\s+(.+?)(?:\.|,|!|$)/i,
    type: 'fact', importance: 0.7 },

  // Job/Role
  { regex: /(?:ich bin|i'm|i am)\s+(?:ein(?:e)?|a|an)\s+((?:frontend|backend|fullstack|full.?stack|devops|senior|junior|lead|staff|principal)\s+(?:developer|engineer|dev|entwickler|programmierer))/i,
    type: 'identity', importance: 0.9 },
];

function cleanExtracted(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const EXTRACTION_STOPWORDS = new Set([
  'und', 'oder', 'aber', 'and', 'or', 'but', 'also', 'dann', 'weil', 'because',
  'that', 'the', 'ein', 'eine', 'der', 'die', 'das', 'den', 'dem', 'des',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein',
  'nicht', 'kein', 'keine', 'noch', 'schon', 'nur', 'wenn', 'wie', 'was',
  'wo', 'wer', 'wann', 'hab', 'hat', 'bin', 'bist', 'sind', 'war', 'will',
  'kann', 'muss', 'ist', 'mit', 'von', 'zu', 'in', 'auf', 'an', 'fuer', 'für',
  'is', 'with', 'of', 'to', 'on', 'for', 'at', 'by', 'it', 'he', 'she',
  'we', 'you', 'they', 'not', 'no', 'if', 'so', 'be', 'am', 'are',
  'have', 'has', 'had', 'was', 'were', 'can', 'would', 'should',
  'do', 'does', 'did', 'this', 'these', 'those', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'here', 'there', 'all', 'some',
  'just', 'only', 'get', 'got', 'let', 'make', 'mach', 'mal', 'halt',
  'lass', 'bitte', 'ja', 'nein', 'ok', 'okay', 'vielleicht', 'eigentlich',
  'einfach', 'bisschen', 'sozusagen', 'ding', 'basically', 'actually',
  'stuff', 'thing', 'like', 'really', 'very', 'quite',
]);

function isValidContent(content: string, type: string): boolean {
  if (content.length < 5) return false;

  const words = content.split(' ');
  const realWords = words.filter(w => !EXTRACTION_STOPWORDS.has(w.toLowerCase()));

  if (realWords.length === 0) return false;

  if (type === 'identity') {
    if (words.length > 3) return false;
    if (!/^[A-ZÄÖÜ]/.test(content)) return false;
    if (realWords.length === 0) return false;
    if (content.length < 3) return false;
  }

  if (type === 'preference' || type === 'fact') {
    if (realWords.length < 3) return false;
  }

  return true;
}

function isDuplicate(content: string): Node | null {
  const existing = searchNodes(content, 10);
  const lower = content.toLowerCase();

  for (const node of existing) {
    const nodeLower = node.content.toLowerCase();
    if (nodeLower === lower) return node;
    if (nodeLower.includes(lower)) return node;
    if (lower.includes(nodeLower)) return node;
  }

  return null;
}

// M49: Interference Management — detect content overlap between old and new preferences
function calculateContentOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / Math.min(wordsA.size, wordsB.size);
}

export function extractFromPrompt(prompt: string, sessionId: string, flags?: KeywordFlags): ExtractionResult {
  const result: ExtractionResult = {
    nodes_created: 0,
    nodes_activated: 0,
    edges_created: 0,
  };

  // M36+M38+M39+M40: Read encoding signal for importance modifiers
  const encodingSig = readEncodingSignal(sessionId);
  const importanceBoost = calculateImportanceBoost(encodingSig);
  const encodingContext = encodingSig ? {
    session_topic: encodingSig.session_topic,
    mood: encodingSig.mood,
    provider: encodingSig.provider,
    message_index: encodingSig.message_index,
  } : undefined;

  for (const pattern of PATTERNS) {
    const match = prompt.match(pattern.regex);
    if (!match || !match[1]) continue;

    let content = cleanExtracted(match[1]);

    // Identity: Stopwords am Ende abschneiden ("Lovis und" → "Lovis")
    if (pattern.type === 'identity') {
      const stopwords = ['und', 'oder', 'aber', 'and', 'or', 'but', 'also', 'dann', 'weil', 'because', 'that', 'the', 'ein', 'eine', 'der', 'die', 'das'];
      const words = content.split(' ');
      while (words.length > 1 && stopwords.includes(words[words.length - 1].toLowerCase())) {
        words.pop();
      }
      content = words.join(' ');
    }

    if (content.length > 200) continue;
    if (!isValidContent(content, pattern.type)) continue;
    if (isGarbage(content)) continue;
    if (calculateQualityScore(content, pattern.type) < 0.3) continue;

    const existingNode = isDuplicate(content);
    if (existingNode) {
      result.nodes_activated++;
      continue;
    }

    const emotionalTag = pattern.emotional_tag || (flags?.frustration ? 'frustration' : undefined);
    const finalImportance = Math.max(0.1, Math.min(1.0, pattern.importance + importanceBoost));

    const node = addNode(content, pattern.type, {
      importance: finalImportance,
      emotional_tag: emotionalTag,
      source: `extract:${sessionId}`,
      metadata: encodingContext ? { encoding_context: encodingContext } as NodeMetadata : undefined,
    });

    result.nodes_created++;

    // M49: Interference Management — mark superseded preferences/decisions
    if (pattern.type === 'preference' || pattern.type === 'decision') {
      const similar = searchNodes(content, 5).filter(n =>
        n.type === pattern.type && n.id !== node.id
      );
      for (const old of similar) {
        const overlap = calculateContentOverlap(old.content, content);
        if (overlap > 0.4) {
          addEdge(old.id, node.id, 'replaced_by', 0.8);
          result.edges_created++;
          break;
        }
      }
    }

    const newEdges = autoLinkNodes(node.id);
    result.edges_created += newEdges.length;
  }

  return result;
}
