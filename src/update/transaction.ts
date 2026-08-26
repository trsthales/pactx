import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pc from 'picocolors';
import {
    TransactionManifest,
    TransactionStatus,
    TransactionType,
    TransactionSnapshotItem,
    CreatedFileEntry,
    MutationPlan
} from './types';
import { ContextLock } from './lock';
import { safeAtomicWriteFileSync } from './applier';

export class TransactionEngine {
    /**
     * Returns the absolute path to .ai-context/.pactx/transactions/
     * and ensures it exists.
     */
    static getTransactionsDir(contextDir: string): string {
        const dir = path.join(contextDir, '.pactx', 'transactions');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Returns the manifest file path for a given transaction hash.
     */
    static getTxFilePath(contextDir: string, txHash: string): string {
        const cleanHash = txHash.replace(/[^a-zA-Z0-9_-]/g, '');
        return path.join(TransactionEngine.getTransactionsDir(contextDir), `TX-${cleanHash}.json`);
    }

    /**
     * Creates a new transaction manifest in PREPARED state with full SHA-256 snapshot.
     */
    static createTransaction(
        contextDir: string,
        plan: MutationPlan,
        snapshotMap: Map<string, string | null>,
        createdFiles: Array<string | CreatedFileEntry>,
        baseRevision: string,
        type: TransactionType = 'APPLY',
        targetTxHashes?: string[]
    ): TransactionManifest {
        const snapshot: TransactionSnapshotItem[] = [];

        for (const [filePath, content] of snapshotMap.entries()) {
            const contentHash = content !== null
                ? crypto.createHash('sha256').update(content).digest('hex')
                : '';
            const resolvedPath = path.resolve(contextDir, filePath);
            const relativePath = path.relative(contextDir, resolvedPath).replace(/\\/g, '/');
            snapshot.push({
                path: relativePath,
                relativePath,
                contentHash,
                content,
            });
        }

        const normalizedCreatedFiles: CreatedFileEntry[] = createdFiles.map(f => {
            if (typeof f === 'string') {
                const resolved = path.resolve(contextDir, f);
                const rel = path.relative(contextDir, resolved).replace(/\\/g, '/');
                return { relativePath: rel, afterHash: '' };
            }
            const resolved = path.resolve(contextDir, f.relativePath);
            const rel = path.relative(contextDir, resolved).replace(/\\/g, '/');
            return {
                relativePath: rel,
                afterHash: f.afterHash || '',
            };
        });

        const manifest: TransactionManifest = {
            txHash: plan.canonicalHash,
            type,
            targetTxHashes: targetTxHashes && targetTxHashes.length > 0 ? targetTxHashes : undefined,
            status: 'PREPARED',
            recoveryAttempts: 0,
            createdAt: new Date().toISOString(),
            source: plan.source ? {
                type: plan.source.type || 'conversation',
                model: plan.source.model,
                sessionTopic: plan.source.sessionTopic,
            } : undefined,
            baseRevision: baseRevision || plan.baseRevision || '',
            snapshot,
            createdFiles: normalizedCreatedFiles,
            plan,
        };

        const txPath = TransactionEngine.getTxFilePath(contextDir, plan.canonicalHash);
        safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');

        return manifest;
    }

    /**
     * Updates the status of an existing transaction manifest atomically.
     */
    static updateStatus(contextDir: string, txHash: string, status: TransactionStatus): TransactionManifest {
        const txPath = TransactionEngine.getTxFilePath(contextDir, txHash);
        if (!fs.existsSync(txPath)) {
            throw new Error(`Transaction manifest not found: ${txPath}`);
        }

        const raw = fs.readFileSync(txPath, 'utf-8');
        const manifest: TransactionManifest = JSON.parse(raw);
        manifest.status = status;

        safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');
        return manifest;
    }

    /**
     * Marks transaction as APPLYING.
     */
    static markApplying(contextDir: string, txHash: string): TransactionManifest {
        return TransactionEngine.updateStatus(contextDir, txHash, 'APPLYING');
    }

    /**
     * Marks transaction as COMMITTED.
     */
    static markCommitted(contextDir: string, txHash: string): TransactionManifest {
        return TransactionEngine.updateStatus(contextDir, txHash, 'COMMITTED');
    }

    /**
     * Marks transaction as ROLLED_BACK.
     */
    static markRolledBack(contextDir: string, txHash: string): TransactionManifest {
        return TransactionEngine.updateStatus(contextDir, txHash, 'ROLLED_BACK');
    }

    /**
     * Resolves a relative or absolute path against contextDir and ensures it does not escape.
     */
    static resolveAndValidateJail(contextDir: string, targetPath: string): string {
        const resolved = path.resolve(contextDir, targetPath);
        const rel = path.relative(contextDir, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`Security violation: Path "${targetPath}" escapes context jail.`);
        }
        return resolved;
    }

