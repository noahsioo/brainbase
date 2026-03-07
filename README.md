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
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#supported-providers">Providers</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="https://brainbase.dev">Website</a>
</p>

---

Every AI starts from zero. Every session. Every time. Your AI doesn't know your name, your stack, your preferences, your project — nothing. You repeat yourself endlessly.

**BrainBase fixes this.** It gives every AI a real brain — built on neuroscience, not keyword matching.

One brain. Every AI. Every device. Local. Private. Free.

## What makes BrainBase different

This isn't another RAG wrapper or vector search. BrainBase is an actual brain — modeled after how the human brain stores, retrieves, and strengthens memories.

**92 neuroscience mechanisms.** 18,000 lines of TypeScript. Built in 24 days by a 17-year-old.

| Mechanism | What it does |
|-----------|-------------|
| **Thalamus** | Filters incoming information — only what matters gets through |
| **Spreading Activation** | Finds relevant memories by activating connected knowledge |
| **Hebbian Learning** | "Fire together, wire together" — connections strengthen with use |
| **Consolidation** | Sleep cycles reorganize and strengthen important memories |
| **Emotion System** | Frustration, excitement, curiosity — your AI feels context |
| **Metacognition** | The brain knows what it knows and what it doesn't |
| **6 Senses** | Code analysis, tone detection, emotion bypass, system health |
| **Development Phases** | The brain matures: infant → child → teen → adult → wise |

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

# Check status — see your brain health, node count, provider status
brainbase status

# Start the watcher daemon — processes memories in the background
brainbase watcher start

# Open the dashboard — 3D brain visualization in your browser
brainbase dashboard

# Search your brain
brainbase search "react state management"

# View stats
brainbase stats
```

After `brainbase init`, just use your AI normally. BrainBase works silently in the background — extracting knowledge, building connections, strengthening memories. Your AI gets smarter with every conversation.

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

1. **Every message** passes through the Thalamus — only important signals get through
2. **6 Senses** analyze code, tone, emotion, system health, stability, context
3. **Extraction** pulls entities, relationships, and facts from the conversation
4. **Knowledge Graph** stores everything as interconnected nodes with weighted edges
5. **Spreading Activation** finds relevant memories by traversing the graph
6. **Context Generator** builds a narrative briefing and injects it into your AI
7. **Consolidation** runs in the background — pruning, strengthening, connecting

Your AI never sees the graph directly. It gets a natural-language briefing with exactly the right context for the current conversation.

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

BrainBase includes a real-time 3D brain visualization dashboard:

<!-- TODO: Screenshot/GIF hier einfuegen (brainbase dashboard starten → Screenshot machen → als docs/dashboard.png speichern) -->
<!-- <p align="center"><img src="docs/dashboard.png" alt="BrainBase Dashboard" width="700"></p> -->

- Knowledge graph rendered as an interactive 3D network
- Node activation levels, edge strengths, memory clusters
- Brain health metrics (connectivity, freshness, coherence)
- Live watcher status and consolidation history

```bash
brainbase dashboard
```

## MCP Server

BrainBase exposes 7 tools via MCP (Model Context Protocol):

```bash
brainbase mcp
```

Works with any MCP-compatible client (Cursor, Windsurf, Continue, etc.)

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

Free for personal and non-commercial use. See license for details.

## Author

Built by **Noah Sioly** ([@noahsioo](https://x.com/noahsioo)), 17, from Germany.

600k+ followers on social media. But this is the real thing.

---

<p align="center">
  <strong>Your AI never forgets.</strong>
</p>
