# RENAME GAMEPLAN: BrainBase → BrainBase

**Domain:** brainbase.dev
**Status:** NUR ANALYSE — NICHTS AENDERN bis explizit erlaubt
**Erstellt:** 2026-03-11
**Gesamtzahl:** ~840+ Stellen in ~84 Dateien + 3 GitHub Repos + Vercel + DNS + npm + LaunchAgent + Data-Dir

---

## NAMING MAP — Alle Varianten

| Alt | Neu | Wo |
|-----|-----|----|
| `BrainBase` | `BrainBase` | Produktname in UI, Texten, Docs |
| `brainbase` | `brainbase` | CLI-Command, Filenames, Keys, IDs |
| `BRAINBASE` | `BRAINBASE` | Env vars, HTML-Marker-Tags |
| `brainbase-cli` | `brainbase-cli` | npm package name |
| `Brainbase` | `BrainBase` | Satzanfang-Variante |
| `brain-base` | - | Existiert NICHT im Code (gecheckt) |
| `com.brainbase.watcher` | `com.brainbase.watcher` | macOS LaunchAgent Label |
| `.brainbase` | `.brainbase` | User-Daten-Verzeichnis (~/) |
| `brainbase.dev` | `brainbase.dev` | Website-Domain |
| `docs.brainbase.dev` | `docs.brainbase.dev` | Docs-Domain |
| `trust.brainbase.dev` | `trust.brainbase.dev` | Trust-Page Domain |
| `security@brainbase.dev` | `security@brainbase.dev` | Security-Email |
| `noahsioo/brainbase` | `noahsioo/brainbase` | GitHub Repo (Produkt) |
| `noahsioo/brainbase-site` | `noahsioo/brainbase-site` | GitHub Repo (Landing Page) |
| `noahsioo/brainbase-docs` | `noahsioo/brainbase-docs` | GitHub Repo (Docs) |
| `noahsioly/brainbase` | `noahsioly/brainbase` | Falsche URL in site.ts |
| `brainbase_website` | `brainbase_website` | Supabase-Quelle in subscribe.js |
| `BRAINBASE_DIAGNOSTIC` | `BRAINBASE_DIAGNOSTIC` | Environment Variable |
| `introducing-brainbase` | `introducing-brainbase` | Blog-Post Filename + URL |
| `brainbase.mdc` | `brainbase.mdc` | Cursor Rules Datei |
| `brainbase.md` | `brainbase.md` | Windsurf/Continue/Desktop/Aider Datei |

---

## TEIL 1: HAUPTREPO — Source Code

### Repo: `/Users/Lovis/Desktop/memory-unlimited/`
### Gesamt: 26 TypeScript-Dateien, 99 Stellen + 7 andere Dateien, ~74 Stellen

---

### 1.01 `package.json` (3 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 2 | `"name": "brainbase-cli"` | `"name": "brainbase-cli"` |
| 9 | `"brainbase": "dist/index.js"` | `"brainbase": "dist/index.js"` |
| — | (description bleibt gleich, kein brainbase drin) | — |

**ACHTUNG:** `bin`-Feld bestimmt den globalen CLI-Command-Namen. Nach Aenderung: `npm unlink && npm link` noetig.

### 1.02 `package-lock.json` (3 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 2 | `"name": "brainbase"` | `"name": "brainbase-cli"` |
| 8 | `"name": "brainbase"` | `"name": "brainbase-cli"` |
| 19 | `"brainbase": "dist/index.js"` | `"brainbase": "dist/index.js"` |

**ACHTUNG:** Am besten `rm package-lock.json && npm install` nach package.json Aenderung.

### 1.03 `src/index.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 26 | `.name('brainbase')` | `.name('brainbase')` |

Das ist der Commander.js Name — erscheint in `--help` Output.

### 1.04 `src/config.ts` (10 Stellen)

| Zeile | Exakter String | Neu | Impact |
|-------|----------------|-----|--------|
| 5 | `join(homedir(), '.brainbase')` | `join(homedir(), '.brainbase')` | MEMORY_DIR — ALLES haengt davon ab! DB_PATH, CONFIG_PATH, PID_PATH, etc. |
| 23 | `'skills', 'brainbase'` | `'skills', 'brainbase'` | Codex Skill-Verzeichnis |
| 24 | `'skills', 'brainbase', 'SKILL.md'` | `'skills', 'brainbase', 'SKILL.md'` | Codex Skill-Datei |
| 37 | `'rules', 'brainbase.mdc'` | `'rules', 'brainbase.mdc'` | Cursor Rules Datei |
| 42 | `'memories', 'brainbase.md'` | `'memories', 'brainbase.md'` | Windsurf Memory Datei |
| 47 | `'brainbase.md'` (continue-dev) | `'brainbase.md'` | Continue.dev Datei |
| 51 | `'brainbase.md'` (claude-desktop) | `'brainbase.md'` | Claude Desktop Datei |
| 56 | `'brainbase.md'` (aider) | `'brainbase.md'` | Aider Datei |
| 139 | `'<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->'` | `'<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->'` | MEMORY_BLOCK_START Konstante |
| 140 | `'<!-- BRAINBASE:END -->'` | `'<!-- BRAINBASE:END -->'` | MEMORY_BLOCK_END Konstante |

**VERBINDUNGEN:**
- Zeile 5 (MEMORY_DIR) wird importiert von: store.ts, daemon.ts, init.ts, session-end.ts, environment-sense.ts, diagnostic.ts, cold-start.ts, UND ALLEN Dateien die DATA_DIR/LOGS_DIR/etc. nutzen
- Zeilen 139-140 (MEMORY_BLOCK markers) werden importiert von: hot.ts, self-heal.ts, status.ts, init.ts
- Zeilen 23-56 (PROVIDER_PATHS) werden importiert von: init.ts, hot.ts, detect.ts, self-heal.ts, status.ts, verify.ts

**MIGRATION NOETIG:** Wenn MEMORY_DIR sich aendert, muss `~/.brainbase/` nach `~/.brainbase/` migriert werden! Sonst verliert der User sein Gehirn. Siehe Teil 7.

### 1.05 `src/commands/init.ts` (29 Stellen)

