# pactx 📦

> **Universal context continuity & handoff engine for AI-assisted software development.**  
> Keep your AI aligned across chats, models, and sessions without context degradation.

[![npm version](https://img.shields.io/npm/v/pactx.svg)](https://www.npmjs.com/package/pactx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem: The "AI Amnesia & Context Drift"

Long chat sessions suffer from context window degradation, hallucinations, and loss of constraints. When switching between chats or models (ChatGPT ⇄ Claude ⇄ Gemini ⇄ Cursor), asking an AI with context rot to *"summarize what we did"* results in missed decisions, repeated mistakes, and wasted tokens.

**LLMs are stateless compute engines. Your project is persistent state.**

---

## The Solution: `pactx`

`pactx` turns your repository into the **canonical source of truth**. Instead of asking the AI to remember, `pactx` inspects your project specifications, active decisions (ADRs), and Git runtime delta to compose an ultra-dense, token-optimized context pack.

```text
┌────────────────────────────────────────────────────────┐
│                   YOUR REPOSITORY                      │
│  .ai-context/ (project, state, active ADRs, glossary)  │
│  + Git Runtime State (branch, recent commits, diffs)   │
└───────────────────────────┬────────────────────────────┘
                            │
                      npx pactx
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
      📋 Copied to Clipboard    💻 Pure Markdown Pack
               │                         │
     ChatGPT / Claude Web         Cursor / CLI Agents
```

---

## Quickstart

No global installation required:

### 1. Initialize `.ai-context/` in your repository
```bash
npx pactx init
```

This generates the standard directory structure:
```text
.ai-context/
├── project.md      # Static identity, stack, and non-negotiable rules
├── state.md        # Active task, blockers, rejected hypotheses (DO NOT RETRY)
├── glossary.md     # Invariant contracts, table names, endpoints
└── decisions/      # Lightweight ADRs (DEC-001.md, DEC-002.md)
```

### 2. Pack and Copy Context in 1 Second
```bash
npx pactx
```

Output:
```text
✔ Context packed com sucesso!
📋 Copiado para a Área de Transferência!
Tamanho: 1.45 KB | ~380 tokens

👉 Cole diretamente no ChatGPT, Claude, Gemini ou no seu agente!
```

Just press `Ctrl+V` (or `Cmd+V`) in any AI chat.

---

## CLI Options

| Command / Flag | Description |
|---|---|
| `pactx` / `npx pactx pack` | Assembles context, copies to clipboard, and prints stats |
| `pactx init` | Scaffolds the `.ai-context/` specification files |
| `pactx --short` | Omits glossary and non-essential sections for tight token budgets |
| `pactx --stdout` | Dumps the markdown directly to terminal (ideal for pipes or CI) |

---

## Key Principles & Design

1. **Git-Native & Human-Readable:** Pure Markdown and YAML frontmatter committed to your Git history.
2. **Negative Knowledge Preservation:** Explicitly tracks rejected hypotheses and failed paths to prevent new AIs from repeating previous mistakes.
3. **ADR Lifecycle Filtering:** Automatically includes `status: active` decisions while summarizing `status: superseded` decisions so outdated architecture is never mistaken for current truth.
4. **Headless Resilient:** Automatic fallback to stdout when running in headless CI/Linux environments without GUI clipboards.

---

## Specification (`.ai-context/`)

### `project.md`
Stores static vision, technology stack, and invariant rules that the AI must never violate.

### `state.md`
The transient handoff file. Stores the active task, what was recently completed, discarded hypotheses, and the immediate next step.

### `decisions/*.md`
Micro-ADRs with frontmatter lifecycle tracking (`status: active | superseded | rejected`).

### `glossary.md`
Naming conventions, entities, and API contracts to avoid renaming drift across chats.