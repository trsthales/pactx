import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseMicroAnchors,
  appendSessionAnchor,
  getSessionAnchors,
  clearSessionAnchors,
} from '../src/telemetry/anchorScanner';
import { initProject } from '../src/init';
import { composeContext } from '../src/composer';
import { renderStatus } from '../src/commands/status';

test('anchorScanner: extração de comentários HTML estruturados <!-- pactx:v1 type payload -->', () => {
  const text = `
Here is my architectural proposal.
<!-- pactx:v1 dec {"title":"Auth via PIN", "satisfies":["REQ-001"]} -->
We also established that rate limiting is required.
<!-- pactx:v1 fact "Rate limit is 5 req/min per IP" -->
And we discarded JWT:
<!-- pactx:v1 rej "JWT auth discarded due to token size" -->
<!-- pactx:v1 req {"title":"PIN Policy", "type":"functional"} -->
<!-- pactx:v1 task "Implement validation middleware in authController" -->
`;

  const anchors = parseMicroAnchors(text);
  assert.strictEqual(anchors.length, 5);

  const dec = anchors.find(a => a.type === 'dec');
  assert.ok(dec);
  assert.strictEqual(dec?.source, 'ai_comment');
  assert.strictEqual(dec?.payload.title, 'Auth via PIN');
  assert.deepStrictEqual(dec?.payload.satisfies, ['REQ-001']);

  const fact = anchors.find(a => a.type === 'fact');
  assert.ok(fact);
  assert.strictEqual(fact?.payload, 'Rate limit is 5 req/min per IP');

  const rej = anchors.find(a => a.type === 'rej');
  assert.ok(rej);
  assert.strictEqual(rej?.payload, 'JWT auth discarded due to token size');

  const req = anchors.find(a => a.type === 'req');
  assert.ok(req);
  assert.strictEqual(req?.payload.title, 'PIN Policy');
  assert.strictEqual(req?.payload.type, 'functional');

  const task = anchors.find(a => a.type === 'task');
  assert.ok(task);
  assert.strictEqual(task?.payload, 'Implement validation middleware in authController');
});

test('anchorScanner: extração de diretivas do desenvolvedor (/remember, /pin, @pactx)', () => {
  const text = `
/remember decision: Use PBKDF2 with student-specific salt
/remember reject: Do not use plain MD5 or SHA1
/pin fact: PostgreSQL is our single source of truth
/remember requirement: PIN must be exactly 4 digits
/remember task: Add unit tests for rate limiting
@pactx fact: Server runs on port 3000
/remember We agreed to never store plaintext passwords
`;

  const anchors = parseMicroAnchors(text);
  assert.strictEqual(anchors.length, 7);

  assert.strictEqual(anchors[0].type, 'dec');
  assert.strictEqual(anchors[0].source, 'user_remember');
  assert.strictEqual(anchors[0].payload, 'Use PBKDF2 with student-specific salt');

  assert.strictEqual(anchors[1].type, 'rej');
  assert.strictEqual(anchors[1].payload, 'Do not use plain MD5 or SHA1');

  assert.strictEqual(anchors[2].type, 'fact');
  assert.strictEqual(anchors[2].payload, 'PostgreSQL is our single source of truth');

  assert.strictEqual(anchors[3].type, 'req');
  assert.strictEqual(anchors[3].payload, 'PIN must be exactly 4 digits');

  assert.strictEqual(anchors[4].type, 'task');
  assert.strictEqual(anchors[4].payload, 'Add unit tests for rate limiting');

  assert.strictEqual(anchors[5].type, 'fact');
  assert.strictEqual(anchors[5].payload, 'Server runs on port 3000');

  assert.strictEqual(anchors[6].type, 'fact'); // default fact
  assert.strictEqual(anchors[6].payload, 'We agreed to never store plaintext passwords');
});

test('anchorScanner: resiliência a JSON malformado em comentários HTML', () => {
  const malformed = '<!-- pactx:v1 dec { invalid: json here, missing quotes -->';
  const anchors = parseMicroAnchors(malformed);

  assert.strictEqual(anchors.length, 1);
  assert.strictEqual(anchors[0].type, 'dec');
  assert.strictEqual(typeof anchors[0].payload, 'string');
  assert.match(anchors[0].payload, /invalid: json here/);
});

test('anchorScanner: persistência append-only em anchors.jsonl e leitura correta', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-anchor-test-'));
  try {
    initProject(tmpDir);
    const contextDir = path.join(tmpDir, '.ai-context');

    // Inicialmente sem âncoras
    assert.deepStrictEqual(getSessionAnchors(contextDir), []);

    // Adiciona âncoras sequencialmente
    appendSessionAnchor(contextDir, {
      type: 'dec',
      payload: { title: 'Dec 1' },
      rawText: '<!-- pactx:v1 dec {"title":"Dec 1"} -->',
      source: 'ai_comment',
      capturedAt: new Date().toISOString(),
    });

    appendSessionAnchor(contextDir, {
      type: 'rej',
      payload: 'Hypothesis A',
      rawText: '/remember reject: Hypothesis A',
      source: 'user_remember',
      capturedAt: new Date().toISOString(),
    });

    const anchors = getSessionAnchors(contextDir);
    assert.strictEqual(anchors.length, 2);
    assert.strictEqual(anchors[0].type, 'dec');
    assert.strictEqual(anchors[1].type, 'rej');

    // Limpeza de âncoras
    clearSessionAnchors(contextDir);
    assert.deepStrictEqual(getSessionAnchors(contextDir), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('composer: Context Pack gerado inclui instruções de micro-âncoras e /remember', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-composer-anchor-test-'));
  try {
    initProject(tmpDir);
    const output = composeContext(tmpDir);

    assert.match(output, /PROGRESSIVE IN-FLIGHT MICRO-ANCHORS/);
    assert.match(output, /<!-- pactx:v1 dec/);
    assert.match(output, /<!-- pactx:v1 rej/);
    assert.match(output, /\/remember DIRECTIVE/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('status: renderStatus com --telemetry exibe contagem de âncoras capturadas', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-status-anchors-test-'));
  try {
    initProject(tmpDir);
    composeContext(tmpDir);
    const contextDir = path.join(tmpDir, '.ai-context');

    appendSessionAnchor(contextDir, {
      type: 'dec',
      payload: 'Decision 1',
      rawText: '<!-- pactx:v1 dec "Decision 1" -->',
      source: 'ai_comment',
      capturedAt: new Date().toISOString(),
    });
    appendSessionAnchor(contextDir, {
      type: 'rej',
      payload: 'Rejection 1',
      rawText: '<!-- pactx:v1 rej "Rejection 1" -->',
      source: 'ai_comment',
      capturedAt: new Date().toISOString(),
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
    };

    try {
      renderStatus(tmpDir, { telemetry: true });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /Anchors Logged:\s+2 captured \(1 DEC, 1 REJ, 0 FACT\)/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
