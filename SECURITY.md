# Security Policy 🛡️

The `pactx` team takes security vulnerabilities, supply chain integrity, and adversarial exploitation risks seriously.

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability in `pactx`, please **do NOT** open a public issue.

### Preferred Method: GitHub Security Advisory
1. Navigate to the repository's **Security** tab: [https://github.com/trsthales/pactx/security](https://github.com/trsthales/pactx/security).
2. Click **"Report a vulnerability"** to submit a private report.

### Alternative Method: Email
If GitHub Private Vulnerability Reporting is unavailable, send an email to the project maintainers with:
- A description of the vulnerability (e.g., Command Injection, Path Traversal, Section Injection, Race Condition).
- Steps to reproduce or a minimal Proof of Concept (PoC).
- Impact assessment and potential mitigations.

### Response Timeline
- **Initial Acknowledgment**: Within 48 hours.
- **Triage & Reproduction**: Within 5 business days.
- **Fix & Disclosure Coordination**: We will coordinate with you on a patch release and advisory disclosure.

---

## Security Architecture Overview

`pactx` operates under a **Zero-Trust** model regarding LLM outputs, clipboard content, Git branches, and file structures:
- **Symlink & Hardlink Protection**: Prevents arbitrary file overwrite via inode isolation and symbolic link rejection.
- **Markdown & Prompt Injection Defense**: Neutralizes markdown headers, block fences, HTML/XML prompt tags, and system directives in untrusted payloads.
- **Memory & Context Containment**: Bounds array sizes, string lengths, and decision batches to prevent memory leaks and ReDoS.
- **Atomic Persistence**: Uses write-to-temp and atomic rename with immediate cleanup on failure.