    /**
     * Checks if there are any pending failed or recovery-required transactions,
     * including corrupted transactions in quarantine (P2-B).
     */
    static hasPendingRecovery(contextDir: string): TransactionManifest | null {
        const transactionsDir = TransactionEngine.getTransactionsDir(contextDir);
        if (fs.existsSync(transactionsDir)) {
            const files = fs.readdirSync(transactionsDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));
            for (const file of files) {
                try {
                    const raw = fs.readFileSync(path.join(transactionsDir, file), 'utf-8');
                    const manifest: TransactionManifest = JSON.parse(raw);
                    if (manifest.status === 'RECOVERY_REQUIRED' || manifest.status === 'FAILED') {
                        return manifest;
                    }
                } catch {}
            }
        }

        // [P2-B] Verifica existência de manifestos corrompidos em .pactx/quarantine/
        const quarantineDir = path.join(contextDir, '.pactx', 'quarantine');
        if (fs.existsSync(quarantineDir)) {
            const corruptFiles = fs.readdirSync(quarantineDir).filter(f => f.endsWith('.corrupt'));
            if (corruptFiles.length > 0) {
                const firstCorrupt = corruptFiles[0];
                const cleanHash = path.basename(firstCorrupt, '.corrupt').replace(/^TX-/, '');
                return {
                    txHash: cleanHash,
                    status: 'RECOVERY_REQUIRED',
                    type: 'APPLY',
                    recoveryAttempts: 0,
                    createdAt: new Date().toISOString(),
                    baseRevision: '',
                    snapshot: [],
                    createdFiles: [],
                    plan: {} as any,
                };
            }
        }

