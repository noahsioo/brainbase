import type { LLMClient } from '../llm/types.js';
import { addNode, getNode, updateNode, searchNodes, getDb, getOrCreateEntity, findEntityByName, getEdgeBetween, addEdge, strengthenEdge, getAllEntities, incrementEvidence, type Node, type NodeMetadata } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import type { KeywordFlags } from '../signal/keywords.js';
import { verifyExtraction, verifyEntity, verifyRelation, isGarbage, type ExtractionResponse, type ExtractedEntity, type ExtractedFact, type ExtractedRelation, type ExtractedTopic, type SemanticIntent } from '../extraction/verification.js';
import { analyzeStyleForCategory } from '../learning/style-analyzer.js';
import { queueEmbedding } from '../llm/embeddings.js';
import { recordCreation, recordGarbage, recordEvidence } from '../learning/self-tuner.js';
import { recordGarbageType } from '../hygiene/immune-system.js';
import { recordLLMCall } from '../regulation/energy.js';
import { generateContext } from '../memory/context-generator.js';
import { createProspectiveMemory } from '../memory/prospective.js';
import { parseTemporalExpression } from '../extraction/temporal-parser.js';
import { applyDopaminReward, getHungerZones } from '../memory/knowledge-hunger.js';

const CONFIDENCE_CAP = 0.8;
const INVALID_TOPIC_NAMES = new Set([
  'conversation', 'session', 'message', 'request', 'topic', 'thema',
  'project', 'projekt', 'task', 'aufgabe', 'general', 'allgemein',
]);
const VALID_INTENTS: ReadonlySet<SemanticIntent> = new Set([
  'question',
  'statement',
  'request',
  'feedback',
  'greeting',
  'other',
]);

export interface WatcherSemanticPayload {
  nothing_new: boolean;
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  topic: string;
  topic_confidence: number;
  intent: SemanticIntent;
  facts: ExtractedFact[];
  references: string[];
}

export interface MessageExtractionResult {
  nodes: Node[];
  semantic: WatcherSemanticPayload | null;
}

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
- GOOD entities: "Lovis", "TypeScript", "BrainBase", "Berlin", "React"
- BAD entities: "the system", "it", "something", "a thing", "brain", "idea", "concept"

Entity types: person, technology, project, concept, tool, food, place, organization, skill, language, framework, library, service, topic

## RELATIONS
How entities connect: uses, likes, dislikes, builds, knows, part_of, works_with, prefers, wants, is_a, located_at, has_skill, created_by, member_of, speaks, interested_in, depends_on, enables, related_to
- GOOD: { "from": "Lovis", "to": "TypeScript", "type": "uses" }
- BAD: { "from": "User", "to": "system", "type": "related_to" }

## RELATIONSHIP QUALITY
Relationships are MORE VALUABLE than isolated entities.
When user says "I use TypeScript for BrainBase":
- Extract BOTH: Lovis → uses → TypeScript AND BrainBase → uses → TypeScript
Multi-hop: "Lovis builds BrainBase with TypeScript" → 3 relations:
  1. Lovis → builds → BrainBase
  2. BrainBase → uses → TypeScript
  3. Lovis → uses → TypeScript

## FACTS (RARELY needed — prefer entities+relations)
Only use facts for these SPECIFIC cases:
- A concrete PREFERENCE: "Bevorzugt X ueber Y" (type: preference)
- A concrete DECISION with reasoning: "Switched from X to Y because Z" (type: decision)
- User's IDENTITY info: name, age, role, location (type: identity)
- Code EXAMPLES of user's work style (type: example, up to 2000 chars)
- A REMINDER or future intention: "Naechsten Donnerstag Zahnarzt" (type: reminder)
  The user mentions something they need to do/remember in the future.
  MUST include: WHAT needs to happen. SHOULD include: WHEN (date/time/day).
  Do NOT use for vague plans ("irgendwann will ich...") — only concrete intentions with a time reference.
