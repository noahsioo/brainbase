import type { LLMClient } from '../llm/types.js';
import { addNode, getNode, updateNode, searchNodes, getDb, getOrCreateEntity, findEntityByName, getEdgeBetween, addEdge, strengthenEdge, getAllEntities, incrementEvidence, type Node, type NodeMetadata } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { verifyExtraction, verifyEntity, verifyRelation, isGarbage, type ExtractionResponse, type ExtractedEntity, type ExtractedRelation } from '../extraction/verification.js';
import { analyzeStyleForCategory } from '../learning/style-analyzer.js';
import { queueEmbedding } from '../llm/embeddings.js';
import { recordCreation, recordGarbage, recordEvidence } from '../learning/self-tuner.js';
import { recordGarbageType } from '../hygiene/immune-system.js';
import { recordLLMCall } from '../regulation/energy.js';
import { generateContext } from '../memory/context-generator.js';

const CONFIDENCE_CAP = 0.8;

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
  sarcasm_detected?: boolean;
  rhetorical_detected?: boolean;
  emotion_bypass_type?: string | null;
  event_boundary?: boolean;
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

function buildSystemPrompt(frustration: boolean): string {
  const base = `You are the Hippocampus of an AI memory system. You encode experiences into ENTITIES and RELATIONSHIPS — like a real brain.

A brain does NOT store sentences. It stores CONCEPTS (neurons) connected by WEIGHTED RELATIONSHIPS (synapses).

Your job: Extract ENTITIES and RELATIONS from the conversation.

## QUALITY TEST (MOST IMPORTANT RULE)
Before storing ANYTHING, ask yourself: "Would this be useful context in 2 weeks?"
- "User uses TypeScript" → YES (helps future sessions)
- "User is exploring ideas" → NO (vague, useless)
- "User prefers tabs over spaces" → YES (concrete preference)
- "User was working on something" → NO (what specifically?)
- "Bevorzugt funktionale Programmierung ueber OOP" → YES (actionable preference)
- "User discussed philosophical topics" → NO (says nothing concrete)

If the answer is NO → do NOT store it. Set nothing_new: true instead.

## NEGATIVE EXAMPLES (NEVER store these)
- "User is exploring consciousness and brain mechanics"
- "User was thinking about deep questions"
- "The conversation covered philosophical topics"
- "User is curious about how things work"
- "User wants to continue with the project"
- "User expressed excitement about the system"
- "User has ideas about X" (what ideas specifically?)
- "User discussed Y" (what was the conclusion?)
- "User is working on improvements"
- "User is building a system"
- Any observation about the user's emotional state
- Any summary of what the conversation was "about"

## POSITIVE EXAMPLES (GOOD extractions)
- Entity: "Supabase" (technology) — concrete, named
- Relation: "Lovis" → uses → "better-sqlite3" — specific
- Fact: "Bevorzugt funktionale Programmierung ueber OOP" — actionable preference
- Decision: "Wechsel von Firebase zu Supabase wegen Kosten" — specific decision with reason

## ENTITIES
Atomic concepts: people, technologies, projects, tools, places, foods, skills, organizations.
Each entity must be a SINGLE named concept, not a phrase or description.
- GOOD entities: "Lovis", "TypeScript", "Memory Unlimited", "Berlin", "React"
- BAD entities: "the system", "it", "something", "a thing", "brain", "idea", "concept"

Entity types: person, technology, project, concept, tool, food, place, organization, skill, language, framework, library, service, topic

## RELATIONS
How entities connect: uses, likes, dislikes, builds, knows, part_of, works_with, prefers, wants, is_a, located_at, has_skill, created_by, member_of, speaks, interested_in, depends_on, enables, related_to
- GOOD: { "from": "Lovis", "to": "TypeScript", "type": "uses" }
- BAD: { "from": "User", "to": "system", "type": "related_to" }

## FACTS (only for complex info that doesn't fit as entity+relation)
Still use facts for:
- Complex insights that need a sentence
- Decisions with reasoning
- Examples of user's work (full text, up to 2000 chars)
- Episodes or experiences

Fact types: preference, fact, decision, task, project, learning, identity, insight, example

## ABSOLUTE RULES
1. If NOTHING new → nothing_new: true
2. Smalltalk, confirmations, code requests, greetings, "let's continue" → NOTHING
3. NEVER store vague garbage like "User is exploring...", "User wants to build a system that...", "User believes..."
4. Only store CONCRETE, NAMED things: a person, a technology, a decision, a preference
5. confidence between 0.3 and 0.8
6. Prefer entities+relations over facts. Use facts only when a triple doesn't capture it
7. "User" or the user's name is always a valid entity (type: person)
8. Max 5 entities per message. If more → keep only the most important
9. You can UPDATE existing knowledge via the "updates" array
10. Stream-of-consciousness monologues without concrete info → NOTHING
11. Meta-comments about the conversation itself → NOTHING`;

  if (frustration) {
    return base + `

FRUSTRATION MODE:
- The user is frustrated. Extract the CAUSE, not the emotion.
- Store the cause as a relation: Entity → "dislikes" → CauseEntity
- Do NOT use emotional language in entity names`;
  }

  return base;
}

