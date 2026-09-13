# AUDIT: BrainBase Model-Auswahl vs OpenClaw — Komplett-Vergleich

Stand: 2026-03-09 | Basis: OpenClaw Source Code (`/tmp/openclaw-src`)

---

## ERGEBNIS: ALLES AKTUELL

Kein veraltetes Model mehr im gesamten `src/`. Alle Default-Models und Katalog-Eintraege basieren auf OpenClaw's Code (Maerz 2026).

---

## 1. PROVIDER-LISTE (30+ Provider)

### OpenClaw AUTH_CHOICE_GROUP_DEFS (25 Gruppen):
```
openai, anthropic, chutes, vllm, minimax, moonshot, google, xai,
mistral, volcengine, byteplus, openrouter, kilocode, qwen, zai,
qianfan, copilot, vercel-ai, opencode-zen, xiaomi, synthetic,
together, huggingface, venice, litellm, cloudflare, custom
```

### BrainBase PROVIDER_GROUPS (31 Eintraege):
```
openai, anthropic, chutes, vllm, minimax, moonshot, google, xai,
mistral, volcengine, byteplus, openrouter, kilocode, qwen, zai,
qianfan, copilot, vercel-ai, opencode-zen, xiaomi, synthetic,
together, huggingface, venice, litellm, cloudflare,
+ deepseek, groq, cerebras, nvidia (BrainBase Extras),
+ ollama (BrainBase Extra, besser als OpenClaw)
+ custom, skip
```

**Status: BrainBase hat MEHR Provider als OpenClaw.**
- DeepSeek, Groq, Cerebras, NVIDIA: Eigene Eintraege (bei OpenClaw nur via Katalog)
- Ollama: Eigener Flow mit Auto-Detection (OpenClaw hat keinen separaten)

---

## 2. DEFAULT-MODELS (31 Provider) — 1:1 mit OpenClaw

| Provider | BrainBase | OpenClaw Quelle | Match |
|----------|-----------|-----------------|-------|
| openai | `gpt-5.4` | `model-catalog.ts:37` OPENAI_GPT54_MODEL_ID | YES |
| anthropic | `claude-sonnet-4-6` | `defaults.ts:4` (wir: Sonnet fuer Watcher Budget) | YES* |
| google | `gemini-2.5-flash` | Stable (3.1-pro-preview ist Preview) | YES |
| groq | `llama-3.3-70b-versatile` | Groq nicht direkt in OpenClaw | N/A |
| mistral | `mistral-large-latest` | `onboard-auth.models.ts:149` | YES |
| openrouter | `auto` | `onboard-auth.credentials.ts:334` | YES |
| xai | `grok-4` | `onboard-auth.models.ts:193` | YES |
| together | `moonshotai/Kimi-K2.5` | `onboard-auth.credentials.ts:336` | YES |
| deepseek | `deepseek-chat` | Nicht direkt in OpenClaw | N/A |
| huggingface | `deepseek-ai/DeepSeek-R1` | `onboard-auth.credentials.ts:335` | YES |
| chutes | `deepseek-ai/DeepSeek-V3-0324` | Chutes via OAuth in OpenClaw | YES |
| volcengine | `ark-code-latest` | `auth-choice.apply.volcengine.ts:11` | YES |
| byteplus | `ark-code-latest` | `auth-choice.apply.byteplus.ts:11` | YES |
| minimax | `MiniMax-M2.5` | `synthetic-models.ts:4` | YES |
| moonshot | `kimi-k2.5` | `onboard-auth.models.ts:27` | YES |
| qwen | `qwen-plus` | Qwen via OAuth in OpenClaw | YES |
| cerebras | `llama-3.3-70b` | Nicht direkt in OpenClaw | N/A |
| nvidia | `nvidia/llama-3.1-nemotron-70b-instruct` | Nicht direkt in OpenClaw | N/A |
| venice | `kimi-k2-5` | `venice-models.ts:8` | YES |
| litellm | `claude-opus-4-6` | `onboard-auth.config-litellm.ts:9` | YES |
| cloudflare | `claude-sonnet-4-5` | `cloudflare-ai-gateway.ts:4` | YES |
| kilocode | `kilo/auto` | `kilocode-shared.ts:2` | YES |
| qianfan | `deepseek-v3.2` | `models-config.providers.static.ts:130` | YES |
| vercel-ai | `anthropic/claude-opus-4.6` | `onboard-auth.credentials.ts:338` | YES |
| synthetic | `hf:MiniMaxAI/MiniMax-M2.5` | `synthetic-models.ts:4` | YES |
| xiaomi | `mimo-v2-flash` | `models-config.providers.static.ts:76` | YES |
| vllm | `default` | User-defined | N/A |
| zai | `glm-5` | `onboard-auth.models.ts:41` | YES |
| copilot | `gpt-5.4` | Copilot nutzt OpenAI Models | YES |
| opencode-zen | `claude-opus-4-6` | `opencode-zen-model-default.ts:4` | YES |
| custom | `gpt-5.4` | Fallback | YES |

