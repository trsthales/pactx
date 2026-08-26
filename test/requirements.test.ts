import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { initProject } from '../src/init';
import { parseAndValidateUpdate } from '../src/update/parser';
import { buildMutationPlan } from '../src/update/planner';
import { applyMutationPlan } from '../src/update/applier';

test('Requirements: Criação e Numeração Automática (REQ-%03d) em requirements.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-req-creation-'));
    try {
        const contextDir = path.join(tmpDir, '.ai-context');
        fs.mkdirSync(contextDir, { recursive: true });

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "security"
    title: "Multi-tenant Data Isolation"
    statement: "O sistema deve isolar dados de alunos estritamente por escola para conformidade com a LGPD."
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);

        assert.strictEqual(plan.operations.createdRequirements.length, 1);
        assert.strictEqual(plan.operations.createdRequirements[0].id, 'REQ-001');
        assert.strictEqual(plan.operations.createdRequirements[0].type, 'security');

        applyMutationPlan(tmpDir, plan);

        const reqPath = path.join(contextDir, 'requirements.md');
        assert.strictEqual(fs.existsSync(reqPath), true, 'requirements.md deve existir');

        const raw = fs.readFileSync(reqPath, 'utf-8');
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        assert.ok(match, 'Deve possuir frontmatter YAML válido');

        const data = yaml.parse(match[1]);
        assert.strictEqual(data.spec_version, '1.0');
        assert.strictEqual(data.requirements.length, 1);
        assert.strictEqual(data.requirements[0].id, 'REQ-001');
        assert.strictEqual(data.requirements[0].type, 'security');
        assert.strictEqual(data.requirements[0].title, 'Multi-tenant Data Isolation');

        assert.match(match[2], /### \[REQ-001\] Multi-tenant Data Isolation/);
        assert.match(match[2], /O sistema deve isolar dados de alunos/);

        // Aplica um segundo requisito auto e valida REQ-002
        const payloadText2 = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "functional"
    title: "Student PIN Login"
    statement: "Alunos devem se autenticar com PIN."
\`\`\`
`;
        const parsed2 = parseAndValidateUpdate(payloadText2);
        const plan2 = buildMutationPlan(tmpDir, parsed2.payload, parsed2.canonicalHash);

        assert.strictEqual(plan2.operations.createdRequirements[0].id, 'REQ-002');
        applyMutationPlan(tmpDir, plan2);

        const raw2 = fs.readFileSync(reqPath, 'utf-8');
        const match2 = raw2.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        const data2 = yaml.parse(match2![1]);
        assert.strictEqual(data2.requirements.length, 2);
        assert.strictEqual(data2.requirements[0].id, 'REQ-001');
        assert.strictEqual(data2.requirements[1].id, 'REQ-002');
        assert.match(match2![2], /### \[REQ-001\] Multi-tenant Data Isolation/);
        assert.match(match2![2], /### \[REQ-002\] Student PIN Login/);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Requirements: Semântica de Patch preserva requisitos existentes não mencionados', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-req-patch-'));
    try {
        initProject(tmpDir); // Cria REQ-001 padrão
        const contextDir = path.join(tmpDir, '.ai-context');
        const reqPath = path.join(contextDir, 'requirements.md');

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "performance"
    title: "Cache Layer"
    statement: "Redis para sessões ativas."
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);
        applyMutationPlan(tmpDir, plan);

        const raw = fs.readFileSync(reqPath, 'utf-8');
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        const data = yaml.parse(match![1]);

        assert.strictEqual(data.requirements.length, 2);
        assert.strictEqual(data.requirements[0].id, 'REQ-001');
        assert.strictEqual(data.requirements[1].id, 'REQ-002');

        // Valida que o statement do REQ-001 preexistente foi preservado
        assert.match(match![2], /### \[REQ-001\] Initial System Requirement/);
        assert.match(match![2], /Define the core capabilities and functional requirements/);
        assert.match(match![2], /### \[REQ-002\] Cache Layer/);
        assert.match(match![2], /Redis para sessões ativas\./);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Requirements: Vínculo Bidirecional satisfies nos ADRs ⇄ satisfied_by nos Requisitos', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-req-satisfies-'));
    try {
        initProject(tmpDir); // Cria REQ-001 e DEC-001
        const contextDir = path.join(tmpDir, '.ai-context');
        const reqPath = path.join(contextDir, 'requirements.md');

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "compliance"
    title: "Audit Trail Invariance"
    statement: "Logs devem ser append-only."
new_decisions:
  - id: "auto"
    title: "Write-Ahead Logging Engine"
    reason: "Atender REQ-002"
    decision: "Diário persistido em .pactx/transactions"
    satisfies: ["REQ-002"]
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);

        assert.strictEqual(plan.operations.createdRequirements[0].id, 'REQ-002');
        assert.strictEqual(plan.operations.createdAdrs[0].id, 'DEC-002');
        assert.deepStrictEqual(plan.operations.createdAdrs[0].satisfies, ['REQ-002']);

        applyMutationPlan(tmpDir, plan);

        // Valida ADR criado com satisfies no frontmatter
        const adr2Path = path.join(contextDir, 'decisions', 'DEC-002.md');
        const adr2Raw = fs.readFileSync(adr2Path, 'utf-8');
        const adr2Fm = yaml.parse(adr2Raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
        assert.deepStrictEqual(adr2Fm.satisfies, ['REQ-002']);

        // Valida requirements.md com satisfied_by atualizado para DEC-002
        const reqRaw = fs.readFileSync(reqPath, 'utf-8');
        const reqFm = yaml.parse(reqRaw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
        const req2 = reqFm.requirements.find((r: any) => r.id === 'REQ-002');
        assert.ok(req2, 'REQ-002 deve existir no frontmatter');
        assert.deepStrictEqual(req2.satisfied_by, ['DEC-002']);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Requirements P1-12: Fail-Closed no planner quando satisfies aponta para requisito inexistente', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-req-failclosed-'));
    try {
        initProject(tmpDir);

        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_decisions:
  - id: "auto"
    title: "Decision with Orphan Satisfies"
    reason: "Teste de Fail-Closed"
    decision: "Decisão tomada"
    satisfies: ["REQ-999"]
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        assert.throws(() => {
            buildMutationPlan(tmpDir, payload, canonicalHash);
        }, /Validation Error: Requirement "REQ-999" referenced in 'satisfies' does not exist in repository or current batch\./);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Requirements P1-11: Sincronização bidirecional estrita no supersede de ADRs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-req-supersede-sync-'));
    try {
        initProject(tmpDir); // Cria REQ-001 e DEC-001 (DEC-001 satisfies REQ-001)
        const contextDir = path.join(tmpDir, '.ai-context');
        const reqPath = path.join(contextDir, 'requirements.md');
        const dec1Path = path.join(contextDir, 'decisions', 'DEC-001.md');

        // Cria nova decisão DEC-002 que substitui DEC-001
        const payloadText = `
\`\`\`pactx-update
version: "1.1"
new_decisions:
  - id: "auto"
    title: "Updated Storage Architecture"
    reason: "Substituir DEC-001 com modelo otimizado"
    decision: "Nova arquitetura com cache"
superseded_decisions:
  - id: "DEC-001"
    by: "auto"
    reason: "Substituída pela nova arquitetura"
\`\`\`
`;
        const { payload, canonicalHash } = parseAndValidateUpdate(payloadText);
        const plan = buildMutationPlan(tmpDir, payload, canonicalHash);

        // O planner deve ter identificado que DEC-001 satisfazia REQ-001 e planejado a migração
        assert.strictEqual(plan.operations.createdAdrs[0].id, 'DEC-002');
        assert.deepStrictEqual(plan.operations.createdAdrs[0].satisfies, ['REQ-001']);

        const reqOp = plan.operations.updatedRequirements.find(u => u.id === 'REQ-001');
        assert.ok(reqOp, 'REQ-001 deve constar em updatedRequirements');
        assert.deepStrictEqual(reqOp.satisfiedByRemove, ['DEC-001']);
        assert.deepStrictEqual(reqOp.satisfiedByAdd, ['DEC-002']);

        applyMutationPlan(tmpDir, plan);

        // Valida que requirements.md foi atualizado: DEC-001 removido e DEC-002 adicionado
        const reqRaw = fs.readFileSync(reqPath, 'utf-8');
        const reqFm = yaml.parse(reqRaw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
        const req1 = reqFm.requirements.find((r: any) => r.id === 'REQ-001');
        assert.ok(req1);
        assert.deepStrictEqual(req1.satisfied_by, ['DEC-002']);

        // Valida DEC-002 criado com satisfies: ["REQ-001"]
        const dec2Path = path.join(contextDir, 'decisions', 'DEC-002.md');
        const dec2Raw = fs.readFileSync(dec2Path, 'utf-8');
        const dec2Fm = yaml.parse(dec2Raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
        assert.deepStrictEqual(dec2Fm.satisfies, ['REQ-001']);

        // Valida DEC-001 marcado como superseded
        const dec1Raw = fs.readFileSync(dec1Path, 'utf-8');
        const dec1Fm = yaml.parse(dec1Raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
        assert.strictEqual(dec1Fm.status, 'superseded');
        assert.strictEqual(dec1Fm.superseded_by, 'DEC-002');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Retrocompatibilidade v1.0: Processa perfeitamente payloads legados sem new_requirements e sem source.type', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-v10-compat-'));
    try {
        initProject(tmpDir);

        const legacyPayloadText = `
\`\`\`pactx-update
version: "1.0"
source:
  model: "Claude 3.5 Sonnet"
  session_topic: "Refatoração Legada"
state:
  active_task: "Legacy Task v1.0"
  status: "IN_PROGRESS"
  completed_items:
    - "Suporte v1.0 validado"
new_decisions:
  - id: "auto"
    title: "Decisão v1.0"
    reason: "Retrocompatibilidade"
    decision: "Aceitar v1.0"
\`\`\`
`;
        const { payload, canonicalHash, warnings } = parseAndValidateUpdate(legacyPayloadText);
        assert.strictEqual(payload.version, '1.0');
        assert.strictEqual(payload.source?.type, 'conversation');

        const plan = buildMutationPlan(tmpDir, payload, canonicalHash, warnings);
        assert.strictEqual(plan.schemaVersion, '1.0');
        assert.strictEqual(plan.source?.type, 'conversation');

        applyMutationPlan(tmpDir, plan);

        const dec2Path = path.join(tmpDir, '.ai-context', 'decisions', 'DEC-002.md');
        assert.strictEqual(fs.existsSync(dec2Path), true);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Validação e Segurança de Requisitos: Rejeita tipos inválidos e IDs fora do padrão', () => {
    const invalidTypePayload = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "auto"
    type: "super_fast_invalid"
    title: "Invalid Type"
    statement: "Statement"
\`\`\`
`;
    assert.throws(() => {
        parseAndValidateUpdate(invalidTypePayload);
    }, /Invalid requirement type: "super_fast_invalid"/);

    const invalidIdPayload = `
\`\`\`pactx-update
version: "1.1"
new_requirements:
  - id: "REQ-000"
    type: "functional"
    title: "Zero ID"
    statement: "Statement"
\`\`\`
`;
    assert.throws(() => {
        parseAndValidateUpdate(invalidIdPayload);
    }, /Invalid requirement identifier: "REQ-000"/);

    const invalidSatisfiesPayload = `
\`\`\`pactx-update
version: "1.1"
new_decisions:
  - id: "auto"
    title: "Decisão"
    reason: "R"
    decision: "D"
    satisfies: ["auto"]
\`\`\`
`;
    assert.throws(() => {
        parseAndValidateUpdate(invalidSatisfiesPayload);
    }, /Invalid requirement identifier in satisfies: "auto"/);
});
