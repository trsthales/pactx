import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

export function initProject(cwd: string = process.cwd()): void {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');

    if (fs.existsSync(contextDir)) {
        console.log(pc.yellow('⚠ .ai-context already exists in this directory.'));
        return;
    }

    fs.mkdirSync(decisionsDir, { recursive: true });

    fs.writeFileSync(
        path.join(contextDir, 'project.md'),
        `---
spec_version: "1.0"
project: "Project Name"
version: "0.1.0"
stack: ["Node.js", "TypeScript", "PostgreSQL"]
---
# Project Vision
Briefly describe the purpose of this system.

# Invariant Rules
1. All new code must include automated unit tests.
2. Never assume root causes of bugs without runtime evidence.
`
    );

    fs.writeFileSync(
        path.join(contextDir, 'state.md'),
        `---
spec_version: "1.0"
sprint: "SPRINT_01"
active_task: "TASK-01"
recommended_model: "Medium"
status: "IN_PROGRESS"
---
# Current Goal
Initial architecture setup and core validations.

# Recently Completed
- [x] Repository initialized.

# Rejected Hypotheses / Known Errors (DO NOT RETRY)
- (Record here what you tested and did not work so AI does not retry)

# Immediate Next Action
Start implementing the main module.
`
    );

    fs.writeFileSync(
        path.join(contextDir, 'glossary.md'),
        `# Glossary & Contracts
- **User**: Represents an authenticated user in the system.
- **Tenant**: Organization or school identifier.
`
    );

    fs.writeFileSync(
        path.join(decisionsDir, 'DEC-001.md'),
        `---
id: "DEC-001"
title: "Initial Architectural Decision"
status: "active"
date: "${new Date().toISOString().split('T')[0]}"
---
# Decision
Base technology stack and modular structure defined.

# Reason
Simplicity, maintainability, and long-term developer ergonomics.
`
    );

    console.log(pc.green('✔ .ai-context structure initialized successfully!'));
    console.log(pc.cyan("👉 Edit files in .ai-context/ and run 'npx @trsthales/pactx' to copy context."));
}