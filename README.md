<p align="center">
  <img src="docs/logo.svg" alt="Veris" width="80">
</p>

<h1 align="center">Veris</h1>

<p align="center">
  <strong>Your AI forgets everything. Give it a real brain.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/veris?style=for-the-badge" alt="npm">
  <img src="https://img.shields.io/badge/license-ELv2-blue?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-24k_lines-blue?style=for-the-badge" alt="TypeScript">
  <img src="https://img.shields.io/badge/mechanisms-124+-purple?style=for-the-badge" alt="mechanisms">
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#supported-providers">Providers</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="https://docs.veris.dev">Docs</a> ·
  <a href="https://veris.dev">Website</a>
</p>

## The problem

Every AI starts from zero. Every session. Every time.

It doesn't know your name. It doesn't know your stack. It doesn't know that you've explained the same architecture three times this week. You tell it you're building a React app — and tomorrow it'll ask you what framework you use.

The current "solutions"? A vector database that keyword-matches your old messages. A RAG wrapper that dumps 50 random chunks into the context window. A `.md` file you manually maintain. None of them actually *understand* anything. They just search text.

Your AI is a genius with amnesia.

## What Veris is

Veris is not a memory plugin. It's an actual brain.

Not metaphorically. 158 documented neuroscience mechanisms — how the human brain stores, retrieves, connects, and strengthens memories — translated into code. **124+ mechanisms. 24,700+ lines of TypeScript. Built by a 17-year-old.**

The AI you use (OpenClaw, Claude Code, Cursor, Codex, Gemini — any of them) is just the mouth. It vibrates, it produces words. But the *brain* behind it? That's Veris. Same personality, same memories, same knowledge — no matter which AI you talk through.

Switch from OpenClaw to Cursor mid-project. Veris doesn't care. It knows you. It knows your project. It picks up where you left off.

**One brain. Every AI. Local. Private. Free.**

```bash
npm install -g veris
```

## Why this is different

| | Vector search / RAG | Veris |
|---|---|---|
| Storage | Chunks of text in a database | Knowledge graph — entities, relationships, weighted edges |
| Retrieval | Keyword/embedding similarity | Spreading activation — memories trigger connected memories |
| Learning | None | Hebbian learning — "fire together, wire together" |
| Filtering | None — everything gets stored | Thalamus — only important signals pass through |
| Over time | Gets slower, noisier | Gets smarter — consolidation prunes noise, strengthens patterns |
| Background | Dead between sessions | Alive — sleep cycles, replay, creative connections |
| Self-awareness | None | Metacognition — the brain knows what it knows and what it doesn't |

<details>
<summary><strong>All 124+ mechanisms</strong></summary>

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

Full descriptions: [All 124+ Mechanisms →](https://docs.veris.dev/mechanisms/)
</details>

## Supported providers

Works with any AI that supports hooks or MCP:

| Provider | Integration | Status |
|----------|------------|--------|
| **OpenClaw** | AGENTS.md | Full |
| **Claude Code** | Hooks (SessionStart, UserPrompt, SessionEnd, PreCompact) | Full |
| **Cursor** | MCP Server | Full |
| **Windsurf** | MCP Server | Full |
| **Codex CLI** | Skills + Config | Full |
| **Gemini CLI** | GEMINI.md auto-update | Full |
| **Aider** | MCP Server | Full |
| **Continue** | MCP Server | Full |
| **Any MCP client** | MCP Server (stdio) | Full |

Setup guide for each provider: [Provider docs →](https://docs.veris.dev/providers/)

## Install

```bash
npm install -g veris
```

### Quick start

```bash
# Initialize — creates your brain, connects your AI providers
veris init

# Start the background daemon — processes memories while you work
veris watcher start

# That's it. Use your AI normally. Veris runs silently.
```

After `veris init`, just use your AI normally. Veris works in the background — extracting knowledge, building connections, strengthening memories. Your AI gets smarter with every conversation.

Full setup guide: [Getting Started →](https://docs.veris.dev/getting-started/installation.html)

## How it works

```
You talk to any AI
        |
        v
   [ Veris ]
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

Deep dive into every mechanism: [How Veris Works →](https://docs.veris.dev/concepts/overview.html)

## The brain is alive

This isn't a database that waits for queries. Veris runs continuously:

- **Sleep cycles** — every 6 hours, the brain consolidates. NREM strengthens important memories, REM finds creative connections between unrelated knowledge
- **Hunger** — the brain detects knowledge gaps and drives your AI to ask the right questions. Not because you told it to — because it *wants* to know
- **Development phases** — a new brain is like a child: curious about everything, low thresholds, absorbing everything. After hundreds of sessions, it matures: selective, fast, deep schemas
- **Self-awareness** — the brain monitors itself. Too much noise? Raises thresholds. Knowledge fragmented? Triggers consolidation. It regulates itself

## Commands

| Command | Description |
|---------|-------------|
| `veris init` | Setup wizard — creates brain, connects providers |
| `veris status` | Brain health, node count, provider status |
| `veris watcher start` | Start background memory processing |
| `veris dashboard` | Open 3D brain visualization |
| `veris search <query>` | Search your knowledge graph |
| `veris stats` | Detailed brain statistics |
| `veris list` | Recent memory nodes |
| `veris hot` | Most activated nodes right now |
| `veris add <text>` | Manually add knowledge |
| `veris forget <query>` | Remove specific memories |
| `veris consolidate` | Trigger manual consolidation cycle |
| `veris verify` | Run brain integrity check |
| `veris snapshot` | Export brain state |
| `veris embed` | Generate embeddings for hybrid search |
| `veris detect` | Detect installed AI providers |
| `veris mcp install` | Register MCP server for a provider |
| `veris site` | Open veris.dev in browser |

Full reference with flags and examples: [CLI docs →](https://docs.veris.dev/cli/)

## Dashboard

Oh yeah, I also built a dashboard. Because why not. 🧠

<p align="center">
  <video src="https://github.com/user-attachments/assets/faf0e7af-a8eb-44b9-8317-c011530fca3b" width="700" controls></video>
</p>

- Interactive 3D knowledge graph — nodes, edges, clusters
- Activation levels and memory strength in real-time
- Brain health metrics (connectivity, freshness, coherence)
- Watcher status and consolidation history

```bash
veris dashboard
```

[Dashboard docs →](https://docs.veris.dev/dashboard/)

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

107 TypeScript files. 24,700+ lines. Zero dependencies on any AI provider.

[Full architecture breakdown →](https://docs.veris.dev/architecture/)

## Privacy

Your brain runs **100% locally**. SQLite database on your machine. No cloud. No telemetry. No data leaves your device — except conversation excerpts sent to your configured LLM provider for knowledge extraction.

Your data is yours. Always.

[Privacy & License details →](https://docs.veris.dev/privacy/)

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

Built by **Noah Sioly** ([@noahsioo](https://x.com/noahsioo)), 17, from Germany.

---

<p align="center">
  <strong>Your AI never forgets.</strong>
</p>