function buildExtractionPrompt(
  message: string,
  existingNodes: Node[],
  recentContext?: string,
): string {
  // M34: Structured knowledge profile instead of raw node list
  let nodesContext = '';
  try {
    const knowledgeProfile = generateContext('MINIMAL');
    const hasKnowledge = knowledgeProfile &&
      knowledgeProfile !== 'Noch keine Memories gespeichert. Das System lernt automatisch aus Sessions.';

    if (hasKnowledge) {
      nodesContext = `\nWhat you already know about this person:\n${knowledgeProfile}\n\nOnly store things that are NEW and CONCRETE. Do NOT repeat what you already know.\n`;
    }
  } catch { /* fallback to entity names only */ }

  // Keep entity names for dedup (prevents "TS" instead of "TypeScript")
  const entities = existingNodes.filter(n => n.type === 'entity');
  if (entities.length > 0) {
    const entityNames = entities.slice(0, 15)
      .map(n => {
        const meta = n.metadata ? JSON.parse(n.metadata) : {};
        return `"${n.content}" (${meta.entity_type || 'concept'})`;
      })
      .join(', ');
    nodesContext += `\nKnown entity names (reuse, don't duplicate): ${entityNames}\n`;
  }

  let conversationBlock: string;
  if (recentContext) {
    conversationBlock = `Recent conversation for context:\n${recentContext}\n\nExtract from the LATEST message(s). Use earlier messages only for context.`;
  } else {
    conversationBlock = `New message: "${message}"`;
  }

  return `${nodesContext}
${conversationBlock}

Respond with this exact JSON:
{
  "nothing_new": true or false,
  "entities": [
    { "name": "EntityName", "type": "person|technology|project|concept|tool|food|place|organization|skill|language|framework|library" }
  ],
  "relations": [
    { "from": "EntityA", "to": "EntityB", "type": "uses|likes|dislikes|builds|knows|part_of|works_with|prefers|wants|is_a|located_at|has_skill|related_to", "confidence": 0.3-0.8 }
  ],
  "new_facts": [
    { "content": "...", "type": "preference|fact|decision|task|project|learning|identity|insight|example", "confidence": 0.3-0.8, "metadata": { "category": "optional" } }
  ],
  "updates": [
    { "existing_content": "exact content to update", "new_content": "updated content", "reason": "what changed" }
  ],
  "emotion": { "type": "neutral|frustrated|excited|curious", "intensity": 0.0-1.0 }
}

If nothing_new is true, ALL arrays MUST be empty.
Prefer entities+relations over facts. Facts are for complex info only.`;
}

function getRecentMessages(sessionId: string, limit: number = 10): string {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT role, content FROM raw_buffer WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(sessionId, limit) as Array<{ role: string; content: string }>;

    if (rows.length === 0) return '';

    return rows.reverse().map(r => {
      const prefix = r.role === 'user' ? 'User' : 'Assistant';
      return `${prefix}: ${r.content.slice(0, 500)}`;
    }).join('\n---\n');
  } catch {
    return '';
  }
}

