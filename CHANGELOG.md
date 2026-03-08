# Changelog

## v0.2.0

- **Session-aware memory retrieval** — context, tasks, conflicts, and meta insights now track which session they belong to
- **Semantic scoring** — context candidates are ranked by embedding similarity, not just activation strength
- **Session embeddings** — messages and topics get embedded per session for better relevance matching
- **Prospection slot** — session-based activation management for forward-looking context
- **Local task reminders** — tasks surface based on session context
- **FOK signal handling** — Feeling-of-Knowing signals are now session-aware
- **Diagnostic logging** — enhanced logging across user-prompt processing pipeline

## v0.1.0

- Initial release
- 92 neuroscience mechanisms across 18 subsystems
- Knowledge Graph engine (SQLite, 15 tables)
- Spreading Activation with multi-hop traversal
- Thalamus with 4 nuclei, burst/tonic modes, cross-inhibition
- 6 senses (code, tone, emotion, interoception, stability, context)
- Context Generator with 6 slots and 4 modes
- Background consolidation (NREM/REM sleep cycles)
- Knowledge hunger system (curiosity, dopamine reward)
- Metacognition (Feeling of Knowing, Judgment of Learning, Self-Model)
- Development phases and lifecycle management
- 3D Dashboard visualization
- MCP Server (7 tools, stdio JSON-RPC)
- CLI with 14 commands
- 9 provider integrations (Claude Code, Cursor, Windsurf, OpenClaw, Codex, Gemini, Aider, Continue, any MCP client)
- Watcher daemon (HTTP port 7899)
- Cloud LLM support (OpenAI, Anthropic, etc.)
- Hybrid search with embeddings
