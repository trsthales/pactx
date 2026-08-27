# pactx Architecture & Technical Specification 🏛️

🌐 **Language / Idioma:** [English](./ARCHITECTURE.md) | [Português (Brasil)](./ARCHITECTURE.pt-BR.md)

This document provides the in-depth technical and architectural specification of `pactx`, detailing its closed-loop state engine, zero-trust security pipeline, concurrency primitives, and transactional persistence guarantees.

---

## 1. Fundamental Thesis

In modern AI-assisted software development, tools and workflows often fail due to a fundamental mismatch of state semantics:

1. **Large Language Models (LLMs) are Stateless Compute Engines:**
   Context windows are ephemeral, subject to degradation, loss of attention, hallucinations, and token saturation.
2. **Software Codebases are Persistent, Evolving State Machines:**
   Architecture rules, invariant contracts, architectural decision records (ADRs), and ongoing sprint states require absolute persistence and deterministic traceability.

`pactx` bridges this gap by establishing the **Git repository as the single canonical source of truth** and implementing a bidirectional, human-in-the-loop synchronization protocol between developers, repositories, and AI models.

---

## 2. Closed-Loop State Engine Architecture

`pactx` operates across two core pipelines: **Egress** (Context Packing) and **Ingress** (Context Ingestion & State Mutation).

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          LOCAL REPOSITORY                              │
│                                                                        │
│   .ai-context/                                                         │
│   ├── project.md         (Static Architecture & Rules)                 │
│   ├── requirements.md    (Canonical Requirements & Business Rules)     │
│   ├── state.md           (Active Sprint, Tasks, Facts, Hypotheses)     │
│   ├── glossary.md        (Domain Contracts & Invariant Terms)          │
│   ├── decisions/DEC-*.md (Micro-ADRs with satisfies Links)             │
│   └── .pactx/                                                          │
│       ├── ledger.json    (Audit Ledger & Applied Hashes)               │
│       ├── .pactx.lock    (Atomic Concurrency Lock)                     │
│       └── transactions/  (Write-Ahead Log Manifests TX-*.json)         │
│                                                                        │
│   Git Runtime State (Branch, Recent Commits, Modified Files Diff)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx @trsthales/pactx │ [EGRESS] 3. npx @trsthales/pactx │ update [INGRESS]
     (composer.ts) │                        (TransactionEngine)│ (Zero-Trust Pipeline)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  Token-Optimized Markdown    │   │  Human-in-the-Loop Review       │
    │  Context Pack (Clipboard)    │   │  (Full-Text Diff & Verification)│
    │  + Root Discovery (findRoot) │   │  + pactx diff Dry-Run           │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   │                           [PLANNER & PARSER]
                   │                           • Anti-Symlink / Hardlink Check
                   │                           • Markdown Section Sanitizer
                   │                           • Path Traversal Jail
                   │                           • Write-Ahead Logging (WAL)
                   │                           • Atomic File Lock (.pactx.lock)
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │               ANY AI (ChatGPT / Claude / Gemini / Cursor)          │
    │                   Emits ```pactx-update block                      │
    └────────────────────────────────────────────────────────────────────┘
```

### The Ingress Pipeline Flow
When an AI outputs a `pactx-update` block, the ingestion pipeline executes in five strict, fail-closed stages:

```text
Untrusted Input (Clipboard / File / Stdin)
   │
   ▼
[1. PARSER (src/update/parser.ts)]
   ├── Extract ```pactx-update``` code block
   ├── Parse YAML safely (without prototype pollution)
   ├── Validate schema types (v1.0 & v1.1) and strict enums
   ├── Execute anti-evasion heuristic scanner (NFKD normalization)
   ├── Enforce cardinality bounds (max arrays: 100, max string: 2000, max ADRs: 20)
   └── Calculate deterministic canonical SHA-256 hash
   │
   ▼
[2. PLANNER (src/update/planner.ts)]
   ├── Verify path traversal jail (assertInsideDirectory via fs.realpathSync.native)
   ├── Check idempotency via .pactx/ledger.json (fail-closed on corrupt JSON)
   ├── Allocate provisional ADR & Requirement IDs (resolving auto -> DEC-%03d / REQ-%03d)
   ├── Validate semantic references (by: auto vs explicit supersede targets)
   └── Detect optimistic concurrency divergence (base_revision vs current_revision)
   │
   ▼
[3. REVIEW UI (src/cli.ts)]
   └── Display full-text literal plan (facts, decisions, requirements, tasks)
   │
   ▼
[4. TRANSACTION ENGINE & WAL (src/update/transaction.ts)]
   ├── Acquire exclusive ContextLock (.pactx/.pactx.lock via fs.openSync('wx'))
   ├── Trigger boot Auto-Recovery for orphaned PREPARED/APPLYING manifests
   ├── Allocate definitive sequential IDs under lock (TOCTOU elimination)
   ├── Write WAL Manifest TX-<hash>.json with SHA-256 snapshots (PREPARED -> APPLYING)
   ├── Apply patch semantics to state.md & requirements.md
   ├── Perform atomic writes (safeAtomicWriteFileSync: write-to-temp + rename)
   ├── Transition WAL Manifest to COMMITTED
   ├── Append transaction entry to .pactx/ledger.json
   └── Release ContextLock and prune transactions (>50 / >30d)
```

