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
base_revision: "a7f3b8"
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

        // Validações pós-commit no disco
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-002.md')), true);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', '.pactx-history.json')), true);

        const stateContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'state.md'), 'utf-8');
        assert.match(stateContent, /TK-02 Auth Guard/);
        assert.match(stateContent, /Proxy reverso remove o cabeçalho Authorization/);
        assert.match(stateContent, /Erro 403 não era CORS/);

        const dec1Content = fs.readFileSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-001.md'), 'utf-8');
        assert.match(dec1Content, /status:\s*superseded/);
        assert.match(dec1Content, /superseded_by:\s*DEC-002/);

        // Teste de Idempotência: re-planejar o mesmo hash deve acusar isAlreadyApplied = true
        const plan2 = buildMutationPlan(tmpDir, payload, canonicalHash);
        assert.strictEqual(plan2.isAlreadyApplied, true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Security Jail: Bloqueio de Path Traversal', () => {
    const maliciousPayload = `
\`\`\`pactx-update
version: "1.0"
new_decisions:
  - id: "../../etc/passwd"
    title: "Ataque"
    reason: "Teste"
    decision: "Teste"
\`\`\`
`;

    assert.throws(() => {
        parseAndValidateUpdate(maliciousPayload);
    }, /Identificador de decisão inválido/);
});