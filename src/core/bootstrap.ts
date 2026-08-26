import { findContextDir, findProjectRoot } from '../utils/contextFinder';
import { ensureStorageLayout } from '../update/migration';
import { TransactionEngine } from '../update/transaction';

export interface BootstrapOptions {
    autoRecovery?: boolean;
}

export interface BootstrapResult {
    contextDir: string;
    projectRoot: string;
}

/**
 * Centralized bootstrap routine for all PactX operations.
 * 1. Discovers the canonical context directory and project root.
 * 2. Ensures the internal storage layout (.ai-context/.pactx/transactions/).
 * 3. Runs transparent auto-recovery for interrupted transactions under ContextLock (if autoRecovery is true).
 */
export function bootstrapPactx(
    cwd: string = process.cwd(),
    options: BootstrapOptions = { autoRecovery: true }
): BootstrapResult {
    const contextDir = findContextDir(cwd);
    const projectRoot = findProjectRoot(cwd);

    ensureStorageLayout(contextDir);
    if (options.autoRecovery !== false) {
        TransactionEngine.runAutoRecovery(contextDir);
    }

    return {
        contextDir,
        projectRoot,
    };
}
