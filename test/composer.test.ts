import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { composeContext, sanitizeInlineMarkdown } from '../src/composer';

test('initProject e composeContext workflow', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-'));

    try {
        initProject(tmpDir);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'project.md')), true);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'state.md')), true);

        const output = composeContext(tmpDir);
        assert.match(output, /PROJECT & INVARIANTS/);
        assert.match(output, /CURRENT STATE & ACTIVE TASK/);
        assert.match(output, /DEC-001/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('composer: sanitizeInlineMarkdown previne quebra de cercas e injeção de novas linhas', () => {
    const maliciousBranch = 'feat/`rm -rf /`\r\n### MALICIOUS';
    const sanitized = sanitizeInlineMarkdown(maliciousBranch);
    assert.strictEqual(sanitized, 'feat/ rm -rf / ### MALICIOUS');
    assert.strictEqual(sanitized.includes('`'), false);
    assert.strictEqual(sanitized.includes('\n'), false);
    assert.strictEqual(sanitized.includes('\r'), false);
});