export async function extractFromMessage(
  client: LLMClient,
  message: string,
  sessionId: string,
  flags?: KeywordFlags,
): Promise<Node[]> {
  const existingNodes = searchNodes(message, 15);

  const systemPrompt = buildSystemPrompt(flags?.frustration ?? false);

  // Always get recent context from raw_buffer for better understanding
  const isMultiMessage = message.includes('\n---\n');
  let recentContext: string | undefined;
  if (isMultiMessage) {
    recentContext = message;
  } else {
    const buffered = getRecentMessages(sessionId, 8);
    if (buffered) {
      recentContext = buffered;
    }
  }

  const prompt = buildExtractionPrompt(message, existingNodes, recentContext);

  let response: ExtractionResponse & { updates?: Array<{ existing_content: string; new_content: string; reason: string }> };
  try {
    response = await client.generateJson(prompt, {
      system: systemPrompt,
      temperature: 0.1,
    });
  } catch (err) {
    console.error('[Extractor] LLM extraction failed:', err);
    return [];
  }

  if (!response || typeof response.nothing_new !== 'boolean') {
    console.error('[Extractor] Invalid response format');
    return [];
  }

  // Handle updates to existing nodes
  if (Array.isArray(response.updates)) {
    for (const update of response.updates) {
      if (!update.existing_content || !update.new_content) continue;
      if (update.new_content.length < 5 || update.new_content.length > 300) continue;

      for (const node of existingNodes) {
        if (node.content.toLowerCase().trim() === update.existing_content.toLowerCase().trim()) {
          updateNode(node.id, { content: update.new_content.trim() });
          break;
        }
      }
    }
  }

  const createdNodes: Node[] = [];

  // ── Process Entities ──────────────────────────────────────
  const entityNodeMap = new Map<string, Node>(); // name (lowercase) → node

  if (Array.isArray(response.entities)) {
    // Pre-load existing person entities so "User" can be mapped to real name
    const existingEntities = getAllEntities(20);
    const existingPerson = existingEntities.find(e => {
      if (!e.metadata) return false;
      try {
        const meta = JSON.parse(e.metadata);
        return meta.entity_type === 'person' && e.content.toLowerCase() !== 'user';
      } catch { return false; }
    });

    for (const rawEntity of response.entities.slice(0, 5)) {
      const entity = verifyEntity(rawEntity);
      if (!entity) continue;

      // Map "User" to existing person entity if one exists
      if (entity.name.toLowerCase() === 'user' && existingPerson) {
        entityNodeMap.set('user', existingPerson);
        continue;
      }

      const node = getOrCreateEntity(entity.name, entity.type, {
        source: `llm:${sessionId}`,
      });

      entityNodeMap.set(entity.name.toLowerCase(), node);
      queueEmbedding(node.id, node.content);

      // Only count as "created" if it's actually new (created within last second)
      if (Date.now() - node.created_at < 1000) {
        createdNodes.push(node);
      }
    }
  }

  // ── Process Relations ─────────────────────────────────────
  // Build a type lookup from entities array for better typing
  const entityTypeLookup = new Map<string, string>();
  if (Array.isArray(response.entities)) {
    for (const e of response.entities) {
      if (e.name && e.type) entityTypeLookup.set(e.name.trim().toLowerCase(), e.type);
    }
  }

  if (Array.isArray(response.relations)) {
    const knownNames = new Set(entityNodeMap.keys());
    for (const rawRel of response.relations) {
      if (rawRel.from) knownNames.add(rawRel.from.trim().toLowerCase());
      if (rawRel.to) knownNames.add(rawRel.to.trim().toLowerCase());
    }

    for (const rawRel of response.relations) {
      const rel = verifyRelation(rawRel, knownNames);
      if (!rel) continue;

      const fromKey = rel.from.toLowerCase();
      const toKey = rel.to.toLowerCase();

      // Always use getOrCreateEntity for reinforcement
      let fromNode = entityNodeMap.get(fromKey);
      if (!fromNode) {
        const fromType = entityTypeLookup.get(fromKey) || 'concept';
        fromNode = getOrCreateEntity(rel.from, fromType, { source: `llm:${sessionId}` });
        entityNodeMap.set(fromKey, fromNode);
        queueEmbedding(fromNode.id, fromNode.content);
      }

      let toNode = entityNodeMap.get(toKey);
      if (!toNode) {
        const toType = entityTypeLookup.get(toKey) || 'concept';
        toNode = getOrCreateEntity(rel.to, toType, { source: `llm:${sessionId}` });
        entityNodeMap.set(toKey, toNode);
        queueEmbedding(toNode.id, toNode.content);
      }

      // Create or strengthen edge
      const existingEdge = getEdgeBetween(fromNode.id, toNode.id);
      if (existingEdge) {
        strengthenEdge(existingEdge.id, 0.05);
      } else {
        addEdge(fromNode.id, toNode.id, rel.type, rel.confidence * 0.8, {
          source_session: sessionId,
          extraction_confidence: rel.confidence,
        });
      }
    }
  }

  // ── Process Facts (legacy + complex info) ─────────────────
  if (response.nothing_new && (!response.entities || response.entities.length === 0)) {
    return createdNodes;
  }

  // M36+M38+M39+M40: Read encoding signal for importance modifiers + encoding context
  const encodingSig = readEncodingSignal(sessionId);
  const importanceBoost = calculateImportanceBoost(encodingSig);
  const encodingContext = encodingSig ? {
    session_topic: encodingSig.session_topic,
    mood: encodingSig.mood,
    provider: encodingSig.provider,
    message_index: encodingSig.message_index,
  } : undefined;

  if (Array.isArray(response.new_facts) && response.new_facts.length > 0) {
    const verified = verifyExtraction(response, existingNodes);

    // 11.1: Evidence Accumulation — Duplikate staerken bestehende Nodes
    for (const matchedId of verified.evidence_matches) {
      incrementEvidence(matchedId);
      recordEvidence();
      // 19.3: Update source_details on confirmation
      try {
        const matched = getNode(matchedId);
        if (matched?.metadata) {
          const meta = JSON.parse(matched.metadata);
          if (!meta.source_details) {
            meta.source_details = { first_session: sessionId, last_confirmed: Date.now(), confirmation_count: 1 };
          } else {
            meta.source_details.last_confirmed = Date.now();
            meta.source_details.confirmation_count = (meta.source_details.confirmation_count || 0) + 1;
          }
          updateNode(matchedId, { metadata: JSON.stringify(meta) });
        }
      } catch { /* non-fatal */ }
    }
    for (const enrichment of verified.enrichments) {
      const existingNode = getNode(enrichment.node_id);
      if (existingNode) {
        const newContent = existingNode.content + ' (' + enrichment.addition + ')';
        if (newContent.length <= 500) {
          updateNode(enrichment.node_id, { content: newContent });
        }
      }
    }

    // 24.2: Misinformation Protection — contradictions nicht ignorieren
    for (const contradiction of verified.contradictions) {
      const existingNode = getNode(contradiction.existing_node_id);
      if (!existingNode) continue;

      let cMeta: Record<string, unknown> = {};
      try { cMeta = existingNode.metadata ? JSON.parse(existingNode.metadata) : {}; } catch { cMeta = {}; }
      const evidence = (cMeta.evidence_count as number) || 1;

      if (evidence >= 5) {
        const contradictNode = addNode(contradiction.new_content, 'fact', {
          importance: 0.3,
          confidence: 0.3,
          source: `llm:${sessionId}`,
          metadata: { contradiction_of: contradiction.existing_node_id, needs_confirmation: true },
        });
        addEdge(contradictNode.id, contradiction.existing_node_id, 'contradicts', 0.5);
      } else {
        const replacementNode = addNode(contradiction.new_content, existingNode.type, {
          importance: existingNode.importance * 0.8,
          confidence: 0.4,
          source: `llm:${sessionId}`,
        });
        addEdge(replacementNode.id, contradiction.existing_node_id, 'replaced_by', 0.6);
        updateNode(contradiction.existing_node_id, { importance: existingNode.importance * 0.5 });
      }
    }

    for (const fact of verified.new_facts) {
      const maxLen = fact.type === 'example' ? 2000 : 300;
      if (!fact.content || fact.content.length < 5 || fact.content.length > maxLen) continue;
      if (isGarbage(fact.content)) { recordGarbage(); recordGarbageType(fact.content); continue; }

      const validTypes = ['preference', 'fact', 'decision', 'task', 'project', 'learning', 'identity', 'insight', 'example'];
      if (!validTypes.includes(fact.type)) continue;

      // 10.2+10.3: Sarcasm → drastically reduce confidence (don't store jokes as facts)
      let confidence = Math.min(CONFIDENCE_CAP, Math.max(0, fact.confidence));
      if (encodingSig?.sarcasm_detected) {
        confidence *= 0.3;
      }
      // 13.4: Rhetorical → reduce confidence (might not be factual)
      if (encodingSig?.rhetorical_detected) {
        confidence *= 0.5;
      }

      // 11.3: VTA Loop — Novelty gates plasticity (confidence boost/reduction)
      if (encodingSig) {
        if (encodingSig.novelty > 0.7) {
          confidence = Math.min(CONFIDENCE_CAP, confidence + 0.1);
        }
        if (encodingSig.novelty < 0.3) {
          confidence *= 0.85;
        }
      }

      const emotionalTag = flags?.frustration ? 'frustration' :
        (response.emotion?.type && response.emotion.type !== 'neutral' ? response.emotion.type : undefined);

      const baseImportance = fact.type === 'example' ? 0.75 : confidence * 0.9;
      const finalImportance = Math.max(0.1, Math.min(1.0, baseImportance + importanceBoost));

      const node = addNode(fact.content.trim(), fact.type, {
        importance: finalImportance,
        confidence,
        emotional_tag: emotionalTag,
        source: `llm:${sessionId}`,
        metadata: {
          ...fact.metadata,
          encoding_context: encodingContext,
          source_details: {
            first_session: sessionId,
            last_confirmed: Date.now(),
            confirmation_count: 1,
          },
        } as NodeMetadata,
      });

      autoLinkNodes(node.id);
      queueEmbedding(node.id, node.content);
      createdNodes.push(node);
      recordCreation();

      // 12.1: Event Boundary — tag nodes created right after topic change
      if (encodingSig?.event_boundary) {
        const nodeMeta: Record<string, unknown> = node.metadata ? JSON.parse(node.metadata) : {};
        nodeMeta.boundary_node = true;
        updateNode(node.id, { metadata: JSON.stringify(nodeMeta) });
      }

      if (fact.type === 'example' && fact.metadata?.category) {
        try { analyzeStyleForCategory(fact.metadata.category); } catch { /* non-critical */ }
      }
    }
  }

  // 24.4: Energie-Management — LLM-Call tracken
  recordLLMCall(sessionId, createdNodes.length);

  return createdNodes;
}

