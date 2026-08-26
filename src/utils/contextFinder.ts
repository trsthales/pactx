import fs from 'node:fs';
import path from 'node:path';

/**
 * Traverses up from startDir until it finds a directory containing '.ai-context'.
 * Throws an error if the root of the filesystem is reached without finding it.
 */
export function findContextDir(startDir: string = process.cwd()): string {
    let currentDir = path.resolve(startDir);

    while (true) {
        const candidate = path.join(currentDir, '.ai-context');
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch {
            // Ignore permission or file system errors and continue ascending
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
