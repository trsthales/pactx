import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { createPactxMcpServer } from '../src/mcp/server';
import {
  saveProposal,
  getProposal,
  removeProposal,
  listProposals,
  normalizeProposalId,
} from '../src/mcp/proposals';
import { getSessionAnchors } from '../src/telemetry/anchorScanner';

test('createPactxMcpServer: inicializa servidor MCP com nome, versão e resources', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-mcp-init-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);
    assert.ok(server);

    const resources = server._registeredResources;
    assert.ok(resources);
    assert.ok(resources['pactx://context']);
    assert.ok(resources['pactx://health']);
    assert.ok(resources['pactx://status']);

    // Testa Resource pactx://context
    const contextRes = await resources['pactx://context'].readCallback(new URL('pactx://context'));
    assert.strictEqual(contextRes.contents[0].mimeType, 'text/markdown');
    assert.match(contextRes.contents[0].text, /Initial Architectural Decision/);

    // Testa Resource pactx://health
    const healthRes = await resources['pactx://health'].readCallback(new URL('pactx://health'));
    assert.strictEqual(healthRes.contents[0].mimeType, 'application/json');
    const healthObj = JSON.parse(healthRes.contents[0].text);
    assert.ok(healthObj.health);

    // Testa Resource pactx://status
    const statusRes = await resources['pactx://status'].readCallback(new URL('pactx://status'));
    assert.strictEqual(statusRes.contents[0].mimeType, 'application/json');
    const statusObj = JSON.parse(statusRes.contents[0].text);
    assert.ok(statusObj.decisions.total >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pactx_record_anchor: tool MCP grava micro-âncoras síncronas no anchors.jsonl', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-mcp-anchor-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);

    const tools = server._registeredTools;
    assert.ok(tools);

    const recordTool = tools['pactx_record_anchor'];
    assert.ok(recordTool);

    const res = await recordTool.handler({
      type: 'dec',
      payload: { title: 'Use AES-GCM for storage encryption', satisfies: ['REQ-001'] },
    });

    assert.ok(!res.isError);
    assert.match(res.content[0].text, /✅ Anchor recorded \[DEC\]/);

    // Verifica que o arquivo anchors.jsonl foi atualizado
    const contextDir = path.join(tmpDir, '.ai-context');
    const anchors = getSessionAnchors(contextDir);
    assert.strictEqual(anchors.length, 1);
    assert.strictEqual(anchors[0].type, 'dec');
    assert.match(JSON.stringify(anchors[0].payload), /AES-GCM/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pactx_get_context_health: tool MCP calcula saturação e retorna ContextHealthReport em JSON', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-mcp-health-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);
    const tools = server._registeredTools;
    const healthTool = tools['pactx_get_context_health'];

    const res = await healthTool.handler({
      modelName: 'claude-3-5-sonnet',
      estimatedTokensUsed: 145000,
    });

    assert.ok(!res.isError);
    const report = JSON.parse(res.content[0].text);
    assert.strictEqual(report.model.name, 'claude-3-5-sonnet');
    assert.strictEqual(report.health.grade, 'CAUTION');
    assert.ok(report.health.score < 80);
    assert.ok(report.recommendation.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pactx_propose_mutation e pactx_apply_mutation: fluxo desacoplado de proposta e commit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-mcp-proposal-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);
    const tools = server._registeredTools;

    const proposeTool = tools['pactx_propose_mutation'];
    const applyTool = tools['pactx_apply_mutation'];

    const validPayload = `\`\`\`pactx-update
version: "1.1"
state:
  active_task: "Implementação de MFA"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items: []
  new_facts:
    - "TOTP RFC 6238 é o padrão para 2FA"
  rejected_hypotheses:
    - "SMS 2FA não é seguro devido a SIM swap"
  next_action: "Criar gerador de QR Code"
new_requirements:
  - id: "auto"
    type: "security"
    title: "MFA Obrigatório para Admins"
    statement: "Todos os administradores devem autenticar com TOTP."
new_decisions:
  - id: "auto"
    title: "Adoção de TOTP RFC 6238"
    reason: "Segurança comprovada e suporte universal"
    decision: "Usar biblioteca otpauth para geração e validação de tokens"
    satisfies: []
superseded_decisions: []
new_glossary_terms: []
\`\`\``;

    // 1. Proposta
    const proposeRes = await proposeTool.handler({ payload: validPayload });
    assert.ok(!proposeRes.isError);
    assert.match(proposeRes.content[0].text, /✅ Proposal generated successfully \(ID: PROP-[A-F0-9]+\)/);

    const match = proposeRes.content[0].text.match(/PROP-[A-F0-9]+/);
    assert.ok(match);
    const proposalId = match[0];

    // Verifica que o arquivo da proposta foi gravado em disk
    const contextDir = path.join(tmpDir, '.ai-context');
    const proposal = getProposal(contextDir, proposalId);
    assert.ok(proposal);
    assert.strictEqual(proposal.proposalId, proposalId);
    assert.strictEqual(proposal.plan.operations.createdRequirements.length, 1);
    assert.strictEqual(proposal.plan.operations.createdAdrs.length, 1);

    // 2. Aplicação
    const applyRes = await applyTool.handler({ proposalId });
    assert.ok(!applyRes.isError);
    assert.match(applyRes.content[0].text, /successfully committed/);

    // Verifica que o state.md e requirements foram atualizados
    const stateContent = fs.readFileSync(path.join(contextDir, 'state.md'), 'utf-8');
    assert.match(stateContent, /Implementação de MFA/);
    assert.match(stateContent, /TOTP RFC 6238/);
    assert.match(stateContent, /SMS 2FA não é seguro/);

    const reqContent = fs.readFileSync(path.join(contextDir, 'requirements.md'), 'utf-8');
    assert.match(reqContent, /MFA Obrigatório para Admins/);

    // Verifica que a proposta foi removida após o commit
    assert.strictEqual(getProposal(contextDir, proposalId), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pactx_propose_mutation: rejeição de payload malformado ou versão inválida', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-mcp-reject-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);
    const tools = server._registeredTools;
    const proposeTool = tools['pactx_propose_mutation'];

    // Payload inválido (sem bloco pactx-update e sem YAML válido)
    const invalidRes = await proposeTool.handler({ payload: 'Just a random text without pactx block' });
    assert.strictEqual(invalidRes.isError, true);
    assert.match(invalidRes.content[0].text, /Error generating proposal/);

    // Versão incompatível
    const unsupportedVersionPayload = `\`\`\`pactx-update
version: "99.0"
state:
  active_task: "Test"
\`\`\``;
    const versionRes = await proposeTool.handler({ payload: unsupportedVersionPayload });
    assert.strictEqual(versionRes.isError, true);
    assert.match(versionRes.content[0].text, /Unsupported schema version/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('proposalsStore: utilitários de CRUD de propostas', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-proposals-crud-test-'));
  try {
    initProject(tmpDir);
    const contextDir = path.join(tmpDir, '.ai-context');

    assert.strictEqual(normalizeProposalId('a1b2c3d4'), 'PROP-A1B2C3D4');
    assert.strictEqual(normalizeProposalId('PROP-a1b2c3d4'), 'PROP-A1B2C3D4');

    const proposalMock: any = {
      proposalId: 'PROP-A1B2C3D4',
      canonicalHash: 'a1b2c3d4e5f6',
      proposedAt: new Date().toISOString(),
      plan: { operations: {} },
      payload: {},
      rawInput: 'mock',
      warnings: [],
    };

    saveProposal(contextDir, proposalMock);

    const loaded = getProposal(contextDir, 'PROP-A1B2C3D4');
    assert.ok(loaded);
    assert.strictEqual(loaded.proposalId, 'PROP-A1B2C3D4');

    const all = listProposals(contextDir);
    assert.strictEqual(all.length, 1);

    const removed = removeProposal(contextDir, 'PROP-A1B2C3D4');
    assert.strictEqual(removed, true);
    assert.strictEqual(getProposal(contextDir, 'PROP-A1B2C3D4'), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pactx update --proposal: aplica proposta salva via comando update', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-proposal-cli-test-'));
  try {
    initProject(tmpDir);
    const server: any = createPactxMcpServer(tmpDir);
    const tools = server._registeredTools;
    const proposeTool = tools['pactx_propose_mutation'];

    const validPayload = `\`\`\`pactx-update
version: "1.1"
state:
  active_task: "GraphQL Migration"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items: []
  new_facts:
    - "Apollo Server é utilizado"
  rejected_hypotheses: []
  next_action: "Definir schema"
new_requirements: []
new_decisions:
  - id: "auto"
    title: "Adoção de GraphQL"
    reason: "Flexibilidade nas consultas"
    decision: "Usar Apollo Server"
    satisfies: []
superseded_decisions: []
new_glossary_terms: []
\`\`\``;

    const proposeRes = await proposeTool.handler({ payload: validPayload });
    const match = proposeRes.content[0].text.match(/PROP-[A-F0-9]+/);
    assert.ok(match);
    const proposalId = match[0];

    const contextDir = path.join(tmpDir, '.ai-context');
    const proposal = getProposal(contextDir, proposalId);
    assert.ok(proposal);

    // Executa a aplicação transacional da proposta
    const { applyMutationPlan } = await import('../src/update/applier');
    applyMutationPlan(tmpDir, proposal.plan);
    removeProposal(contextDir, proposalId);

    const stateContent = fs.readFileSync(path.join(contextDir, 'state.md'), 'utf-8');
    assert.match(stateContent, /GraphQL Migration/);
    assert.match(stateContent, /Apollo Server é utilizado/);
    assert.strictEqual(getProposal(contextDir, proposalId), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

