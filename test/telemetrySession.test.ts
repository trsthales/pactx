import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { composeContext } from '../src/composer';
import { renderStatus, getTelemetryData } from '../src/commands/status';
import {
  startSession,
  getActiveSession,
  clearActiveSession,
  getSessionsDir,
} from '../src/telemetry/sessionStore';

test('sessionStore: startSession, getActiveSession e clearActiveSession operam corretamente', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-session-test-'));
  try {
    initProject(tmpDir);
    const contextDir = path.join(tmpDir, '.ai-context');

    // 1. Diretório de sessões é criado sob demanda
    const sessionsDir = getSessionsDir(contextDir);
    assert.strictEqual(fs.existsSync(sessionsDir), true);

    // 2. Sem sessão ativa inicialmente
    assert.strictEqual(getActiveSession(contextDir), null);

    // 3. Iniciar sessão
    const session = startSession(contextDir, 'abc123def456', 420, 'gemini-2.5-pro');
    assert.strictEqual(typeof session.sessionId, 'string');
    assert.strictEqual(session.baseRevision, 'abc123def456');
    assert.strictEqual(session.packTokenEstimate, 420);
    assert.strictEqual(session.modelName, 'gemini-2.5-pro');
    assert.strictEqual(session.currentTurn, 0);
    assert.strictEqual(typeof session.sessionStartedAt, 'string');

    // 4. Ler sessão ativa
    const active = getActiveSession(contextDir);
    assert.notStrictEqual(active, null);
    assert.strictEqual(active?.sessionId, session.sessionId);
    assert.strictEqual(active?.packTokenEstimate, 420);
    assert.strictEqual(active?.modelName, 'gemini-2.5-pro');

    // 5. Limpar sessão
    clearActiveSession(contextDir);
    assert.strictEqual(getActiveSession(contextDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('composer: composeContext() inicializa sessão efêmera em .ai-context/.pactx/sessions/current.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-compose-session-test-'));
  try {
    initProject(tmpDir);
    const contextDir = path.join(tmpDir, '.ai-context');

    const output = composeContext(tmpDir);
    assert.ok(output.length > 0);

    const session = getActiveSession(contextDir);
    assert.notStrictEqual(session, null);
    assert.strictEqual(typeof session?.sessionId, 'string');
    assert.ok((session?.packTokenEstimate || 0) > 0);
    assert.strictEqual(session?.modelName, 'claude-3-7-sonnet');
    assert.strictEqual(typeof session?.baseRevision, 'string');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('status: renderStatus com --telemetry exibe dashboard visual e barra de saturação', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-status-telemetry-test-'));
  try {
    initProject(tmpDir);
    composeContext(tmpDir);

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
    assert.match(output, /PactX Context Telemetry/);
    assert.match(output, /Active Task:/);
    assert.match(output, /Model Profile:/);
    assert.match(output, /Session Metrics:/);
    assert.match(output, /Session Timeline/);
    assert.match(output, /Recommendation:/);
    assert.match(output, /\[█*░*\]/); // Barra de progresso ANSI
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('status: renderStatus com --telemetry e --json emite payload JSON completo com telemetry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-status-telemetry-json-test-'));
  try {
    initProject(tmpDir);
    composeContext(tmpDir);

    let jsonOutput = '';
    const originalLog = console.log;
    console.log = (msg: string) => {
      jsonOutput += msg;
    };

    try {
      renderStatus(tmpDir, { telemetry: true, json: true });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput);
    assert.ok(parsed.project);
    assert.ok(parsed.telemetry);
    assert.ok(parsed.telemetry.session);
    assert.ok(parsed.telemetry.healthReport);
    assert.strictEqual(typeof parsed.telemetry.healthReport.health.score, 'number');
    assert.strictEqual(typeof parsed.telemetry.healthReport.consumption.saturationPercent, 'number');
    assert.strictEqual(parsed.telemetry.session.modelName, 'claude-3-7-sonnet');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('status: renderStatus com --telemetry em estado IDLE exibe mensagem informativa', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-status-idle-test-'));
  try {
    initProject(tmpDir);
    // Não chamamos composeContext, logo não há current.json

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
    assert.match(output, /IDLE \/ NO ACTIVE SESSION/);

    // E com --json emite telemetry com session: null e healthReport: null
    let jsonOutput = '';
    console.log = (msg: string) => {
      jsonOutput += msg;
    };

    try {
      renderStatus(tmpDir, { telemetry: true, json: true });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput);
    assert.strictEqual(parsed.telemetry.session, null);
    assert.strictEqual(parsed.telemetry.healthReport, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
