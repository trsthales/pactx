import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initProject,
  composeContext,
  estimateTokens,
  estimateTurnCost,
  extractDeterministicData,
  createPactxMcpServer,
} from '../src';

test('benchmark: acurácia da estimativa ponderada de tokens (código vs prosa)', () => {
  // Prosa pura (~4 caracteres por token + 15% margem)
  const proseText = 'This is a standard technical explanation about database architecture and data models.';
  const proseTokens = estimateTokens(proseText);
  const expectedProse = Math.ceil(Math.ceil(proseText.length / 4) * 1.15);
  assert.strictEqual(proseTokens, expectedProse);

  // Código puro dentro de bloco markdown (~3 caracteres por token + 15% margem)
  const codeText = '```typescript\nexport function calculate(a: number, b: number): number {\n  return a + b;\n}\n```';
  const codeTokens = estimateTokens(codeText);
  const expectedCode = Math.ceil(Math.ceil(codeText.length / 3) * 1.15);
  assert.strictEqual(codeTokens, expectedCode);

  // Texto misto
  const mixed = `${proseText}\n\n${codeText}`;
  const mixedTokens = estimateTokens(mixed);
  const expectedMixed = Math.ceil((Math.ceil(codeText.length / 3) + Math.ceil((proseText + '\n\n').length / 4)) * 1.15);
  assert.strictEqual(mixedTokens, expectedMixed);

  // Custo de turno
  const turnCost = estimateTurnCost('Qual a arquitetura?', 'Usaremos PostgreSQL com multi-tenancy.');
  assert.ok(turnCost > 0);
});

test('benchmark: throughput de extração determinística processa 100 turnos em menos de 50ms', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-bench-extract-'));
  try {
    initProject(tmpDir);

    // Gera transcript sintético de 100 turnos
    const turns = [];
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        turns.push({
          index: i,
          role: 'user' as const,
          content: i === 10
            ? '/remember reject: Não usar SQLite em produção com múltiplos nós'
            : `User message ${i}: Please clarify step ${i}`,
        });
      } else {
        turns.push({
          index: i,
          role: 'assistant' as const,
          content: i === 11
            ? `\`\`\`typescript\n// DECISION: Usar PostgreSQL com Citus para escala horizontal\nconst db = initPool();\n\`\`\`\n<!-- pactx:v1 dec {"title":"PostgreSQL com Citus", "satisfies":["REQ-001"]} -->\n<!-- pactx:v1 fact "Throughput mínimo: 5000 rps" -->`
            : `Assistant reply ${i}: Here is the code implementation for task ${i}.`,
        });
      }
    }

    const transcriptMock = {
      source: 'claude' as const,
      turns,
      rawText: '',
    };

    const startTime = performance.now();
    const result = extractDeterministicData(transcriptMock, tmpDir);
    const durationMs = performance.now() - startTime;

    assert.strictEqual(result.totalTurns, 100);
    assert.ok(result.anchorsCount >= 3);
    assert.ok(result.candidateUpdate.new_decisions?.some(d => d.title.includes('Citus')));
    assert.ok(result.candidateUpdate.state?.rejected_hypotheses?.some(h => h.includes('SQLite')));

    // Verifica que o tempo de execução é ultrarrápido (< 50ms)
    assert.ok(durationMs < 50, `Extração determinística de 100 turnos levou ${durationMs.toFixed(2)}ms (limite: 50ms)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('benchmark: simulação de ciclo fechado completo (Egress -> Anchors -> Extract -> Ingress -> MCP)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-full-cycle-test-'));
  try {
    // 1. Setup inicial
    initProject(tmpDir);

    // 2. Egress (pactx pack)
    const contextPack = composeContext(tmpDir);
    assert.match(contextPack, /Initial Architectural Decision/);
    assert.match(contextPack, /<!-- pactx:v1/); // Inclusão de instruções de micro-âncoras

    // 3. MCP Server & In-Flight Anchors
    const server: any = createPactxMcpServer(tmpDir);
    const tools = server._registeredTools;
    const resources = server._registeredResources;

    await tools['pactx_record_anchor'].handler({
      type: 'rej',
      payload: 'Não usar Redis como banco de dados primário',
    });

    await tools['pactx_record_anchor'].handler({
      type: 'fact',
      payload: 'Latency target: p99 < 15ms',
    });

    // 4. Ingress via Proposta MCP (pactx_propose_mutation)
    const updatePayload = `\`\`\`pactx-update
version: "1.1"
state:
  active_task: "Otimização de Performance"
  status: "COMPLETED"
  recommended_model: "Medium"
  completed_items:
    - "Benchmark de latência concluído"
  new_facts:
    - "Latency target: p99 < 15ms"
  rejected_hypotheses:
    - "Não usar Redis como banco de dados primário"
  next_action: "Deploy em staging"
new_requirements:
  - id: "auto"
    type: "performance"
    title: "Latência p99 Baixa"
    statement: "Todos os endpoints devem responder em menos de 15ms no percentil 99."
new_decisions:
  - id: "auto"
    title: "In-Memory LRU Cache para Queries Quentes"
    reason: "Reduzir carga no PostgreSQL e garantir p99 < 15ms"
    decision: "Adicionar quick-lru no gateway"
    satisfies: ["REQ-002"]
superseded_decisions: []
new_glossary_terms: []
\`\`\``;

    const proposeRes = await tools['pactx_propose_mutation'].handler({ payload: updatePayload });
    assert.ok(!proposeRes.isError);
    const match = proposeRes.content[0].text.match(/PROP-[A-F0-9]+/);
    assert.ok(match);
    const proposalId = match[0];

    // 5. Commit da proposta (pactx_apply_mutation)
    const applyRes = await tools['pactx_apply_mutation'].handler({ proposalId });
    assert.ok(!applyRes.isError);

    // 6. Verificação do novo estado canônico
    const nextPack = composeContext(tmpDir);
    assert.match(nextPack, /In-Memory LRU Cache/);
    assert.match(nextPack, /Latency target: p99 < 15ms/);
    assert.match(nextPack, /Não usar Redis como banco de dados primário/);

    // 7. Verificação de Resource MCP atualizado
    const healthRes = await resources['pactx://health'].readCallback(new URL('pactx://health'));
    const healthObj = JSON.parse(healthRes.contents[0].text);
    assert.strictEqual(healthObj.health.grade, 'SAFE');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
