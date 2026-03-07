<h1 align="center">BrainBase</h1>

<p align="center">
  <strong>Your AI forgets everything. Give it a real brain.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/brainbase" alt="npm">
  <img src="https://img.shields.io/badge/license-ELv2-blue" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-18k_lines-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/mechanisms-92-purple" alt="mechanisms">
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#supported-providers">Providers</a> ·
  <a href="#commands">Commands</a> ·
  <a href="https://brainbase.dev">Website</a>
</p>

---

## The problem

Every AI starts from zero. Every session. Every time.

It doesn't know your name. It doesn't know your stack. It doesn't know that you've explained the same architecture three times this week. You tell it you're building a React app — and tomorrow it'll ask you what framework you use.

The current "solutions"? A vector database that keyword-matches your old messages. A RAG wrapper that dumps 50 random chunks into the context window. A `.md` file you manually maintain. None of them actually *understand* anything. They just search text.

Your AI is a genius with amnesia.

## What BrainBase is

BrainBase is not a memory plugin. It's an actual brain.

Not metaphorically. I studied 158 documented neuroscience mechanisms — how the human brain stores, retrieves, connects, and strengthens memories — and translated 92 of them into code. 18,000 lines of TypeScript. Built in 24 days.

The AI you use (Claude, Cursor, Codex, Gemini — any of them) is just the mouth. It vibrates, it produces words. But the *brain* behind it? That's BrainBase. Same personality, same memories, same knowledge — no matter which AI you talk through.

Switch from Claude to Cursor mid-project. BrainBase doesn't care. It knows you. It knows your project. It picks up where you left off.

**One brain. Every AI. Local. Private. Free.**

```bash
npm install -g brainbase
```

## Why this is different

| | Vector search / RAG | BrainBase |
|---|---|---|
| Storage | Chunks of text in a database | Knowledge graph — entities, relationships, weighted edges |
| Retrieval | Keyword/embedding similarity | Spreading activation — memories trigger connected memories |
| Learning | None | Hebbian learning — "fire together, wire together" |
| Filtering | None — everything gets stored | Thalamus — only important signals pass through |
| Over time | Gets slower, noisier | Gets smarter — consolidation prunes noise, strengthens patterns |
| Background | Dead between sessions | Alive — sleep cycles, replay, creative connections |
| Self-awareness | None | Metacognition — the brain knows what it knows and what it doesn't |

<details>
<summary><strong>All 92 mechanisms</strong></summary>

**Thalamus:** 4 Nuclei, Burst/Tonic modes, Cross-Inhibition, Adaptive Thresholds, Sensory Gating, Latent Inhibition

**Spreading Activation:** Multi-Hop, Priming, Inhibition of Return, Myelination, Pattern Completion

**Synaptic:** Hebbian, Anti-Hebbian, STDP, Homeostatic Scaling, Pruning, Pattern Separation, Sparse Coding

**Emotion:** Amygdala, Neuromodulators, Somatic Markers, Approach/Avoidance, Predictive Coding

**Control:** Working Memory, Dual Process, Salience, Conflict Monitoring, Task Switching, Metacognition, Session Focus

**Hippocampus:** Encoding Specificity, 2-Tier Memory, Generation Effect, Novelty Detection, Synaptic Tagging

**Maintenance:** 6h Consolidation, NREM/REM Sleep, Replay, Reconsolidation, Spacing Effect, Schema Formation

**Advanced:** Provider Bias, Cue Overload, Interference, Tip-of-Tongue, Corollary Discharge, Brainwaves, Default Mode Network, Habits

**Hunger System:** Knowledge Gaps, Curiosity Impulses, Dopamine Reward, Active Info Seeking

**6 Senses:** Code Sense, Tone Sense, Emotion Bypass, Interoception, Stability Sense, Context Sense

**Quality:** Evidence Accumulation, Sarcasm Filter, VTA Loop, Self-Tuning, Cerebellum Feedback

**Deep Encoding:** Event Boundaries, Engrams, Neurogenesis, Systems Consolidation

**Social Cognition:** User Model / Theory of Mind, Empathy Modes, Task-Set Inference, Pragmatic Intent

**AI Psychology:** Provider Personality Profiles, Context-Format Optimization, Effectiveness Learning, Cross-Provider Identity

**Metacognition:** Feeling of Knowing, Judgment of Learning, 3 Attention Systems, Self-Model

**Fine Mechanics:** Refractory Period, Release Probability, Short-Term Plasticity, Metaplasticity, Inhibitory Plasticity

**Life:** Background Processing, Proactive Context Warming, DMN Creative Connections, System Mood

**Lifecycle:** Development Phases, Age-Specific Behavior across all subsystems
</details>

## Supported providers

Works with any AI that supports hooks or MCP:

| Provider | Integration | Status |
|----------|------------|--------|
| **Claude Code** | Hooks (SessionStart, UserPrompt, SessionEnd, PreCompact) | Full |
| **Cursor** | MCP Server | Full |
| **Windsurf** | MCP Server | Full |
| **Codex CLI** | Skills + Config | Full |
| **Gemini CLI** | GEMINI.md auto-update | Full |
| **Aider** | MCP Server | Full |
| **Continue** | MCP Server | Full |
| **Any MCP client** | MCP Server (stdio) | Full |

## Install

```bash
npm install -g brainbase
```

### Quick start

```bash
# Initialize — creates your brain, connects your AI providers
brainbase init

# Start the background daemon — processes memories while you work
brainbase watcher start

# That's it. Use your AI normally. BrainBase runs silently.
```

