import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LockData } from './types';

export class ContextLock {
    private lockPath: string;
    private fd: number | null = null;
    private token: string;

    constructor(contextDir: string) {
        const pactxDir = path.join(contextDir, '.pactx');
        if (!fs.existsSync(pactxDir)) {
            fs.mkdirSync(pactxDir, { recursive: true });
        }
        this.lockPath = path.join(pactxDir, '.pactx.lock');
        this.token = crypto.randomUUID();
    }

    getToken(): string {
        return this.token;
    }

    acquire(timeoutMs = 5000): void {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                this.fd = fs.openSync(this.lockPath, 'wx');
                const lockData: LockData = {
                    pid: process.pid,
                    token: this.token,
                    createdAt: Date.now(),
                    heartbeatAt: Date.now(),
                };
                fs.writeFileSync(this.fd, JSON.stringify(lockData));
                return;
            } catch (err: any) {
                if (err.code !== 'EEXIST') throw err;

                // Recuperação de Stale Lock (Liveness de PID + Timeout de 30s)
                try {
                    if (fs.existsSync(this.lockPath)) {
                        const raw = fs.readFileSync(this.lockPath, 'utf-8');
                        let isStale = false;
                        let lockPid: number | undefined;
                        let heartbeatAt: number | undefined;

                        try {
                            const data = JSON.parse(raw);
                            lockPid = data.pid;
                            heartbeatAt = data.heartbeatAt || data.time;
                        } catch {
                            // Lockfile corrompido -> stale
                            isStale = true;
                        }

                        if (lockPid && typeof lockPid === 'number') {
                            try {
                                // Signal 0 verifica se o PID ainda existe no SO
                                process.kill(lockPid, 0);
                            } catch (killErr: any) {
                                if (killErr.code === 'ESRCH') {
                                    // Processo não existe mais -> stale lock!
                                    isStale = true;
                                }
                            }
                        }

                        if (!isStale) {
                            const stats = fs.statSync(this.lockPath);
                            const lastActivity = heartbeatAt || stats.mtimeMs;
                            if (Date.now() - lastActivity > 30000) {
                                isStale = true;
                            }
                        }

                        if (isStale) {
                            try { fs.unlinkSync(this.lockPath); } catch {}
                            continue;
                        }
                    }
                } catch {}

                // Pausa antes de tentar novamente
                const remaining = timeoutMs - (Date.now() - start);
                if (remaining <= 0) break;
                const sleepTime = Math.min(100, Math.max(10, remaining));
                try {
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepTime);
                } catch {
                    const sleepUntil = Date.now() + sleepTime;
                    while (Date.now() < sleepUntil) {}
                }
            }
        }
        throw new Error('Timeout: Unable to acquire lock on .ai-context/. Another pactx process is currently running.');
    }

    release(): void {
        if (this.fd !== null) {
            try { fs.closeSync(this.fd); } catch {}
            this.fd = null;
        }
        if (fs.existsSync(this.lockPath)) {
            try {
                const raw = fs.readFileSync(this.lockPath, 'utf-8');
                const data = JSON.parse(raw);
                // Liberação estrita: apenas remove se o token UUID de posse corresponder (P2-4)
                if (data.token === this.token) {
                    fs.unlinkSync(this.lockPath);
                }
            } catch {
                // Se o arquivo estiver corrompido e não conseguimos verificar o token, não removemos silenciosamente
            }
        }
    }
}