| Zeile | Exakter String | Neu | Typ |
|-------|----------------|-----|-----|
| 33-38 | ASCII Art Banner "BRAINBASE" | Neues ASCII Art "BRAINBASE" | ASCII Art |
| 67 | `# BrainBase — Persistent Brain Active` | `# BrainBase — Persistent Brain Active` | CLEAN_INSTRUCTION |
| 69 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` | CLEAN_INSTRUCTION |
| 78 | `<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->` | `<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->` | CLAUDE_MD_BLOCK |
| 79 | `## BrainBase — Persistent Brain Active` | `## BrainBase — Persistent Brain Active` | CLAUDE_MD_BLOCK |
| 81 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` | CLAUDE_MD_BLOCK |
| 89 | `Context from BrainBase overrides` | `Context from BrainBase overrides` | CLAUDE_MD_BLOCK |
| 90 | `<!-- BRAINBASE:END -->` | `<!-- BRAINBASE:END -->` | CLAUDE_MD_BLOCK |
| 93 | `description: BrainBase - persistent brain` | `description: BrainBase - persistent brain` | CLEAN_CURSOR_RULE |
| 100 | `name: brainbase` | `name: brainbase` | CLEAN_SKILL_CONTENT |
| 290 | `'com.brainbase.watcher'` | `'com.brainbase.watcher'` | LAUNCH_AGENT_LABEL |
| 294 | `'Set up BrainBase - your AI super-brain'` | `'Set up BrainBase - your AI super-brain'` | Command description |
| 297 | `p.intro(cb(' BrainBase '))` | `p.intro(cb(' BrainBase '))` | CLI UI |
| 975 | `'run: brainbase watcher start'` | `'run: brainbase watcher start'` | Error hint |
| 978 | `'run: brainbase watcher start'` | `'run: brainbase watcher start'` | Error hint |
| 1020 | `'  brainbase stats'` | `'  brainbase stats'` | Summary box |
| 1021 | `'  brainbase search'` | `'  brainbase search'` | Summary box |
| 1022 | `'  brainbase dashboard'` | `'  brainbase dashboard'` | Summary box |
| 1023 | `'  brainbase insights'` | `'  brainbase insights'` | Summary box |
| 1024 | `'  brainbase verify'` | `'  brainbase verify'` | Summary box |
| 1025 | `'  brainbase consolidate'` | `'  brainbase consolidate'` | Summary box |
| 1115 | `MEMORY-UNLIMITED\|BRAINBASE` in Regex | `MEMORY-UNLIMITED\|BRAINBASE\|BRAINBASE` | Backward-compat Regex |
| 1138 | `'brainbase hook user-prompt'` | `'brainbase hook user-prompt'` | Hook registration |
| 1146 | `'brainbase hook session-start'` | `'brainbase hook session-start'` | Hook registration |
| 1154 | `'brainbase hook session-end'` | `'brainbase hook session-end'` | Hook registration |
| 1162 | `'brainbase hook pre-compact'` | `'brainbase hook pre-compact'` | Hook registration |
| 1175 | `.startsWith('brainbase')` | `.startsWith('brainbase')` | Hook-Check |
| 1259 | `MEMORY-UNLIMITED\|BRAINBASE` in Regex | `MEMORY-UNLIMITED\|BRAINBASE\|BRAINBASE` | Backward-compat |
| 1275 | `MEMORY-UNLIMITED\|BRAINBASE` in Regex | `MEMORY-UNLIMITED\|BRAINBASE\|BRAINBASE` | Backward-compat |

**ASCII BANNER (Zeile 33-38):**
Aktuell steht "BRAINBASE" als Block-Buchstaben. Muss komplett neu generiert werden fuer "BRAINBASE". Viel kuerzer (5 Buchstaben statt 9), also wird der Banner schmaler.

**VERBINDUNGEN:**
- CLAUDE_MD_BLOCK (Zeile 78-90) wird in `injectClaudeMdBlock()` geschrieben → landet in `~/.claude/CLAUDE.md`
- CLEAN_INSTRUCTION (Zeile 67-76) wird in Gemini/OpenClaw/etc. Dateien geschrieben
- CLEAN_CURSOR_RULE (Zeile 92-97) wird in `~/.cursor/rules/brainbase.mdc` geschrieben → Filename aendert sich zu `brainbase.mdc`
- CLEAN_SKILL_CONTENT (Zeile 99-103) wird in `~/.codex/skills/brainbase/SKILL.md` geschrieben → Pfad aendert sich
- Hook-Registrierung (Zeile 1138-1165) schreibt in `~/.claude/settings.json`
- LAUNCH_AGENT_LABEL (Zeile 290) bestimmt Plist-Pfad: `~/Library/LaunchAgents/com.brainbase.watcher.plist`
- Backward-compat Regexe (1115, 1259, 1275) MUESSEN `BRAINBASE` beibehalten und `BRAINBASE` hinzufuegen — sonst werden alte User-Dateien nicht erkannt

### 1.06 `src/memory/hot.ts` (15 Stellen)

| Zeile | Exakter String | Neu | Typ |
|-------|----------------|-----|-----|
| 25 | `'## BrainBase — Persistent Brain Active'` | `'## BrainBase — Persistent Brain Active'` | buildMemoryBlock() |
| 27 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` | buildMemoryBlock() |
| 35 | `'Context from BrainBase overrides'` | `'Context from BrainBase overrides'` | buildMemoryBlock() |
| 64 | `## BrainBase — Persistent Brain Active` | `## BrainBase — Persistent Brain Active` | Fallback block |
| 64 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` | Fallback block (selbe Zeile) |
| 78 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` | buildProviderBlock() |
| 90 | `description: BrainBase - persistent brain` | `description: BrainBase - persistent brain` | Cursor block |
| 90 | `# BrainBase — Persistent Brain Active` | `# BrainBase — Persistent Brain Active` | Cursor block (selbe Zeile) |
| 93 | `name: brainbase` | `name: brainbase` | Codex block |
| 93 | `# BrainBase — Persistent Brain Active` | `# BrainBase — Persistent Brain Active` | Codex block (selbe Zeile) |
| 96 | `# BrainBase — Persistent Brain Active` | `# BrainBase — Persistent Brain Active` | Default block |
| 197 | `// Shared file: use BRAINBASE markers` | `// Shared file: use BRAINBASE markers` | Comment |
| 206 | `MEMORY-UNLIMITED\|BRAINBASE` in Regex | `MEMORY-UNLIMITED\|BRAINBASE\|BRAINBASE` | Backward-compat Regex |
| 210 | `# BrainBase\b` in Regex | `# (?:BrainBase\|BrainBase)\b` | Old block cleanup Regex |
| 214 | `# BrainBase — Persistent Brain Active` in Regex | `# (?:BrainBase\|BrainBase) — Persistent Brain Active` | Old block cleanup Regex |

**VERBINDUNGEN:**
- `buildMemoryBlock()` Output → wird in CLAUDE.md, GEMINI.md, AGENTS.md injiziert
- `buildProviderBlock()` Output → wird in brainbase.mdc, SKILL.md, windsurf brainbase.md geschrieben
- Regexe in `writeProviderBlock()` muessen alte Bloecke finden → backward-compat mit `BRAINBASE`

### 1.07 `src/mcp/server.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 8 | `const SERVER_NAME = 'brainbase'` | `const SERVER_NAME = 'brainbase'` |

**VERBINDUNG:** Dieser Name erscheint in MCP `initialize` Response → alle Provider sehen ihn als Server-Name.

### 1.08 `src/mcp/tools.ts` (0 Stellen)

Keine brainbase/BrainBase Referenzen. Tool-Namen sind `memory_search`, `memory_context`, etc. KEIN Rename noetig.

### 1.09 `src/commands/mcp.ts` (11 Stellen)