- A LIFE EVENT or life phase: a PERIOD that affects the user's context over days/weeks/months (type: life_event)
  Unlike reminders (one-shot), life events have a DURATION.
  "In 2 Monaten Sommerferien" → { type: "life_event", content: "Sommerferien", metadata: { starts: "in 2 Monaten", duration_days: 42 } }
  "Ab September neuer Job" → { type: "life_event", content: "Neuer Job", metadata: { starts: "September", duration_days: 365 } }
  "Bin gerade krank" → { type: "life_event", content: "Krank", metadata: { starts: "heute", duration_days: 7 } }
  "Pruefungsphase laeuft" → { type: "life_event", content: "Pruefungsphase", metadata: { starts: "heute", duration_days: 21 } }
  MUST include: WHAT the phase is. SHOULD include: WHEN it starts (in metadata.starts).
  metadata.duration_days is your BEST ESTIMATE of how long this phase typically lasts.
  Do NOT use for single events ("Zahnarzt am Mittwoch") — use reminder for those.
  Use life_event ONLY for PHASES: vacation, illness, exam period, new job, moving, travel, etc.

Allowed fact types: preference, decision, identity, example, reminder, life_event
Do NOT use any other fact type. If info fits as entity+relation, use that instead.

## WHEN TO SET nothing_new
nothing_new: true means "there is ZERO new concrete information in this message".
- Smalltalk, confirmations, code requests, build commands, greetings → nothing_new: true
- Meta-comments about the conversation → nothing_new: true
- Code debugging, fixing, building, deploying → nothing_new: true (unless a NEW tool/technology is mentioned)

CRITICAL: If a message mentions ANY new named entity (person, place, company, tool) that is NOT in the known entities list, set nothing_new: false and extract it.
Example: "Ich studiere an der TU Muenchen und arbeite bei Siemens"
- If TU Muenchen is already known but Siemens is NOT → nothing_new: false, extract Siemens
- Only set nothing_new: true if EVERYTHING in the message is already known

## ABSOLUTE RULES
1. If ANY new concrete entity or fact exists → nothing_new: false
2. NEVER store vague observations: "User is exploring...", "User wants to build...", "User believes..."
3. Only store CONCRETE, NAMED things: a person, a technology, a decision, a preference
4. confidence between 0.3 and 0.5
5. Prefer entities+relations over facts. Facts ONLY for preferences/decisions/identity
6. "User" or the user's name is always a valid entity (type: person)
7. Max 5 entities per message. If more → keep only the most important
8. You can UPDATE existing knowledge via the "updates" array
9. Repeating ONLY already known info → nothing_new: true
10. Extract PEOPLE by name (family, friends, colleagues). "Mein Bruder Max" → entity Max (person) + relation
11. Extract ORGANIZATIONS (companies, universities, teams) the user is connected to
12. It's better to extract a real entity than to miss it. But NEVER store garbage.`;

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
      nodesContext = `\nWhat you already know about this person:\n${knowledgeProfile}\n\nIMPORTANT: The above is what you ALREADY know. Do NOT re-extract or create facts about things above. Focus ONLY on what is NEW in the user's message below.\n`;
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
    conversationBlock = `Recent conversation for context:\n${recentContext}\n\nExtract NEW entities, relations, and facts from the messages above. Focus on NAMED things (people, companies, places, tools) that are NOT in the "already known" section.`;
  } else {
    conversationBlock = `New message: "${message}"\n\nExtract NEW entities, relations, and facts from this message. Focus on NAMED things (people, companies, places, tools) that are NOT in the "already known" section.`;
  }

  return `${nodesContext}
${conversationBlock}

Respond with this exact JSON:
{
  "nothing_new": true or false,
  "entities": [
    { "name": "EntityName", "type": "person|technology|project|concept|tool|food|place|organization|skill|language|framework|library", "confidence": 0.3-0.5 }
  ],
  "relations": [
    { "from": "EntityA", "to": "EntityB", "type": "uses|likes|dislikes|builds|knows|part_of|works_with|prefers|wants|is_a|located_at|has_skill|related_to", "confidence": 0.3-0.5 }
  ],
  "new_facts": [
    { "content": "...", "type": "preference|decision|identity|example|reminder|life_event", "confidence": 0.3-0.5, "metadata": { "category": "optional", "starts": "temporal expression for life_event", "duration_days": 14 } }
  ],
  "topic": { "name": "short concrete topic", "confidence": 0.0-1.0 },
  "intent": "question|statement|request|feedback|greeting|other",
  "references": ["pronoun or callback target from the latest message if relevant"],
  "updates": [
    { "existing_content": "exact content to update", "new_content": "updated content", "reason": "what changed" }
  ],
  "emotion": { "type": "neutral|frustrated|excited|curious", "intensity": 0.0-1.0 }
}

RULES FOR topic / intent / references:
- topic must be a SHORT concrete noun phrase, not a sentence
- topic must NOT be vague meta like "conversation", "project", "request", "message"
- intent is for the LATEST user message only
- references should contain unresolved callbacks like "das", "it", "that bug", otherwise []

If nothing_new is true, entities/relations/new_facts/updates MUST be empty.
topic and intent may still be set if clear. references may still be set if useful.
Prefer entities+relations over facts. Facts ONLY for preferences, decisions, identity, or examples.
FOCUS: Extract from the USER'S MESSAGE, not from the existing knowledge. Do NOT create facts about things you already know.
Remember: nothing_new: true is the DEFAULT. Most messages don't contain new knowledge.`;
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

