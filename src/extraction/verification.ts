import type { Node } from '../memory/store.js';

export interface ExtractedFact {
  content: string;
  type: 'preference' | 'fact' | 'decision' | 'task' | 'project' | 'learning';
  confidence: number;
}

export interface ExtractionResponse {
  nothing_new: boolean;
  new_facts: ExtractedFact[];
  emotion: {
    type: string;
    intensity: number;
  };
}

const IMPORTANCE_CAP = 0.9;
const IDENTITY_TYPES = ['identity'];
const EMOTIONAL_ABSOLUTES = /\b(hasst|hates|liebt|loves|immer|always|niemals|never|jedes mal|every time)\b/i;

export interface NodeEnrichment {
  node_id: string;
  addition: string;
}

interface VerifiedExtraction {
  new_facts: ExtractedFact[];
  merged_count: number;
  contradictions: Array<{ new_content: string; existing_node_id: string }>;
  enrichments: NodeEnrichment[];
}

export function isSimilar(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();

  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;

  const wordsA = new Set(la.split(/\s+/));
  const wordsB = new Set(lb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);

  if (union.size === 0) return false;
  const jaccard = intersection.length / union.size;
  return jaccard > 0.6;
}

export function isContradiction(newContent: string, existingContent: string): boolean {
  const n = newContent.toLowerCase();
  const e = existingContent.toLowerCase();

  const switchPatterns = [
    /(?:nutzt|uses|bevorzugt|prefers)\s+(\S+)/i,
    /(?:statt|instead of|anstatt)\s+(\S+)/i,
  ];

  for (const pattern of switchPatterns) {
    const nMatch = n.match(pattern);
    const eMatch = e.match(pattern);

    if (nMatch && eMatch && nMatch[1] !== eMatch[1]) {
      const wordsN = new Set(n.split(/\s+/));
      const wordsE = new Set(e.split(/\s+/));
      const shared = [...wordsN].filter(w => wordsE.has(w) && w.length > 3);
      if (shared.length >= 1) return true;
    }
  }

  return false;
}

function cleanEmotionalContent(content: string): string {
  return content
    .replace(/\b(hasst|hates)\b/gi, 'mag nicht')
    .replace(/\b(liebt|loves)\b/gi, 'bevorzugt')
    .replace(/\b(immer|always)\b/gi, 'oft')
    .replace(/\b(niemals|never)\b/gi, 'selten')
    .replace(/\b(jedes mal|every time)\b/gi, 'haeufig');
}

function extractNewInfo(newContent: string, existingContent: string): string | null {
  const newWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const existingWords = new Set(existingContent.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  const novel: string[] = [];
  for (const w of newWords) {
    if (!existingWords.has(w)) {
      novel.push(w);
    }
  }

  if (novel.length === 0 || novel.length > 5) return null;

  const addition = novel.join(', ');
  if (existingContent.length + addition.length + 3 > 500) return null;

  return addition;
}

export function verifyExtraction(
  response: ExtractionResponse,
  existingNodes: Node[],
): VerifiedExtraction {
  const result: VerifiedExtraction = {
    new_facts: [],
    merged_count: 0,
    contradictions: [],
    enrichments: [],
  };

  if (!response.new_facts || !Array.isArray(response.new_facts)) {
    return result;
  }

  for (const fact of response.new_facts) {
    if (!fact.content || fact.content.length < 3) continue;

    let content = fact.content;
    if (EMOTIONAL_ABSOLUTES.test(content)) {
      content = cleanEmotionalContent(content);
    }

    let isDuplicate = false;
    for (const node of existingNodes) {
      if (isSimilar(content, node.content)) {
        isDuplicate = true;
        result.merged_count++;

        const newInfo = extractNewInfo(content, node.content);
        if (newInfo) {
          result.enrichments.push({
            node_id: node.id,
            addition: newInfo,
          });
        }
        break;
      }

      if (isContradiction(content, node.content)) {
        result.contradictions.push({
          new_content: content,
          existing_node_id: node.id,
        });
      }
    }

    if (isDuplicate) continue;

    let confidence = Math.min(0.8, Math.max(0, fact.confidence));
    const isIdentity = IDENTITY_TYPES.includes(fact.type);
    const importanceCap = isIdentity ? 1.0 : IMPORTANCE_CAP;
    confidence = Math.min(confidence, importanceCap);

    result.new_facts.push({
      content,
      type: fact.type,
      confidence,
    });
  }

  return result;
}
