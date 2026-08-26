import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import pc from 'picocolors';
import { bootstrapPactx } from '../core/bootstrap';
import { ContextLock } from '../update/lock';
import { TransactionEngine } from '../update/transaction';
import { TransactionManifest, HistoryLedger } from '../update/types';
import { safeAtomicWriteFileSync } from '../update/applier';
import { getCurrentContextRevision } from '../composer';

export interface RollbackOptions {
    yes?: boolean;
    dryRun?: boolean;
    forceCascade?: boolean;
}

export async function executeRollback(
    cwd: string = process.cwd(),
    targetHashArg?: string,
    options: RollbackOptions = {}
): Promise<void> {
    const { contextDir, projectRoot } = bootstrapPactx(cwd);
    const transactionsDir = TransactionEngine.getTransactionsDir(contextDir);
    const historyFile = path.join(contextDir, '.pactx', 'ledger.json');

    const lock = new ContextLock(contextDir);
    lock.acquire();

    try {
        // 1. Auto-recovery de integridade prévio sob lock
        TransactionEngine.runAutoRecovery(contextDir, true);

        // [P1-A] Trava de segurança: impede rollback se houver transações que requerem recuperação
        const pendingRecovery = TransactionEngine.hasPendingRecovery(contextDir);
        if (pendingRecovery) {
            lock.release();
            throw new Error(
                `Repository blocked: Transaction TX-${pendingRecovery.txHash} requires recovery ` +
                `(Status: ${pendingRecovery.status}). Run 'pactx doctor --fix' before rolling back.`
            );
        }

        // 2. Coleta de todas as transações COMMITTED (que não sejam do tipo ROLLBACK)
        const files = fs.readdirSync(transactionsDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));
        const committedManifests: TransactionManifest[] = [];

        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(transactionsDir, file), 'utf-8');
                const manifest: TransactionManifest = JSON.parse(raw);
                if (manifest.status === 'COMMITTED' && manifest.type !== 'ROLLBACK') {
                    committedManifests.push(manifest);
                }
            } catch {}
        }

        if (committedManifests.length === 0) {
            throw new Error('No committed transactions found to rollback.');
        }

        // Ordena cronologicamente crescente
        committedManifests.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        // 3. Localização da transação alvo
        let targetIdx = -1;
        if (targetHashArg) {
            const cleanHash = targetHashArg.trim().toLowerCase();
            targetIdx = committedManifests.findIndex(m => m.txHash.toLowerCase() === cleanHash || m.txHash.toLowerCase().startsWith(cleanHash));
            if (targetIdx === -1) {
                throw new Error(`Transaction "${targetHashArg}" not found among committed transactions.`);
            }
        } else {
            // LIFO padrão: pega a mais recente
            targetIdx = committedManifests.length - 1;
        }

        const targetTx = committedManifests[targetIdx];
        const subsequentTxs = committedManifests.slice(targetIdx + 1);

        // 4. Análise de Grafo e Dependências
        if (subsequentTxs.length > 0) {
            // Coleta entidades criadas na transação alvo
            const targetCreatedAdrIds = new Set((targetTx.plan.operations.createdAdrs || []).map(a => a.id.toUpperCase()));
            const targetCreatedReqIds = new Set((targetTx.plan.operations.createdRequirements || []).map(r => r.id.toUpperCase()));

            let conflictingDependency = '';

            for (const subTx of subsequentTxs) {
                // Checa se algum ADR posterior satisfaz requisito criado no target
                for (const adr of subTx.plan.operations.createdAdrs || []) {
                    if (adr.satisfies) {
                        for (const satId of adr.satisfies) {
                            if (targetCreatedReqIds.has(satId.toUpperCase())) {
                                conflictingDependency = `Subsequent decision ${adr.id} satisfies requirement ${satId}`;
                                break;
                            }
                        }
                    }
                    if (conflictingDependency) break;
                }
                // Checa se algum ADR posterior substitui ADR criado no target
                for (const subAdr of subTx.plan.operations.supersededAdrs || []) {
                    if (targetCreatedAdrIds.has(subAdr.id.toUpperCase()) || targetCreatedAdrIds.has(subAdr.supersededBy.toUpperCase())) {
                        conflictingDependency = `Subsequent decision ${subAdr.id} relates to ${subAdr.supersededBy}`;
                        break;
                    }
                }
                if (conflictingDependency) break;
            }

            if (conflictingDependency && !options.forceCascade) {
                throw new Error(
                    `Cannot rollback transaction TX-${targetTx.txHash.substring(0, 8)}: ${conflictingDependency}. ` +
                    `Use sequential rollbacks or --force-cascade.`
                );
            }

            if (!options.forceCascade && subsequentTxs.length > 0) {
                throw new Error(
                    `Transaction TX-${targetTx.txHash.substring(0, 8)} is not the latest committed transaction (${subsequentTxs.length} newer transactions exist). ` +
                    `To rollback all subsequent transactions down to this one, pass --force-cascade.`
                );
            }
        }

        // Fila de rollback em ordem LIFO estrita
        const rollbackQueue = [...subsequentTxs.reverse(), targetTx];
        const targetTxHashes = rollbackQueue.map(t => t.txHash);

        // 5. Exibição do Plano de Rollback
        console.log(pc.bold(pc.yellow(`\n⏪ PactX Rollback Plan (${rollbackQueue.length} transaction${rollbackQueue.length > 1 ? 's' : ''} to revert):`)));
        console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

        for (const tx of rollbackQueue) {
            const taskLabel = tx.plan.operations.stateUpdate?.activeTask ? ` [Task: ${tx.plan.operations.stateUpdate.activeTask}]` : '';
            console.log(pc.bold(pc.cyan(`\n📦 Transaction TX-${tx.txHash.substring(0, 8)}${taskLabel}`)));
            console.log(`   • Applied At: ${new Date(tx.createdAt).toLocaleString()}`);
            console.log(`   • Base Revision: ${tx.baseRevision || '(none)'}`);

            if (tx.createdFiles && tx.createdFiles.length > 0) {
                console.log(pc.red('   • Files to Delete:'));
                for (const f of tx.createdFiles) {
                    const rel = typeof f === 'string' ? f : f.relativePath;
                    console.log(pc.red(`     [-] ${rel}`));
                }
            }

            if (tx.snapshot && tx.snapshot.length > 0) {
                console.log(pc.yellow('   • Files to Restore from Snapshot:'));
                for (const s of tx.snapshot) {
                    if (s.content !== null) {
                        console.log(pc.yellow(`     [↺] ${s.relativePath || s.path}`));
                    }
                }
            }
        }

        console.log(pc.dim('\n────────────────────────────────────────────────────────────────────────────'));

        if (options.dryRun) {
            console.log(pc.green('🔍 --dry-run mode: Rollback plan simulated successfully. 0 files modified on disk.\n'));
            return;
        }

        const proceed = options.yes ? true : await new Promise<boolean>((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question(pc.bold('? Confirm rollback to previous state? (Y/n) '), (answer) => {
                rl.close();
                resolve(answer.trim().toLowerCase() === 'y' || answer.trim() === '');
            });
        });

        if (!proceed) {
            console.log(pc.yellow('✖ Rollback cancelled by user.\n'));
            return;
        }

        // 6. Preparação da Transação WAL de Rollback de Primeira Classe (P1-01 & P1-12)
        const rollbackTimestamp = Date.now();
        const rollbackTxHash = crypto.createHash('sha256')
            .update(`rollback-${targetTxHashes.join('-')}-${rollbackTimestamp}`)
            .digest('hex');

        // Cria snapshot em memória do estado atual antes da reversão
        const rollbackSnapshotMap = new Map<string, string | null>();
        for (const tx of rollbackQueue) {
            for (const item of tx.snapshot) {
                const targetPath = TransactionEngine.resolveAndValidateJail(contextDir, item.relativePath || item.path);
                if (!rollbackSnapshotMap.has(targetPath)) {
                    rollbackSnapshotMap.set(targetPath, fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null);
                }
            }
            if (Array.isArray(tx.createdFiles)) {
                for (const f of tx.createdFiles) {
                    const rel = typeof f === 'string' ? f : f.relativePath;
                    const targetPath = TransactionEngine.resolveAndValidateJail(contextDir, rel);
                    if (!rollbackSnapshotMap.has(targetPath)) {
                        rollbackSnapshotMap.set(targetPath, fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null);
                    }
                }
            }
        }
        if (fs.existsSync(historyFile) && !rollbackSnapshotMap.has(historyFile)) {
            rollbackSnapshotMap.set(historyFile, fs.readFileSync(historyFile, 'utf-8'));
        }

        const rollbackPlan = {
            schemaVersion: '1.1',
            canonicalHash: rollbackTxHash,
            isAlreadyApplied: false,
            warnings: [],
            operations: {
                createdRequirements: [],
                updatedRequirements: [],
                createdAdrs: [],
                supersededAdrs: [],
                appendedGlossaryTerms: [],
            },
        };

        const currentRev = getCurrentContextRevision(contextDir);
        TransactionEngine.createTransaction(
            contextDir,
            rollbackPlan,
            rollbackSnapshotMap,
            [],
            currentRev,
            'ROLLBACK',
            targetTxHashes
        );

        // Marca a transação de rollback como APPLYING
        TransactionEngine.markApplying(contextDir, rollbackTxHash);

        // 7. Aplica a reversão de todas as transações da fila
        for (const tx of rollbackQueue) {
            // 7.1. Restaura os arquivos a partir do snapshot
            for (const item of tx.snapshot) {
                const destPath = TransactionEngine.resolveAndValidateJail(contextDir, item.relativePath || item.path);
                if (item.content === null) {
                    if (fs.existsSync(destPath)) {
                        try { fs.unlinkSync(destPath); } catch {}
                    }
                } else {
                    safeAtomicWriteFileSync(destPath, item.content, 'utf-8');
                }
            }

            // 7.2. Deleção de arquivos criados
            if (Array.isArray(tx.createdFiles)) {
                for (const createdEntry of tx.createdFiles) {
                    const relPath = typeof createdEntry === 'string' ? createdEntry : createdEntry.relativePath;
                    const expectedHash = typeof createdEntry === 'string' ? '' : createdEntry.afterHash;
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

            // 7.3. Marca o manifesto alvo como ROLLED_BACK
            TransactionEngine.markRolledBack(contextDir, tx.txHash);
        }

        // 8. Atualiza o ledger removendo todas as transações revertidas
        let ledger: HistoryLedger = { version: '1.0', applied_updates: [] };
        if (fs.existsSync(historyFile)) {
            try {
                ledger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch {}
        }
        const revertSet = new Set(targetTxHashes);
        ledger.applied_updates = (ledger.applied_updates || []).filter(u => !revertSet.has(u.hash));
        safeAtomicWriteFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');

        // 9. Comita a transação de Rollback
        TransactionEngine.markCommitted(contextDir, rollbackTxHash);

        console.log(pc.green(`\n✔ Rollback executed successfully! ${rollbackQueue.length} transaction${rollbackQueue.length > 1 ? 's' : ''} reverted.`));
        console.log(pc.dim('📋 Ledger updated in .ai-context/.pactx/ledger.json\n'));

    } finally {
        lock.release();
    }
}
