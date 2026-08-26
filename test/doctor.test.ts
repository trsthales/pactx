import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { runDiagnostics, renderDoctor } from '../src/commands/doctor';

test('Doctor: Repositório inicializado é 100% saudável e passa em todas as 9 regras', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-doctor-clean-'));
    try {
        initProject(tmpDir);

        const report = runDiagnostics(tmpDir);

        assert.strictEqual(report.hasErrors, false);
        assert.strictEqual(report.hasWarnings, false);
        assert.strictEqual(report.exitCode, 0);
        assert.strictEqual(report.results.length, 9);

        for (const res of report.results) {
            assert.strictEqual(res.status, 'pass', `Regra ${res.name} deve passar`);
        }

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Doctor: Detecta loop circular em linhagem de ADRs (Regra 3)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-doctor-adr-cycle-'));
    try {
        initProject(tmpDir);
        const decisionsDir = path.join(tmpDir, '.ai-context', 'decisions');

        fs.writeFileSync(
            path.join(decisionsDir, 'DEC-002.md'),
            `---
id: "DEC-002"
title: "Decisão 2"
status: "superseded"
superseded_by: "DEC-003"
---
# Decision
D2
`
        );

        fs.writeFileSync(
            path.join(decisionsDir, 'DEC-003.md'),
            `---
id: "DEC-003"
title: "Decisão 3"
status: "superseded"
superseded_by: "DEC-002"
---
# Decision
D3
`
        );

        const report = runDiagnostics(tmpDir);
        assert.strictEqual(report.hasErrors, true);
        assert.strictEqual(report.exitCode, 2);

        const adrRule = report.results.find(r => r.id === 3);
        assert.strictEqual(adrRule?.status, 'fail');
        assert.ok(adrRule?.details?.some(d => d.includes('Circular ADR supersede loop detected')));

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Doctor: Detecta violação de Security Jail por link simbólico (Regra 2)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-doctor-symlink-'));
    try {
        initProject(tmpDir);
        const target = path.join(tmpDir, 'outside.txt');
        fs.writeFileSync(target, 'target', 'utf-8');

        const symlinkPath = path.join(tmpDir, '.ai-context', 'symlink.md');
        fs.symlinkSync(target, symlinkPath);

        const report = runDiagnostics(tmpDir);
        assert.strictEqual(report.hasErrors, true);
        assert.strictEqual(report.exitCode, 2);

        const jailRule = report.results.find(r => r.id === 2);
        assert.strictEqual(jailRule?.status, 'fail');
        assert.ok(jailRule?.details?.some(d => d.includes('Symbolic link detected')));

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Doctor: Opção --fix remove lockfile abandonado e podar resíduos', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-doctor-fix-'));
    try {
        initProject(tmpDir);
        const lockPath = path.join(tmpDir, '.ai-context', '.pactx', '.pactx.lock');
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 1111 }), 'utf-8');

        // Altera mtime para simular lock abandonado há 60 segundos
        const past = new Date(Date.now() - 60000);
        fs.utimesSync(lockPath, past, past);

        // Executa sem fix: deve acusar falha
        const reportBefore = runDiagnostics(tmpDir, false);
        const lockRuleBefore = reportBefore.results.find(r => r.id === 8);
        assert.strictEqual(lockRuleBefore?.status, 'fail');

        // Executa com fix: deve remover o lock
        const exitCode = renderDoctor(tmpDir, true);
        assert.strictEqual(exitCode, 0);
        assert.strictEqual(fs.existsSync(lockPath), false, 'Lock abandonado deve ter sido removido');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Doctor Regra 9: Emite warning quando ADR ativo satisfaz requisito depreciado', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-doctor-rule9-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const reqPath = path.join(contextDir, 'requirements.md');
        const adr1Path = path.join(contextDir, 'decisions', 'DEC-001.md');

        // Atualiza REQ-001 com status deprecated
        const reqContent = `---
spec_version: "1.0"
requirements:
  - id: REQ-001
    status: deprecated
    type: functional
    title: Initial System Requirement
    satisfied_by:
      - DEC-001
---

### [REQ-001] Initial System Requirement
Deprecated spec.
`;
        fs.writeFileSync(reqPath, reqContent, 'utf-8');

        // DEC-001 ativo aponta para REQ-001
        const adr1Content = `---
id: DEC-001
title: Initial Architectural Foundation
status: active
satisfies:
  - REQ-001
date: 2026-08-25
---

# Decision
Active architecture.
`;
        fs.writeFileSync(adr1Path, adr1Content, 'utf-8');

        const report = runDiagnostics(tmpDir);
        assert.strictEqual(report.hasWarnings, true);

        const rule9 = report.results.find(r => r.id === 9);
        assert.ok(rule9, 'Regra 9 deve existir no relatório');
        assert.strictEqual(rule9.status, 'warn');
        assert.ok(rule9.details?.some(d => d.includes('Active decision DEC-001 satisfies deprecated requirement REQ-001')));

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
