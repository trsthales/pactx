import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { parseAndValidateUpdate } from '../src/update/parser';
import { buildMutationPlan } from '../src/update/planner';
import { applyMutationPlan } from '../src/update/applier';

test('Update Pipeline: Caminho Feliz Completo & Transação', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-update-test-'));

    try {
        initProject(tmpDir);

        const validPayload = `
\`\`\`pactx-update
version: "1.0"
state:
  active_task: "TK-02 Auth Guard"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items:
    - "Criado interceptor HTTP"
  new_facts:
    - "Proxy reverso remove o cabeçalho Authorization"
  rejected_hypotheses:
    - "Erro 403 não era CORS"
  next_action: "Implementar mutex no refresh token"
new_decisions:
  - id: "auto"
    title: "Isolamento de banco por Tenant"
    reason: "Privacidade LGPD"
    decision: "Banco SQLite isolado por escola"
superseded_decisions:
  - id: "DEC-001"
    by: "auto"
    reason: "Substituída pelo novo modelo"
new_glossary_terms:
  - term: "TenantContext"
    definition: "Contexto de tenant na thread"
\`\`\`
`;

        const { payload, canonicalHash } = parseAndValidateUpdate(validPayload);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);

        assert.strictEqual(plan.operations.createdAdrs[0].id, 'DEC-002');
        assert.strictEqual(plan.operations.supersededAdrs[0].supersededBy, 'DEC-002');

        applyMutationPlan(tmpDir, plan);

        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-002.md')), true);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', '.pactx-history.json')), true);

        const stateContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'state.md'), 'utf-8');
        assert.match(stateContent, /TK-02 Auth Guard/);
        assert.match(stateContent, /Proxy reverso remove o cabeçalho Authorization/);

        const dec1Content = fs.readFileSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-001.md'), 'utf-8');
        assert.match(dec1Content, /status:\s*superseded/);
        assert.match(dec1Content, /superseded_by:\s*DEC-002/);

        // Idempotência
        const plan2 = buildMutationPlan(tmpDir, payload, canonicalHash);
        assert.strictEqual(plan2.isAlreadyApplied, true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Validação Semântica: Rejeita supersede de ADR inexistente', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-nonexistent-'));

    try {
        initProject(tmpDir);

        const payload = `
\`\`\`pactx-update
version: "1.0"
superseded_decisions:
  - id: "DEC-999"
    by: "DEC-001"
    reason: "Teste"
\`\`\`
`;
        const { payload: parsed, canonicalHash } = parseAndValidateUpdate(payload);
        assert.throws(() => {
            buildMutationPlan(tmpDir, parsed, canonicalHash);
        }, /Decisão para substituição não encontrada/);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Validação Semântica: Rejeita ambiguidade em by: auto', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-ambiguity-'));

    try {
        initProject(tmpDir);

        const payload = `
\`\`\`pactx-update
version: "1.0"
new_decisions:
  - id: "auto"
    title: "Decisão 1"
    reason: "R1"
    decision: "D1"
  - id: "auto"
    title: "Decisão 2"
    reason: "R2"
    decision: "D2"
superseded_decisions:
  - id: "DEC-001"
    by: "auto"
    reason: "Ambiguidade"
\`\`\`
`;
        const { payload: parsed, canonicalHash } = parseAndValidateUpdate(payload);
        assert.throws(() => {
            buildMutationPlan(tmpDir, parsed, canonicalHash);
        }, /Ambiguidade em superseded_decisions/);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Validação de Concorrência Otimista: Detecta Stale Context', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-stale-'));

    try {
        initProject(tmpDir);

        const payload = `
\`\`\`pactx-update
version: "1.0"
base_revision: "stale99"
state:
  active_task: "TK-03"
\`\`\`
`;
        const { payload: parsed, canonicalHash } = parseAndValidateUpdate(payload);
        const plan = buildMutationPlan(tmpDir, parsed, canonicalHash);
        assert.strictEqual(plan.warnings.some(w => w.includes('Stale Context')), true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});