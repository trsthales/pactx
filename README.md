<p align="center">
  <img src="img/logo.png" alt="pactx banner" width="450">
</p>

# pactx 📦

> **Universal closed-loop context continuity & handoff engine for AI-assisted software development.**  
> Keep your AI aligned across chats, models, and sessions without context degradation or manual state maintenance.

🌐 **Language / Idioma:** [English](./README.md) | [Português (Brasil)](./README.pt-BR.md)

[![npm version](https://img.shields.io/npm/v/@trsthales/pactx.svg)](https://www.npmjs.com/package/@trsthales/pactx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem: The "AI Amnesia & Context Drift"

Long chat sessions suffer from context window degradation, hallucinations, and loss of constraints. When switching between chats or models (ChatGPT ⇄ Claude ⇄ Gemini ⇄ Cursor), asking an AI with context rot to *"summarize what we did"* results in missed decisions, repeated mistakes, and wasted tokens.

**LLMs are stateless compute engines. Your project is persistent state.**

---

## The Solution: `pactx` Closed-Loop Memory

`pactx` turns your repository into the **canonical source of truth** and creates a **bidirectional bridge** between your codebase and any AI model.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          YOUR REPOSITORY                               │
│      .ai-context/ (project, state, active ADRs, glossary)              │
│      + Git Runtime State (branch, recent commits, modified files)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx @trsthales/pactx │        3. npx @trsthales/pactx update
         (Egress)  │                        (Ingress) │ (Human-in-the-Loop)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  📋 Token-Optimized Context  │   │  📦 Structured pactx-update     │
    │     (Copied to Clipboard)    │   │     (ADRs, Facts, Hypotheses)   │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   ▼                                  │ 2. /handoff or extract
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │          ANY AI (ChatGPT / Claude / Gemini / Cursor / MCP)         │
    └────────────────────────────────────────────────────────────────────┘
```

1. **Egress (`pactx` / `pack`):** Inspects project specs, active ADRs, and Git delta to generate a clean, token-efficient Markdown context pack.
2. **In-Flight Anchors & Telemetry:** Passively captures micro-anchors (`<!-- pactx:v1 ... -->`) and developer directives (`/remember`) during the chat.
3. **Ingress (`pactx update` or `pactx extract`):** Ingests structured handoffs or extracts directly from chat transcripts, validating schema and Zero-Trust security rules with atomic WAL transactions.
4. **Realtime MCP Server (`pactx serve --mcp`):** Native Model Context Protocol server for IDE agents (Cursor, Claude Desktop, Windsurf).

---

## Quickstart

No global installation required:

### 1. Initialize `.ai-context/` in your repository
```bash
npx @trsthales/pactx init
```

This scaffolds the canonical directory structure:
```text
.ai-context/
├── project.md      # Static identity, stack, and non-negotiable rules
├── requirements.md # Canonical requirements & business rules (REQ-001)
├── state.md        # Active task, facts, blockers, rejected hypotheses
├── glossary.md     # Invariant contracts, table names, domain terms
└── decisions/      # Versioned micro-ADRs (DEC-001.md)
```

### 2. Pack Context & Start Session (1 Second)
```bash
npx @trsthales/pactx
```
Output:
```text
✔ Context packed successfully!
📋 Copied to clipboard!
Size: 1.45 KB | ~380 tokens

👉 Paste directly into ChatGPT, Claude, Gemini, or your coding agent!
```
Paste (`Ctrl+V`) into any AI chat. The AI will immediately understand the exact task, active architecture, invariant rules, and discarded hypotheses.

### 3. Close the Loop & Persist State
When finishing a task or before switching chats, ask the AI:
> `"/handoff"` *(or "Generate the pactx-update block")*

Copy the AI's response and run in your terminal:
```bash
npx @trsthales/pactx update
```

---

## 🤖 Model Context Protocol (MCP) Integration (v0.4.0)

`pactx` provides a native **MCP Server** over `stdio` for real-time agent memory in IDEs like **Cursor**, **Claude Desktop**, and **Windsurf**.

### Cursor Setup (`.cursor/mcp.json` or Global Cursor Settings)

Add to `.cursor/mcp.json` in your project root or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pactx": {
      "command": "npx",
      "args": ["-y", "@trsthales/pactx@latest", "serve", "--mcp"]
    }
  }
}
```

### Claude Desktop Setup (`claude_desktop_config.json`)

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pactx": {
      "command": "npx",
      "args": ["-y", "@trsthales/pactx@latest", "serve", "--mcp"]
    }
  }
}
```

### Available MCP Resources & Tools

| Type | Identifier | Description |
|---|---|---|
| **Resource** | `pactx://context` | Current canonical Context Pack in Markdown |
| **Resource** | `pactx://health` | Real-time context saturation & amnesia risk report in JSON |
| **Resource** | `pactx://status` | Full cognitive memory repository metrics in JSON |
| **Tool** | `pactx_record_anchor` | Records in-flight decision/fact/rejection anchors in real time |
| **Tool** | `pactx_get_context_health` | Returns context window health and handoff recommendations |
| **Tool** | `pactx_propose_mutation` | Proposes a mutation plan and returns a `proposalId` for human review |
| **Tool** | `pactx_apply_mutation` | Atomically commits an approved proposal to repository state |

---

## 🔍 Out-of-Band Transcript Extractor (`pactx extract`)

Late-session handoff summaries are vulnerable to model fatigue. `pactx extract` bypasses tired in-chat generation by extracting state directly from raw transcripts:

