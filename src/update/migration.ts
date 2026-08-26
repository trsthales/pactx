import fs from 'node:fs';
import path from 'node:path';
import { HistoryLedger, HistoryEntry } from './types';
import { safeAtomicWriteFileSync } from './applier';
import { ContextLock } from './lock';

const MAX_HISTORY_ENTRIES = 500;

/**
 * Ensures the internal storage layout (.ai-context/.pactx/transactions/) exists,
 * seamlessly migrates legacy .pactx-history.json to .pactx/ledger.json under ContextLock,
 * merges dual-layout conflicts deduplicating by hash, and cleans up legacy root lockfiles.
 */
export function ensureStorageLayout(contextDir: string, lockHeld: boolean = false): void {
    const pactxDir = path.join(contextDir, '.pactx');
    const transactionsDir = path.join(pactxDir, 'transactions');

    if (!fs.existsSync(transactionsDir)) {
        fs.mkdirSync(transactionsDir, { recursive: true });
    }

    const legacyHistoryPath = path.join(contextDir, '.pactx-history.json');
    const legacyLockPath = path.join(contextDir, '.pactx.lock');
    const hasLegacy = fs.existsSync(legacyHistoryPath) || fs.existsSync(legacyLockPath);

    if (!hasLegacy) {
        return;
    }

    // Se existem arquivos legados que necessitam de migração/limpeza, executa sob ContextLock (P2-1)
    let lock: ContextLock | null = null;
    if (!lockHeld) {
        lock = new ContextLock(contextDir);
        lock.acquire();
    }

    try {
        const currentLedgerPath = path.join(pactxDir, 'ledger.json');
        const hasLegacyHistory = fs.existsSync(legacyHistoryPath);
        const hasCurrentLedger = fs.existsSync(currentLedgerPath);
        if (hasLegacyHistory && !hasCurrentLedger) {
            // Migração simples v0.2.x -> v0.3.0
            try {
                const raw = fs.readFileSync(legacyHistoryPath, 'utf-8');
                // Validar que é JSON antes de gravar
                JSON.parse(raw);
                safeAtomicWriteFileSync(currentLedgerPath, raw, 'utf-8');
                fs.unlinkSync(legacyHistoryPath);
            } catch {
                // Se o arquivo contiver JSON inválido ou falhar, movemos mesmo assim para o applier/planner falhar com fail-closed
                try {
                    fs.renameSync(legacyHistoryPath, currentLedgerPath);
                } catch {
                    const raw = fs.readFileSync(legacyHistoryPath, 'utf-8');
                    safeAtomicWriteFileSync(currentLedgerPath, raw, 'utf-8');
                    try { fs.unlinkSync(legacyHistoryPath); } catch {}
                }
            }
        } else if (hasLegacyHistory && hasCurrentLedger) {
        // Conflito de layout duplo (downgrade / upgrade)
        try {
            const legacyRaw = fs.readFileSync(legacyHistoryPath, 'utf-8');
            const currentRaw = fs.readFileSync(currentLedgerPath, 'utf-8');

            const legacyLedger: HistoryLedger = JSON.parse(legacyRaw);
            const currentLedger: HistoryLedger = JSON.parse(currentRaw);

            const legacyEntries = Array.isArray(legacyLedger.applied_updates) ? legacyLedger.applied_updates : [];
            const currentEntries = Array.isArray(currentLedger.applied_updates) ? currentLedger.applied_updates : [];

            const map = new Map<string, HistoryEntry>();
            // Deduplica por hash
            for (const entry of legacyEntries) {
                if (entry && entry.hash) {
                    map.set(entry.hash, entry);
                }
            }
            for (const entry of currentEntries) {
                if (entry && entry.hash) {
                    map.set(entry.hash, entry);
                }
            }

            const combinedEntries = Array.from(map.values());
            combinedEntries.sort((a, b) => {
                const timeA = a.applied_at ? new Date(a.applied_at).getTime() : 0;
                const timeB = b.applied_at ? new Date(b.applied_at).getTime() : 0;
                return timeA - timeB;
            });

            const finalEntries = combinedEntries.length > MAX_HISTORY_ENTRIES
                ? combinedEntries.slice(-MAX_HISTORY_ENTRIES)
                : combinedEntries;

            const consolidatedLedger: HistoryLedger = {
                version: '1.0',
                applied_updates: finalEntries,
            };

            safeAtomicWriteFileSync(currentLedgerPath, JSON.stringify(consolidatedLedger, null, 2), 'utf-8');
            fs.unlinkSync(legacyHistoryPath);
        } catch (err: any) {
            throw new Error(`Integrity failure: Failed to merge legacy history during migration (${err.message}). Operation aborted.`);
        }
    }

        // Limpeza de lock legado na raiz de .ai-context/
        if (fs.existsSync(legacyLockPath)) {
            try {
                const stat = fs.statSync(legacyLockPath);
                if (Date.now() - stat.mtimeMs > 30000) {
                    fs.unlinkSync(legacyLockPath);
                }
            } catch {
                try { fs.unlinkSync(legacyLockPath); } catch {}
            }
        }
    } finally {
        if (lock) {
            lock.release();
        }
    }
}