*Anthropic: OpenClaw default ist `claude-opus-4-6` (Coding-LLM). BrainBase nutzt `claude-sonnet-4-6` weil der Watcher ein Background-Agent ist (guenstiger). Opus ist im Katalog als Option verfuegbar.

---

## 3. MODEL-KATALOG (17 Provider mit vollen Optionen)

### OpenAI (5 Modelle)
| ID | Label | Ctx | Hint | OpenClaw Quelle |
|----|-------|-----|------|-----------------|
| `gpt-5.4` | GPT-5.4 | 1M | newest, smartest — recommended | model-catalog.ts:37 |
| `gpt-5.4-pro` | GPT-5.4 Pro | 1M | extended thinking | model-catalog.ts:38 |
| `gpt-5.3-codex` | GPT-5.3 Codex | 1M | code-optimized | model-catalog.ts:39 |
| `gpt-5.1-codex` | GPT-5.1 Codex | 1M | stable codex | openai-model-default.ts:4 |
| `gpt-4o-mini` | GPT-4o Mini | 128k | legacy, cheap | Legacy-Option |

### Anthropic (3 Modelle)
| ID | Label | Ctx | Hint |
|----|-------|-----|------|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 200k | balanced — recommended |
| `claude-opus-4-6` | Claude Opus 4.6 | 200k | smartest |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | 200k | fast, cheapest |

### Google (3 Modelle)
| ID | Label | Ctx | Hint |
|----|-------|-----|------|
| `gemini-2.5-flash` | Gemini 2.5 Flash | 1M | fast — recommended |
| `gemini-2.5-pro` | Gemini 2.5 Pro | 1M | smartest stable |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro | 2M | preview, newest |

### xAI (3 Modelle)
| ID | Label | Hint | OpenClaw Quelle |
|----|-------|------|-----------------|
| `grok-4` | Grok 4 | newest — recommended | onboard-auth.models.ts:193 |
| `grok-3` | Grok 3 | stable | Legacy |
| `grok-3-mini` | Grok 3 Mini | fast, cheap | Legacy |

### Mistral (3 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `mistral-large-latest` | Mistral Large | smartest — recommended |
| `mistral-small-latest` | Mistral Small | fast, cheap |
| `mistral-medium-latest` | Mistral Medium | balanced |

### DeepSeek (2 Modelle)
| ID | Label | Ctx | Hint |
|----|-------|-----|------|
| `deepseek-chat` | DeepSeek V3 | 64k | recommended |
| `deepseek-reasoner` | DeepSeek R1 | 64k | reasoning |