```bash
# Offline deterministic extraction (zero API key / zero token cost)
npx @trsthales/pactx extract chat_export.json -y

# Semantic extraction with Evidence Spans using Gemini, Claude, OpenAI, or local Ollama
npx @trsthales/pactx extract transcript.jsonl --model gemini-2.5-flash --api-key $GEMINI_API_KEY
npx @trsthales/pactx extract cursor_log.json --model claude-3-5-haiku
npx @trsthales/pactx extract session.txt --model qwen2.5-coder # Ollama local

# Inspect without modifying disk
npx @trsthales/pactx extract chat.json --dry-run
```

---

## 📊 Context Health & Telemetry (`pactx status --telemetry`)

Monitor context window consumption and operational risk zones before amnesia occurs:

```bash
npx @trsthales/pactx status --telemetry
```

```text
╔══════════════════════════════════════════════════════════════════════╗
║              pactx Context Health Dashboard v0.4.0                  ║
╠══════════════════════════════════════════════════════════════════════╣
║ Session: session_2026-08-27_a3f2d1   Model: claude-3-5-sonnet       ║
║ Turns: 24                            Anchors Logged: 5 captured      ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT CONSUMPTION                                                  ║
║   Total Estimated:        28,252 tokens   [ 14%]                    ║
║   Safe Zone (70%):       140,000 tokens                             ║
║                                                                     ║
║   [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 14%          ║
║    ← SAFE                    CAUTION  WARNING   CRIT →              ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT HEALTH: 86/100 🟢 SAFE                                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## CLI Reference

### Core Commands
| Command / Flag | Description |
|---|---|
| `pactx` / `pactx pack` | Reads repository state, copies context pack to clipboard, and initializes ephemeral session |
| `pactx init` | Scaffolds the `.ai-context/` directory with templates |
| `pactx status` | Displays visual executive cognitive memory dashboard and git runtime state |
| `pactx status --telemetry` | Displays context health, token saturation bar, and micro-anchors metrics |
| `pactx status --json` | Emits full structured status as machine-readable JSON |
| `pactx diff` | Inspects and displays color-coded mutation plan without writing to disk |
| `pactx rollback [hash]` | Graph-safe & WAL-protected rollback of latest transaction (LIFO) or specific hash |
| `pactx doctor` | Validates repository health against 8 integrity and consistency rules (`--fix` to auto-repair) |
| `pactx serve --mcp` | Starts native MCP server over stdio transport for Cursor and Claude Desktop |

### Ingestion & Extraction Commands
| Command / Flag | Description |
|---|---|
| `pactx update` | Reads clipboard, validates payload, displays full-text plan, and prompts for confirmation |
| `pactx update --proposal <id>` | Inspects and applies a decoupled proposal generated by the MCP server |
| `pactx update -y`, `--yes` | Applies changes without interactive confirmation (strictly keeps all safety validations) |
| `pactx update --dry-run` | Simulates and displays the full mutation plan without writing to disk |
| `pactx extract [file]` | Extracts decisions, facts, and rejected hypotheses from chat transcripts |
| `pactx extract --stdin` | Extracts from piped input (`cat chat.json \| pactx extract --stdin`) |
| `pactx extract --model <name>` | Semantic extraction with LLM (Gemini, Claude, OpenAI, Ollama) and Evidence Spans |

---

## Enterprise Safety & Zero-Trust Architecture

`pactx update` treats AI outputs as **untrusted candidate input**:

1. **Write-Ahead Logging (WAL):** Multi-file writes are orchestrated through atomic WAL manifests (`PREPARED` -> `APPLYING` -> `COMMITTED` / `ROLLED_BACK`). Crashes automatically trigger boot auto-recovery.
2. **Path Traversal Jail:** ADR and Requirement identifiers are strictly constrained to `/^(auto\|DEC-\d{3,4}\|REQ-\d{3,4})$/i`. File writes cannot escape `.ai-context/`.
3. **Safe AST Serialization:** Zero naive string template interpolation for YAML. All frontmatter is safely generated via formal YAML dumpers.
4. **Graph-Safe Dependency Rollbacks:** Rollbacks analyze downstream links (`satisfies`, `superseded_by`) and prevent inconsistent states.
5. **Canonical Idempotency:** Payloads are hashed with SHA-256 into `.ai-context/.pactx/ledger.json`. Re-running the same clipboard results in a safe No-Op.
6. **Anti-Poisoning Full-Text Review:** The terminal displays the full literal text of every incoming decision, requirement, fact, and hypothesis before prompting for human approval.

---

## Directory Specification (`.ai-context/`)

```text
.ai-context/
├── project.md            # Vision, technology stack, and invariant rules
├── requirements.md       # Canonical requirements & business rules (REQ-001)
├── state.md              # Active task, completed items, facts, and rejected hypotheses
├── glossary.md           # Domain terms, API contracts, and entity definitions
├── decisions/
│   ├── DEC-001.md        # Active or superseded ADRs with structural lineage & satisfies links
│   └── DEC-002.md
└── .pactx/
    ├── ledger.json       # Audit ledger tracking applied SHA-256 update hashes
    ├── .pactx.lock       # Atomic concurrency lockfile
    ├── transactions/     # Write-Ahead Log (WAL) manifests (TX-<hash>.json)
    └── sessions/         # Ephemeral telemetry, micro-anchors, and proposals (gitignored)
```

---

## Documentation

- ⚡ **[Complete Features Catalog](./docs/FEATURES.md)** — Exhaustive guide covering all CLI commands, WAL engine, and security models.
- 📖 **[Step-by-Step Tutorial](./docs/TUTORIAL.md)** — Practical guide on how to integrate and use `pactx` in your daily workflow.
- 🏛️ **[Technical & Architecture Spec](./docs/ARCHITECTURE.md)** — Deep dive into the closed-loop engine, security jail, and transactional guarantees.

---

## License

Distributed under the **MIT** License. See [`LICENSE`](./LICENSE) for more information.
