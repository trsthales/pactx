import { execSync } from 'node:child_process';

export interface GitState {
    isGit: boolean;
    branch: string;
    recentCommits: string[];
    modifiedFiles: string[];
}

export function getGitState(): GitState {
    try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    } catch {
        return { isGit: false, branch: '', recentCommits: [], modifiedFiles: [] };
    }

    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

    let recentCommits: string[] = [];
    try {
        // Falha com erro fatal em repositórios sem nenhum commit ainda (HEAD inexistente)
        const rawCommits = execSync('git log -n 3 --oneline', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        recentCommits = rawCommits ? rawCommits.split('\n') : [];
    } catch {
        recentCommits = [];
    }

    const rawStatus = execSync('git status --short', { encoding: 'utf-8' }).trim();
    const modifiedFiles = rawStatus ? rawStatus.split('\n').map((line: string) => line.trim()) : [];

    return {
        isGit: true,
        branch,
        recentCommits,
        modifiedFiles,
    };
}