| Zeile | Exakter String | Neu | Kontext |
|-------|----------------|-----|---------|
| 49 | `'gemini mcp remove brainbase'` | `'gemini mcp remove brainbase'` | Gemini CLI MCP deinstall |
| 50 | `'gemini mcp add brainbase node ...'` | `'gemini mcp add brainbase node ...'` | Gemini CLI MCP install |
| 58 | `'codex mcp remove brainbase'` | `'codex mcp remove brainbase'` | Codex CLI MCP deinstall |
| 59 | `'codex mcp add brainbase -- node ...'` | `'codex mcp add brainbase -- node ...'` | Codex CLI MCP install |
| 67 | `contextServers['brainbase']` | `contextServers['brainbase']` | Zed Context Server key |
| 79 | `mcpServers['brainbase']` | `mcpServers['brainbase']` | Cline/Roo MCP key |
| 98 | `a.includes('brainbase')` | `a.includes('brainbase')` | Continue.dev check |
| 122 | `mcpServers['brainbase']` | `mcpServers['brainbase']` | Default MCP key |
| 153 | `a.includes('brainbase')` | `a.includes('brainbase')` | Uninstall filter |
| 164 | `mcpServers['brainbase']` | `mcpServers['brainbase']` | Uninstall check |
| 165 | `delete mcpServers['brainbase']` | `delete mcpServers['brainbase']` | Uninstall delete |

**VERBINDUNGEN:**
- Diese Funktionen schreiben MCP-Config in: `~/.claude/settings.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.continue/config.json`, etc.
- Der MCP-Key-Name (`'brainbase'` → `'brainbase'`) bestimmt wie der Server in den Tools heisst
- Bei Gemini/Codex: Shell-Commands die `gemini mcp add brainbase` ausfuehren — das registriert den Server unter dem Namen `brainbase` in deren Config

**MIGRATION:** Bestehende MCP-Eintraege unter dem alten Key `'brainbase'` bleiben in den Provider-Configs stehen → `brainbase init` muss die alten entfernen und neue registrieren.

### 1.10 `src/hooks/session-start.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 211 | `systemMessage: 'BrainBase active.'` | `systemMessage: 'BrainBase active.'` |

### 1.11 `src/hooks/session-end.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 51 | `join(homedir(), '.brainbase/logs')` | `join(homedir(), '.brainbase/logs')` |

**HINWEIS:** Hier wird NICHT die LOGS_DIR Konstante benutzt, sondern ein hardcoded Pfad. Sollte eigentlich LOGS_DIR benutzen. Aber fuer den Rename muss es trotzdem geaendert werden.

### 1.12 `src/hooks/user-prompt.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 1008 | `!l.includes('BrainBase')` | `!l.includes('BrainBase')` |

Das ist ein Filter in `isCleanUserFact()` — filtert Meta-Referenzen zum System selbst raus.

### 1.13 `src/hooks/pre-compact.ts` (2 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 37 | `BrainBase will restore context.` | `BrainBase will restore context.` |
| 41 | `BrainBase will restore context.` | `BrainBase will restore context.` |

### 1.14 `src/commands/consolidate.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 8 | `'BrainBase - Consolidation Pipeline'` | `'BrainBase - Consolidation Pipeline'` |

### 1.15 `src/commands/dashboard.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 170 | `` `BrainBase - Brain Dashboard` `` | `` `BrainBase - Brain Dashboard` `` |

### 1.16 `src/commands/detect.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 10 | `'BrainBase - Provider Detection'` | `'BrainBase - Provider Detection'` |

### 1.17 `src/commands/list.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 16 | `` `brainbase add` `` | `` `brainbase add` `` |

### 1.18 `src/commands/embed.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 18 | `'brainbase embed backfill'` | `'brainbase embed backfill'` |

### 1.19 `src/commands/site.ts` (2 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 5 | `'Open the BrainBase website'` | `'Open the BrainBase website'` |
| 7 | `'https://github.com/noahsioly/brainbase'` | `'https://brainbase.dev'` |

**HINWEIS:** Die URL ist sowieso falsch (`noahsioly` statt `noahsioo`). Am besten direkt zu `brainbase.dev` aendern.

### 1.20 `src/commands/status.ts` (3 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 9 | `'Show BrainBase system status'` | `'Show BrainBase system status'` |
| 11 | `'BrainBase - Status'` | `'BrainBase - Status'` |
| 14 | `'No - run \`brainbase init\`'` | `'No - run \`brainbase init\`'` |

### 1.21 `src/commands/stats.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 21 | `'BrainBase - Brain Statistics'` | `'BrainBase - Brain Statistics'` |

### 1.22 `src/commands/snapshot.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 26 | `'Run: brainbase consolidate'` | `'Run: brainbase consolidate'` |

### 1.23 `src/commands/verify.ts` (5 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 33 | `'BrainBase - System Verification'` | `'BrainBase - System Verification'` |
| 41 | `'run \`brainbase init\`'` | `'run \`brainbase init\`'` |
| 112 | `searchNodes('BrainBase ist ein', 1)` | `searchNodes('BrainBase is an', 1)` |
| 141 | `hh.command.startsWith('brainbase')` | `hh.command.startsWith('brainbase')` |
| 249 | `'Run \`brainbase init\` zuerst.'` | `'Run \`brainbase init\` zuerst.'` |

**VERBINDUNG:** Zeile 112 sucht nach einem System-Knowledge-Node der bei Cold Start erstellt wird → muss auch in cold-start.ts geaendert werden.

### 1.24 `src/commands/watcher.ts` (2 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 28 | `'Starting BrainBase Watcher...'` | `'Starting BrainBase Watcher...'` |
| 33 | `'Run: brainbase init'` | `'Run: brainbase init'` |

### 1.25 `src/memory/cold-start.ts` (1 Stelle, 2 Referenzen in einer Zeile)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 26 | `'BrainBase is an AI memory system...'` | `'BrainBase is an AI memory system...'` |
| 26 | `'Commands: brainbase dashboard, stats, search, insights.'` | `'Commands: brainbase dashboard, stats, search, insights.'` |

**VERBINDUNG:** Dieser String wird als Pre-Wired Node in die DB geschrieben. `verify.ts` Zeile 112 sucht danach mit `searchNodes('BrainBase ist ein', 1)`. Beide muessen konsistent sein!

**ACHTUNG:** Bestehende DBs haben den alten Node mit "BrainBase" drin. Der wird NICHT automatisch geaendert. Entweder Migration-Script oder "egal, wird mit der Zeit ueberschrieben".

### 1.26 `src/senses/environment-sense.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 28 | `` `${homedir()}/.brainbase/brain.db` `` | `` `${homedir()}/.brainbase/brain.db` `` |

**HINWEIS:** Hier wird ein hardcoded Pfad benutzt statt DB_PATH aus config.ts. Und der Dateiname `brain.db` existiert gar nicht — die echte DB heisst `memory.db` (in DATA_DIR). Das ist ein bestehender Bug, hat aber mit dem Rename nichts zu tun. Trotzdem aendern.

### 1.27 `src/utils/diagnostic.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 5 | `process.env.BRAINBASE_DIAGNOSTIC === '1'` | `process.env.BRAINBASE_DIAGNOSTIC === '1'` |

