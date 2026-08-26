import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { initProject } from '../src/init';
import { parseAndValidateUpdate } from '../src/update/parser';
import { buildMutationPlan } from '../src/update/planner';
import { applyMutationPlan } from '../src/update/applier';
import { TransactionEngine } from '../src/update/transaction';
import { TransactionManifest } from '../src/update/types';

test('WAL Lifecycle: Persiste manifesto TX em PREPARED -> APPLYING -> COMMITTED com checksums', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-wal-lifecycle-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');

        const payloadText = `
\`\`\`pactx-update
version: "1.0"
state:
  active_task: "TK-WAL-01"
  status: "IN_PROGRESS"
new_decisions:
  - id: "auto"
    title: "Decisão com WAL"
    reason: "Garantir durabilidade"
    decision: "Usar TransactionEngine"
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);

        applyMutationPlan(tmpDir, plan);

        const txPath = path.join(transactionsDir, `TX-${canonicalHash}.json`);
        assert.strictEqual(fs.existsSync(txPath), true, 'Manifesto TX deve existir');

        const manifest: TransactionManifest = JSON.parse(fs.readFileSync(txPath, 'utf-8'));
        assert.strictEqual(manifest.txHash, canonicalHash);
        assert.strictEqual(manifest.status, 'COMMITTED');
        assert.strictEqual(manifest.recoveryAttempts, 0);
        assert.strictEqual(typeof manifest.createdAt, 'string');
        assert.strictEqual(typeof manifest.baseRevision, 'string');
        assert.ok(manifest.snapshot.length > 0, 'Snapshot deve conter arquivos');

        // Valida checksums SHA-256 no snapshot
        for (const item of manifest.snapshot) {
            if (item.content !== null) {
                const expectedHash = crypto.createHash('sha256').update(item.content).digest('hex');
                assert.strictEqual(item.contentHash, expectedHash, `Checksum deve bater para ${item.path}`);
            } else {
                assert.strictEqual(item.contentHash, '', `contentHash deve ser vazio para arquivo novo ${item.path}`);
            }
        }

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Auto-Recovery após Crash: Restaura snapshot e remove arquivos criados de transação em APPLYING', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-wal-recovery-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const statePath = path.join(contextDir, 'state.md');
        const originalState = fs.readFileSync(statePath, 'utf-8');
        const originalStateHash = crypto.createHash('sha256').update(originalState).digest('hex');

        const adr2Path = path.join(contextDir, 'decisions', 'DEC-002.md');

        // Cria manifesto simulando transação que caiu em APPLYING
        const txHash = 'crash_tx_001';
        const manifest: TransactionManifest = {
            txHash,
            status: 'APPLYING',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev123',
            snapshot: [
                {
                    path: statePath,
                    contentHash: originalStateHash,
                    content: originalState,
                },
                {
                    path: adr2Path,
                    contentHash: '',
                    content: null, // não existia antes
                }
            ],
            createdFiles: [adr2Path],
            plan: {} as any,
        };

        const txPath = path.join(transactionsDir, `TX-${txHash}.json`);
        fs.writeFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');

        // Simula corrupção de arquivos no crash
        fs.writeFileSync(statePath, 'CORRUPTED STATE CONTENT DURING CRASH', 'utf-8');
        fs.writeFileSync(adr2Path, 'PARTIALLY WRITTEN ADR 2', 'utf-8');

        // Executa auto-recovery
        const result = TransactionEngine.runAutoRecovery(contextDir);
        assert.deepStrictEqual(result.recovered, [txHash]);

        // Valida que state.md foi restaurado perfeitamente
        const restoredState = fs.readFileSync(statePath, 'utf-8');
        assert.strictEqual(restoredState, originalState);

        // Valida que DEC-002.md foi deletado
        assert.strictEqual(fs.existsSync(adr2Path), false, 'Arquivo criado deve ter sido deletado no rollback');

        // Valida que o status foi atualizado para ROLLED_BACK
        const updatedManifest: TransactionManifest = JSON.parse(fs.readFileSync(txPath, 'utf-8'));
        assert.strictEqual(updatedManifest.status, 'ROLLED_BACK');
        assert.strictEqual(updatedManifest.recoveryAttempts, 1);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Anti-Loop em Recovery: Transiciona para FAILED na 3ª tentativa consecutiva', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-recovery-antiloop-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const txHash = 'loop_tx_999';
        const manifest: TransactionManifest = {
            txHash,
            status: 'APPLYING',
            recoveryAttempts: 2, // Já falhou 2 vezes
            createdAt: new Date().toISOString(),
            baseRevision: 'rev123',
            snapshot: [],
            createdFiles: [],
            plan: {} as any,
        };

        const txPath = path.join(transactionsDir, `TX-${txHash}.json`);
        fs.writeFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');

        // Executa auto-recovery (3ª tentativa)
        const result = TransactionEngine.runAutoRecovery(contextDir);
        assert.deepStrictEqual(result.failed, [txHash]);

        const updatedManifest: TransactionManifest = JSON.parse(fs.readFileSync(txPath, 'utf-8'));
        assert.strictEqual(updatedManifest.status, 'FAILED');
        assert.strictEqual(updatedManifest.recoveryAttempts, 3);

        // Executa novamente e garante que transações FAILED não são reprocessadas
        const nextResult = TransactionEngine.runAutoRecovery(contextDir);
        assert.strictEqual(nextResult.recovered.length, 0);
        assert.strictEqual(nextResult.failed.length, 0);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Crash durante PREPARED: Deleta com segurança arquivos de manifesto com JSON corrompido', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-corrupt-tx-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const corruptTxPath = path.join(transactionsDir, 'TX-corrupted.json');
        fs.writeFileSync(corruptTxPath, '{ incomplete_json: true, ...', 'utf-8');

        TransactionEngine.runAutoRecovery(contextDir);

        assert.strictEqual(fs.existsSync(corruptTxPath), false, 'Manifesto corrompido deve ter sido limpo');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Poda de Transações: Mantém os 50 manifestos mais recentes e remove transações com mais de 30 dias', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-pruning-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const now = Date.now();

        // 1. Cria 60 transações COMMITTED recentes (a cada 10 segundos)
        for (let i = 1; i <= 60; i++) {
            const manifest: TransactionManifest = {
                txHash: `hash_${i.toString().padStart(3, '0')}`,
                status: 'COMMITTED',
                recoveryAttempts: 0,
                createdAt: new Date(now - (60 - i) * 10000).toISOString(),
                baseRevision: 'rev',
                snapshot: [],
                createdFiles: [],
                plan: {} as any,
            };
            fs.writeFileSync(
                path.join(transactionsDir, `TX-${manifest.txHash}.json`),
                JSON.stringify(manifest, null, 2),
                'utf-8'
            );
        }

        // 2. Cria 1 transação antiga (>35 dias atrás)
        const oldManifest: TransactionManifest = {
            txHash: 'hash_ancient',
            status: 'COMMITTED',
            recoveryAttempts: 0,
            createdAt: new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString(),
            baseRevision: 'rev',
            snapshot: [],
            createdFiles: [],
            plan: {} as any,
        };
        fs.writeFileSync(
            path.join(transactionsDir, `TX-${oldManifest.txHash}.json`),
            JSON.stringify(oldManifest, null, 2),
            'utf-8'
        );

        // Executa a poda mantendo até 50 transações
        TransactionEngine.pruneTransactions(contextDir, 50, 30);

        const remainingFiles = fs.readdirSync(transactionsDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));
        assert.strictEqual(remainingFiles.length, 50, 'Deve manter exatamente 50 transações mais recentes');

        // A transação antiga deve ter sido podada
        assert.strictEqual(fs.existsSync(path.join(transactionsDir, 'TX-hash_ancient.json')), false);

        // As transações 1 a 10 (mais antigas do lote de 60) devem ter sido podadas
        assert.strictEqual(fs.existsSync(path.join(transactionsDir, 'TX-hash_001.json')), false);
        assert.strictEqual(fs.existsSync(path.join(transactionsDir, 'TX-hash_010.json')), false);

        // A transação 60 (mais recente) deve existir
        assert.strictEqual(fs.existsSync(path.join(transactionsDir, 'TX-hash_060.json')), true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