function truncateConversation(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.substring(0, half) + '\n\n[...truncated...]\n\n' + text.substring(text.length - half);
}

export async function extractFromTranscript(
  client: LLMClient,
  transcriptPath: string,
  sessionId?: string,
): Promise<Node[]> {
  const { readFileSync } = await import('fs');
  const { existsSync } = await import('fs');

  if (!existsSync(transcriptPath)) {
    console.error(`[Extractor] Transcript not found: ${transcriptPath}`);
    return [];
  }

  const raw = readFileSync(transcriptPath, 'utf-8');

  let conversation = '';
  try {
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'human' || entry.type === 'assistant') {
        const role = entry.type === 'human' ? 'User' : 'Assistant';
        const text = typeof entry.message === 'string'
          ? entry.message
          : entry.message?.content || JSON.stringify(entry.message);
        conversation += `${role}: ${text}\n\n`;
      }
    }
  } catch {
    conversation = raw;
  }

  const truncated = truncateConversation(conversation);
  const sid = sessionId || `transcript-${Date.now()}`;

  return extractFromMessage(client, truncated, sid);
}

const EPISODE_SYSTEM_PROMPT = `You are writing a diary entry for an AI memory system.
Summarize this session as an EXPERIENCE, not a fact list.

Format:
- What was worked on? Be specific (project names, features, bugs).
- What was the result? Did it succeed, fail, get stuck?
- What was the mood? Frustrated, excited, focused, confused?
- Any key decisions or breakthroughs?

Write like a diary entry. Max 300 words. Concrete and specific.
Write in the SAME LANGUAGE the user used (German if they spoke German, English if English).
Respond with JSON: { "episode": "the diary entry text" }`;

export async function extractEpisode(
  client: LLMClient,
  transcriptText: string,
  sessionId: string,
): Promise<Node | null> {
  const truncated = truncateConversation(transcriptText, 6000);

  let response: { episode?: string };
  try {
    response = await client.generateJson(
      `Session transcript:\n${truncated}\n\nWrite the diary entry for this session.`,
      { system: EPISODE_SYSTEM_PROMPT, temperature: 0.3 },
    );
  } catch {
    return null;
  }

  if (!response?.episode || response.episode.length < 20) return null;

  const episode = response.episode.slice(0, 1500);

  const node = addNode(episode, 'episode', {
    importance: 0.7,
    confidence: 0.7,
    source: `episode:${sessionId}`,
  });

  autoLinkNodes(node.id);
  queueEmbedding(node.id, node.content);
  return node;
}