### 1.28 `src/watcher/extractor.ts` (6 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 126 | `"BrainBase"` (in GOOD entities example) | `"BrainBase"` |
| 138 | `"I use TypeScript for BrainBase"` | `"I use TypeScript for BrainBase"` |
| 139 | `BrainBase → uses → TypeScript` | `BrainBase → uses → TypeScript` |
| 140 | `"Lovis builds BrainBase with TypeScript"` | `"Lovis builds BrainBase with TypeScript"` |
| 141 | `Lovis → builds → BrainBase` | `Lovis → builds → BrainBase` |
| 142 | `BrainBase → uses → TypeScript` | `BrainBase → uses → TypeScript` |

Das sind LLM-Prompt-Beispiele fuer den Extraction-Prompt. Wenn das Projekt "BrainBase" in den Beispielen vorkommt, wird der LLM es als gueltige Entity lernen.

### 1.29 `src/watcher/self-heal.ts` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 51 | `hh.command.startsWith('brainbase')` | `hh.command.startsWith('brainbase')` |

**VERBINDUNG:** Self-Heal prueft ob Hooks in settings.json noch vorhanden sind. Sucht nach Commands die mit `brainbase` anfangen.

### 1.30 `src/dashboard/index.html` (2 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 6 | `<title>BrainBase - Dashboard</title>` | `<title>BrainBase - Dashboard</title>` |
| 1717 | `'Watcher offline. Run: brainbase watch'` | `'Watcher offline. Run: brainbase watch'` |

---

### 1.31 `README.md` (~50 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 2 | `alt="BrainBase"` | `alt="BrainBase"` |
| 5 | `<h1>BrainBase</h1>` | `<h1>BrainBase</h1>` |
| 12 | `npm/v/brainbase` | `npm/v/brainbase-cli` |
| 25 | `docs.brainbase.dev` | `docs.brainbase.dev` |
| 26 | `brainbase.dev` | `brainbase.dev` |
| 39 | `## What BrainBase is` | `## What BrainBase is` |
| 41 | `BrainBase is not a memory plugin` | `BrainBase is not a memory plugin` |
| 45 | `That's BrainBase` | `That's BrainBase` |
| 47 | `BrainBase doesn't care` | `BrainBase doesn't care` |
| 52 | `npm install -g brainbase` | `npm install -g brainbase-cli` |
| 57 | `BrainBase \|` | `BrainBase \|` |
| 106 | `docs.brainbase.dev/mechanisms/` | `docs.brainbase.dev/mechanisms/` |
| 125 | `docs.brainbase.dev/providers/` | `docs.brainbase.dev/providers/` |
| 130 | `npm install -g brainbase` | `npm install -g brainbase-cli` |
| 137 | `brainbase init` | `brainbase init` |
| 140 | `brainbase watcher start` | `brainbase watcher start` |
| 142 | `BrainBase runs silently` | `BrainBase runs silently` |
| 145 | `brainbase init` + `BrainBase works` | `brainbase init` + `BrainBase works` |
| 147 | `docs.brainbase.dev/getting-started/` | `docs.brainbase.dev/getting-started/` |
| 155 | `[ BrainBase ]` | `[ BrainBase ]` |
| 185 | `BrainBase Works` + URL | `BrainBase Works` + URL |
| 189 | `BrainBase runs continuously` | `BrainBase runs continuously` |
| 200-213 | 14x `brainbase <cmd>` | 14x `brainbase <cmd>` |
| 215 | `docs.brainbase.dev/cli/` | `docs.brainbase.dev/cli/` |
| 231 | `brainbase dashboard` | `brainbase dashboard` |
| 234 | `docs.brainbase.dev/dashboard/` | `docs.brainbase.dev/dashboard/` |
| 262 | `docs.brainbase.dev/architecture/` | `docs.brainbase.dev/architecture/` |
| 270 | `docs.brainbase.dev/privacy/` | `docs.brainbase.dev/privacy/` |

### 1.32 `CONTRIBUTING.md` (2 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 1 | `# Contributing to BrainBase` | `# Contributing to BrainBase` |
| 7 | `github.com/noahsioo/brainbase/issues` | `github.com/noahsioo/brainbase/issues` |

### 1.33 `SECURITY.md` (4 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 7 | `github.com/noahsioo/brainbase/security/advisories/new` | `github.com/noahsioo/brainbase/security/advisories/new` |
| 9 | `security@brainbase.dev` | `security@brainbase.dev` |
| 22 | `BrainBase runs 100% locally` | `BrainBase runs 100% locally` |

### 1.34 `AUDIT-MODEL-SELECTION.md` (~15 Stellen)

Interne Doku, niedrige Prio. Alle `BrainBase` → `BrainBase`.

### 1.35 `test-v8-e2e.ts` (8 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 189 | `'Baut: BrainBase'` | `'Baut: BrainBase'` |
| 190 | `'Lovis: BrainBase'` | `'Lovis: BrainBase'` |
| 194 | `'BrainBase** (project)'` | `'BrainBase** (project)'` |
| 195 | `'BrainBase (project)'` | `'BrainBase (project)'` |
| 199 | `'Zum Thema: brainbase'` + `'BrainBase'` x2 | `'Zum Thema: brainbase'` + `'BrainBase'` x2 |
| 200 | `'brainbase:'` + `'BrainBase'` x2 | `'brainbase:'` + `'BrainBase'` x2 |
| 209 | `'brainbase'` x2 | `'brainbase'` x2 |
| 210 | `'brainbase'` x2 | `'brainbase'` x2 |

### 1.36 `test-learn-use.cjs` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 3 | `homedir() + '/.brainbase/data/memory.db'` | `homedir() + '/.brainbase/data/memory.db'` |

### 1.37 `tmp-clean.cjs` (1 Stelle)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 1 | `homedir() + '/.brainbase/data/memory.db'` | `homedir() + '/.brainbase/data/memory.db'` |

### 1.38 `docs/logo.svg` (0 Stellen)

Kein Text "BrainBase" im SVG. Nur Geometrie. KEIN Rename noetig (es sei denn Logo-Design aendern gewuenscht).

---

## TEIL 2: USER CONFIG — Lokal installierte Dateien

### 2.01 `~/.claude/settings.json` (6 Stellen)

| Zeile | Exakter String | Neu |
|-------|----------------|-----|
| 84 | `"command": "brainbase hook user-prompt"` | `"command": "brainbase hook user-prompt"` |
| 96 | `"command": "brainbase hook session-start"` | `"command": "brainbase hook session-start"` |
| 108 | `"command": "brainbase hook session-end"` | `"command": "brainbase hook session-end"` |
| 120 | `"command": "brainbase hook pre-compact"` | `"command": "brainbase hook pre-compact"` |
| 182 | `"brainbase": {` (mcpServers key) | `"brainbase": {` |
| 184-186 | `args: ["...memory-unlimited/dist/mcp/server.js"]` | bleibt gleich (Pfad aendert sich nicht sofort) |

**WICHTIG:** Diese Datei wird AUTOMATISCH durch `brainbase init` neu geschrieben. Aber bis der User `brainbase init` ausfuehrt, muessen die alten `brainbase` Commands noch funktionieren. Daher: ERST Code-Changes + Build + Link, DANN `brainbase init` ausfuehren.

