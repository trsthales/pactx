import { execFileSync } from 'node:child_process';

export interface GitState {
    isGit: boolean;
    branch: string;
    recentCommits: string[];
    modifiedFiles: string[];
}

export function getGitState(cwd: string = process.cwd()): GitState {
    try {
        execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
    } catch {
        return { isGit: false, branch: '', recentCommits: [], modifiedFiles: [] };
    }

    let branch = '';
    try {
        branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        branch = '';
    }

    let recentCommits: string[] = [];
    try {
        // Falha com erro fatal em repositórios sem nenhum commit ainda (HEAD inexistente)
        const rawCommits = execFileSync('git', ['log', '-n', '3', '--oneline'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        recentCommits = rawCommits ? rawCommits.split(/\r?\n/) : [];
    } catch {
        recentCommits = [];
    }

    let modifiedFiles: string[] = [];
    try {
        const rawStatus = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        modifiedFiles = rawStatus ? rawStatus.split(/\r?\n/).map((line: string) => line.trim()) : [];
    } catch {
        modifiedFiles = [];
    }

    return {
        isGit: true,
        branch,
        recentCommits,
        modifiedFiles,
    };
}