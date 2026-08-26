import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { getStatusData, renderStatus } from '../src/commands/status';

test('Status: Extrai métricas e estado consolidado de um projeto inicializado', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-status-'));
    try {
        initProject(tmpDir);

        const data = getStatusData(tmpDir);

        assert.strictEqual(data.project.name, 'Project Name');
        assert.strictEqual(data.project.version, '0.1.0');
        assert.deepStrictEqual(data.project.stack, ['Node.js', 'TypeScript', 'PostgreSQL']);

        assert.strictEqual(data.state.activeTask, 'TASK-01');
        assert.strictEqual(data.state.status, 'IN_PROGRESS');
        assert.strictEqual(data.state.recommendedModel, 'Medium');
        assert.strictEqual(data.state.completedItemsCount, 1);
        assert.strictEqual(data.state.factsCount, 0);

        assert.strictEqual(data.requirements.total, 1);
        assert.strictEqual(data.requirements.active, 1);
        assert.strictEqual(data.requirements.satisfiedCount, 1);
        assert.strictEqual(data.requirements.satisfactionPercentage, 100);

        assert.strictEqual(data.decisions.total, 1);
        assert.strictEqual(data.decisions.active, 1);
        assert.strictEqual(data.decisions.superseded, 0);

        assert.strictEqual(data.glossary.termsCount, 2);
        assert.strictEqual(data.contextRevision.length, 16);
        assert.strictEqual(data.lock.isLocked, false);
        assert.strictEqual(data.lastMutation, null);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Status: Detecta lock ativo e PID do processo concorrente', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-status-lock-'));
    try {
        initProject(tmpDir);
        const lockPath = path.join(tmpDir, '.ai-context', '.pactx', '.pactx.lock');
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: 'test-token', createdAt: Date.now(), heartbeatAt: Date.now() }), 'utf-8');

        const data = getStatusData(tmpDir);
        assert.strictEqual(data.lock.isLocked, true);
        assert.strictEqual(data.lock.pid, process.pid);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Status: Opção --json emite JSON estruturado válido no stdout', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-status-json-'));
    try {
        initProject(tmpDir);

        let capturedOutput = '';
        const originalLog = console.log;
        console.log = (msg: string) => {
            capturedOutput += msg + '\n';
        };

        try {
            renderStatus(tmpDir, { json: true });
        } finally {
            console.log = originalLog;
        }

        const parsed = JSON.parse(capturedOutput);
        assert.strictEqual(parsed.project.name, 'Project Name');
        assert.strictEqual(parsed.state.activeTask, 'TASK-01');
        assert.strictEqual(parsed.requirements.total, 1);
        assert.strictEqual(parsed.decisions.total, 1);
        assert.strictEqual(parsed.lock.isLocked, false);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
