import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { findContextDir, findProjectRoot } from '../src/utils/contextFinder';
import { ensureStorageLayout } from '../src/update/migration';
import { parseAndValidateUpdate } from '../src/update/parser';
import { buildMutationPlan } from '../src/update/planner';
import { applyMutationPlan } from '../src/update/applier';
import { composeContext } from '../src/composer';

test('Root Discovery: Localiza .ai-context e project root a partir de subpastas profundas', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-discovery-'));
    try {
        initProject(tmpDir);

        const deepDir = path.join(tmpDir, 'src', 'modules', 'auth', 'guards', 'nested');
        fs.mkdirSync(deepDir, { recursive: true });

        const contextDir = findContextDir(deepDir);
        const projectRoot = findProjectRoot(deepDir);

        assert.strictEqual(contextDir, path.join(tmpDir, '.ai-context'));
        assert.strictEqual(projectRoot, tmpDir);

        // Testa composeContext chamado diretamente da subpasta
        const packed = composeContext(deepDir);
        assert.match(packed, /### 1\. PROJECT & INVARIANTS/);
        assert.match(packed, /### 2\. REQUIREMENTS & BUSINESS RULES/);
        assert.match(packed, /### 3\. CURRENT STATE & ACTIVE TASK/);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Root Discovery: Lança erro acionável quando executado fora de um projeto pactx', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-no-context-'));
    try {
        assert.throws(() => {
            findContextDir(tmpDir);
        }, /\.ai-context folder not found in this repository\. Run 'pactx init' to initialize\./);

        assert.throws(() => {
            findProjectRoot(tmpDir);
        }, /\.ai-context folder not found in this repository\. Run 'pactx init' to initialize\./);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Migração Transparente v0.2.x -> v0.3.0: Move .pactx-history.json para .pactx/ledger.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-migration-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const legacyHistoryFile = path.join(contextDir, '.pactx-history.json');
        const currentLedgerFile = path.join(contextDir, '.pactx', 'ledger.json');
        const transactionsDir = path.join(contextDir, '.pactx', 'transactions');

        // Cria histórico legado v0.2.x
        const legacyData = {
            version: '1.0',
            applied_updates: [
                {
                    hash: 'hash_legacy_001',
                    applied_at: '2026-08-20T10:00:00.000Z',
                    task: 'Task Legacy 1',
                    created_adrs: ['DEC-001'],
                    superseded_adrs: [],
                },
                {
                    hash: 'hash_legacy_002',
                    applied_at: '2026-08-21T12:00:00.000Z',
                    task: 'Task Legacy 2',
                    created_adrs: ['DEC-002'],
                    superseded_adrs: ['DEC-001'],
                },
            ],
        };
        fs.writeFileSync(legacyHistoryFile, JSON.stringify(legacyData, null, 2), 'utf-8');

        // Garante que o ledger v0.3 e transactions ainda não existem
        if (fs.existsSync(currentLedgerFile)) fs.unlinkSync(currentLedgerFile);

        // Executa a migração de layout
        ensureStorageLayout(contextDir);

        // Validações
        assert.strictEqual(fs.existsSync(legacyHistoryFile), false, 'Arquivo legado deve ser removido');
        assert.strictEqual(fs.existsSync(currentLedgerFile), true, 'Arquivo .pactx/ledger.json deve existir');
        assert.strictEqual(fs.existsSync(transactionsDir), true, 'Diretório .pactx/transactions deve existir');

        const migratedContent = JSON.parse(fs.readFileSync(currentLedgerFile, 'utf-8'));
        assert.strictEqual(migratedContent.version, '1.0');
        assert.strictEqual(migratedContent.applied_updates.length, 2);
        assert.strictEqual(migratedContent.applied_updates[0].hash, 'hash_legacy_001');
        assert.strictEqual(migratedContent.applied_updates[1].hash, 'hash_legacy_002');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Migração com Conflito de Layout Duplo: Deduplica por hash e ordena cronologicamente', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-dual-layout-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const pactxDir = path.join(contextDir, '.pactx');
        fs.mkdirSync(pactxDir, { recursive: true });

        const legacyHistoryFile = path.join(contextDir, '.pactx-history.json');
        const currentLedgerFile = path.join(pactxDir, 'ledger.json');

        // Histórico legado contém entradas A e B
        const legacyData = {
            version: '1.0',
            applied_updates: [
                {
                    hash: 'hash_A',
                    applied_at: '2026-08-20T10:00:00.000Z',
                    task: 'Task A',
                },
                {
                    hash: 'hash_B',
                    applied_at: '2026-08-22T10:00:00.000Z',
                    task: 'Task B (Legacy Version)',
                },
            ],
        };
        fs.writeFileSync(legacyHistoryFile, JSON.stringify(legacyData, null, 2), 'utf-8');

        // Histórico atual contém entradas B (duplicada) e C (mais recente)
        const currentData = {
            version: '1.0',
            applied_updates: [
                {
                    hash: 'hash_B',
                    applied_at: '2026-08-22T10:00:00.000Z',
                    task: 'Task B (Current Version)',
                },
                {
                    hash: 'hash_C',
                    applied_at: '2026-08-24T10:00:00.000Z',
                    task: 'Task C',
                },
            ],
        };
        fs.writeFileSync(currentLedgerFile, JSON.stringify(currentData, null, 2), 'utf-8');

        // Executa migração que deve resolver o conflito
        ensureStorageLayout(contextDir);

        // Valida que o legado foi removido
        assert.strictEqual(fs.existsSync(legacyHistoryFile), false);

        // Valida conteúdo consolidado
        const consolidated = JSON.parse(fs.readFileSync(currentLedgerFile, 'utf-8'));
        assert.strictEqual(consolidated.applied_updates.length, 3, 'Deve conter exatamente 3 entradas deduplicadas');
        assert.strictEqual(consolidated.applied_updates[0].hash, 'hash_A');
        assert.strictEqual(consolidated.applied_updates[1].hash, 'hash_B');
        assert.strictEqual(consolidated.applied_updates[2].hash, 'hash_C');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Limpeza de Lock Legado: Remove .ai-context/.pactx.lock órfão na raiz durante migração', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-legacy-lock-'));
    try {
        initProject(tmpDir);
        const contextDir = path.join(tmpDir, '.ai-context');
        const legacyLockFile = path.join(contextDir, '.pactx.lock');

        // Cria lock legado antigo (>30s)
        fs.writeFileSync(legacyLockFile, JSON.stringify({ pid: 99999, time: Date.now() - 40000 }), 'utf-8');
        // Define mtime antigo
        const pastTime = (Date.now() - 40000) / 1000;
        fs.utimesSync(legacyLockFile, pastTime, pastTime);

        ensureStorageLayout(contextDir);

        assert.strictEqual(fs.existsSync(legacyLockFile), false, 'Lockfile legado deve ser limpo');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Pipeline Completo em Subpasta: MutationPlan e Applier funcionam transparentemente a partir de subdiretório', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-subfolder-pipeline-'));
    try {
        initProject(tmpDir);
        const subDir = path.join(tmpDir, 'src', 'components');
        fs.mkdirSync(subDir, { recursive: true });

        const projectRoot = findProjectRoot(subDir);
        assert.strictEqual(projectRoot, tmpDir);

        const payloadText = `
\`\`\`pactx-update
version: "1.0"
state:
  active_task: "Subfolder Update"
  status: "IN_PROGRESS"
new_decisions:
  - id: "auto"
    title: "Decisão criada a partir de subpasta"
    reason: "Teste de path discovery"
    decision: "Tudo resolvido via projectRoot"
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(projectRoot, payload, canonicalHash);

        assert.strictEqual(plan.operations.createdAdrs[0].id, 'DEC-002');
        applyMutationPlan(projectRoot, plan);

        // Valida que o arquivo foi gravado corretamente na raiz do projeto
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-002.md')), true);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', '.pactx', 'ledger.json')), true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('P2-06 Containment: findContextDir não sobe além da raiz do repositório Git', () => {
    const parentTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-parent-'));
    try {
        // Inicializa .ai-context no diretório pai (ex: /home/user/.ai-context)
        initProject(parentTmpDir);
        assert.strictEqual(fs.existsSync(path.join(parentTmpDir, '.ai-context')), true);

        // Cria um subdiretório que é um repositório Git independente
        const childGitRepo = path.join(parentTmpDir, 'isolated-git-project');
        fs.mkdirSync(childGitRepo, { recursive: true });

        // Simula repositório git inicializado com git init via child_process
        const { execFileSync } = require('node:child_process');
        try {
            execFileSync('git', ['init'], { cwd: childGitRepo, stdio: 'ignore' });
        } catch {
            // Se git CLI não estiver disponível, cria pasta .git
            fs.mkdirSync(path.join(childGitRepo, '.git'), { recursive: true });
        }

        const nestedSubDir = path.join(childGitRepo, 'src', 'nested');
        fs.mkdirSync(nestedSubDir, { recursive: true });

        // A busca a partir de nestedSubDir deve parar em childGitRepo e NÃO capturar parentTmpDir/.ai-context
        assert.throws(() => {
            findContextDir(nestedSubDir);
        }, /\.ai-context folder not found in this repository\. Run 'pactx init' to initialize\./);

    } finally {
        fs.rmSync(parentTmpDir, { recursive: true, force: true });
    }
});
