# Changelog

All notable changes to this project will be documented in this file.

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