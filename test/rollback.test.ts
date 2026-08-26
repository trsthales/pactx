import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { parseAndValidateUpdate } from '../src/update/parser';
import { buildMutationPlan } from '../src/update/planner';
import { applyMutationPlan } from '../src/update/applier';
import { executeRollback } from '../src/commands/rollback';
import { TransactionManifest, HistoryLedger } from '../src/update/types';

test('Rollback LIFO: Reverte a transação mais recente, restaura state.md e remove DEC-002', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-rollback-lifo-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const statePath = path.join(contextDir, 'state.md');
        const originalState = fs.readFileSync(statePath, 'utf-8');

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
state:
  active_task: "TASK-ROLLBACK-01"
  status: "IN_PROGRESS"
  new_facts:
    - "Fato adicionado antes do rollback"
new_decisions:
  - id: "auto"
    title: "Decisão para Rollback"
    reason: "Teste de reversão"
    decision: "Esta decisão deve sumir"
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);
        applyMutationPlan(tmpDir, plan);

        const adr2Path = path.join(contextDir, 'decisions', 'DEC-002.md');
        assert.strictEqual(fs.existsSync(adr2Path), true, 'DEC-002 deve existir antes do rollback');

        // Executa o rollback LIFO
        await executeRollback(tmpDir, undefined, { yes: true });

        // Valida que DEC-002 foi removido
        assert.strictEqual(fs.existsSync(adr2Path), false, 'DEC-002 deve ser deletado após rollback');

        // Valida que state.md foi restaurado
        const restoredState = fs.readFileSync(statePath, 'utf-8');
        assert.strictEqual(restoredState, originalState, 'state.md deve ser idêntico ao estado original');

        // Valida que o manifesto da transação alvo foi marcado como ROLLED_BACK
        const txPath = path.join(contextDir, '.pactx', 'transactions', `TX-${canonicalHash}.json`);
        const manifest: TransactionManifest = JSON.parse(fs.readFileSync(txPath, 'utf-8'));
        assert.strictEqual(manifest.status, 'ROLLED_BACK');

        // Valida que foi gerado um manifesto de transação de Rollback de Primeira Classe (P1-01)
        const allTxFiles = fs.readdirSync(path.join(contextDir, '.pactx', 'transactions'));
        const rollbackTxFile = allTxFiles.find(f => {
            if (!f.startsWith('TX-') || !f.endsWith('.json')) return false;
            try {
                const m = JSON.parse(fs.readFileSync(path.join(contextDir, '.pactx', 'transactions', f), 'utf-8'));
                return m.type === 'ROLLBACK';
            } catch { return false; }
        });
        assert.ok(rollbackTxFile, 'Deve existir um manifesto de transação com type === ROLLBACK');
        const rollbackManifest: TransactionManifest = JSON.parse(fs.readFileSync(path.join(contextDir, '.pactx', 'transactions', rollbackTxFile!), 'utf-8'));
        assert.strictEqual(rollbackManifest.status, 'COMMITTED');
        assert.deepStrictEqual(rollbackManifest.targetTxHashes, [canonicalHash]);

        // Valida que o ledger removeu a transação
        const ledger: HistoryLedger = JSON.parse(fs.readFileSync(path.join(contextDir, '.pactx', 'ledger.json'), 'utf-8'));
        assert.strictEqual(ledger.applied_updates.some(u => u.hash === canonicalHash), false);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Rollback Dry-Run: Exibe plano e encerra com 0 modificações no disco', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-rollback-dryrun-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_decisions:
  - id: "auto"
    title: "Decisão Dry Run"
    reason: "R"
    decision: "D"
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);
        applyMutationPlan(tmpDir, plan);

        const adr2Path = path.join(contextDir, 'decisions', 'DEC-002.md');
        assert.strictEqual(fs.existsSync(adr2Path), true);

        // Executa rollback com --dry-run
        await executeRollback(tmpDir, undefined, { dryRun: true });

        // Garante que o arquivo ainda existe e status permanece COMMITTED
        assert.strictEqual(fs.existsSync(adr2Path), true, 'DEC-002 deve continuar existindo');
        const txPath = path.join(contextDir, '.pactx', 'transactions', `TX-${canonicalHash}.json`);
        const manifest: TransactionManifest = JSON.parse(fs.readFileSync(txPath, 'utf-8'));
        assert.strictEqual(manifest.status, 'COMMITTED');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Rollback Graph-Safe: Bloqueia reversão com dependência ativa e permite com --force-cascade', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-rollback-graph-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');

        // Mutação 1: Cria REQ-002
        const p1 = parseAndValidateUpdate(`
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "security"
    title: "Auditoria Imutável"
    statement: "Statement"
\`\`\`
`);
        applyMutationPlan(tmpDir, buildMutationPlan(tmpDir, p1.payload, p1.canonicalHash));

        // Mutação 2: Cria DEC-002 com satisfies: ["REQ-002"]
        const p2 = parseAndValidateUpdate(`
\`\`\`pactx-update
version: "1.1"
new_decisions:
  - id: "auto"
    title: "ADR Vinculado"
    reason: "R"
    decision: "D"
    satisfies: ["REQ-002"]
\`\`\`
`);
        applyMutationPlan(tmpDir, buildMutationPlan(tmpDir, p2.payload, p2.canonicalHash));

        // Tenta reverter TX 1 (REQ-002) sem --force-cascade
        await assert.rejects(async () => {
            await executeRollback(tmpDir, p1.canonicalHash, { yes: true });
        }, /Subsequent decision DEC-002 satisfies requirement REQ-002/);

        // Reverte TX 1 com --force-cascade
        await executeRollback(tmpDir, p1.canonicalHash, { yes: true, forceCascade: true });

        // Valida que DEC-002 foi deletado e REQ-002 foi revertido em requirements.md
        assert.strictEqual(fs.existsSync(path.join(contextDir, 'decisions', 'DEC-002.md')), false);
        const reqContent = fs.readFileSync(path.join(contextDir, 'requirements.md'), 'utf-8');
        assert.strictEqual(reqContent.includes('Auditoria Imutável'), false);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('P1-A Guard: pactx rollback é bloqueado quando há transação RECOVERY_REQUIRED ou FAILED', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-rollback-guard-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');

        // Cria uma transação válida COMMITTED
        const p1 = parseAndValidateUpdate(`
\`\`\`pactx-update
version: "1.1"
state:
  active_task: "Initial Task"
\`\`\`
`);
        applyMutationPlan(tmpDir, buildMutationPlan(tmpDir, p1.payload, p1.canonicalHash));

        // Injeta uma transação falha com status RECOVERY_REQUIRED
        const badTxHash = 'failed_tx_abc123';
        const badManifest: TransactionManifest = {
            txHash: badTxHash,
            status: 'RECOVERY_REQUIRED',
            type: 'APPLY',
            recoveryAttempts: 1,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev1',
            snapshot: [],
            createdFiles: [],
            plan: {} as any,
        };
        fs.writeFileSync(path.join(transactionsDir, `TX-${badTxHash}.json`), JSON.stringify(badManifest, null, 2), 'utf-8');

        // Tentativa de rollback DEVE ser bloqueada
        await assert.rejects(async () => {
            await executeRollback(tmpDir, undefined, { yes: true });
        }, /Repository blocked: Transaction TX-failed_tx_abc123 requires recovery \(Status: RECOVERY_REQUIRED\)\. Run 'pactx doctor --fix' before rolling back\./);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

