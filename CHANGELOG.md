# Changelog

All notable changes to this project will be documented in this file.

## [0.4.1] - 2026-08-27

### Security & Hardening
- **[P1-01] Path Traversal Jail in Proposals**: Strict regex validation (`/^PROP-[A-F0-9]{8,64}$/i`) and `assertInsideDirectory` preventing traversal attacks on `proposalId`.
- **[P1-02] Cryptographic Revalidation of Proposals**: Proposals recalculated and validated against `canonicalHash` prior to application.
- **[P1-03 & P2-06] Micro-Anchor Limits & Types**: Imposed 16KB limit per micro-anchor payload and strict Zod typing in MCP schema.
- **[P1-04] Network Safety & Timeouts**: Configured 60s timeout via `AbortSignal.timeout` (customizable via `PACTX_MODEL_TIMEOUT_MS`) across all native `fetch` model calls.
- **[P1-05 & P1-06] Transcript Guard & Single-Pass Parse**: Imposed 10MB limit on transcript files and single-pass JSON parsing avoiding redundant deserialization.
- **[P1-07 & P1-08] Evidence Spans Validation & Prompt Delimiters**: Enclosed transcripts in `<TRANSCRIPT_DATA>` boundary tags and sanitized hallucinated evidence spans.
- **[P2-04] Storage Layer Separation**: Separated pure path getter `getSessionsDir()` from directory creator `ensureSessionsDir()`.

## [0.4.0] - 2026-08-27

### Added
- Native Model Context Protocol (MCP) server via `pactx serve --mcp` over stdio.
- MCP Resources: `pactx://context`, `pactx://health`, and `pactx://status`.
- MCP Tools: `pactx_record_anchor`, `pactx_get_context_health`, `pactx_propose_mutation`, and `pactx_apply_mutation`.
- Decoupled proposal approval flow via `proposalId` and CLI command `pactx update --proposal <id>`.
- Out-of-Band Transcript Extractor via `pactx extract [file]` with support for Claude, ChatGPT, Cursor, and raw formats.
- Hybrid extraction pipeline: deterministic pre-extraction (zero cost/offline) + optional semantic LLM extraction with Evidence Spans (`evidence: { turn, quote }`).
- Weighted token estimator (code /3, prose /4, +15% safety margin) with zero heavy dependencies.
- Context health telemetry dashboard via `pactx status --telemetry` with ANSI saturation bar and `--json` support.
- In-flight micro-anchors protocol (`<!-- pactx:v1 ... -->`) and `/remember` developer directives.
- Ephemeral session store in `.ai-context/.pactx/sessions/` (protected in `.gitignore`).

## [0.3.2] - 2026-08-26

### Security & Hardening
- **[P1-A] Rollback Recovery Guard**: `pactx rollback` now verifies `hasPendingRecovery` and strictly blocks execution on repositories with unrecovered failed transactions (`RECOVERY_REQUIRED` / `FAILED`).
- **[P1-B] Requirements Recovery Integrity**: Computed exact SHA-256 `afterHash` for newly created `requirements.md` files, preventing unconditional deletion during auto-recovery and correctly detecting post-crash modifications.
- **[P1-C] Universal HTML/XML & URL Scheme Sanitization**: Expanded `sanitizeBodyField` to sanitize all generic HTML tags (`<script>`, `<img>`, `<style>`, etc.) and block dangerous URL schemes (`javascript:`, `vbscript:`, `data:`).
- **[P2-B] Quarantine Detection**: `hasPendingRecovery` now inspects `.ai-context/.pactx/quarantine/` for quarantined corrupt manifests, blocking mutations until reviewed.
- **[P2-C] Non-Git Directory Traversal Bounded**: Limited parent directory traversal in `findContextDir` to a maximum of 10 levels for non-git environments.

## [0.3.1] - 2026-08-26

### Added
- Rollback operations recorded as first-class WAL transactions (`type: 'ROLLBACK'`).
- Corrupt transaction quarantine (`.pactx/quarantine/`) preserving 100% forensic evidence without arbitrary deletion.
- Blocking state `RECOVERY_REQUIRED` protecting corrupted or conflictive repositories.
- Conflict-aware auto-recovery validating `afterHash` before removing created files.
- Living process check (`isProcessAlive` with `process.kill(pid, 0)`) for lock releases and temporary file cleanup.
- Lazy-loading dynamic imports in CLI commands for optimized startup performance.

## [0.3.0] - 2026-08-26

### Added
- `TransactionEngine` with Write-Ahead Logging (WAL) and lifecycle states (`PREPARED`, `APPLYING`, `COMMITTED`, `ROLLED_BACK`, `FAILED`).
- Transparent boot auto-recovery under `ContextLock` with anti-loop protection (3-attempt counter transitioning to `FAILED`).
- Canonical `Requirement` entity stored in `.ai-context/requirements.md` with YAML frontmatter, Markdown body, and patch semantics.
- Bidirectional link synchronization: `satisfies: ["REQ-xxx"]` on ADRs ⇄ `satisfied_by: ["DEC-xxx"]` on requirements.
- Protocol schema version `1.1` with backward compatibility for `1.0` and default `source.type = 'conversation'`.
- Automatic root discovery (`findContextDir` and `findProjectRoot`) allowing execution from nested subdirectories.
- Transparent storage layout migration from `.pactx-history.json` to `.pactx/ledger.json` with conflict resolution.
- `pactx status`: Visual executive terminal dashboard and `--json` export.
- `pactx diff`: Color-coded pre-application mutation inspector for clipboard, files, and stdin with 0 disk side-effects.
- `pactx rollback`: Graph-safe and WAL-protected transaction rollback with LIFO and `--force-cascade` cascade resolution.
- `pactx doctor`: Automated repository health diagnostic engine with 8 integrity rules and `--fix` auto-repair.
- Transaction pruning keeping the 50 most recent manifests and removing records older than 30 days.

## [0.2.1] - 2026-08-22

### Added
- Patch semantics for `stateUpdate`: partial updates preserve unmentioned fields.
- Full canonical context revision including `glossary.md` with 16-character hash.
- Atomic file writes via temporary file swap and rename (`safeAtomicWriteFileSync`).
- Memory protection bounding collection sizes and string lengths.
- Directory jail verification with `realpath` preventing parent symlink escapes.
- Fail-closed behavior on corrupted `.pactx-history.json`.

## [0.2.0] - 2026-08-22

### Added
- Closed-loop state mutation engine via `pactx update`.
- Full-text interactive review CLI interface.
- Zero-trust security guards (Anti-Symlink Overwrite and Anti-Section Injection).
- Automated ADR sequence numbering (`DEC-%03d`) and structural superseding.
- Optimistic concurrency control via `base_revision` and `--force` flag.
- Audit history ledger in `.pactx-history.json`.

## [0.1.0] - 2026-08-22

### Added
- Core CLI implementation (`pactx init` and `pactx pack`).
- Spec format definition for `.ai-context/` (`project.md`, `state.md`, `glossary.md`, and `decisions/`).
- Automated Git state inspection (active branch, recent commits, and modified files).
- ADR status filter (respects `active` vs `superseded` decisions).
- Headless clipboard fallback for Linux/CI/containers.
- Automated unit test suite via Node test runner.