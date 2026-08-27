import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectTranscriptFormat,
  detectAndNormalizeTranscript,
  extractDeterministicData,
  ClaudeExportAdapter,
  ChatGPTExportAdapter,
  CursorLogAdapter,
  RawTranscriptAdapter,
} from '../src';
import { initProject } from '../src/init';

test('ClaudeExportAdapter: normaliza export do Claude.ai com chat_messages', () => {
  const claudeMock = {
    uuid: 'claude-chat-123',
    name: 'Authentication Architecture',
    chat_messages: [
      { sender: 'human', text: 'How should we design PIN authentication?' },
      {
        sender: 'assistant',
        text: 'We should use PBKDF2 with student salts.\n<!-- pactx:v1 dec {"title":"PIN Auth"} -->',
      },
    ],
  };

  const adapter = new ClaudeExportAdapter();
  assert.strictEqual(adapter.detect(claudeMock), true);
  assert.strictEqual(detectTranscriptFormat(JSON.stringify(claudeMock)), 'claude');

  const normalized = detectAndNormalizeTranscript(JSON.stringify(claudeMock));
  assert.strictEqual(normalized.source, 'claude');
  assert.strictEqual(normalized.sessionId, 'claude-chat-123');
  assert.strictEqual(normalized.turns.length, 2);
  assert.strictEqual(normalized.turns[0].role, 'user');
  assert.strictEqual(normalized.turns[0].content, 'How should we design PIN authentication?');
  assert.strictEqual(normalized.turns[1].role, 'assistant');
  assert.match(normalized.turns[1].content, /PBKDF2/);
});

test('ChatGPTExportAdapter: normaliza export do ChatGPT com mapping', () => {
  const chatgptMock = {
    title: 'Database Design',
    create_time: 1700000000,
    mapping: {
      'node-1': {
        id: 'node-1',
        message: {
          id: 'msg-1',
          author: { role: 'user' },
          create_time: 1700000001,
          content: { content_type: 'text', parts: ['Should we use MongoDB?'] },
        },
      },
      'node-2': {
        id: 'node-2',
        message: {
          id: 'msg-2',
          author: { role: 'assistant' },
          create_time: 1700000002,
          content: {
            content_type: 'text',
            parts: ['No, PostgreSQL is required.\n<!-- pactx:v1 rej "MongoDB rejected" -->'],
          },
        },
      },
    },
  };

  const adapter = new ChatGPTExportAdapter();
  assert.strictEqual(adapter.detect(chatgptMock), true);
  assert.strictEqual(detectTranscriptFormat(JSON.stringify(chatgptMock)), 'chatgpt');

  const normalized = detectAndNormalizeTranscript(JSON.stringify(chatgptMock));
  assert.strictEqual(normalized.source, 'chatgpt');
  assert.strictEqual(normalized.turns.length, 2);
  assert.strictEqual(normalized.turns[0].role, 'user');
  assert.strictEqual(normalized.turns[0].content, 'Should we use MongoDB?');
  assert.strictEqual(normalized.turns[1].role, 'assistant');
  assert.match(normalized.turns[1].content, /PostgreSQL is required/);
});

test('CursorLogAdapter: normaliza JSONL do Cursor', () => {
  const cursorJsonl = `
{"tabId":"tab-456","bubbleId":"b-1","type":"user","text":"Implement rate limiter"}
{"tabId":"tab-456","bubbleId":"b-2","type":"ai","text":"Here is the middleware.\\n<!-- pactx:v1 fact \\"5 req/min\\" -->"}
`.trim();

  const adapter = new CursorLogAdapter();
  assert.strictEqual(adapter.detect(cursorJsonl), true);
  assert.strictEqual(detectTranscriptFormat(cursorJsonl), 'cursor');

  const normalized = detectAndNormalizeTranscript(cursorJsonl);
  assert.strictEqual(normalized.source, 'cursor');
  assert.strictEqual(normalized.sessionId, 'tab-456');
  assert.strictEqual(normalized.turns.length, 2);
  assert.strictEqual(normalized.turns[0].role, 'user');
  assert.strictEqual(normalized.turns[0].content, 'Implement rate limiter');
  assert.strictEqual(normalized.turns[1].role, 'assistant');
  assert.match(normalized.turns[1].content, /5 req\/min/);
});

test('RawTranscriptAdapter: fallback universal para texto com marcadores', () => {
  const rawText = `
Human: We need to define the user role policy.
Assistant: I suggest defining an Admin and Student role.
<!-- pactx:v1 req {"title":"RBAC Policy"} -->
`.trim();

  const adapter = new RawTranscriptAdapter();
  assert.strictEqual(adapter.detect(rawText), true);
  assert.strictEqual(detectTranscriptFormat(rawText), 'raw');

  const normalized = detectAndNormalizeTranscript(rawText);
  assert.strictEqual(normalized.source, 'raw');
  assert.strictEqual(normalized.turns.length, 2);
  assert.strictEqual(normalized.turns[0].role, 'user');
  assert.strictEqual(normalized.turns[1].role, 'assistant');
  assert.match(normalized.turns[1].content, /RBAC Policy/);
});

test('extractDeterministicData: extração completa de âncoras, diretivas /remember e anotações de código', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-deterministic-test-'));
  try {
    initProject(tmpDir);

    const transcriptMock = {
      source: 'claude' as const,
      turns: [
        {
          index: 0,
          role: 'user' as const,
          content: '/remember reject: Não usar JWT para alunos\nHow do we configure database tenancy?',
        },
        {
          index: 1,
          role: 'assistant' as const,
          content: `
We will configure multi-tenancy as follows:
\`\`\`typescript
// DECISION: SQLite por tenant
// REJECTED: Shared database without isolation
const db = createTenantConnection(tenantId);
\`\`\`
<!-- pactx:v1 dec {"title":"PIN Auth", "satisfies":["REQ-001"]} -->
<!-- pactx:v1 fact "5 req/min rate limit" -->
<!-- pactx:v1 req {"title":"Tenant Isolation", "type":"security"} -->
`,
        },
      ],
      rawText: '',
    };

    const result = extractDeterministicData(transcriptMock, tmpDir);

    assert.strictEqual(result.totalTurns, 2);
    assert.strictEqual(result.anchorsCount, 4); // 1 user remember + 3 ai comments
    assert.strictEqual(result.inlineCodeAnnotations.length, 2); // 1 DECISION + 1 REJECTED

    const update = result.candidateUpdate;
    assert.ok(update);
    assert.strictEqual(update.version, '1.1');

    // Fatos
    assert.ok(update.state?.new_facts?.includes('5 req/min rate limit'));

    // Hipóteses rejeitadas (âncora + anotação de código)
    assert.ok(update.state?.rejected_hypotheses?.includes('Não usar JWT para alunos'));
    assert.ok(update.state?.rejected_hypotheses?.includes('Shared database without isolation'));

    // Decisões (âncora + anotação de código)
    const pinAuth = update.new_decisions?.find(d => d.title === 'PIN Auth');
    assert.ok(pinAuth);
    assert.deepStrictEqual(pinAuth?.satisfies, ['REQ-001']);

    const sqliteTenant = update.new_decisions?.find(d => d.title === 'SQLite por tenant');
    assert.ok(sqliteTenant);

    // Requisitos
    const req = update.new_requirements?.find(r => r.title === 'Tenant Isolation');
    assert.ok(req);
    assert.strictEqual(req?.type, 'security');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
