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
│   ├── state.md           (Active Sprint, Tasks, Facts, Hypotheses)     │
│   ├── glossary.md        (Domain Contracts & Invariant Terms)          │
│   ├── decisions/DEC-*.md (Active & Superseded Micro-ADRs)              │
│   └── .pactx-history.json (Audit Ledger & Applied SHA-256 Hashes)      │
│                                                                        │
│   Git Runtime State (Branch, Recent Commits, Modified Files Diff)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx pactx │ [EGRESS]            3. npx pactx │ update [INGRESS]
     (composer.ts) │                        (applier) │ (Zero-Trust Pipeline)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  Token-Optimized Markdown    │   │  Human-in-the-Loop Review       │
    │  Context Pack (Clipboard)    │   │  (Full-Text Diff & Verification)│
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   │                           [PLANNER & PARSER]
                   │                           • Anti-Symlink / Hardlink Check
                   │                           • Markdown Section Sanitizer
                   │                           • Path Traversal Jail
                   │                           • Memory & Bound Containment
                   │                           • Atomic File Lock (.pactx.lock)
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │               ANY AI (ChatGPT / Claude / Gemini / Cursor)          │
    │                   Emits ```pactx-update block                      │
    └────────────────────────────────────────────────────────────────────┘
```

### The Ingress Pipeline Flow
When an AI outputs a `pactx-update` block, the ingestion pipeline executes in four strict, fail-closed stages:

```text
Untrusted Input (Clipboard / File / Stdin)
   │
   ▼
[1. PARSER (src/update/parser.ts)]
   ├── Extract ```pactx-update``` code block
   ├── Parse YAML safely (without prototype pollution)
   ├── Validate schema types and strict enums (status, recommended_model)
   ├── Execute anti-evasion heuristic scanner (NFKD normalization)
   ├── Enforce cardinality bounds (max arrays: 100, max string: 2000, max ADRs: 20)
   └── Calculate deterministic canonical SHA-256 hash
   │
   ▼
[2. PLANNER (src/update/planner.ts)]
   ├── Verify path traversal jail (assertInsideDirectory via fs.realpathSync.native)
   ├── Check idempotency via .pactx-history.json (fail-closed on corrupt JSON)
   ├── Allocate ADR IDs (resolving auto -> DEC-002 with collision prevention)
   ├── Validate semantic references (by: auto vs explicit supersede targets)
   └── Detect optimistic concurrency divergence (base_revision vs current_revision)
   │
   ▼
[3. REVIEW UI (src/cli.ts)]
   └── Display full-text literal plan (facts, decisions, tasks) for human approval
   │
   ▼
[4. APPLIER (src/update/applier.ts)]
   ├── Acquire exclusive file lock (.pactx.lock via fs.openSync('wx'))
   ├── Register signal traps (SIGINT, SIGTERM, SIGHUP) for clean abort
   ├── Take in-memory pre-flight snapshots of target files
   ├── Apply patch semantics to state.md (preserving custom sections and unmentioned fields)
   ├── Perform atomic writes (safeAtomicWriteFileSync: write-to-temp + rename)
   ├── Log audit metadata (hash, revisions, timestamp, forced flag)
   └── Release file lock and unregister signal handlers
```

---

## 3. Data Model & Canonical Entities

All canonical state is persisted in `.ai-context/` using human-readable Markdown and strict YAML frontmatter.

### 3.1 `project.md` (Static System Spec)
Contains the immutable architectural foundations, tech stack, and non-negotiable rules of the project.
```markdown
---
spec_version: "1.0"
project: "EduTrack"
version: "0.1.0"
stack: ["Node.js", "TypeScript", "Fastify", "PostgreSQL"]
---
# Visão do Projeto
Plataforma educacional...

# Regras Invioláveis
1. Todo endpoint deve conter validação Zod.
```

### 3.2 `state.md` (Volatile Task State & Patch Semantics)
Tracks active development state. `pactx` treats state updates with **Patch Semantics**: if the AI omits `active_task`, `next_action`, or `status`, existing values are preserved verbatim rather than wiped out.
```markdown
---
spec_version: "1.0"
sprint: "SPRINT_01"
active_task: "TASK-05 Autenticação via PIN"
recommended_model: "High"
status: "IN_PROGRESS"
---
# Objetivo Atual
Implementação do login por PIN numérico...

# O que foi feito recentemente
- [x] Schema Zod configurado

# Fatos & Descobertas
- Rate limit de 5 req/min obrigatório

# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)
- Bcrypt descartado devido a overhead

# Próxima Ação Imediata
Criar controller e rotas Fastify
```

### 3.3 `decisions/DEC-%03d.md` (Micro-ADRs & Structural Lineage)
Architectural decisions are versioned sequentially. When an ADR is superseded, `pactx` updates its frontmatter to point structurally to the superseding decision:
```markdown
---
spec_version: "1.0"
id: "DEC-001"
title: "Autenticação Inicial por Senha"
status: "superseded"
date: "2026-08-20"
superseded_by: "DEC-002"
superseded_date: "2026-08-22"
superseded_reason: "Alunos do ensino fundamental possuem fricção com senhas complexas"
---
# Decisão
...
```

