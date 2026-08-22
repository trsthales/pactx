import { execSync } from 'node:child_process';

export interface GitState {
    isGit: boolean;
    branch: string;
    recentCommits: string[];
    modifiedFiles: string[];
}

export function getGitState(cwd: string = process.cwd()): GitState {
    try {
        execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    } catch {
        return { isGit: false, branch: '', recentCommits: [], modifiedFiles: [] };
    }

    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();

    let recentCommits: string[] = [];
    try {
        // Falha com erro fatal em repositórios sem nenhum commit ainda (HEAD inexistente)
        const rawCommits = execSync('git log -n 3 --oneline', { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        recentCommits = rawCommits ? rawCommits.split(/\r?\n/) : [];
    } catch {
        recentCommits = [];
    }

    const rawStatus = execSync('git status --short', { cwd, encoding: 'utf-8' }).trim();
    const modifiedFiles = rawStatus ? rawStatus.split(/\r?\n/).map((line: string) => line.trim()) : [];

    return {
        isGit: true,
        branch,
        recentCommits,
        modifiedFiles,
    };
}