function isSubstantiveMessage(message: string): boolean {
  const lines = message.split('\n---\n');
  const lastMessage = lines[lines.length - 1] || message;
  const words = lastMessage.trim().split(/\s+/).filter(w => w.length > 2);

  if (words.length < 3) return false;

  const confirmPatterns = /^(ja|nein|ok|okay|genau|perfekt|passt|gut|weiter|mach|continue|yes|no|sure|right|exactly|nope|yep|alles klar|klar|done|fertig|los|go)$/i;
  if (words.length <= 3 && words.every(w => confirmPatterns.test(w))) return false;

  // V5-2: Code/build commands are not substantive for memory extraction
  const commandPatterns = /^(mach|fix|aender|änder|build|run|deploy|push|commit|install|update|start|stop|delete|remove|erstell|zeig|show|list|check|test)\b/i;
  if (words.length <= 5 && commandPatterns.test(lastMessage.trim())) {
    // V8-6: Wenn ein Eigenname/Tech-Term enthalten ist → trotzdem substantive
    const CASE_SENSITIVE = /[A-Z][a-z]+[A-Z]|[A-Z]{2,}|[a-z]+\.[a-z]+/;
    const TECH_TERMS = /^(typescript|python|react|node|api|sdk|cli|llm|gpu|cpu|sql|css|html|json|yaml|xml|supabase|firebase|docker|redis|postgres|graphql|webpack|vite|nextjs|nuxt|svelte|angular|vue|rust|golang|swift|kotlin)$/i;
    const hasEntity = words.some(w => w.length > 2 && (CASE_SENSITIVE.test(w) || TECH_TERMS.test(w)));
    if (!hasEntity) return false;
  }

  // V5-2: Filter very short messages with only stopwords/filler
  const SUBSTANTIVE_STOPWORDS = new Set([
    'das', 'the', 'und', 'and', 'oder', 'aber', 'but', 'also', 'dann',
    'bitte', 'please', 'mal', 'halt', 'noch', 'jetzt', 'now', 'hier',
    'here', 'dort', 'there', 'einfach', 'just', 'only', 'nur', 'wie',
    'how', 'was', 'what', 'mit', 'with', 'für', 'fuer', 'for', 'den',
    'dem', 'die', 'der', 'ein', 'eine', 'einen', 'nicht', 'not', 'kann',
    'can', 'will', 'soll', 'should', 'muss', 'must',
  ]);
  const realWords = words.filter(w => !SUBSTANTIVE_STOPWORDS.has(w.toLowerCase()));
  if (realWords.length < 2) return false;

  return true;
}