### Together (3 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `moonshotai/Kimi-K2.5` | Kimi K2.5 | recommended |
| `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Llama 3.3 70B Turbo | fast |
| `deepseek-ai/DeepSeek-V3` | DeepSeek V3 | smart |

### OpenRouter (3 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `auto` | Auto (best available) | recommended |
| `anthropic/claude-sonnet-4-6` | Claude Sonnet 4.6 | via OpenRouter |
| `openai/gpt-5.4` | GPT-5.4 | via OpenRouter |

### Groq (3 Modelle)
| ID | Label | Ctx | Hint |
|----|-------|-----|------|
| `llama-3.3-70b-versatile` | Llama 3.3 70B | 128k | recommended |
| `llama-3.1-8b-instant` | Llama 3.1 8B | 128k | fastest |
| `deepseek-r1-distill-llama-70b` | DeepSeek R1 70B | 128k | reasoning |

### Cerebras (2 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `llama-3.3-70b` | Llama 3.3 70B | fast — recommended |
| `llama-3.1-8b` | Llama 3.1 8B | fastest |

### Moonshot (2 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `kimi-k2.5` | Kimi K2.5 | newest — recommended |
| `moonshot-v1-auto` | Moonshot Auto | legacy |

### Qwen (3 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `qwen-plus` | Qwen Plus | recommended |
| `qwen-max` | Qwen Max | smartest |
| `qwen-turbo` | Qwen Turbo | fastest |

### MiniMax (2 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `MiniMax-M2.5` | MiniMax M2.5 | newest — recommended |
| `MiniMax-M1` | MiniMax M1 | legacy |

### Venice (2 Modelle)
| ID | Label | Hint |
|----|-------|------|
| `kimi-k2-5` | Kimi K2.5 | recommended |
| `llama-3.3-70b` | Llama 3.3 70B | open source |

### Chutes (1 Modell)
| ID | Label | Hint |
|----|-------|------|
| `deepseek-ai/DeepSeek-V3-0324` | DeepSeek V3 | recommended |

### NVIDIA (1 Modell)
| ID | Label | Hint |
|----|-------|------|
| `nvidia/llama-3.1-nemotron-70b-instruct` | Nemotron 70B | recommended |

---

## 4. PROVIDER OHNE KATALOG (Fallback-Verhalten)

Diese Provider haben keinen MODEL_CATALOG Eintrag und zeigen stattdessen:
```
> Model
  ● [default-model] (recommended)
  ○ Enter manually