**REIHENFOLGE:**
1. Code aendern (package.json bin → `brainbase`)
2. `npm run build && npm link`
3. `brainbase init` → schreibt neue settings.json automatisch
4. Altes `brainbase` CLI existiert nicht mehr (npm unlink hat's entfernt)

### 2.02 `~/.claude/CLAUDE.md` (5 Stellen)

| Stelle | Exakter String | Neu |
|--------|----------------|-----|
| 1 | `<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->` | `<!-- BRAINBASE:START - DO NOT EDIT THIS BLOCK -->` |
| 2 | `## BrainBase — Persistent Brain Active` | `## BrainBase — Persistent Brain Active` |
| 3 | `persistent brain (BrainBase)` | `persistent brain (BrainBase)` |
| 4 | `Context from BrainBase overrides` | `Context from BrainBase overrides` |
| 5 | `<!-- BRAINBASE:END -->` | `<!-- BRAINBASE:END -->` |

**Wird automatisch durch** `brainbase init` oder `refreshClaudeMdContext()` beim naechsten Session-Start ueberschrieben.

### 2.03 `~/.cursor/rules/brainbase.mdc` (EXISTS, 6 Stellen)

| Aktion | Detail |
|--------|--------|
| RENAME Datei | `brainbase.mdc` → `brainbase.mdc` |
| Zeile 2 | `description: BrainBase` → `description: BrainBase` |
| Zeile 6 | `# BrainBase — Persistent Brain Active` → `# BrainBase — Persistent Brain Active` |
| Zeile 8 | `(BrainBase)` → `(BrainBase)` |

**Wird automatisch durch** `brainbase init` neu erstellt (unter neuem Pfad). Alte Datei `brainbase.mdc` manuell loeschen oder durch init-Migration entfernen.

### 2.04 `~/.codeium/windsurf/memories/brainbase.md` (EXISTS, 4 Stellen)

| Aktion | Detail |
|--------|--------|
| RENAME Datei | `brainbase.md` → `brainbase.md` |
| Zeile 1 | `# BrainBase — Persistent Brain Active` → `# BrainBase — Persistent Brain Active` |
| Zeile 3 | `(BrainBase)` → `(BrainBase)` |

**Wird automatisch durch** `brainbase init` neu erstellt.

### 2.05 User-Daten-Verzeichnis `~/.brainbase/`

| Inhalt | Pfad |
|--------|------|
| `config.json` | `~/.brainbase/config.json` → `~/.brainbase/config.json` |
| `data/memory.db` | `~/.brainbase/data/memory.db` → `~/.brainbase/data/memory.db` |
| `data/memory.db-wal` | `~/.brainbase/data/memory.db-wal` → `~/.brainbase/data/memory.db-wal` |
| `data/memory.db-shm` | `~/.brainbase/data/memory.db-shm` → `~/.brainbase/data/memory.db-shm` |
| `logs/watcher.log` | `~/.brainbase/logs/watcher.log` → `~/.brainbase/logs/watcher.log` |
| `logs/extraction-debug.log` | `~/.brainbase/logs/extraction-debug.log` → `~/.brainbase/logs/extraction-debug.log` |
| `logs/self-heal.log` | `~/.brainbase/logs/self-heal.log` → `~/.brainbase/logs/self-heal.log` |
| `watcher.pid` | `~/.brainbase/watcher.pid` → `~/.brainbase/watcher.pid` |

**MIGRATION KRITISCH:** Das gesamte Verzeichnis muss verschoben werden. `mv ~/.brainbase ~/.brainbase`. Die SQLite-DB (memory.db) enthaelt ALLE Erinnerungen — wenn die verloren geht, ist das Gehirn weg.

**MIGRATION-CODE in config.ts einfuegen:**
```typescript
// Am Anfang von config.ts, nach den Imports:
const OLD_MEMORY_DIR = join(homedir(), '.brainbase');
if (existsSync(OLD_MEMORY_DIR) && !existsSync(MEMORY_DIR)) {
  renameSync(OLD_MEMORY_DIR, MEMORY_DIR);
}
```

### 2.06 macOS LaunchAgent

| Alt | Neu |
|-----|-----|
| `~/Library/LaunchAgents/com.brainbase.watcher.plist` | `~/Library/LaunchAgents/com.brainbase.watcher.plist` |

**Ablauf:**
1. Alten LaunchAgent unloaden: `launchctl unload ~/Library/LaunchAgents/com.brainbase.watcher.plist`
2. Alte Plist loeschen
3. Neuer wird durch `brainbase init` erstellt (registerLaunchAgent)

### 2.07 `~/.brainbase/config.json` (Inhalt)

```json
{
  "version": "0.1.0",
  "providers": ["claude-code", "codex", ...],
  "watcher_engine": "cloud",
  "cloud_provider": { ... }
}
```

Kein "brainbase" String im Inhalt. Nur der Pfad aendert sich (→ `~/.brainbase/config.json`).

---

## TEIL 3: LANDING PAGE

### Repo: `/tmp/brainbase-site/` → wird zu `/tmp/brainbase-site/`
### GitHub: `noahsioo/brainbase-site` → `noahsioo/brainbase-site`
### 14 Dateien, 121 Stellen

### 3.01 `index.html` (21 Stellen)

| Zeile | Was | Aenderung |
|-------|-----|-----------|
| 11 | canonical URL | `brainbase.dev` → `brainbase.dev` |
| 12 | `<title>` | `BrainBase` → `BrainBase` |
| 14 | og:title | `BrainBase` → `BrainBase` |
| 17 | og:url | `brainbase.dev` → `brainbase.dev` |
| 18 | og:image URL | `brainbase.dev/og.png` → `brainbase.dev/og.png` |
| 22 | twitter:title | `BrainBase` → `BrainBase` |
| 24 | twitter:image | `brainbase.dev/og.png` → `brainbase.dev/og.png` |
| 26 | JSON-LD Schema | `"name":"BrainBase"`, URL → BrainBase |
| 829 | Install command | `npm install -g brainbase` → `npm install -g brainbase-cli` |
| 830 | Copy button data-cmd | `npm install -g brainbase` → `npm install -g brainbase-cli` |
| 864 | Section title | `With BrainBase` → `With BrainBase` |
| 888 | Inline code | `npm i -g brainbase` → `npm i -g brainbase-cli` |
| 970 | Preview label | `brainbase dashboard` → `brainbase dashboard` |
| 1029 | GitHub link | `noahsioo/brainbase` → `noahsioo/brainbase` |
| 1045 | Install + init command | `brainbase` → `brainbase-cli` / `brainbase` |
| 1046 | Copy button data-cmd | `brainbase` → `brainbase-cli` / `brainbase` |
| 1067 | Footer brand | `BrainBase` → `BrainBase` |
| 1070 | Docs link | `docs.brainbase.dev` → `docs.brainbase.dev` |
| 1071 | GitHub link | `noahsioo/brainbase` → `noahsioo/brainbase` |
| 1072 | Trust link | `trust.brainbase.dev` → `trust.brainbase.dev` |

### 3.02 `noah.html` (15 Stellen)

| Zeile | Aenderung |
|-------|-----------|
| 11 | canonical: `brainbase.dev/noah.html` → `brainbase.dev/noah.html` |
| 12 | title: `BrainBase` → `BrainBase` |
| 13 | meta description: `Building BrainBase` → `Building BrainBase` |
| 15 | og:description: `Building BrainBase` → `Building BrainBase` |
| 17 | og:image: `brainbase.dev/og.png` → `brainbase.dev/og.png` |
| 20 | twitter:description: `Building BrainBase` → `Building BrainBase` |
| 21 | twitter:image: `brainbase.dev/og.png` → `brainbase.dev/og.png` |
| 284 | Logo link: `brainbase.dev` → `brainbase.dev` |
| 296 | Logo text: `BrainBase` → `BrainBase` |
| 298 | Back link text: `brainbase.dev` → `brainbase.dev` |
| 308 | Profile meta: `Building BrainBase` → `Building BrainBase` |
| 349 | Story text: `BrainBase` → `BrainBase` |
| 381 | Footer: `BrainBase` → `BrainBase` |
| 384 | Docs URL: `docs.brainbase.dev` → `docs.brainbase.dev` |
| 385 | GitHub: `noahsioo/brainbase` → `noahsioo/brainbase` |

### 3.03 `blog/introducing-brainbase.html` → RENAME zu `introducing-brainbase.html` (24 Stellen)

**DATEINAME AENDERN:** `introducing-brainbase.html` → `introducing-brainbase.html`

Alle internen Links, canonical URLs, og:urls, sitemap, feed.xml, blog/index.html muessen den neuen Dateinamen referenzieren.

Inhalt: Jede Stelle `BrainBase` → `BrainBase`, jede URL `brainbase.dev` → `brainbase.dev`, jeder CLI-Befehl `brainbase` → `brainbase`/`brainbase-cli`.

### 3.04 `blog/index.html` (19 Stellen)

canonical, title, meta, og, twitter, RSS link, Logo, Logo-text, back-link, subtitle, post-card href (→ `introducing-brainbase.html`), post-card title, footer brand, docs URL, GitHub URL.

### 3.05 `blog/feed.xml` (7 Stellen)

Title, link, description, atom:link, item title, item link, item guid — alle `brainbase` → `brainbase`.

### 3.06 `404.html` (8 Stellen)

Title, logo text, back link, docs link, terminal example, footer brand, docs URL, GitHub URL.

### 3.07 `manifest.json` (2 Stellen)

```json
"name": "BrainBase" → "BrainBase"
"short_name": "BrainBase" → "BrainBase"
```

### 3.08 `sitemap.xml` (4 URLs)

Alle `brainbase.dev/` → `brainbase.dev/`. Plus `introducing-brainbase.html` → `introducing-brainbase.html`.

### 3.09 `robots.txt` (1 Stelle)

`Sitemap: https://brainbase.dev/sitemap.xml` → `Sitemap: https://brainbase.dev/sitemap.xml`

### 3.10 `datenschutz.html` (4 Stellen)

Title, back-link, body text, footer.

### 3.11 `impressum.html` (3 Stellen)

Title, back-link, footer.

### 3.12 `confirmed.html` (4 Stellen)

Title, back-link, try-again link, footer.

### 3.13 `og-image.html` (2 Stellen)

Title text `BrainBase`, domain `brainbase.dev`.

**ACHTUNG:** Das generierte `og.png` Bild muss AUCH neu generiert werden! Es enthaelt "BrainBase" als gerenderten Text.

### 3.14 `api/subscribe.js` (7 Stellen)

| Zeile | Aenderung |
|-------|-----------|
| 6 | CORS origin: `brainbase.dev` → `brainbase.dev` |
| 48 | QUELLE: `'brainbase_website'` → `'brainbase_website'` |
| 50 | PROJECT: `'brainbase'` → `'brainbase'` |
| 57 | confirmUrl: `brainbase.dev/api/confirm` → `brainbase.dev/api/confirm` |
| 94 | Image src: `brainbase.dev/noah.webp` → `brainbase.dev/noah.webp` |
| 128 | Impressum link: `brainbase.dev/impressum.html` → `brainbase.dev/impressum.html` |
| 129 | Datenschutz link: `brainbase.dev/datenschutz.html` → `brainbase.dev/datenschutz.html` |

---

## TEIL 4: DOCS

### Repo: `/tmp/brainbase-docs/` → wird zu `/tmp/brainbase-docs/`
### GitHub: `noahsioo/brainbase-docs` → `noahsioo/brainbase-docs`
### 31 Dateien, 409 Stellen

**PATTERN:** Jede Docs-Seite hat identische Elemente die geaendert werden muessen:

**Pro Seite (wiederholt sich in JEDER der 31 Dateien):**
1. `<link rel="canonical" href="https://docs.brainbase.dev/...">` → `docs.brainbase.dev`
2. `<title>... — BrainBase Docs</title>` → `BrainBase Docs`
3. `<meta property="og:title" content="... — BrainBase Docs">` → `BrainBase Docs`
4. `<meta property="og:description" content="...BrainBase...">` → `BrainBase` (wo relevant)
5. `<meta property="og:url" content="https://docs.brainbase.dev/...">` → `docs.brainbase.dev`
6. `<meta property="og:image" content="https://brainbase.dev/og.png">` → `brainbase.dev/og.png`
7. `<meta name="twitter:image" content="https://brainbase.dev/og.png">` → `brainbase.dev/og.png`
8. Nav Logo: `BrainBase <span>Docs</span>` → `BrainBase <span>Docs</span>`
9. GitHub Nav Link: `noahsioo/brainbase` → `noahsioo/brainbase`
10. Footer: `BrainBase — Built by Noah Sioly` → `BrainBase — Built by Noah Sioly`
11. Footer links: `brainbase.dev/blog/`, `brainbase.dev`, `brainbase.dev/impressum.html`, `brainbase.dev/datenschutz.html` → alle `brainbase.dev`
12. Footer GitHub: `noahsioo/brainbase` → `noahsioo/brainbase`

**Plus seitenspezifischer Content** (CLI-Befehle, Install-Commands, Text):

### 4.01 Dateien mit extra Content (nicht nur Template):

| Datei | Extra Stellen | Details |
|-------|---------------|---------|
| `index.html` | ~10 | Install code (`npm install -g brainbase`), "What is BrainBase?", Quick Start, stats |
| `getting-started/installation.html` | ~8 | `npm install -g brainbase`, `brainbase init`, System requirements |
| `getting-started/quick-start.html` | ~7 | `brainbase init`, `brainbase watcher start`, `brainbase verify` |
| `getting-started/first-session.html` | ~5 | Usage examples |
| `cli/index.html` | ~35 | JEDER CLI-Befehl: `brainbase init`, `brainbase status`, etc. |
| `providers/claude-code.html` | ~8 | Hook commands, settings.json example |
| `providers/cursor.html` | ~5 | MCP config, brainbase.mdc Pfad |
| `providers/windsurf.html` | ~5 | MCP config |
| `providers/openclaw.html` | ~5 | AGENTS.md content |
| `providers/codex.html` | ~3 | Skill path |
| `providers/gemini.html` | ~3 | GEMINI.md |
| `providers/aider.html` | ~3 | Config |
| `providers/mcp.html` | ~8 | MCP server name, CLI, config examples |
| `providers/index.html` | ~5 | Overview |
| `concepts/overview.html` | ~5 | "BrainBase vs RAG" Vergleich |
| `concepts/knowledge-graph.html` | ~3 | |
| `concepts/spreading-activation.html` | ~3 | |
| `concepts/thalamus.html` | ~2 | |
| `concepts/consolidation.html` | ~3 | |
| `concepts/hunger.html` | ~2 | |
| `concepts/development.html` | ~2 | |
| `dashboard/index.html` | ~3 | `brainbase dashboard` command |
| `architecture/index.html` | ~3 | |
| `mechanisms/index.html` | ~3 | |
| `privacy/index.html` | ~5 | License link, privacy text |

### 4.02 Nicht-HTML Dateien:

| Datei | Stellen | Aenderung |
|-------|---------|-----------|
| `manifest.json` | 2 | name, description |
| `robots.txt` | 1 | Sitemap URL |
| `sitemap.xml` | 25 | ALLE 25 URLs: `docs.brainbase.dev` → `docs.brainbase.dev` |
| `search-index.json` | 2 | Referenzen zu BrainBase |
| `docs.js` | 1 | Config/search |
| `404.html` | 7 | Template + Links |

---

## TEIL 5: AUTO-MEMORY + CLAUDE PLANS

### 5.01 `~/.claude/projects/-Users-Lovis/memory/MEMORY.md` (12 Stellen)

| Zeile | Aenderung |
|-------|-----------|
| 1 | `# BrainBase — Gehirn-Projekt` → `# BrainBase — Gehirn-Projekt` |
| 47 | `(wird zu brainbase/ umbenannt)` → `(wird zu brainbase/ umbenannt)` |
| 55 | `REBRANDING: Memory Unlimited → BrainBase (BB)` → `Memory Unlimited → BrainBase → BrainBase` |
| 56 | `Neuer Name: BrainBase` → `Neuer Name: BrainBase` |
| 57 | `Firma + Produkt = BrainBase` → `Firma + Produkt = BrainBase` |
| 96 | `noahsioo/brainbase` → `noahsioo/brainbase` |
| 97 | `noahsioo/brainbase-site` + `brainbase.dev` → `noahsioo/brainbase-site` + `brainbase.dev` |
| 98 | `noahsioo/brainbase-docs` + `docs.brainbase.dev` → `noahsioo/brainbase-docs` + `docs.brainbase.dev` |
| 99 | `brainbase-site` → `brainbase-site` |
| 100 | `brainbase-docs` → `brainbase-docs` |
| 107 | `brainbase` global → `brainbase` global |
| 122 | `BrainBase-Idee` → `BrainBase-Idee` |

### 5.02 `~/.claude/projects/-Users-Lovis/memory/docs/docs-inventory.md` (10 Stellen)

| Zeile | Aenderung |
|-------|-----------|
| 1 | `# BrainBase Docs` → `# BrainBase Docs` |
| 7 | `/tmp/brainbase-docs/` → `/tmp/brainbase-docs/` |
| 8 | `noahsioo/brainbase-docs` → `noahsioo/brainbase-docs` |
| 9 | `docs.brainbase.dev` → `docs.brainbase.dev` |
| 23 | `brainbase-site` → `brainbase-site` |
| 38 | `BrainBase Docs` + `BrainBase?` → `BrainBase Docs` + `BrainBase?` |
| 45 | `brainbase init` → `brainbase init` |
| 91 | `BrainBase` → `BrainBase` |
| 177 | npm name Blocker (irrelevant nach Rename) |
| 179 | `docs.brainbase.dev` → `docs.brainbase.dev` |

### 5.03 Claude Plans (niedrige Prio)

Alte Plans in `~/.claude/plans/` referenzieren "brainbase". Diese werden irgendwann irrelevant und koennen ignoriert werden.

---

## TEIL 6: GITHUB + INFRASTRUKTUR

### 6.01 GitHub Repo Renames (3 Repos, manuell durch Lovis)

| Alt | Neu | Wo |
|-----|-----|-----|
| `noahsioo/brainbase` | `noahsioo/brainbase` | GitHub → Settings → Repository name |
| `noahsioo/brainbase-site` | `noahsioo/brainbase-site` | GitHub → Settings → Repository name |
| `noahsioo/brainbase-docs` | `noahsioo/brainbase-docs` | GitHub → Settings → Repository name |

**GitHub erstellt automatisch Redirects** von den alten Repo-URLs. Git Remotes muessen lokal geaendert werden:
```bash
git remote set-url origin https://github.com/noahsioo/brainbase.git
```

### 6.02 Vercel (manuell durch Lovis)

| Projekt | Aenderung |
|---------|-----------|
| Landing Page | Domain von `brainbase.dev` zu `brainbase.dev` + GitHub Repo Verbindung update |
| Docs | Domain von `docs.brainbase.dev` zu `docs.brainbase.dev` |
| Trust | Domain von `trust.brainbase.dev` zu `trust.brainbase.dev` (falls deployed) |

### 6.03 DNS (manuell durch Lovis)

- `brainbase.dev` Nameserver auf Vercel zeigen lassen
- Alte `brainbase.dev` als Redirect behalten (301 → brainbase.dev)

### 6.04 npm Publish

```bash
npm publish  # als "brainbase-cli"
```

npm Package Name `brainbase` war sowieso vergeben (Gokhan Egri). `brainbase-cli` muss verfuegbar sein — pruefen!

### 6.05 E-Mail

`security@brainbase.dev` einrichten (Domain-Email).

### 6.06 OG Image

`og.png` in brainbase-site enthaelt "BrainBase" als gerenderten Text. Muss neu generiert werden aus `og-image.html` (nach Rename).

---

## TEIL 7: BACKWARD COMPATIBILITY + MIGRATION

### 7.01 Data Directory Migration

**In `src/config.ts`, direkt nach den Imports, VOR `MEMORY_DIR`:**
```typescript
import { renameSync } from 'fs';

const OLD_MEMORY_DIR = join(homedir(), '.brainbase');
const MEMORY_DIR_PATH = join(homedir(), '.brainbase');

// Migration: move old .brainbase to .brainbase
if (existsSync(OLD_MEMORY_DIR) && !existsSync(MEMORY_DIR_PATH)) {
  try {
    renameSync(OLD_MEMORY_DIR, MEMORY_DIR_PATH);
  } catch { /* cross-device, fallback to copy */ }
}

export const MEMORY_DIR = MEMORY_DIR_PATH;
```

### 7.02 Marker Regex Backward-Compat

In `init.ts` und `hot.ts`, alle Regexe die alte Marker suchen:
```regex
/<!-- (?:MEMORY-UNLIMITED|BRAINBASE):START/
```
Muessen erweitert werden zu:
```regex
/<!-- (?:MEMORY-UNLIMITED|BRAINBASE|BRAINBASE):START/
```

Das stellt sicher dass:
- User die von Memory-Unlimited kommen → alte Bloecke werden gefunden und ersetzt
- User die von BrainBase kommen → alte Bloecke werden gefunden und ersetzt
- Neue BRAINBASE Bloecke → werden auch gefunden (fuer Updates)

### 7.03 Hook Command Migration

`self-heal.ts` und `verify.ts` checken `.startsWith('brainbase')`. Nach Rename checken sie `.startsWith('brainbase')`. Aber bestehende settings.json hat noch `brainbase` Commands.

**Loesung:** `brainbase init` ueberschreibt die Hooks. Bis dahin funktioniert der alte `brainbase` Command nicht mehr (weil npm unlinked). Also muss `brainbase init` SOFORT nach dem Build laufen.

### 7.04 MCP Server Name Migration

Provider-Configs (cursor mcp.json, windsurf mcp_config.json, etc.) haben `"brainbase"` als Key. `brainbase init` erstellt einen neuen Key `"brainbase"`. Aber der alte `"brainbase"` Key bleibt stehen.

**Loesung:** In `installMcpServerForProvider()`, VOR dem neuen Eintrag: alten loeschen.
```typescript
// Remove old "brainbase" entry if present
if (mcpServers['brainbase']) {
  delete mcpServers['brainbase'];
}
mcpServers['brainbase'] = { ... };
```

### 7.05 Provider Instruction Files

Alte Dateien auf Disk:
- `~/.cursor/rules/brainbase.mdc` → bleibt liegen, neues `brainbase.mdc` wird erstellt
- `~/.codeium/windsurf/memories/brainbase.md` → bleibt liegen, neues `brainbase.md` wird erstellt
- `~/.codex/skills/brainbase/SKILL.md` → alter Ordner bleibt liegen

**Loesung:** In init.ts Provider-Setup, alte Dateien loeschen:
```typescript
// Cleanup old brainbase files
const oldPaths = [
  join(homedir(), '.cursor', 'rules', 'brainbase.mdc'),
  join(homedir(), '.codeium', 'windsurf', 'memories', 'brainbase.md'),
  join(homedir(), '.continue', 'brainbase.md'),
  // etc.
];
for (const old of oldPaths) {
  if (existsSync(old)) unlinkSync(old);
}
```

### 7.06 LaunchAgent Migration

In `registerLaunchAgent()` in init.ts:
```typescript
// Remove old LaunchAgent
const oldPlist = join(homedir(), 'Library', 'LaunchAgents', 'com.brainbase.watcher.plist');
if (existsSync(oldPlist)) {
  try {
    execSync(`launchctl unload "${oldPlist}" 2>/dev/null`, { stdio: 'ignore' });
    unlinkSync(oldPlist);
  } catch {}
}
```

### 7.07 Cold Start System Knowledge Node

Die DB hat einen Pre-Wired Node mit `content: 'BrainBase is an AI memory system...'`. Der bleibt in der DB stehen. `verify.ts` sucht nach dem neuen String.

**Loesung:** In der Migration, den alten Node updaten:
```typescript
db.prepare("UPDATE nodes SET content = REPLACE(content, 'BrainBase', 'BrainBase') WHERE content LIKE '%BrainBase%' AND type = 'system_knowledge'").run();
```

Oder: `verify.ts` sucht nach beiden Varianten.

---

## TEIL 8: AUSFUEHRUNGSREIHENFOLGE

```
PHASE 1: CODE (kann ich machen)
────────────────────────────────
1.  src/config.ts                 → Pfade + Marker Konstanten
2.  src/index.ts                  → CLI Name
3.  package.json                  → npm name + bin
4.  src/commands/init.ts          → Banner + Strings + Hooks + Regexe
5.  src/memory/hot.ts             → Memory Blocks + Regexe
6.  src/mcp/server.ts             → Server Name
7.  src/commands/mcp.ts           → MCP Keys
8.  src/hooks/*.ts                → 4 Hook-Dateien
9.  src/commands/*.ts             → 12 Command-Dateien
10. src/watcher/*.ts              → extractor + self-heal
11. src/senses/environment-sense.ts
12. src/utils/diagnostic.ts
13. src/memory/cold-start.ts
14. src/dashboard/index.html
15. README.md + CONTRIBUTING.md + SECURITY.md + AUDIT-MODEL-SELECTION.md
16. test-v8-e2e.ts + test-learn-use.cjs + tmp-clean.cjs

PHASE 2: BUILD + LINK
──────────────────────
17. rm package-lock.json
18. npm install
19. npx tsc --noEmit  (Type-Check)
20. npm run build
21. npm unlink (altes brainbase)
22. npm link (neues brainbase)
23. brainbase --version  (Smoke Test)

PHASE 3: MIGRATION
───────────────────
24. mv ~/.brainbase ~/.brainbase
25. Alte LaunchAgent unloaden + loeschen
26. brainbase init (erstellt neue Hooks, CLAUDE.md, Provider Files, MCP Configs, LaunchAgent)
27. Alte Provider-Dateien loeschen (brainbase.mdc, brainbase.md)

PHASE 4: VERIFIZIERUNG
───────────────────────
28. brainbase status
29. brainbase verify
30. Claude Code Session starten → Hook muss feuern
31. Check: ~/.claude/settings.json hat "brainbase" Commands
32. Check: ~/.claude/CLAUDE.md hat BRAINBASE:START Block

PHASE 5: LANDING PAGE (kann ich machen)
────────────────────────────────────────
33. Alle 14 Dateien in /tmp/brainbase-site/ aendern
34. og.png neu generieren
35. git commit + push

PHASE 6: DOCS (kann ich machen)
────────────────────────────────
36. Alle 31 Dateien in /tmp/brainbase-docs/ aendern
37. git commit + push

PHASE 7: AUTO-MEMORY
─────────────────────
38. MEMORY.md updaten
39. docs-inventory.md updaten

PHASE 8: GITHUB + INFRA (manuell, Lovis)
─────────────────────────────────────────
40. GitHub: 3 Repos umbenennen
41. Lokal: git remote set-url fuer alle 3 Repos
42. Vercel: Domains umstellen
43. DNS: brainbase.dev konfigurieren
44. npm: brainbase-cli publishen (npm publish)
45. Optional: brainbase.dev → 301 Redirect zu brainbase.dev
46. Optional: security@brainbase.dev E-Mail einrichten
```

---

## ZUSAMMENFASSUNG

| Bereich | Dateien | Stellen |
|---------|---------|---------|
| Hauptrepo TypeScript | 26 | 99 |
| Hauptrepo HTML/JSON/MD | 10 | ~74 |
| Landing Page | 14 | 121 |
| Docs | 31 | 409 |
| Claude Config | 3 | ~17 |
| Auto-Memory | 2 | ~22 |
| Provider Files auf Disk | 2 | ~10 |
| **CODE TOTAL** | **~88** | **~752** |
| | | |
| GitHub Repo Renames | 3 | manuell |
| Vercel Domains | 3 | manuell |
| DNS | 1 | manuell |
| npm Publish | 1 | manuell |
| LaunchAgent | 1 | automatisch via init |
| Data Directory | 1 | automatisch via Migration |
| OG Image | 1 | neu generieren |
| **INFRA TOTAL** | **11** | **manuell/auto** |

**GRAND TOTAL: ~88 Dateien, ~752 Code-Stellen + 11 Infra-Aktionen**