export async function extractFromMessageDetailed(
  client: LLMClient,
  message: string,
  sessionId: string,
  flags?: KeywordFlags,
): Promise<MessageExtractionResult> {
  if (!isSubstantiveMessage(message)) {
    recordLLMCall(sessionId, 0);
    return {
      nodes: [],
      semantic: {
        nothing_new: true,
        entities: [],
        relations: [],
        topic: '',
        topic_confidence: 0,
        intent: 'other',
        facts: [],
        references: [],
      },
    };
  }

  const existingNodes = searchNodes(message, 15);

  const systemPrompt = buildSystemPrompt(flags?.frustration ?? false);

  // Always get recent context from raw_buffer for better understanding
  const isMultiMessage = message.includes('\n---\n');
  let recentContext: string | undefined;
  if (isMultiMessage) {
    recentContext = message;
  } else {
    const buffered = getRecentMessages(sessionId, 3);
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
    return { nodes: [], semantic: null };
  }

  if (!response || typeof response.nothing_new !== 'boolean') {
    console.error('[Extractor] Invalid response format');
    return { nodes: [], semantic: null };
  }

  // Diagnostic: log when LLM says nothing_new but message had substance
  if (response.nothing_new && process.env.MEMORY_DEBUG) {
    const msgPreview = message.slice(0, 120);
    console.error(`[Extractor] LLM returned nothing_new:true for: "${msgPreview}"`);
  }

  const semantic = buildWatcherSemanticPayload(response);

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

  // V9-8: Co-Mention Edge Strengthening — implizite Kanten zwischen co-extrahierten Entities
  if (entityNodeMap.size >= 2) {
    const entityEntries = Array.from(entityNodeMap.entries())
      .filter(([, node]) => node.type === 'entity')
      .slice(0, 5);

    for (let i = 0; i < entityEntries.length; i++) {
      for (let j = i + 1; j < entityEntries.length; j++) {
        const [, nodeA] = entityEntries[i];
        const [, nodeB] = entityEntries[j];
        if (nodeA.id === nodeB.id) continue;

        const existingEdge = getEdgeBetween(nodeA.id, nodeB.id);
        if (existingEdge) {
          strengthenEdge(existingEdge.id, 0.02);
        } else {
          addEdge(nodeA.id, nodeB.id, 'co_mentioned', 0.1, {
            auto_generated: true,
            source_session: sessionId,
          });
        }
      }
    }
  }

  // ── Process Facts (legacy + complex info) ─────────────────
  if (response.nothing_new && (!response.entities || response.entities.length === 0)) {
    return { nodes: createdNodes, semantic };
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

      const validTypes = ['preference', 'decision', 'identity', 'example', 'reminder', 'life_event'];
      if (!validTypes.includes(fact.type)) continue;

      // V6-1: Reminder → Prospective Memory (skip normal fact storage)
      if (fact.type === 'reminder') {
        const temporal = parseTemporalExpression(fact.content);
        const TEMPORAL_STOPWORDS = /^(naechsten?|nächsten?|morgen|uebermorgen|übermorgen|heute|next|tomorrow|the|and|und|oder|for|fuer|für|with|mit|bis|until|by|am|um|at|in|on)$/i;
        const triggerWords = fact.content
          .split(/\s+/)
          .filter(w => w.length > 3 && !TEMPORAL_STOPWORDS.test(w))
          .map(w => w.toLowerCase())
          .slice(0, 5);

        createProspectiveMemory(fact.content, triggerWords, {
          importance: 0.85,
          source: `llm:${sessionId}`,
          trigger_date: temporal?.date,
          trigger_type: temporal?.type === 'recurring'
            ? 'recurring'
            : temporal ? (triggerWords.length > 0 ? 'both' : 'time') : 'event',
        });
        recordCreation();
        continue;
      }

      // V11-2: Life Event → Temporal Life Context (skip normal fact storage)
      if (fact.type === 'life_event') {
        const factMeta = fact.metadata as Record<string, unknown> | undefined;
        const startsExpr = (factMeta?.starts as string) || fact.content;
        const temporal = parseTemporalExpression(startsExpr);
        const durationDays = (factMeta?.duration_days as number) || 14;

        const validFrom = temporal?.date || Date.now();
        const validUntil = validFrom + durationDays * 24 * 60 * 60 * 1000;

        const now = Date.now();
        let phase: 'upcoming' | 'active' | 'past' = 'upcoming';
        if (now >= validFrom && now <= validUntil) phase = 'active';
        if (now > validUntil) phase = 'past';

        addNode(fact.content, 'life_event', {
          importance: 0.9,
          confidence: Math.min(0.5, fact.confidence),
          source: `llm:${sessionId}`,
          metadata: {
            valid_from: validFrom,
            valid_until: validUntil,
            event_phase: phase,
            duration_days: durationDays,
          },
        });
        recordCreation();
        continue;
      }

      // V5-2: New facts start with max 0.5 confidence — must earn higher via Evidence
      const NEW_FACT_CONFIDENCE_CAP = 0.5;
      let confidence = Math.min(NEW_FACT_CONFIDENCE_CAP, Math.max(0, fact.confidence));
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

  // V7: Dopamin Reward — hunger satisfaction when new knowledge fills gaps
  if (createdNodes.length > 0) {
    try {
      const hungerZones = getHungerZones(sessionId);
      if (hungerZones.length > 0) {
        for (const node of createdNodes) {
          const content = node.content.toLowerCase();
          for (const zone of hungerZones) {
            if (content.includes(zone.entity.toLowerCase())) {
              applyDopaminReward(zone.entity, sessionId);
              break;
            }
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return { nodes: createdNodes, semantic };
}

export async function extractFromMessage(
  client: LLMClient,
  message: string,
  sessionId: string,
  flags?: KeywordFlags,
): Promise<Node[]> {
  const result = await extractFromMessageDetailed(client, message, sessionId, flags);
  return result.nodes;
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

export function buildWatcherSemanticPayload(response: ExtractionResponse): WatcherSemanticPayload {
  const normalizedTopic = normalizeTopic(response.topic);

  return {
    nothing_new: Boolean(response.nothing_new),
    entities: normalizeSemanticEntities(response.entities),
    relations: normalizeSemanticRelations(response.relations),
    topic: normalizedTopic.name,
    topic_confidence: normalizedTopic.confidence,
    intent: normalizeIntent(response.intent),
    facts: normalizeSemanticFacts(response.new_facts),
    references: normalizeReferences(response.references),
  };
}

function normalizeSemanticEntities(entities: ExtractedEntity[] | undefined): ExtractedEntity[] {
  if (!Array.isArray(entities)) return [];

  return entities
    .map(entity => verifyEntity(entity))
    .filter((entity): entity is ExtractedEntity => entity !== null)
    .slice(0, 5)
    .map(entity => ({
      ...entity,
      confidence: normalizeSemanticConfidence(entity.confidence),
    }));
}

function normalizeSemanticRelations(relations: ExtractedRelation[] | undefined): ExtractedRelation[] {
  if (!Array.isArray(relations)) return [];

  return relations
    .map(relation => {
      const from = normalizeText(relation.from);
      const to = normalizeText(relation.to);
      const type = normalizeText(relation.type);
      if (!from || !to || !type || from.toLowerCase() === to.toLowerCase()) {
        return null;
      }
      return {
        from,
        to,
        type,
        confidence: normalizeSemanticConfidence(relation.confidence),
      };
    })
    .filter((relation): relation is ExtractedRelation => relation !== null)
    .slice(0, 8);
}

function normalizeSemanticFacts(facts: ExtractedFact[] | undefined): ExtractedFact[] {
  if (!Array.isArray(facts)) return [];

  return facts
    .map(fact => {
      const content = normalizeText(fact.content);
      const type = normalizeText(fact.type);
      if (!content || !type) return null;
      return {
        ...fact,
        content,
        type: type as ExtractedFact['type'],
        confidence: normalizeSemanticConfidence(fact.confidence),
      };
    })
    .filter((fact): fact is ExtractedFact => fact !== null)
    .slice(0, 8);
}

function normalizeTopic(topic: ExtractedTopic | undefined): ExtractedTopic {
  const name = normalizeText(topic?.name).toLowerCase();
  if (!name || INVALID_TOPIC_NAMES.has(name)) {
    return { name: '', confidence: 0 };
  }

  return {
    name,
    confidence: normalizeTopicConfidence(topic?.confidence),
  };
}

function normalizeIntent(intent: SemanticIntent | undefined): SemanticIntent {
  const normalized = normalizeText(intent).toLowerCase() as SemanticIntent;
  return VALID_INTENTS.has(normalized) ? normalized : 'other';
}

function normalizeReferences(references: string[] | undefined): string[] {
  if (!Array.isArray(references)) return [];

  const unique: string[] = [];
  for (const reference of references) {
    const normalized = normalizeText(reference);
    if (!normalized) continue;
    if (unique.some(existing => existing.toLowerCase() === normalized.toLowerCase())) continue;
    unique.push(normalized);
    if (unique.length >= 5) break;
  }

  return unique;
}

function normalizeSemanticConfidence(value: number | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0.3, Math.min(0.8, numeric));
}

function normalizeTopicConfidence(value: number | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeText(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
