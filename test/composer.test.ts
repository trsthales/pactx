import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { composeContext } from '../src/composer';

test('initProject e composeContext workflow', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-'));

    try {
        initProject(tmpDir);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'project.md')), true);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'state.md')), true);

        const output = composeContext(tmpDir);
        assert.match(output, /PROJETO & INVARIANTES/);
        assert.match(output, /ESTADO ATUAL & PRÓXIMA TAREFA/);
        assert.match(output, /DEC-001/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});