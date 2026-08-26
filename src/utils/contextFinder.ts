import fs from 'node:fs';
import path from 'node:path';
import { getGitRoot } from '../git';

/**
 * Traverses up from startDir until it finds a directory containing '.ai-context'.
 * Does not ascend past the Git repository root (if inside a git worktree).
 * Throws an error if the root of the filesystem or Git repository is reached without finding it.
 */
export function findContextDir(startDir: string = process.cwd()): string {
    let currentDir = path.resolve(startDir);
    const gitRoot = getGitRoot(currentDir);

    while (true) {
        const candidate = path.join(currentDir, '.ai-context');
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch {
            // Ignore permission or file system errors and continue ascending
        }

        // Se chegamos na raiz do Git e não encontramos .ai-context, não subimos além do repositório Git (P2-06)
        if (gitRoot && currentDir === gitRoot) {
            throw new Error(".ai-context folder not found in this repository. Run 'pactx init' to initialize.");
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error(".ai-context folder not found in this repository. Run 'pactx init' to initialize.");
        }
        currentDir = parentDir;
    }
}

/**
 * Returns the project root directory (parent of .ai-context) discovered from startDir.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
    return path.dirname(findContextDir(startDir));
}
