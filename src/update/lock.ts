import fs from 'node:fs';
import path from 'node:path';

export class ContextLock {
    private lockPath: string;
    private fd: number | null = null;

    constructor(contextDir: string) {
        const pactxDir = path.join(contextDir, '.pactx');
        if (!fs.existsSync(pactxDir)) {
            fs.mkdirSync(pactxDir, { recursive: true });
        }
        this.lockPath = path.join(pactxDir, '.pactx.lock');
    }

    acquire(timeoutMs = 5000): void {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                this.fd = fs.openSync(this.lockPath, 'wx');
                fs.writeFileSync(this.fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
                return;
            } catch (err: any) {
                if (err.code !== 'EEXIST') throw err;
                // Recuperação de Stale Lock (> 30s sem atividade)
                try {
                    const stats = fs.statSync(this.lockPath);
                    if (Date.now() - stats.mtimeMs > 30000) {
                        try { fs.unlinkSync(this.lockPath); } catch {}
                        continue;
                    }
                } catch {}
                // Pausa de 100ms antes de tentar novamente
                const remaining = timeoutMs - (Date.now() - start);
                if (remaining <= 0) break;
                const sleepTime = Math.min(100, Math.max(10, remaining));
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepTime);
            }
        }
        throw new Error('Timeout: Unable to acquire lock on .ai-context/. Another pactx process is currently running.');
    }

    release(): void {
        if (this.fd !== null) {
            try { fs.closeSync(this.fd); } catch {}
            try { fs.unlinkSync(this.lockPath); } catch {}
            this.fd = null;
        }
    }
}
