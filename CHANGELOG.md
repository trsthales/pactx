# Changelog

All notable changes to this project will be documented in this file.

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