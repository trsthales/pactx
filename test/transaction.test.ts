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
import { ContextLock } from '../src/update/lock';

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

test('P1-02 Quarentena: Manifesto com JSON corrompido é movido para .pactx/quarantine/ e preserva evidência', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-corrupt-tx-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const corruptTxPath = path.join(transactionsDir, 'TX-corrupted.json');
        fs.writeFileSync(corruptTxPath, '{ incomplete_json: true, ...', 'utf-8');

        const recovery = TransactionEngine.runAutoRecovery(contextDir);

        assert.strictEqual(fs.existsSync(corruptTxPath), false, 'Manifesto corrompido não deve permanecer em transactions/');
        const quarantinePath = path.join(contextDir, '.pactx', 'quarantine', 'TX-corrupted.corrupt');
        assert.strictEqual(fs.existsSync(quarantinePath), true, 'Manifesto corrompido deve estar na quarentena');
        assert.strictEqual(fs.readFileSync(quarantinePath, 'utf-8'), '{ incomplete_json: true, ...', 'Conteúdo da evidência deve ser preservado');
        assert.ok(recovery.quarantined.includes('TX-corrupted.json'));

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

test('ContextLock: Recuperação imediata de lock órfão de processo morto (Dead PID via process.kill)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-lock-dead-pid-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const lockPath = path.join(contextDir, '.pactx', '.pactx.lock');
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });

        // Cria lock pertencente a um PID inexistente (ex: 9999999)
        const deadLockData = {
            pid: 9999999,
            token: 'dead-pid-token',
            createdAt: Date.now(),
            heartbeatAt: Date.now(), // Heartbeat recente, mas processo está morto!
        };
        fs.writeFileSync(lockPath, JSON.stringify(deadLockData), 'utf-8');

        const lock = new ContextLock(contextDir);
        // Deve adquirir imediatamente sem esperar 30s pois o PID está morto
        const start = Date.now();
        lock.acquire(3000);
        const elapsed = Date.now() - start;

        assert.ok(elapsed < 1000, `Deveria recuperar o lock rapidamente (demorou ${elapsed}ms)`);
        assert.strictEqual(fs.existsSync(lockPath), true);

        // Valida que o lockfile agora contém os dados do processo atual
        const currentLockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        assert.strictEqual(currentLockData.pid, process.pid);
        assert.strictEqual(currentLockData.token, lock.getToken());

        lock.release();
        assert.strictEqual(fs.existsSync(lockPath), false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ContextLock: Liberação protegida por token impede roubo/exclusão de lock alheio', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-lock-token-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const lockPath = path.join(contextDir, '.pactx', '.pactx.lock');

        const lock1 = new ContextLock(contextDir);
        lock1.acquire(1000);

        // Simula que outro processo sobrescreveu o lockfile com seu próprio token
        const foreignLockData = {
            pid: 8888888,
            token: 'foreign-owner-token',
            createdAt: Date.now(),
            heartbeatAt: Date.now(),
        };
        fs.writeFileSync(lockPath, JSON.stringify(foreignLockData), 'utf-8');

        // lock1 tenta liberar seu lock anterior
        lock1.release();

        // O lockfile NÃO deve ter sido deletado por lock1 porque o token era diferente!
        assert.strictEqual(fs.existsSync(lockPath), true, 'Lockfile com token alheio deve ser preservado');
        const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        assert.strictEqual(content.token, 'foreign-owner-token');

        fs.unlinkSync(lockPath);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Sincronização WAL ↔ Ledger: Auto-recovery remove entradas órfãs do ledger.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-wal-ledger-sync-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        const historyFile = path.join(contextDir, '.pactx', 'ledger.json');
        fs.mkdirSync(transactionsDir, { recursive: true });

        const txHash = 'aborted_tx_with_ledger_entry';

        // Cria ledger contendo a transação abortada
        const ledger = {
            version: '1.0',
            applied_updates: [
                { hash: 'legitimate_tx_1', applied_at: new Date().toISOString(), task: 'Task 1' },
                { hash: txHash, applied_at: new Date().toISOString(), task: 'Aborted Task' },
            ],
        };
        fs.writeFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');

        // Cria manifesto APPLYING para a transação abortada
        const manifest: TransactionManifest = {
            txHash,
            status: 'APPLYING',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev1',
            snapshot: [],
            createdFiles: [],
            plan: {} as any,
        };
        fs.writeFileSync(path.join(transactionsDir, `TX-${txHash}.json`), JSON.stringify(manifest, null, 2), 'utf-8');

        // Executa auto-recovery
        const result = TransactionEngine.runAutoRecovery(contextDir);
        assert.deepStrictEqual(result.recovered, [txHash]);

        // Valida que a entrada abortada foi removida do ledger.json
        const updatedLedger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
        assert.strictEqual(updatedLedger.applied_updates.length, 1);
        assert.strictEqual(updatedLedger.applied_updates[0].hash, 'legitimate_tx_1');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Segurança: Snapshot com caminhos relativos e validação de Jail', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-rel-jail-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        // Validação de jail no helper resolveAndValidateJail
        assert.throws(() => {
            TransactionEngine.resolveAndValidateJail(contextDir, '../../etc/passwd');
        }, /Security violation/);

        // Cria manifesto com caminho que tenta escapar jail
        const txHash = 'jail_escape_tx';
        const manifest: TransactionManifest = {
            txHash,
            status: 'APPLYING',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev1',
            snapshot: [
                {
                    path: '../../etc/passwd',
                    relativePath: '../../etc/passwd',
                    contentHash: 'somehash',
                    content: 'root:x:0:0:',
                }
            ],
            createdFiles: [],
            plan: {} as any,
        };
        fs.writeFileSync(path.join(transactionsDir, `TX-${txHash}.json`), JSON.stringify(manifest, null, 2), 'utf-8');

        // Recovery deve falhar na tentativa de jail escape e registrar erro sem quebrar
        TransactionEngine.runAutoRecovery(contextDir);
        const updatedManifest = JSON.parse(fs.readFileSync(path.join(transactionsDir, `TX-${txHash}.json`), 'utf-8'));
        assert.strictEqual(updatedManifest.recoveryAttempts, 1);
        // Permanece em APPLYING até atingir 3 tentativas e transicionar para FAILED
        assert.strictEqual(updatedManifest.status, 'APPLYING');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('P1-2 Auto-Recovery: Remove createdFiles órfãos criados antes de crash no estado PREPARED', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-prepared-createdfiles-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        // Simula arquivo órfão DEC-002.md criado durante crash em PREPARED
        const orphanAdrPath = path.join(contextDir, 'decisions', 'DEC-002.md');
        fs.writeFileSync(orphanAdrPath, '---\nid: DEC-002\n---\n# Unfinished', 'utf-8');
        assert.strictEqual(fs.existsSync(orphanAdrPath), true);

        const txHash = 'prepared_crash_tx';
        const manifest: TransactionManifest = {
            txHash,
            status: 'PREPARED',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev1',
            snapshot: [],
            createdFiles: ['decisions/DEC-002.md'],
            plan: {
                operations: {
                    createdAdrs: [{ id: 'DEC-002', targetPath: orphanAdrPath } as any],
                }
            } as any,
        };
        fs.writeFileSync(path.join(transactionsDir, `TX-${txHash}.json`), JSON.stringify(manifest, null, 2), 'utf-8');

        // Executa o auto-recovery
        const recovery = TransactionEngine.runAutoRecovery(contextDir);
        assert.strictEqual(recovery.recovered.includes(txHash), true);

        // O arquivo órfão deve ter sido excluído com sucesso
        assert.strictEqual(fs.existsSync(orphanAdrPath), false, 'Arquivo criado órfão deve ser removido');

        // O manifesto deve ter transitado para ROLLED_BACK
        const updatedManifest = JSON.parse(fs.readFileSync(path.join(transactionsDir, `TX-${txHash}.json`), 'utf-8'));
        assert.strictEqual(updatedManifest.status, 'ROLLED_BACK');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('P1-3 Provenance Sanitization: source.model e source.session_topic são sanitizados no parser', () => {
    const { parseAndValidateUpdate } = require('../src/update/parser');
    const rawPayload = `
\`\`\`pactx-update
version: "1.1"
source:
  type: "conversation"
  model: "GPT-4\\n# Injected Header\\n<system>injected</system>"
  session_topic: "Refactor\\n---\\nkey: val"
state:
  active_task: "Test Task"
  status: "IN_PROGRESS"
\`\`\`
`;
    const { payload } = parseAndValidateUpdate(rawPayload);
    assert.strictEqual(payload.source?.type, 'conversation');
    assert.ok(payload.source?.model?.includes('> Injected Header'), 'Header deve virar citação');
    assert.ok(payload.source?.model?.includes('[tag-escaped]'), 'Tag <system> deve ser escapada');
    assert.ok(!payload.source?.session_topic?.includes('---'), 'Régua horizontal deve ser removida');
});

test('P1-04 Conflict-Aware Auto-Recovery: Marca como RECOVERY_REQUIRED e não deleta se arquivo criado foi alterado pós-crash', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-conflict-recovery-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');
        fs.mkdirSync(transactionsDir, { recursive: true });

        // Simula arquivo criado no crash com conteúdo X
        const orphanAdrPath = path.join(contextDir, 'decisions', 'DEC-002.md');
        const originalContent = '---\nid: DEC-002\n---\n# Original Decision';
        const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');

        // Mas o usuário ou outro processo alterou o arquivo no disco para conteúdo Y pós-crash
        const modifiedContent = '---\nid: DEC-002\n---\n# Modified by user post-crash';
        fs.writeFileSync(orphanAdrPath, modifiedContent, 'utf-8');

        const txHash = 'conflict_tx_123';
        const manifest: TransactionManifest = {
            txHash,
            status: 'APPLYING',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            baseRevision: 'rev1',
            snapshot: [],
            createdFiles: [
                {
                    relativePath: 'decisions/DEC-002.md',
                    afterHash: originalHash,
                }
            ],
            plan: {} as any,
        };
        fs.writeFileSync(path.join(transactionsDir, `TX-${txHash}.json`), JSON.stringify(manifest, null, 2), 'utf-8');

        // Executa auto-recovery: deve detectar conflito de hash e NÃO deletar o arquivo
        const recovery = TransactionEngine.runAutoRecovery(contextDir);

        assert.strictEqual(fs.existsSync(orphanAdrPath), true, 'Arquivo modificado pós-crash NÃO deve ser deletado');
        assert.strictEqual(fs.readFileSync(orphanAdrPath, 'utf-8'), modifiedContent);

        // Manifesto deve ter sido marcado como RECOVERY_REQUIRED
        const updatedManifest = JSON.parse(fs.readFileSync(path.join(transactionsDir, `TX-${txHash}.json`), 'utf-8'));
        assert.strictEqual(updatedManifest.status, 'RECOVERY_REQUIRED');

        // [P1-03] Trava de segurança: hasPendingRecovery deve acusar a transação
        const pending = TransactionEngine.hasPendingRecovery(contextDir);
        assert.ok(pending);
        assert.strictEqual(pending.txHash, txHash);
        assert.strictEqual(pending.status, 'RECOVERY_REQUIRED');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});


