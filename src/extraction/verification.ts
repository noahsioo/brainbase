import type { Node } from '../memory/store.js';
import { getAdaptiveQualityThreshold } from '../learning/self-tuner.js';

export interface ExtractedFact {
  content: string;
  type: 'preference' | 'fact' | 'decision' | 'task' | 'project' | 'learning' | 'identity' | 'insight' | 'example' | 'reminder';
  confidence: number;
  metadata?: { category?: string; quality?: number };
}

export type SemanticIntent = 'question' | 'statement' | 'request' | 'feedback' | 'greeting' | 'other';

export interface ExtractedEntity {
  name: string;
  type: string; // person, technology, project, concept, tool, food, place, organization, skill
  confidence?: number;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  type: string; // uses, likes, dislikes, builds, knows, part_of, works_with, prefers, wants, is_a, etc.
  confidence: number;
}

export interface ExtractedTopic {
  name: string;
  confidence: number;
}

export interface ExtractionResponse {
  nothing_new: boolean;
  entities?: ExtractedEntity[];
  relations?: ExtractedRelation[];
  new_facts: ExtractedFact[];
  topic?: ExtractedTopic;
  intent?: SemanticIntent;
  references?: string[];
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
  evidence_matches: string[];
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
    evidence_matches: [],
  };

  if (!response.new_facts || !Array.isArray(response.new_facts)) {
    return result;
  }

  for (const fact of response.new_facts) {
    if (!fact.content || fact.content.length < 3) continue;

    // Examples: allow longer content, skip duplicate detection
    if (fact.type === 'example') {
      if (fact.content.length > 2000) continue;
      const confidence = Math.min(0.8, Math.max(0, fact.confidence));
      result.new_facts.push({
        content: fact.content,
        type: 'example',
        confidence,
        metadata: fact.metadata,
      });
      continue;
    }

    // Reminders: each is unique by time, skip duplicate detection
    if (fact.type === 'reminder') {
      if (fact.content.length > 300) continue;
      const confidence = Math.min(0.8, Math.max(0, fact.confidence));
      result.new_facts.push({
        content: fact.content,
        type: 'reminder',
        confidence,
        metadata: fact.metadata,
      });
      continue;
    }

    let content = fact.content;
    if (EMOTIONAL_ABSOLUTES.test(content)) {
      content = cleanEmotionalContent(content);
    }

    let isDuplicate = false;
    for (const node of existingNodes) {
      if (isSimilar(content, node.content)) {
        isDuplicate = true;
        result.merged_count++;
        result.evidence_matches.push(node.id);

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

    // Quality Gate: reject low-quality extractions (11.4: adaptive threshold)
    const qualityScore = calculateQualityScore(content, fact.type);
    if (qualityScore < getAdaptiveQualityThreshold()) continue;

    let confidence = Math.min(0.8, Math.max(0, fact.confidence));

    // 11.2: Content-level sarcasm → drastically reduce confidence
    if (detectContentSarcasm(content)) {
      confidence *= 0.2;
    }

    const isIdentity = IDENTITY_TYPES.includes(fact.type);
    const importanceCap = isIdentity ? 1.0 : IMPORTANCE_CAP;
    confidence = Math.min(confidence, importanceCap);

    result.new_facts.push({
      content,
      type: fact.type,
      confidence,
      metadata: { ...fact.metadata, quality: qualityScore },
    });
  }

  return result;
}

// ── Content-Level Sarcasm Detection ─────────────────────────

const SARCASM_CONTENT_PATTERNS = [
  /\b(natuerlich|natürlich|of course|obviously|clearly)\b.*\b(nicht|not|never|nie)\b/i,
  /\b(super|toll|great|amazing|brilliant)\b.*\b(funktioniert|works|klappt)\b.*\b(nicht|not)\b/i,
  /\b(angeblich|supposedly|apparently|vermeintlich)\b/i,
];

function detectContentSarcasm(content: string): boolean {
  return SARCASM_CONTENT_PATTERNS.some(p => p.test(content));
}

// ── Quality Score ───────────────────────────────────────────

export function calculateQualityScore(content: string, type: string): number {
  let score = 0.5;

  // Specificity: contains named things?
  const hasProperNoun = /[A-Z][a-z]{2,}/.test(content);
  const hasNamedThing = /\b(React|Vue|Angular|Svelte|Next\.?js|TypeScript|JavaScript|Python|Rust|Go|Java|Supabase|Firebase|Node|Docker|Kubernetes|AWS|GCP|Azure|Vercel|PostgreSQL|MongoDB|Redis|Tailwind|shadcn|Git|Linux|macOS|Windows|VSCode|Cursor|Neovim)\b/i.test(content);
  if (hasProperNoun) score += 0.15;
  if (hasNamedThing) score += 0.15;

  // Vagueness penalty
  const VAGUE_WORDS = ['something', 'things', 'stuff', 'various', 'some', 'somehow',
    'irgendwie', 'irgendwas', 'sachen', 'dinge', 'verschiedene', 'manche'];
  const vagueCount = VAGUE_WORDS.filter(w => content.toLowerCase().includes(w)).length;
  score -= vagueCount * 0.15;

  // Length check: too short = too little info, too long = rambling
  if (content.length < 10) score -= 0.2;
  if (content.length > 200 && type !== 'example') score -= 0.1;

  // V5-2: Meta-observations — harder penalty (-0.5 statt -0.3)
  if (/\b(is exploring|is considering|was discussing|is working on|seems to|appears to|is curious|is interested|is thinking|was working|has been)\b/i.test(content)) {
    score -= 0.5;
  }
  if (/\b(erkundet|ueberlegt|überlegt|diskutiert|scheint|arbeitet an|ist neugierig|ist interessiert)\b/i.test(content)) {
    score -= 0.5;
  }

  // V5-2: Very short content without Named Entity → likely garbage
  if (content.length < 20 && !hasProperNoun && !hasNamedThing) {
    score -= 0.3;
  }

  // Action words are good (concrete preferences/decisions)
  if (/\b(bevorzugt|prefers|nutzt|uses|switched|gewechselt|decided|entschieden|wechsel|chose|picked)\b/i.test(content)) {
    score += 0.1;
  }

  // Identity/example/reminder types get a small bonus (usually intentional)
  if (type === 'identity' || type === 'example' || type === 'reminder') {
    score += 0.2;
  }

  return Math.max(0, Math.min(1.0, score));
}

// ── Garbage Filter ──────────────────────────────────────────

const GARBAGE_PATTERNS = [
  // Vague meta-observations about the user
  /\buser (?:is |was )?(?:exploring|considering|discussing|wondering|focused on|working on)\b/i,
  /\buser (?:wants|feels|experiences|believes|thinks|seems|appears)\b/i,
  /\bthere are (?:weaknesses|issues|problems|challenges)\b/i,
  /\bthe (?:conversation|discussion|session) (?:is|was) about\b/i,
  // Too vague / meta
  /\bsystem (?:should|needs to|must) (?:be able to|function|work|process)\b/i,
  /\bmemory system (?:should|needs to|can|will) automatically\b/i,
  /\binformation (?:processing|management|retrieval|storage)\b/i,
  // Session-specific noise
  /\bcommit and push changes\b/i,
  /\bpage updates? and view jumping\b/i,
  /\blatest version (?:in the|without)\b/i,
  /\bresponsiveness and version updates\b/i,
  // Negative feedback tracker references (these are auto-generated noise)
  /^Negative feedback bei:/,
  // Stream-of-consciousness / philosophical rambling
  /\b(?:what is|was ist) (?:the meaning|die bedeutung|consciousness|bewusstsein)\b/i,
  /\b(?:why do|warum) (?:humans|menschen|we|wir)\b/i,
  /\bthe (?:brain|gehirn) (?:is|ist) (?:crazy|amazing|complex|fascinating)\b/i,
  // Vague project references
  /\bworking on (?:a|the|some) (?:project|thing|system|app)\b/i,
  /\b(?:will|want to|wollen?) (?:eventually|irgendwann|spaeter|später|later)\b/i,
  // Emotional meta-observations
  /\buser (?:is|was|seems?) (?:happy|sad|excited|confused|curious|interested|philosophical|motivated)\b/i,
  /\b(?:expressed|showed|had) (?:excitement|interest|curiosity|frustration) (?:about|regarding|for)\b/i,
  // Session meta-noise
  /\b(?:let's|lass uns|wollen wir) (?:continue|weitermachen|move on)\b/i,
  /\b(?:everything|alles) (?:works|funktioniert|is working)\b/i,
  // Generic summaries
  /\bthe user (?:has been|was) (?:working|coding|building|developing)\b/i,
  /\buser has ideas about\b/i,
  /\buser discussed\b/i,
  /^user (?:is|was|has|seems?|appears?|feels?|wants?|thinks?|believes?|experiences?)/i,
  /^the user /i,
  /^lovis (?:is|was|has) (?:been )?(?:working|building|exploring|discussing|considering)/i,
  /\buser (?:asked|mentioned|noted|said|stated|indicated|expressed|shared|revealed|admitted)\b/i,
  /\b(?:seems|appears) to (?:be|have|want|like|prefer|think|believe)\b/i,
  // V5-2: Anti-summary — "[Name] is/was/has [generic verb]" at start
  /^[A-Z][a-z]+ (?:is|was|has|seems?|appears?|wants?|prefers?|likes?|dislikes?|believes?|thinks?|feels?) /i,
  // V5-2: Generic action summaries
  /\b(?:is|was) (?:working on|building|developing|creating|implementing|designing|planning|testing|debugging|fixing|improving|optimizing)\b/i,
  /\b(?:wants to|will|plans to|intends to|tries to|needs to) (?:build|create|implement|improve|fix|learn|understand|explore)\b/i,
];

export function isGarbage(content: string): boolean {
  if (GARBAGE_PATTERNS.some(p => p.test(content))) return true;

  // V5-2: Content without any Named Entity (capitalized word > 3 chars) is likely garbage
  const hasNamedEntity = /[A-Z][a-zA-Z]{3,}/.test(content);
  if (!hasNamedEntity && content.length > 30) return true;

  return false;
}

// ── Entity & Relation Verification ──────────────────────────

const VALID_ENTITY_TYPES = new Set([
  'person', 'technology', 'project', 'concept', 'tool',
  'food', 'place', 'organization', 'skill', 'language',
  'framework', 'library', 'service', 'topic',
]);

const VALID_RELATION_TYPES = new Set([
  'uses', 'likes', 'dislikes', 'builds', 'knows', 'part_of',
  'works_with', 'prefers', 'wants', 'is_a', 'located_at',
  'has_skill', 'created_by', 'member_of', 'speaks',
  'interested_in', 'related_to', 'depends_on', 'enables',
]);

const GARBAGE_ENTITY_NAMES = new Set([
  'user', 'system', 'it', 'this', 'that', 'something', 'thing',
  'the system', 'the user', 'the project', 'a thing',
  'connected nodes', 'data', 'information', 'stuff',
  'code', 'file', 'function', 'variable', 'error', 'bug',
  'problem', 'solution', 'approach', 'method', 'process',
  'project', 'app', 'application', 'tool', 'feature',
  // Too generic concepts
  'brain', 'gehirn', 'consciousness', 'bewusstsein', 'idea', 'idee',
  'concept', 'konzept', 'question', 'frage', 'answer', 'antwort',
  'feeling', 'gefuehl', 'gefühl', 'experience', 'erfahrung', 'thought', 'gedanke',
  'plan', 'step', 'schritt', 'task', 'aufgabe', 'work', 'arbeit',
  'topic', 'thema', 'conversation', 'session', 'message', 'request',
]);

export function verifyEntity(entity: ExtractedEntity): ExtractedEntity | null {
  if (!entity.name || entity.name.trim().length < 2) return null;
  if (entity.name.trim().length > 100) return null;
  if (GARBAGE_ENTITY_NAMES.has(entity.name.trim().toLowerCase())) return null;

  const entityType = VALID_ENTITY_TYPES.has(entity.type) ? entity.type : 'concept';

  return {
    name: entity.name.trim(),
    type: entityType,
    confidence: entity.confidence,
  };
}

export function verifyRelation(
  relation: ExtractedRelation,
  knownNames: Set<string>,
): ExtractedRelation | null {
  if (!relation.from || !relation.to || !relation.type) return null;

  const fromNorm = relation.from.trim().toLowerCase();
  const toNorm = relation.to.trim().toLowerCase();

  if (!knownNames.has(fromNorm) && !knownNames.has(toNorm)) return null;
  if (fromNorm === toNorm) return null;

  const confidence = Math.min(0.8, Math.max(0.3, relation.confidence || 0.5));
  const relType = VALID_RELATION_TYPES.has(relation.type) ? relation.type : 'related_to';

  return {
    from: relation.from.trim(),
    to: relation.to.trim(),
    type: relType,
    confidence,
  };
}
