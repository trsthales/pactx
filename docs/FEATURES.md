# Complete Features & Architecture Catalog — PactX 📦

> **PactX (`@trsthales/pactx`)** is a universal, closed-loop context continuity and memory engine for AI-assisted software development. It transforms local repositories into deterministic, versioned cognitive state, preventing context degradation, amnesia, and architectural rot across AI sessions.

🌐 **Language / Idioma:** [English](./FEATURES.md) | [Português (Brasil)](./FEATURES.pt-BR.md)

---

## Table of Contents

1. [Overview & Design Philosophy](#1-overview--design-philosophy)
   - [Stateless Compute vs Persistent State](#stateless-compute-vs-persistent-state)
   - [The Closed-Loop Lifecycle](#the-closed-loop-lifecycle)
   - [Why Transparent Markdown vs Opaque Vector Databases](#why-transparent-markdown-vs-opaque-vector-databases)
2. [Complete CLI Command Catalog](#2-complete-cli-command-catalog)
   - [`pactx init`](#pactx-init)
   - [`pactx` / `pactx pack`](#pactx--pactx-pack)
   - [`pactx update`](#pactx-update)
   - [`pactx status`](#pactx-status)
   - [`pactx doctor`](#pactx-doctor)
   - [`pactx diff`](#pactx-diff)
   - [`pactx rollback`](#pactx-rollback)
3. [The 6 Cognitive Memory Entities](#3-the-6-cognitive-memory-entities)
   - [`project.md` (Identity & Invariants)](#1-projectmd-identity--invariants)
   - [`state.md` (Active Execution & Patch Semantics)](#2-statemd-active-execution--patch-semantics)
   - [`requirements.md` (Canonical Problem Space)](#3-requirementsmd-canonical-problem-space)
   - [`decisions/DEC-%03d.md` (Architectural Solution Space)](#4-decisionsdec-03dmd-architectural-solution-space)
   - [`glossary.md` (Invariant Domain Contracts)](#5-glossarymd-invariant-domain-contracts)
   - [`.pactx/` (Audit Ledger & Transaction Manifests)](#6-pactx-audit-ledger--transaction-manifests)
4. [The Transactional Engine (`TransactionEngine` WAL)](#4-the-transactional-engine-transactionengine-wal)
   - [State Machine (`PREPARED` $\to$ `COMMITTED`)](#state-machine)
   - [Write-to-Temp & Atomic Rename](#write-to-temp--atomic-rename)
   - [Transparent Boot Auto-Recovery & Anti-Loop Protection](#transparent-boot-auto-recovery--anti-loop-protection)
   - [Pruning & Retention Policy](#pruning--retention-policy)
5. [Zero-Trust Security Matrix & Defense-in-Depth](#5-zero-trust-security-matrix--defense-in-depth)
6. [Multi-AI Interoperability Guide](#6-multi-ai-interoperability-guide)
   - [Usage with ChatGPT, Claude, Gemini, Cursor & Claude Code](#usage-workflow)
   - [The `pactx-update` Specification (v1.0 & v1.1)](#pactx-update-specification)

---

## 1. Overview & Design Philosophy

### Stateless Compute vs Persistent State
Large Language Models (LLMs) are **stateless compute engines**. Every chat session starts fresh or accumulates noisy tokens that eventually trigger context rot, hallucinations, and forgotten constraints. In contrast, your software project is **persistent, deterministic state**.

PactX resolves this impedance mismatch by establishing the local Git repository as the **single source of truth** for project memory.

### The Closed-Loop Lifecycle

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          YOUR REPOSITORY                               │
│      .ai-context/ (project, state, requirements, ADRs, glossary)       │
│      + Git Runtime State (branch, recent commits, modified files)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. pactx pack│                                  │3. pactx update
         (Egress)  │                                  │   (Ingress)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  📋 Token-Optimized Context  │   │  📦 Structured pactx-update     │
    │     (Copied to Clipboard)    │   │     (ADRs, Facts, Requirements) │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │               ANY AI (ChatGPT / Claude / Gemini / Cursor)          │
    └────────────────────────────────────────────────────────────────────┘
```

1. **Egress (`pactx pack`):** Reads the canonical memory, filters active decisions, inspects live Git status, and compiles a token-optimized context pack directly into your clipboard.
2. **Reasoning (`AI Session`):** The AI operates with total architectural awareness, zero token waste, and explicit memory of rejected hypotheses.
3. **Ingress (`pactx update`):** The AI outputs a structured `pactx-update` block. PactX ingests, validates, previews, and atomically commits the state changes.

### Why Transparent Markdown vs Opaque Vector Databases

| Feature | Vector DBs / Embeddings | PactX Canonical Files (`.ai-context/`) |
|---|:---:|:---:|
| **Format** | Binary / Opaque database | Clean, human-readable Markdown & YAML |
| **Version Control** | Hard to diff/merge in Git | Native Git commits, PR reviews, branches |
| **Auditability** | Stochastic cosine similarity | 100% deterministic SHA-256 Ledger & WAL |
| **Portability** | Requires external servers / API keys | Zero dependencies, runs anywhere offline |
| **Human Editability** | Read-only embeddings | Directly editable in VS Code, Vim, or Cursor |

---

## 2. Complete CLI Command Catalog

### `pactx init`
Scaffolds the canonical `.ai-context/` directory in the current project root.

- **When to use:** Once per project when adopting PactX.
- **Behavior:** Creates `project.md`, `requirements.md`, `state.md`, `glossary.md`, and initial `decisions/DEC-001.md`. If files already exist, it safely preserves them without overwriting.

```bash
npx @trsthales/pactx init
```

*Output:*
```text
✔ .ai-context structure initialized successfully!
👉 Edit files in .ai-context/ and run 'npx @trsthales/pactx' to copy context.
```

---

### `pactx` / `pactx pack`
Compiles the active project memory into a structured Markdown payload and copies it to your clipboard.

- **When to use:** At the start of a coding session or when switching AI chats.
- **Flags:**
  - `-s, --short`: Compacts the prompt to essential guidelines and active tasks, saving ~40% tokens.
  - `--stdout`: Emits the context pack directly to the terminal stdout without touching the OS clipboard.

```bash
npx @trsthales/pactx
```

*Output:*
```text
✔ Context packed successfully!
📋 Copied to clipboard!
Size: 1.48 KB | ~390 tokens

👉 Paste directly into ChatGPT, Claude, Gemini, or your coding agent!
```

---

### `pactx update`
Ingests a structured `pactx-update` response from the AI, runs validation, displays an interactive full-text preview, and executes an atomic transaction.

- **When to use:** When receiving a `/handoff` block from an AI session.
- **Flags:**
  - `-y, --yes`: Applies mutations non-interactively (retaining all safety validations).
  - `--force`: Forces application even with warnings (e.g., overriding Optimistic Concurrency Control checks).
  - `--dry-run`: Simulates the complete mutation without writing any bytes to disk.
  - `--file <path>`: Ingests the update payload from a local file instead of the clipboard.
  - `--stdin`: Ingests the update payload from standard input / UNIX pipe.

```bash
npx @trsthales/pactx update
```

*Terminal Preview:*
```text
📦 pactx-update block detected!

================================================================================
📝 STATE UPDATE (.ai-context/state.md)
   • Active Task: "Implement Distributed Lock" [IN_PROGRESS]
   • Recommended Model: High
   • Completed Items:
     + [x] Implemented atomic wx file creation
   • Facts & Discoveries:
     + POSIX O_EXCL provides atomic exclusivity
   • Discarded Hypotheses:
     + In-memory locks do not survive across CLI invocations
   • Immediate Next Action: "Add PID liveness check"

🏛️ NEW ARCHITECTURAL DECISIONS
   [DEC-002] "Process-Aware Lockfile"
   • Satisfies: REQ-001
   • Reason: Eliminate stale locks after SIGKILL
   • Decision: Persist PID and token in .pactx.lock and test with process.kill(pid, 0)
================================================================================

? Apply this mutation plan to .ai-context/? (Y/n)
```

---

### `pactx status`
Displays a comprehensive health and metrics dashboard of the project's cognitive memory.

- **When to use:** To inspect the active sprint, requirements progress, ADR count, and lock status.
- **Flags:**
  - `-j, --json`: Outputs the complete metrics object as structured JSON for CI/CD and automation.

```bash
npx @trsthales/pactx status
```

*Dashboard Display:*
```text
┌────────────────────────────────────────────────────────────────────────┐
│ 📦 PACTX PROJECT STATUS: ctxpack (v0.3.0)                             │
├────────────────────────────────────────────────────────────────────────┤
│ 🎯 Active Task: "Implement Distributed Lock" [IN_PROGRESS]             │
│ 🤖 Model: High | Revision: 9c08a9f3eb2f1c84                           │
│ 📋 Requirements: 3 total (2 active, 1 draft) | 66.7% satisfied        │
│ 🏛️ Decisions: 2 total (2 active, 0 superseded)                         │
│ 📖 Glossary: 4 terms defined                                          │
│ 🌿 Git: [feat/v0.3-foundation] • 0 uncommitted changes                 │
│ 🔒 Lock: Clean (Unlocked)                                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

### `pactx doctor`
Runs automated diagnostics against the 8 integrity and consistency rules of PactX.

- **When to use:** In CI/CD pipelines, pre-commit hooks, or after manual edits to `.ai-context/`.
- **Flags:**
  - `--fix`: Automatically repairs fixable discrepancies, prunes old transaction logs, and clears abandoned locks.

```bash
npx @trsthales/pactx doctor --fix
```

*Diagnostic Table:*
```text
┌───┬────────────────────────────┬────────┬───────────────────────────────────────────┐
│ # │ Diagnostic Rule            │ Status │ Message                                   │
├───┼────────────────────────────┼────────┼───────────────────────────────────────────┤
│ 1 │ Frontmatter Schema         │  PASS  │ All YAML frontmatters are valid           │
│ 2 │ Security Jail              │  PASS  │ No path traversal or symlinks detected    │
│ 3 │ ADR Lineage Integrity     │  PASS  │ Decision succession graph is acyclic      │
│ 4 │ Requirement Mapping        │  PASS  │ All ADR satisfies references are defined  │
│ 5 │ Bidirectional Parity       │  PASS  │ Perfect parity between ADRs and Req graph │
│ 6 │ Ledger Health              │  PASS  │ Audit ledger is valid and parseable       │
│ 7 │ Transaction Integrity      │  PASS  │ All WAL transaction manifests verified    │
│ 8 │ Lockfile Health            │  PASS  │ Lockfile is clean and responsive          │
└───┴────────────────────────────┴────────┴───────────────────────────────────────────┘
✔ All 8 integrity rules passed successfully!
```

---

### `pactx diff`
Renders a colorized, structural preview of a proposed `pactx-update` block without acquiring locks or touching disk.

- **When to use:** To inspect what an update will change before running `pactx update`.
- **Flags:**
  - `--file <path>`: Inspects payload from file.
  - `--stdin`: Inspects payload from pipe.

```bash
cat update.md | npx @trsthales/pactx diff --stdin
```

---

### `pactx rollback`
Performs deterministic, graph-safe rollbacks of committed mutations using WAL snapshots.

- **When to use:** To undo an erroneous update or revert to a previous architecture state.
- **Arguments & Flags:**
  - `[hash]`: Target transaction hash (or prefix). If omitted, rolls back the most recent transaction (LIFO).
  - `-y, --yes`: Executes rollback without interactive confirmation.
  - `--dry-run`: Simulates the rollback without modifying disk.
  - `--force-cascade`: Automatically cascades rollbacks to all downstream dependent transactions.

```bash
npx @trsthales/pactx rollback
```

---

## 3. The 6 Cognitive Memory Entities

```text
.ai-context/
├── project.md            # 1. Identity & Invariants
├── state.md              # 2. Active Execution & Patch Semantics
├── requirements.md       # 3. Canonical Problem Space
├── decisions/            # 4. Architectural Solution Space
│   ├── DEC-001.md
│   └── DEC-002.md
├── glossary.md           # 5. Domain Terms & Invariant Contracts
└── .pactx/               # 6. Audit Ledger & Transaction Manifests
    ├── ledger.json
    ├── .pactx.lock
    └── transactions/
```

### 1. `project.md` (Identity & Invariants)
Defines the foundational vision, tech stack, architecture boundaries, and non-negotiable rules.
- **Lifecycle:** Static, modified only during major technical shifts.

### 2. `state.md` (Active Execution & Patch Semantics)
Tracks the active task, status (`IN_PROGRESS`, `BLOCKED`, `COMPLETED`), recommended model, completed items, facts discovered, rejected hypotheses, and the immediate next step.
- **Patch Semantics:** If an update omits `active_task` or `next_action`, pre-existing values are preserved.

### 3. `requirements.md` (Canonical Problem Space)
Stores functional, security, performance, and compliance requirements.
- **Frontmatter:** Structured YAML with `id`, `type`, `status`, and `satisfied_by: ["DEC-002"]`.
- **Markdown Body:** Detailed human-readable specifications and acceptance criteria under `### [REQ-xxx] Title`.

### 4. `decisions/DEC-%03d.md` (Architectural Solution Space)
Records architectural decisions as immutable micro-ADRs.
- **Features:** Auto-incrementing IDs (`DEC-001`, `DEC-002`), structural lineage (`superseded_by`), and explicit requirement mapping (`satisfies: ["REQ-001"]`).

### 5. `glossary.md` (Invariant Domain Contracts)
A canonical lexicon of domain terms, table schemas, database column names, and API contracts.

### 6. `.pactx/` (Audit Ledger & Transaction Manifests)
Internal database containing:
- `ledger.json`: SHA-256 history of all applied mutations with revision timestamps.
- `.pactx.lock`: Exclusive lockfile with process ID, UUID ownership token, and heartbeat.
- `transactions/TX-<hash>.json`: Write-Ahead Logging manifests with full before/after snapshots.

---

## 4. The Transactional Engine (`TransactionEngine` WAL)

PactX guarantees **ACID-like properties** for file-based repository mutations.

### State Machine

```text
       ┌──────────┐
       │ PREPARED │ (Snapshot written to TX-<hash>.json with SHA-256)
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │ APPLYING │ (Files modified via atomic temp-rename)
       └────┬─────┘
            ├─────────────────────────┐
            ▼ (Success)               ▼ (Interrupted / Exception)
     ┌───────────┐             ┌─────────────┐
     │ COMMITTED │             │ ROLLED_BACK │ (Snapshot restored)
     └───────────┘             └──────┬──────┘
                                      │ (If recovery fails >= 3x)
                                      ▼
                                 ┌────────┐
                                 │ FAILED │ (Halted for manual review)
                                 └────────┘
```

### Write-to-Temp & Atomic Rename
File writes use `safeAtomicWriteFileSync`:
1. Content is written to a hidden temporary file in the same directory (`.${file}.${pid}.${time}.${rand}.tmp`).
2. Atomic replacement occurs at the OS/filesystem level via `fs.renameSync()`.
3. If an error occurs, the temporary file is unlinked immediately.

### Transparent Boot Auto-Recovery & Anti-Loop Protection
Whenever any CLI command runs, `bootstrapPactx` inspects `.pactx/transactions/`:
- If an orphaned `PREPARED` or `APPLYING` transaction is found, its snapshot integrity is verified via SHA-256 and original files are restored.
- The aborted transaction is purged from `ledger.json`.
- If a manifest fails recovery 3 consecutive times, it is marked as `FAILED` to prevent recovery loops.

### Pruning & Retention Policy
Finalized manifests (`COMMITTED` or `ROLLED_BACK`) older than 30 days or beyond the 50 most recent transactions are automatically pruned during background execution and `doctor --fix`.

---

## 5. Zero-Trust Security Matrix & Defense-in-Depth

| Defensive Layer | Threat Model / Vulnerability | Mitigation Mechanism in PactX |
|---|---|---|
| **Filesystem Jail** | Path traversal (`../../../etc/passwd`) | Canonical directory boundaries enforced via `fs.realpathSync.native` and path jail assertions. |
| **Anti-Symlink Protection** | Arbitrary file overwrite via symlink hijacking | `safeAtomicWriteFileSync` validates `fs.lstatSync().isSymbolicLink() === false` before writing. |
| **Anti-Hardlink Protection** | Cross-file corruption via hardlink sharing | Detects `stat.nlink > 1` and unlinks the link before creating an isolated inode. |
| **Prompt Injection Evasion** | Zero-width chars, Cyrillic homoglyphs | Normalizes text using Unicode NFKD, strips hidden markers, and matches linear anti-evasão regexes. |
| **Trojan Section Injection** | Persistent LLM hijacking via `# Title` injection | `sanitizeBodyField` converts embedded markdown headers to blockquotes (`>`) and escapes XML tags (`<system>`, `<!-- -->`). |
| **Optimistic Concurrency Control** | Silent overwrites from concurrent AI chats | Revalidates repository revision hash under exclusive lock immediately before writes (Final OCC Check). |
| **Anti-TOCTOU Under Lock** | Race condition in ADR auto-ID allocation | Definitively allocates IDs under `ContextLock` and maps references dynamically. |
| **ReDoS Immunity** | Regular Expression Denial of Service on large inputs | All regular expressions are strictly linear $\mathcal{O}(N)$ without nested quantifiers. |

---

## 6. Multi-AI Interoperability Guide

### Usage Workflow

PactX works seamlessly with any AI interface:

```text
1. Terminal:            npx @trsthales/pactx
2. AI Interface:        Paste (Ctrl+V) -> Code, converse, solve tasks
3. AI Interface:        Type "/handoff" -> Copy the generated block
4. Terminal:            npx @trsthales/pactx update
```

Compatible with:
- **Web Interfaces:** ChatGPT, Claude.ai, Gemini Web, DeepSeek.
- **AI IDEs & Editors:** Cursor, Windsurf, GitHub Copilot.
- **Terminal Agents:** Claude Code, Aider, OpenCode.

---

### `pactx-update` Specification

The AI outputs a fenced code block:

````markdown
```pactx-update
version: "1.1"
base_revision: "9c08a9f3eb2f1c84"
source:
  type: "conversation"
  model: "Claude 3.7 Sonnet"
state:
  active_task: "Implement Distributed Lock"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items:
    - "Added atomic lockfile creation"
  new_facts:
    - "O_EXCL provides atomic exclusivity on POSIX and NTFS"
  rejected_hypotheses:
    - "In-memory mutex does not protect across CLI invocations"
  next_action: "Add PID liveness check"
new_requirements:
  - id: "auto"
    type: "security"
    title: "Process Lock Liveness"
    statement: "The lockfile must automatically release when the owner process terminates."
new_decisions:
  - id: "auto"
    title: "Token-Based Lockfile with PID Check"
    reason: "Ensure stale locks from killed processes are reclaimed immediately"
    decision: "Store UUID token and PID; verify with process.kill(pid, 0)"
    satisfies: ["REQ-002"]
superseded_decisions:
  - id: "DEC-001"
    by: "auto"
    reason: "Replaced by process-aware lockfile"
new_glossary_terms:
  - term: "LockToken"
    definition: "UUID v4 assigned to a ContextLock instance to prevent lock theft."
```
````

---

## 7. Model Context Protocol (MCP) & Real-Time Engine (v0.4.0)

PactX v0.4.0 includes a native **Model Context Protocol (MCP)** server for real-time IDE memory without copy-paste:

- **Command:** `pactx serve --mcp` (stdio transport).
- **Resources:**
  - `pactx://context`: Markdown context pack.
  - `pactx://health`: JSON context health and saturation report.
  - `pactx://status`: JSON repository cognitive metrics.
- **Tools:**
  - `pactx_record_anchor`: Real-time decision/fact/rejection recording.
  - `pactx_get_context_health`: Real-time token usage evaluation & handoff triggers.
  - `pactx_propose_mutation`: Decoupled proposal creation returning `proposalId`.
  - `pactx_apply_mutation`: Transactional commit under `ContextLock`.

---

## 8. Out-of-Band Transcript Extractor (`pactx extract`)

- **Deterministic Local Extraction:** Extracts micro-anchors (`<!-- pactx:v1 ... -->`), `/remember` directives, and code annotations (`// DECISION:`, `// REJECTED:`) 100% offline at zero token cost.
- **Semantic LLM Extraction:** Optional AI extraction with Evidence Spans (`evidence: { turn, quote }`) using Google Gemini, Anthropic Claude, OpenAI, or local Ollama without heavy external SDKs.

---

<p align="center">
  <b>PactX 📦 — Universal Context Continuity Engine</b><br>
  Developed with zero-trust architectural rigor for mission-critical software engineering.
</p>

