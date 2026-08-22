# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-08-22

### Added
- Core CLI implementation (`pactx init` and `pactx pack`).
- Spec format definition for `.ai-context/` (`project.md`, `state.md`, `glossary.md`, and `decisions/`).
- Automated Git state inspection (active branch, recent commits, and modified files).
- ADR status filter (respects `active` vs `superseded` decisions).
- Headless clipboard fallback for Linux/CI/containers.
- Automated unit test suite via Node test runner.