### 3.4 `glossary.md` (Domain Contracts & Invariant Terms)
Stores domain terminology and schema definitions. New terms are normalized via Unicode NFC and deduplicated case-insensitively.

### 3.5 `.pactx-history.json` (Audit Ledger)
Maintains an immutable history of applied updates, capturing hashes, timestamps, and concurrency revisions:
```json
{
  "version": "1.0",
  "applied_updates": [
    {
      "hash": "c5f89e21b8a901d4...",
      "applied_at": "2026-08-22T18:00:00.000Z",
      "forced": false,
      "base_revision": "7a9f1b2c3d4e5f60",
      "applied_revision": "8b0e2c3d4e5f6071",
      "task": "TASK-05 Autenticação via PIN",
      "created_adrs": ["DEC-002"],
      "superseded_adrs": ["DEC-001"]
    }
  ]
}
```

---

## 4. Zero-Trust Security Architecture

`pactx` enforces a zero-trust model on all AI outputs, clipboard contents, Git branches, and file system interactions.

### 4.1 Path Traversal Jail (`assertInsideDirectory`)
- ADR identifiers are restricted to `/^(auto|DEC-(?!0+$)\d{3,4})$/i`.
- File paths are verified using `fs.realpathSync.native` to ensure target paths and their parent directories physically reside within `.ai-context/`.

### 4.2 Anti-Symlink & Anti-Hardlink Protection
- Before any file write, `safeAtomicWriteFileSync` checks `fs.lstatSync()`.
- If `stat.isSymbolicLink()` is true, the operation immediately aborts with a security violation.
- If `stat.nlink > 1` (hardlink hijacking attempt), the existing link is unlinked before writing a fresh inode.

### 4.3 Anti-Prompt Injection & Markdown Trojaning (`sanitizeBodyField`)
AI-generated content inserted into markdown files could manipulate downstream LLMs. `sanitizeBodyField` neutralizes:
- Markdown Section Injections: Any line starting with `#` to `######` is converted to a blockquote (`> `).
- Horizontal Rules: Markdown rules (`---`, `***`, `___`) simulating frontmatter breaks are removed.
- Prompt System Tags: HTML/XML directives like `<system>`, `<instruction>`, `<rules>`, and comments `<!-- ... -->` are escaped.
- Anti-Evasion Scanner: An adversarial heuristic scanner normalizes strings via Unicode NFKD, strips zero-width non-printable characters (`\u200B-\u200D`, `\uFEFF`), and detects malicious system prompt injection attempts across multiple languages.

### 4.4 ReDoS Immunity & Memory Bounds
- All regular expressions use strictly linear quantifiers, preventing exponential catastrophic backtracking.
- Array inputs are bounded to `MAX_ARRAY_ITEMS = 100`.
- Strings are bounded to `MAX_STRING_LENGTH = 2000`.
- Decision batches are capped at `MAX_DECISIONS_PER_BATCH = 20`.

---

## 5. Concurrency & Transactional Guarantees

### 5.1 Atomic Persistence (Write-to-Temp + Atomic Rename)
Files are never modified in-place:
1. Content is written to a unique temporary file: `.${filename}.${pid}.${timestamp}.${rand}.tmp`.
2. `fs.renameSync` performs an atomic filesystem-level replace.
3. If any step fails, the `.tmp` file is immediately unlinked.

### 5.2 Atomic File Locking (`ContextLock`)
To prevent concurrent updates from racing in multi-terminal or agentic workflows:
- `ContextLock` creates `.ai-context/.pactx.lock` using `fs.openSync` with exclusive flag `wx` (`O_CREAT | O_EXCL`).
- Records PID and acquisition timestamp.
- Recovers safely from stale locks (>30 seconds of inactivity).
- Traps `SIGINT`, `SIGTERM`, and `SIGHUP` to clean up the lock on process interruption.

### 5.3 Optimistic Concurrency Control (OCC)
- `getCurrentContextRevision` calculates a 16-character SHA-256 hash across `project.md`, `state.md`, `glossary.md`, and all `decisions/*.md`.
- `pactx update` checks `base_revision`. If the repository was modified after the AI session started, a `Stale Context` warning is raised, requiring human confirmation or `--force`.

### 5.4 Fail-Closed Transactional Rollback
- Before applying any mutations, `applier.ts` records an in-memory snapshot map of all target files.
- If an unexpected error or interruption occurs, the entire batch is rolled back to its original state, leaving zero half-written files on disk.

---

## 6. Architectural Decisions & Trade-offs

| Decision | Chosen Approach | Alternative Considered | Rationale |
|---|---|---|---|
| **Storage Medium** | Plain Markdown + YAML files in Git | Vector Databases / Embeddings (RAG) | Git-native tracking allows zero infrastructure dependencies, offline execution, deterministic history, and seamless code reviews in PRs. |
| **Parsing Engine** | Safe AST parsing + Sanitization | Regex-only replacement | Prevents prototype pollution and structural YAML breaks while maintaining strict schema typing. |
| **Concurrency Control** | File Locking (`wx`) + 16-char OCC Hash | Database locks / Central Server | Works locally in any terminal without requiring daemons or network connectivity. |
| **Mutation Semantics** | Incremental Patch Merging | Destructive Snapshot Overwriting | Prevents partial AI updates from accidentally erasing user-authored notes, objectives, or custom sections. |