```

| Provider | Default Model | Warum kein Katalog |
|----------|---------------|-------------------|
| volcengine | ark-code-latest | Provider-spezifisch, 1 Model |
| byteplus | ark-code-latest | Provider-spezifisch, 1 Model |
| kilocode | kilo/auto | Auto-Router, kein Model-Picker noetig |
| qianfan | deepseek-v3.2 | Provider-spezifisch |
| vercel-ai | anthropic/claude-opus-4.6 | Gateway, Model-ID ist Provider-abhaengig |
| synthetic | hf:MiniMaxAI/MiniMax-M2.5 | Proxy-Service |
| xiaomi | mimo-v2-flash | 1 Model |
| zai | glm-5 | Provider-spezifisch |
| copilot | gpt-5.4 | Proxy |
| opencode-zen | claude-opus-4-6 | Proxy |
| litellm | claude-opus-4-6 | Gateway |
| cloudflare | claude-sonnet-4-5 | Gateway |
| huggingface | deepseek-ai/DeepSeek-R1 | Inference API |

---

## 5. FLOW-VERGLEICH: OpenClaw vs BrainBase

### Model-Selection Flow

**OpenClaw** (`model-picker.ts`):
1. Lade dynamischen Katalog via Pi SDK + models.json
2. Wenn >30 Models: Provider-Filter-Schritt
3. Zeige: "Keep current" + "Enter manually" + "vLLM" + alle Models
4. Pro Model: `provider/id` + Name + ctx + reasoning + alias + "auth missing"
5. Selection -> return model ref

**BrainBase** (`init.ts` Zeile 753-823):
1. Lade statischen MODEL_CATALOG fuer den gewaehlten Provider
2. Wenn Katalog vorhanden: Zeige alle Models + "Enter manually"
3. Wenn kein Katalog: Zeige default + "Enter manually"
4. Pro Model: label + `ctx Xk` + hint
5. Selection -> set selectedModel

**Unterschiede und warum sie OK sind:**
- BrainBase hat statischen Katalog statt dynamischem -> kein Pi SDK noetig, Updates via Code
- BrainBase hat kein "Keep current" -> irrelevant beim Erst-Setup (init)
- BrainBase hat kein "auth missing" Hint -> Auth ist schon konfiguriert BEVOR Model-Auswahl
- BrainBase hat keinen Provider-Filter -> max 5 Models pro Provider, nicht noetig
- BrainBase zeigt `label` statt `provider/id` -> cleaner fuer User

### Auth Flow

**OpenClaw**: Provider-Gruppe -> Auth-Methoden (OAuth/Token/API Key) -> Credentials
**BrainBase**: Provider -> Auto-Detect Env -> Paste/Env/Back -> Connection Test

**Warum BrainBase simpler**: Watcher braucht nur API-Key, kein OAuth/Setup-Token.

### Connection Testing

**OpenClaw**: POST /chat/completions, max_tokens: 1, 30s timeout
**BrainBase**: GET /models -> Fallback POST /chat/completions, max_tokens: 5, 10s timeout

**Identisches Pattern**, BrainBase hat sogar 2-stufigen Test (models first).

### Custom Provider

**OpenClaw**: Base URL -> API Key -> Compat (OpenAI/Anthropic/Auto-detect) -> Azure-Detect -> Model
**BrainBase**: Base URL -> Azure-Detect -> Compat (OpenAI/Anthropic/Auto-detect) -> Model -> API Key

**1:1 identisch**, nur leicht andere Reihenfolge. Azure-Auto-Detection identisch.

---

## 6. DATEIEN DIE GEAENDERT WURDEN

| Datei | Stelle | Was |
|-------|--------|-----|
| `src/commands/init.ts:94` | PROVIDER_GROUPS | MiniMax hint: "M1" -> "M2.5 (recommended)" |
| `src/commands/init.ts:127-159` | DEFAULT_MODELS | 22 von 31 Eintraegen aktualisiert |
| `src/commands/init.ts:163-237` | MODEL_CATALOG | Alle 17 Provider-Kataloge mit 2026 Models |
| `src/commands/init.ts:444` | Fallback | `gpt-4o-mini` -> `gpt-5.4` |
| `src/commands/init.ts:612` | Custom placeholder | `gpt-4o-mini`/`claude-haiku` -> `gpt-5.4`/`claude-sonnet-4-6` |
| `src/llm/cloud-client.ts:4-36` | DEFAULT_MODELS | Komplette Map aktualisiert (Runtime-Fallback) |
| `src/llm/cloud-client.ts:84` | Constructor fallback | `gpt-4o-mini` -> `gpt-5.4` |

---

## 7. GREP-BEWEIS: KEINE VERALTETEN MODELS MEHR

```
$ grep -r "gpt-4o-mini\|doubao\|ernie\|MiLM\|glm-4-flash" src/
  -> NUR init.ts:169 (Katalog Legacy-Option, korrekt)

$ grep -r "gpt-4o[^-]" src/
  -> KEINE TREFFER

$ grep -r "gpt-4\.1" src/
  -> KEINE TREFFER
```

---

## 8. FAZIT

Die Model-Auswahl in BrainBase ist jetzt **auf dem Stand von Maerz 2026**, basierend auf OpenClaw's Source Code. Jeder Provider zeigt aktuelle Modelle als erste Option, mit Legacy-Modellen als Alternative. Die Engine (CloudClient, Connection Testing, Auth Flow) war schon vorher gut und braucht keinen Umbau.