After `brainbase init`, just use your AI normally. BrainBase works in the background — extracting knowledge, building connections, strengthening memories. Your AI gets smarter with every conversation.

## How it works

```
You talk to any AI
        |
        v
   [ BrainBase ]
        |
   +---------+---------+---------+
   |         |         |         |
Thalamus  Senses   Emotion   Memory
(filter)  (analyze) (feel)   (store)
   |         |         |         |
   +---------+---------+---------+
        |
   Knowledge Graph
   (nodes + edges + spreading activation)
        |
        v
   Context Generator
   (builds a narrative briefing for your AI)
        |
        v
   Your AI now knows you
```

1. **Thalamus** filters incoming information — only important signals get through, noise gets blocked
2. **6 Senses** analyze code patterns, tone, emotion, system health, knowledge consistency, context
3. **Extraction** pulls entities, relationships, and facts from the conversation
4. **Knowledge Graph** stores everything as interconnected nodes with weighted edges
5. **Spreading Activation** finds relevant memories — one concept triggers connected knowledge, like how thinking about "coffee" activates "morning", "productivity", "that bug you fixed at 3am"
6. **Context Generator** builds a natural-language briefing and injects it into your AI
7. **Consolidation** runs in the background — pruning weak memories, strengthening important ones, finding connections you didn't see

Your AI never sees the graph directly. It gets a narrative briefing with exactly the right context for the current conversation.

## The brain is alive

This isn't a database that waits for queries. BrainBase runs continuously:

- **Sleep cycles** — every 6 hours, the brain consolidates. NREM strengthens important memories, REM finds creative connections between unrelated knowledge
- **Hunger** — the brain detects knowledge gaps and drives your AI to ask the right questions. Not because you told it to — because it *wants* to know
- **Development phases** — a new brain is like a child: curious about everything, low thresholds, absorbing everything. After hundreds of sessions, it matures: selective, fast, deep schemas
- **Self-awareness** — the brain monitors itself. Too much noise? Raises thresholds. Knowledge fragmented? Triggers consolidation. It regulates itself

## Commands

| Command | Description |
|---------|-------------|
| `brainbase init` | Setup wizard — creates brain, connects providers |
| `brainbase status` | Brain health, node count, provider status |
| `brainbase watcher start` | Start background memory processing |
| `brainbase dashboard` | Open 3D brain visualization |
| `brainbase search <query>` | Search your knowledge graph |
| `brainbase stats` | Detailed brain statistics |
| `brainbase list` | Recent memory nodes |
| `brainbase hot` | Most activated nodes right now |
| `brainbase add <text>` | Manually add knowledge |
| `brainbase forget <query>` | Remove specific memories |
| `brainbase consolidate` | Trigger manual consolidation cycle |
| `brainbase verify` | Run brain integrity check |
| `brainbase snapshot` | Export brain state |
| `brainbase embed` | Generate embeddings for hybrid search |

## Dashboard

BrainBase includes a real-time 3D visualization of your brain:

<!-- TODO: Screenshot/GIF einfuegen (brainbase dashboard → Screenshot → docs/dashboard.png) -->
<!-- <p align="center"><img src="docs/dashboard.png" alt="BrainBase Dashboard" width="700"></p> -->

- Interactive 3D knowledge graph — nodes, edges, clusters
- Activation levels and memory strength in real-time
- Brain health metrics (connectivity, freshness, coherence)
- Watcher status and consolidation history

```bash
brainbase dashboard
```

## Architecture

```
src/
├── commands/        # CLI commands (init, status, search, etc.)
├── memory/          # Knowledge Graph engine (SQLite, 15 tables)
├── extraction/      # Entity-relationship extraction + verification
├── signal/          # Thalamus, activation, spreading activation
├── senses/          # 6 senses (code, tone, emotion, health, stability, context)
├── learning/        # Hebbian, self-tuner, engrams, cold start
├── consolidation/   # NREM/REM sleep, reconsolidation, schemas
├── regulation/      # Echo system, metacognition, self-model, user-model
├── meta/            # AI profiles, development phases, idle brain
├── hooks/           # Provider integration (session-start, user-prompt, etc.)
├── watcher/         # Background daemon (HTTP port 7899)
├── mcp/             # MCP server (7 tools, stdio JSON-RPC)
├── tacit/           # Knowledge hunger, curiosity system
├── hygiene/         # Pruning, garbage collection, brain maintenance
├── providers/       # Multi-provider detection + configuration
├── llm/             # Cloud LLM client (OpenAI, Anthropic, etc.)
├── dashboard/       # 3D brain visualization
└── config.ts        # Central configuration
```

100 TypeScript files. 18,000+ lines. Zero dependencies on any AI provider.

## Privacy

Your brain runs **100% locally**. SQLite database on your machine. No cloud. No telemetry. No data leaves your device.

Your data is yours. Always.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Database:** better-sqlite3 (Knowledge Graph)
- **CLI:** Commander.js + @clack/prompts
- **LLM Analysis:** OpenAI API (gpt-4o-mini) or any compatible endpoint
- **Embeddings:** text-embedding-3-small (hybrid search)
- **Dashboard:** Vanilla HTML + Three.js (3D visualization)

## License

[Elastic License 2.0 (ELv2)](LICENSE.md)

Free to use. See license for details.

## Author

I'm **Noah Sioly** ([@noahsioo](https://x.com/noahsioo)), 17, from Germany. I built this.

---

<p align="center">
  <strong>Your AI never forgets.</strong>
</p>
