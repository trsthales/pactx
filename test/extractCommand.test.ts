import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { executeExtract } from '../src/commands/extract';
import { extractWithModel, detectProvider } from '../src/extract/modelExtractor';

test('extractCommand: extração em modo offline determinístico aplica mudanças com sucesso', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-extract-offline-test-'));
  try {
    initProject(tmpDir);

    const transcriptContent = JSON.stringify({
      chat_messages: [
        {
          sender: 'human',
          text: '/remember reject: Não usar autenticação por email para alunos menores de 12 anos\nPrecisamos de uma solução segura.',
        },
        {
          sender: 'assistant',
          text: 'Entendido! Recomendo PIN numérico de 4 dígitos.\n<!-- pactx:v1 dec {"title":"PIN Auth via PBKDF2", "satisfies":["REQ-001"]} -->\n<!-- pactx:v1 fact "Limite de 5 tentativas de PIN por minuto" -->',
        },
      ],
    });

    const transcriptFile = path.join(tmpDir, 'transcript.json');
    fs.writeFileSync(transcriptFile, transcriptContent, 'utf-8');

    // Executa extração offline com -y
    await executeExtract(tmpDir, transcriptFile, { yes: true });

    // Verifica que o state.md foi atualizado
    const stateContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'state.md'), 'utf-8');
    assert.match(stateContent, /Não usar autenticação por email/);
    assert.match(stateContent, /Limite de 5 tentativas de PIN/);

    // Verifica que a decisão foi criada em decisions/
    const decisionsDir = path.join(tmpDir, '.ai-context', 'decisions');
    const adrFiles = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
    assert.ok(adrFiles.length >= 2);
    const pinAdr = adrFiles
      .map(f => fs.readFileSync(path.join(decisionsDir, f), 'utf-8'))
      .find(c => c.includes('PIN Auth via PBKDF2'));
    assert.ok(pinAdr);
    assert.match(pinAdr, /PIN Auth via PBKDF2/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('extractCommand: extração semântica com mock de fetch do Gemini e Evidence Spans', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-extract-gemini-test-'));
  const originalFetch = globalThis.fetch;

  try {
    initProject(tmpDir);

    const transcriptContent = `
Human: Qual banco de dados devemos adotar?
Assistant: Recomendo PostgreSQL.
Human: E Redis para cache de sessão?
Assistant: Não recomendo Redis agora pois adiciona complexidade operacional desnecessária.
`;
    const transcriptFile = path.join(tmpDir, 'chat.txt');
    fs.writeFileSync(transcriptFile, transcriptContent, 'utf-8');

    const mockAiResponse = `\`\`\`pactx-update
version: "1.1"
state:
  active_task: "Configuração de Banco de Dados"
  status: "IN_PROGRESS"
  recommended_model: "Medium"
  completed_items: []
  new_facts:
    - "PostgreSQL é o banco primário (evidence: turn 1 - 'Recomendo PostgreSQL')"
  rejected_hypotheses:
    - "Redis para cache de sessão adiciona complexidade (evidence: turn 3 - 'Não recomendo Redis')"
  next_action: "Criar migrations"
new_requirements: []
new_decisions:
  - id: "auto"
    title: "PostgreSQL como Banco de Dados Canônico"
    reason: "Estabilidade e suporte relacional (evidence: turn 1)"
    decision: "Usar PostgreSQL"
    satisfies: []
superseded_decisions: []
new_glossary_terms: []
\`\`\``;

    // Mock fetch
    globalThis.fetch = async (url: any) => {
      assert.match(String(url), /generativelanguage\.googleapis\.com/);
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: mockAiResponse }],
              },
            },
          ],
        }),
      } as any;
    };

    await executeExtract(tmpDir, transcriptFile, {
      yes: true,
      apiKey: 'AIzaSyFakeKey123',
      model: 'gemini-2.5-flash',
    });

    const stateContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'state.md'), 'utf-8');
    assert.match(stateContent, /PostgreSQL é o banco primário/);
    assert.match(stateContent, /evidence: turn 1/);
    assert.match(stateContent, /Redis para cache de sessão/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('modelExtractor: detectProvider identifica provedores corretamente', () => {
  assert.strictEqual(detectProvider({ model: 'gemini-2.5-pro' }), 'gemini');
  assert.strictEqual(detectProvider({ apiKey: 'AIzaSy123' }), 'gemini');
  assert.strictEqual(detectProvider({ model: 'claude-3-5-haiku' }), 'claude');
  assert.strictEqual(detectProvider({ apiKey: 'sk-ant-api03-123' }), 'claude');
  assert.strictEqual(detectProvider({ model: 'gpt-4o-mini' }), 'openai');
  assert.strictEqual(detectProvider({ apiKey: 'sk-proj-123' }), 'openai');
  assert.strictEqual(detectProvider({ model: 'qwen2.5-coder' }), 'ollama');
  assert.strictEqual(detectProvider({ endpoint: 'http://127.0.0.1:11434' }), 'ollama');
});

test('modelExtractor: suporte a chamadas REST de Claude, OpenAI e Ollama', async () => {
  const originalFetch = globalThis.fetch;
  const mockTranscript = {
    source: 'raw' as const,
    turns: [{ index: 0, role: 'user' as const, content: 'Hello' }],
    rawText: 'Hello',
  };
  const mockDet = {
    anchors: [],
    candidateUpdate: {},
    gitSignals: { modifiedFiles: [], recentCommits: [] },
    inlineCodeAnnotations: [],
    totalTurns: 1,
    anchorsCount: 0,
  };

  try {
    // 1. Claude
    let claudeCalled = false;
    globalThis.fetch = async (url: any, opts: any) => {
      claudeCalled = true;
      assert.strictEqual(opts.headers['x-api-key'], 'sk-ant-test');
      return {
        ok: true,
        json: async () => ({ content: [{ text: '```pactx-update\nversion: "1.1"\n```' }] }),
      } as any;
    };
    const claudeRes = await extractWithModel(mockTranscript, mockDet, {
      model: 'claude-3-5-haiku',
      apiKey: 'sk-ant-test',
    });
    assert.strictEqual(claudeCalled, true);
    assert.match(claudeRes, /pactx-update/);

    // 2. OpenAI
    let openaiCalled = false;
    globalThis.fetch = async (url: any, opts: any) => {
      openaiCalled = true;
      assert.strictEqual(opts.headers['Authorization'], 'Bearer sk-openai-test');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '```pactx-update\nversion: "1.1"\n```' } }] }),
      } as any;
    };
    const openaiRes = await extractWithModel(mockTranscript, mockDet, {
      model: 'gpt-4o-mini',
      apiKey: 'sk-openai-test',
    });
    assert.strictEqual(openaiCalled, true);
    assert.match(openaiRes, /pactx-update/);

    // 3. Ollama
    let ollamaCalled = false;
    globalThis.fetch = async (url: any, opts: any) => {
      ollamaCalled = true;
      assert.match(String(url), /11434\/api\/chat/);
      return {
        ok: true,
        json: async () => ({ message: { content: '```pactx-update\nversion: "1.1"\n```' } }),
      } as any;
    };
    const ollamaRes = await extractWithModel(mockTranscript, mockDet, {
      model: 'qwen2.5-coder',
      endpoint: 'http://127.0.0.1:11434',
    });
    assert.strictEqual(ollamaCalled, true);
    assert.match(ollamaRes, /pactx-update/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extractCommand: flag --dry-run imprime bloco sem modificar disco', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-extract-dryrun-test-'));
  try {
    initProject(tmpDir);
    const transcriptFile = path.join(tmpDir, 'transcript.txt');
    fs.writeFileSync(transcriptFile, 'User: Olá\nAssistant: Olá\n<!-- pactx:v1 fact "Servidor ativo" -->', 'utf-8');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      await executeExtract(tmpDir, transcriptFile, { dryRun: true });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /--dry-run mode/);
    assert.match(output, /Servidor ativo/);

    // state.md não foi modificado
    const stateContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'state.md'), 'utf-8');
    assert.strictEqual(stateContent.includes('Servidor ativo'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('extractCommand: validações de arquivo inexistente e trava TTY em --stdin', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-extract-errors-test-'));
  try {
    initProject(tmpDir);

    // Arquivo inexistente
    await assert.rejects(
      async () => {
        await executeExtract(tmpDir, path.join(tmpDir, 'nonexistent.json'));
      },
      /Transcript file not found/
    );

    // Trava de TTY
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      await assert.rejects(
        async () => {
          await executeExtract(tmpDir, undefined, { stdin: true });
        },
        /No data received from pipe/
      );
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1-04: Network Safety - timeout configurável trata TimeoutError graciosamente', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.PACTX_MODEL_TIMEOUT_MS;
  process.env.PACTX_MODEL_TIMEOUT_MS = '50'; // 50ms timeout

  const mockTranscript = {
    source: 'raw' as const,
    turns: [{ index: 0, role: 'user' as const, content: 'Hello' }],
    rawText: 'Hello',
  };
  const mockDet = {
    anchors: [],
    candidateUpdate: {},
    gitSignals: { modifiedFiles: [], recentCommits: [] },
    inlineCodeAnnotations: [],
    totalTurns: 1,
    anchorsCount: 0,
  };

  try {
    globalThis.fetch = async (url: any, opts: any) => {
      // Simula fetch que lança TimeoutError via sinal
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    await assert.rejects(
      async () => {
        await extractWithModel(mockTranscript, mockDet, {
          model: 'gemini-2.5-flash',
          apiKey: 'AIzaSyTest',
        });
      },
      /Model request timed out after 50ms/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout) {
      process.env.PACTX_MODEL_TIMEOUT_MS = originalTimeout;
    } else {
      delete process.env.PACTX_MODEL_TIMEOUT_MS;
    }
  }
});

test('P1-05: Transcript Safety - rejeita arquivos que excedem 10MB', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-extract-10mb-test-'));
  try {
    initProject(tmpDir);
    const largeFile = path.join(tmpDir, 'large_transcript.txt');

    // Cria arquivo com mais de 10MB
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1024, 'a');
    fs.writeFileSync(largeFile, buffer);

    await assert.rejects(
      async () => {
        await executeExtract(tmpDir, largeFile);
      },
      /Transcript file exceeds the maximum 10MB limit/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1-07: Validação de Evidence Spans filtra turnos e citações alucinadas', async () => {
  const { validateAndSanitizeEvidenceSpans } = await import('../src/extract/modelExtractor');

  const transcript = {
    source: 'claude' as const,
    turns: [
      { index: 0, role: 'user' as const, content: 'Devemos usar JWT ou Sessions?' },
      { index: 1, role: 'assistant' as const, content: 'Não devemos usar JWT para sessões de alunos pois senhas são complexas.' },
    ],
    rawText: '',
  };

  const aiOutputWithHallucinatedTurn = `\`\`\`pactx-update
version: "1.1"
state:
  new_facts:
    - "Sessions são seguras (evidence: turn 1 - 'Não devemos usar JWT')"
    - "Fato inventado (evidence: turn 99 - 'Alucinação')"
  rejected_hypotheses:
    - "JWT descartado (evidence: turn 1 - 'Texto inexistente no turno')"
\`\`\``;

  const sanitized = validateAndSanitizeEvidenceSpans(aiOutputWithHallucinatedTurn, transcript);

  // Turn 1 com citação válida é mantido integralmente
  assert.match(sanitized, /evidence: turn 1 - 'Não devemos usar JWT'/);

  // Turn 99 (inexistente) é removido
  assert.strictEqual(sanitized.includes('turn 99'), false);

  // Turn 1 com citação inexistente é sanitizado para manter apenas o número do turno válido
  assert.match(sanitized, /\(evidence: turn 1\)/);
});

