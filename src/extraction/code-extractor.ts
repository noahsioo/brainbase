import { addNode, searchNodes, type Node } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import { type KeywordFlags } from '../signal/keywords.js';

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

export function extractFromPrompt(prompt: string, sessionId: string, flags?: KeywordFlags): ExtractionResult {
  const result: ExtractionResult = {
    nodes_created: 0,
    nodes_activated: 0,
    edges_created: 0,
  };

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

    if (content.length < 2 || content.length > 200) continue;

    const existingNode = isDuplicate(content);
    if (existingNode) {
      result.nodes_activated++;
      continue;
    }

    const emotionalTag = pattern.emotional_tag || (flags?.frustration ? 'frustration' : undefined);

    const node = addNode(content, pattern.type, {
      importance: pattern.importance,
      emotional_tag: emotionalTag,
      source: `extract:${sessionId}`,
    });

    result.nodes_created++;

    const newEdges = autoLinkNodes(node.id);
    result.edges_created += newEdges.length;
  }

  return result;
}
