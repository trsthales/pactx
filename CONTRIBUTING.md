# Contributing to pactx 📦

Thank you for your interest in contributing to `pactx`! We welcome contributions, bug reports, feature proposals, and architectural improvements.

---

## Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **Git**: Installed and available in PATH

### Local Environment Setup
1. **Fork** the repository on GitHub: [https://github.com/trsthales/pactx](https://github.com/trsthales/pactx)
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/pactx.git
   cd pactx
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build TypeScript**:
   ```bash
   npm run build
   ```
5. **Run test suite**:
   ```bash
   npm test
   ```

---

## Architectural & Security Principles

All code submitted to `pactx` must strictly adhere to the following principles:

1. **Zero-Trust Input**:
   - Treat all external input (clipboard payloads, files, Git outputs, CLI flags) as potentially malicious.
   - Sanitize Markdown headers, code fences, HTML/XML system prompt tags, and horizontal rules before writing to files.
   - Validate and bound array sizes, string lengths, and decision counts to avoid context window degradation or memory exhaustion.

2. **Fail-Closed & Atomic Mutation**:
   - Never perform partial or uncoordinated file writes.
   - Use `safeAtomicWriteFileSync` (Write-to-Temp + Atomic Rename) with defensive cleanup.
   - Use `ContextLock` for concurrency control.
   - If parsing or validation fails, abort immediately without touching existing state.

3. **Cross-Platform Determinism**:
   - Always normalize line breaks (`\r\n` and `\r` to `\n`) before computing canonical SHA-256 hashes.
   - Use Unicode NFC normalization for semantic deduplication.
   - Ensure paths and commands execute consistently across Linux, macOS, and Windows.

---

## Pull Request Guidelines

1. **Branch Naming**:
   - `feat/<feature-name>` for new features
   - `fix/<bug-name>` for bug fixes
   - `docs/<description>` for documentation updates
   - `refactor/<description>` for code refactoring

2. **Commit Conventions**:
   - Follow standard Conventional Commits:
     - `feat: add support for custom context formats`
     - `fix: handle edge case in unicode deduplication`
     - `test: add regression test for atomic rename failure`
     - `docs: update protocol schema specification`

3. **Testing**:
   - Every bug fix or feature **must include automated tests** in `test/update.test.ts` (or relevant test files).
   - Ensure `npm run build && npm test` passes with zero warnings or errors prior to opening the PR.

4. **Review Process**:
   - PRs must pass automated CI matrix tests on Ubuntu, Windows, and macOS across Node.js 18, 20, and 22.
   - Maintainers will review code for correctness, security posture, and backward compatibility.

---

## Code of Conduct

Please be respectful, constructive, and collaborative in all issues, discussions, and pull requests.
