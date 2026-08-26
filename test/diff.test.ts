import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init';
import { renderDiff } from '../src/commands/diff';

test('Diff: Preview colorido via --file sem gravar nenhum arquivo no disco', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-diff-file-'));
    try {
        initProject(tmpDir);

        const updatePayload = `
\`\`\`pactx-update
version: "1.1"
state:
  active_task: "TASK-DIFF-TEST"
  status: "IN_PROGRESS"
  new_facts:
    - "Diff preview funcionando perfeitamente"
new_requirements:
  - id: "auto"
    type: "functional"
    title: "Diff Visualizer"
    statement: "Permitir inspecionar mudanças antes de aplicar."
new_decisions:
  - id: "auto"
    title: "Implementar comando diff"
    reason: "Segurança operacional"
    decision: "Adicionar pactx diff à CLI"
    satisfies: ["REQ-002"]
\`\`\`
`;
        const filePath = path.join(tmpDir, 'payload.md');
        fs.writeFileSync(filePath, updatePayload, 'utf-8');

        let captured = '';
        const originalLog = console.log;
        console.log = (msg: string) => {
            captured += msg + '\n';
        };

        try {
            await renderDiff(tmpDir, { file: filePath });
        } finally {
            console.log = originalLog;
        }

        assert.match(captured, /pactx-update mutation preview/);
        assert.match(captured, /TASK-DIFF-TEST/);
        assert.match(captured, /Diff Visualizer/);
        assert.match(captured, /Implementar comando diff/);
        assert.match(captured, /Diff mode: 0 files were modified on disk\./);

        // Garante que o disco permaneceu 100% inalterado
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.ai-context', 'decisions', 'DEC-002.md')), false);
        const reqContent = fs.readFileSync(path.join(tmpDir, '.ai-context', 'requirements.md'), 'utf-8');
        assert.strictEqual(reqContent.includes('Diff Visualizer'), false);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Diff: Rejeita --stdin sem pipe com mensagem acionável em ambiente TTY', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-diff-stdin-'));
    try {
        initProject(tmpDir);

        const originalIsTTY = process.stdin.isTTY;
        (process.stdin as any).isTTY = true;

        try {
            await assert.rejects(async () => {
                await renderDiff(tmpDir, { stdin: true });
            }, /No data received from pipe\. Use: cat update\.md \| pactx diff --stdin/);
        } finally {
            (process.stdin as any).isTTY = originalIsTTY;
        }

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Diff: Rejeita caminho de arquivo inexistente em --file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactx-test-diff-nonexistent-'));
    try {
        initProject(tmpDir);

        await assert.rejects(async () => {
            await renderDiff(tmpDir, { file: path.join(tmpDir, 'nonexistent.md') });
        }, /File not found:/);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