---

## 3. Data Model & Canonical Entities

All canonical state is persisted in `.ai-context/` using human-readable Markdown and strict YAML frontmatter.

### 3.1 `project.md` (Static System Spec)
Contains the immutable architectural foundations, tech stack, and non-negotiable rules of the project.

### 3.2 `requirements.md` (Canonical Requirements & Business Rules)
Tracks functional, security, performance, and compliance requirements with patch semantics:
```markdown
---
spec_version: "1.0"
requirements:
  - id: "REQ-001"
    type: "security"
    title: "Proteção de Rotas com Autenticação Forte"
    status: "active"
    satisfied_by: ["DEC-002"]
---
# Requisitos do Sistema

## REQ-001: Proteção de Rotas com Autenticação Forte
Todas as rotas da API devem exigir tokens criptograficamente validados.
```

### 3.3 `state.md` (Volatile Task State & Patch Semantics)
Tracks active development state. `pactx` treats state updates with **Patch Semantics**: if the AI omits fields, existing values are preserved verbatim.

### 3.4 `decisions/DEC-%03d.md` (Micro-ADRs & Bidirectional Links)
Architectural decisions are versioned sequentially and declare requirements they satisfy:
```markdown
---
spec_version: "1.0"
id: "DEC-002"
title: "Autenticação via PIN com PBKDF2"
status: "active"
date: "2026-08-26"
satisfies: ["REQ-001"]
---
# Decisão
...
```

### 3.5 `.pactx/ledger.json` (Audit Ledger)
Maintains an immutable history of applied updates, capturing hashes, timestamps, and concurrency revisions.

---

## 4. Concurrency, WAL & Rollback Guarantees

### 4.1 Write-Ahead Logging (WAL) State Machine
`TransactionEngine` executes state mutations across strict lifecycle phases:
- `PREPARED`: Pre-flight snapshots taken, SHA-256 checksums recorded.
- `APPLYING`: Atomic disk operations in progress.
- `COMMITTED`: All files written and audit ledger updated.
- `ROLLED_BACK`: State cleanly reverted via snapshot restoration.
- `FAILED`: Unrecoverable state requiring manual intervention (anti-loop protection after 3 attempts).

### 4.2 Graph-Safe Rollbacks (`pactx rollback`)
Rollbacks validate dependency trees. If newer transactions depend on entities created in the target transaction, rollback is prevented unless `--force-cascade` is supplied to revert the entire chain in LIFO order.

### 4.3 Diagnostic Engine (`pactx doctor`)
Runs 8 automated integrity rules: YAML Frontmatters, Security Jail, ADR Lineage, Requirement Mapping, Bidirectional Parity, Ledger Health, Transaction Integrity, and Lockfile Health with `--fix` auto-repair.

---

## 5. Architectural Decisions & Trade-offs

| Decision | Chosen Approach | Alternative Considered | Rationale |
|---|---|---|---|
| **Storage Medium** | Plain Markdown + YAML files in Git | Vector Databases / Embeddings (RAG) | Git-native tracking allows zero infrastructure dependencies, offline execution, deterministic history, and seamless code reviews in PRs. |
| **Transactional Engine** | File-based WAL Manifests (`TX-*.json`) | Direct in-place writes | Provides crash recovery resilience against SIGKILL and power failure without a daemon. |
| **Concurrency Control** | File Locking (`wx`) + 16-char OCC Hash | Database locks / Central Server | Works locally in any terminal without requiring daemons or network connectivity. |
| **Mutation Semantics** | Incremental Patch Merging | Destructive Snapshot Overwriting | Prevents partial AI updates from accidentally erasing user-authored notes, objectives, or custom sections. |

---

## 6. The 4-Layer Architecture (v0.4.0)

PactX v0.4.0 organizes context continuity across 4 complementary layers:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                    PACTX CONTEXT CONTINUITY v0.4.0                     │
│                                                                        │
│  Layer 1: PASSIVE (Always Active)                                      │
│  ├── In-Flight Micro-Anchors Protocol in Context Pack Prompt           │
│  └── Weighted Local Token Estimator (Code /3, Prose /4, +15% Margin)   │
│                                                                        │
│  Layer 2: ACTIVE (Threshold-Driven)                                    │
│  ├── Context Health Engine & Saturation Zones (SAFE/WATCH/CAUTION/...) │
│  └── pactx status --telemetry Visual ANSI Dashboard                    │
│                                                                        │
│  Layer 3: EXTRACTION (Out-of-Band)                                     │
│  ├── pactx extract (Multi-Format Parsers: Claude, ChatGPT, Cursor)     │
│  └── Hybrid Pipeline: Deterministic Local Baseline + Semantic LLM      │
│                                                                        │
│  Layer 4: REALTIME (IDE Agents via MCP)                                │
│  ├── stdio MCP Server (pactx serve --mcp)                              │
│  ├── Resources: pactx://context, pactx://health, pactx://status        │
│  └── Decoupled Proposal Security: pactx_propose_mutation (PROP-<hash>) │
└────────────────────────────────────────────────────────────────────────┘
```

