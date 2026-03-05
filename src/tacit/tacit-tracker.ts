import { randomUUID } from 'crypto';
import type { LLMClient } from '../llm/types.js';
import { getDb, addNode } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import { isSimilar } from '../extraction/verification.js';

export interface TacitPattern {
  id: string;
  pattern: string;
  category: string;
  observations: number;
  first_seen: number;
  last_seen: number;
  promoted: boolean;
}

export interface TacitResult {
  patterns_observed: number;
  patterns_promoted: number;
}

interface LLMTacitResponse {
  patterns: Array<{
    pattern: string;
    category: string;
    confidence: number;
  }>;
}

const VALID_CATEGORIES = ['file_structure', 'coding_style', 'tool_preference', 'workflow', 'communication'];
const MAX_PATTERNS_PER_ANALYSIS = 3;
const PROMOTION_THRESHOLD = 5;
const CONFIDENCE_CAP = 0.85;

const TACIT_SYSTEM_PROMPT = `You analyze conversation transcripts to find BEHAVIORAL patterns - things the user DOES, not what they SAY.

Rules:
- Focus on recurring actions, habits, preferences shown through behavior
- Do NOT extract explicit statements ("I prefer X") - only implicit behavior
- Categories: file_structure, coding_style, tool_preference, workflow, communication
- Max 3 patterns per analysis
- Be specific: "starts debugging with console.log" not "uses debugging"
- confidence between 0.3 and 0.85

Respond with JSON:
{
  "patterns": [
    { "pattern": "short description of behavioral pattern", "category": "one_of_the_categories", "confidence": 0.3-0.85 }
  ]
}

If no clear behavioral patterns are visible, return: { "patterns": [] }`;

function getAllTacitPatterns(): TacitPattern[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tacit_patterns').all() as Array<{
    id: string; pattern: string; category: string;
    observations: number; first_seen: number; last_seen: number; promoted: number;
  }>;
  return rows.map(r => ({ ...r, promoted: r.promoted === 1 }));
}

function findSimilarPattern(pattern: string, existing: TacitPattern[]): TacitPattern | null {
  for (const p of existing) {
    if (isSimilar(pattern, p.pattern)) {
      return p;
    }
  }
  return null;
}

function observePattern(pattern: string, category: string): { isNew: boolean; observations: number; id: string } {
  const db = getDb();
  const now = Date.now();
  const existing = getAllTacitPatterns();
  const similar = findSimilarPattern(pattern, existing);

  if (similar) {
    db.prepare('UPDATE tacit_patterns SET observations = observations + 1, last_seen = ? WHERE id = ?')
      .run(now, similar.id);
    return { isNew: false, observations: similar.observations + 1, id: similar.id };
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO tacit_patterns (id, pattern, category, observations, first_seen, last_seen, promoted)
    VALUES (?, ?, ?, 1, ?, ?, 0)
  `).run(id, pattern, category, now, now);

  return { isNew: true, observations: 1, id };
}

function promotePattern(id: string, pattern: string): void {
  const db = getDb();
  db.prepare('UPDATE tacit_patterns SET promoted = 1 WHERE id = ?').run(id);

  const node = addNode(pattern, 'tacit', {
    importance: CONFIDENCE_CAP,
    confidence: CONFIDENCE_CAP,
    source: 'tacit-tracker',
  });
  autoLinkNodes(node.id);
}

function truncateForTacit(text: string, maxChars = 6000): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.substring(0, half) + '\n\n[...truncated...]\n\n' + text.substring(text.length - half);
}

export async function extractTacitPatterns(
  client: LLMClient,
  transcript: string,
): Promise<TacitResult> {
  const result: TacitResult = { patterns_observed: 0, patterns_promoted: 0 };

  const truncated = truncateForTacit(transcript);
  const prompt = `Transcript:\n${truncated}\n\nExtract behavioral patterns from this conversation.`;

  let response: LLMTacitResponse;
  try {
    response = await client.generateJson<LLMTacitResponse>(prompt, {
      system: TACIT_SYSTEM_PROMPT,
      temperature: 0.2,
    });
  } catch {
    return result;
  }

  if (!response?.patterns || !Array.isArray(response.patterns)) {
    return result;
  }

  const patterns = response.patterns.slice(0, MAX_PATTERNS_PER_ANALYSIS);

  for (const p of patterns) {
    if (!p.pattern || p.pattern.length < 5 || p.pattern.length > 200) continue;
    if (!VALID_CATEGORIES.includes(p.category)) continue;

    const { observations, id } = observePattern(p.pattern, p.category);
    result.patterns_observed++;

    if (observations >= PROMOTION_THRESHOLD) {
      const db = getDb();
      const row = db.prepare('SELECT promoted FROM tacit_patterns WHERE id = ?').get(id) as { promoted: number } | undefined;
      if (row && row.promoted === 0) {
        promotePattern(id, p.pattern);
        result.patterns_promoted++;
      }
    }
  }

  return result;
}