        return null;
    }

    /**
     * Scans .pactx/transactions/ for orphaned PREPARED or APPLYING transactions
     * and performs auto-recovery under ContextLock with anti-loop protection.
     */
    static runAutoRecovery(contextDir: string, lockHeld: boolean = false): { recovered: string[]; failed: string[]; quarantined: string[] } {
        let lock: ContextLock | null = null;
        if (!lockHeld) {
            lock = new ContextLock(contextDir);
            lock.acquire();
        }

        const recovered: string[] = [];
        const failed: string[] = [];
        const quarantined: string[] = [];

        try {
            const transactionsDir = TransactionEngine.getTransactionsDir(contextDir);
            const files = fs.readdirSync(transactionsDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));

            for (const file of files) {
                const txPath = path.join(transactionsDir, file);
                let manifest: TransactionManifest;

                try {
                    const raw = fs.readFileSync(txPath, 'utf-8');
                    manifest = JSON.parse(raw);
                } catch {
                    // [P1-02] Quarentena de WAL Corrompido: move para .pactx/quarantine/ sem nunca deletar
                    const quarantineDir = path.join(contextDir, '.pactx', 'quarantine');
                    if (!fs.existsSync(quarantineDir)) {
                        fs.mkdirSync(quarantineDir, { recursive: true });
                    }
                    const corruptDest = path.join(quarantineDir, `${path.basename(file, '.json')}.corrupt`);
                    try {
                        fs.renameSync(txPath, corruptDest);
                    } catch {
                        try {
                            const raw = fs.readFileSync(txPath, 'utf-8');
                            fs.writeFileSync(corruptDest, raw, 'utf-8');
                            fs.unlinkSync(txPath);
                        } catch {}
                    }
                    quarantined.push(file);
                    console.error(pc.red(`[PactX] Auto-recovery: Corrupt transaction manifest quarantined: ${file}. Recovery required before mutating.`));
                    failed.push(file);
                    continue;
                }

                if (manifest.status === 'RECOVERY_REQUIRED' || manifest.status === 'FAILED') {
                    continue;
                }

                if (manifest.status === 'PREPARED' || manifest.status === 'APPLYING') {
                    manifest.recoveryAttempts = (manifest.recoveryAttempts || 0) + 1;

                    if (manifest.recoveryAttempts >= 3) {
                        manifest.status = 'FAILED';
                        safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');
                        console.error(pc.red(`[PactX] Auto-recovery: Transaction TX-${manifest.txHash} failed recovery after 3 attempts and was marked as FAILED.`));
                        failed.push(manifest.txHash);
                        continue;
                    }

                    try {
                        // 1. Validação de integridade dos snapshots
                        for (const item of manifest.snapshot) {
                            if (item.content !== null && item.contentHash) {
                                const actualHash = crypto.createHash('sha256').update(item.content).digest('hex');
                                if (actualHash !== item.contentHash) {
                                    throw new Error(`Integrity violation: contentHash mismatch for ${item.path}`);
                                }
                            }
                        }

                        // [P1-04] Recovery Ciente de Conflitos: verifica se arquivos criados foram modificados pós-crash
                        let conflictDetected = false;
                        if (Array.isArray(manifest.createdFiles)) {
                            for (const entry of manifest.createdFiles) {
                                const relPath = typeof entry === 'string' ? entry : entry.relativePath;
                                const expectedHash = typeof entry === 'string' ? '' : entry.afterHash;
                                const destPath = TransactionEngine.resolveAndValidateJail(contextDir, relPath);
                                if (fs.existsSync(destPath) && expectedHash) {
                                    const currentContent = fs.readFileSync(destPath, 'utf-8');
                                    const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
                                    if (currentHash !== expectedHash) {
                                        conflictDetected = true;
                                        break;
                                    }
                                }
                            }
                        }

                        if (conflictDetected) {
                            manifest.status = 'RECOVERY_REQUIRED';
                            safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');
                            console.error(pc.red(`[PactX] Auto-recovery: Conflict detected for TX-${manifest.txHash} (created file modified post-crash). Status set to RECOVERY_REQUIRED.`));
                            failed.push(manifest.txHash);
                            continue;
                        }

                        // 2. Restauração dos arquivos canônicos com validação de Jail
                        for (const item of manifest.snapshot) {
                            const destPath = TransactionEngine.resolveAndValidateJail(contextDir, item.relativePath || item.path);
                            if (item.content === null) {
                                if (fs.existsSync(destPath)) {
                                    try { fs.unlinkSync(destPath); } catch {}
                                }
                            } else {
                                safeAtomicWriteFileSync(destPath, item.content, 'utf-8');
                            }
                        }

                        // 3. Remoção de arquivos criados inconsistentes com validação de Jail (PREPARED e APPLYING)
                        if (Array.isArray(manifest.createdFiles)) {
                            for (const entry of manifest.createdFiles) {
                                const relPath = typeof entry === 'string' ? entry : entry.relativePath;
                                const expectedHash = typeof entry === 'string' ? '' : entry.afterHash;
                                const destPath = TransactionEngine.resolveAndValidateJail(contextDir, relPath);
                                if (fs.existsSync(destPath)) {
                                    if (!expectedHash) {
                                        try { fs.unlinkSync(destPath); } catch {}
                                    } else {
                                        const currentContent = fs.readFileSync(destPath, 'utf-8');
                                        const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
                                        if (currentHash === expectedHash) {
                                            try { fs.unlinkSync(destPath); } catch {}
                                        }
                                    }
                                }
                            }
                        }

                        // 4. Sincronização atômica WAL ↔ Ledger (remove transação revertida de ledger.json)
                        const historyFile = path.join(contextDir, '.pactx', 'ledger.json');
                        if (fs.existsSync(historyFile)) {
                            try {
                                const ledgerRaw = fs.readFileSync(historyFile, 'utf-8');
                                const ledger = JSON.parse(ledgerRaw);
                                if (Array.isArray(ledger.applied_updates)) {
                                    const initialLen = ledger.applied_updates.length;
                                    const hashesToRemove = new Set([manifest.txHash, ...(manifest.targetTxHashes || [])]);
                                    ledger.applied_updates = ledger.applied_updates.filter((u: any) => !hashesToRemove.has(u.hash));
                                    if (ledger.applied_updates.length !== initialLen) {
                                        safeAtomicWriteFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');
                                    }
                                }
                            } catch {}
                        }

                        manifest.status = 'ROLLED_BACK';
                        safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');
                        console.log(pc.yellow(`[PactX] Auto-recovery: Orphaned transaction TX-${manifest.txHash} was cleanly rolled back.`));
                        recovered.push(manifest.txHash);

                    } catch (recoveryErr: any) {
                        safeAtomicWriteFileSync(txPath, JSON.stringify(manifest, null, 2), 'utf-8');
                        console.error(pc.red(`[PactX] Auto-recovery attempt ${manifest.recoveryAttempts} failed for TX-${manifest.txHash}: ${recoveryErr.message}`));
                    }
                }
            }
        } finally {
            if (lock) {
                lock.release();
            }
        }

        return { recovered, failed, quarantined };
    }

    /**
     * Prunes finalized transactions older than maxAgeDays or exceeding maxTransactions limit under ContextLock.
     */
    static pruneTransactions(
        contextDir: string,
        maxTransactions: number = 50,
        maxAgeDays: number = 30,
        lockHeld: boolean = false
    ): void {
        let lock: ContextLock | null = null;
        if (!lockHeld) {
            lock = new ContextLock(contextDir);
            lock.acquire();
        }
        try {
            const transactionsDir = TransactionEngine.getTransactionsDir(contextDir);
            const files = fs.readdirSync(transactionsDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));

            const finalizedManifests: Array<{ path: string; createdAt: number }> = [];
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            const now = Date.now();

            for (const file of files) {
                const txPath = path.join(transactionsDir, file);
                try {
                    const raw = fs.readFileSync(txPath, 'utf-8');
                    const manifest: TransactionManifest = JSON.parse(raw);

                    // NUNCA podar transações RECOVERY_REQUIRED ou FAILED
                    if (manifest.status === 'RECOVERY_REQUIRED' || manifest.status === 'FAILED') {
                        continue;
                    }

                    if (manifest.status === 'COMMITTED' || manifest.status === 'ROLLED_BACK') {
                        const createdTime = manifest.createdAt ? new Date(manifest.createdAt).getTime() : 0;
                        if (now - createdTime > maxAgeMs) {
                            try { fs.unlinkSync(txPath); } catch {}
                        } else {
                            finalizedManifests.push({ path: txPath, createdAt: createdTime });
                        }
                    }
                } catch {
                    // Ignore corrupt files during pruning
                }
            }

            if (finalizedManifests.length > maxTransactions) {
                finalizedManifests.sort((a, b) => a.createdAt - b.createdAt);
                const toDeleteCount = finalizedManifests.length - maxTransactions;
                for (let i = 0; i < toDeleteCount; i++) {
                    try { fs.unlinkSync(finalizedManifests[i].path); } catch {}
                }
            }
        } catch {
            // Pruning is non-blocking
        } finally {
            if (lock) {
                lock.release();
            }
        }
    }
}
