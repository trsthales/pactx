import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import pc from 'picocolors';
import { bootstrapPactx } from '../core/bootstrap';
import { getGitState } from '../git';
import { getCurrentContextRevision } from '../composer';
import { HistoryLedger } from '../update/types';
import { getActiveSession, ActiveSessionData } from '../telemetry/sessionStore';
import { getSessionAnchors } from '../telemetry/anchorScanner';
import { calculateContextHealth } from '../telemetry/contextHealth';
import { ContextHealthReport, MicroAnchorEntry } from '../telemetry/types';

export interface StatusData {
    project: {
        name: string;
        version: string;
        stack: string[];
    };
    state: {
        activeTask: string;
        status: string;
        recommendedModel: string;
        factsCount: number;
        discardedHypothesesCount: number;
        completedItemsCount: number;
    };
    requirements: {
        total: number;
        active: number;
        draft: number;
        deprecated: number;
        satisfiedCount: number;
        satisfactionPercentage: number;
    };
    decisions: {
        total: number;
        active: number;
        superseded: number;
    };
    glossary: {
        termsCount: number;
    };
    git: {
        isGit: boolean;
        branch: string;
        recentCommitsCount: number;
        modifiedFilesCount: number;
    };
    contextRevision: string;
    lastMutation: {
        hash?: string;
        appliedAt?: string;
        task?: string;
        forced?: boolean;
    } | null;
    lock: {
        isLocked: boolean;
        pid?: number;
    };
}

export interface TelemetryStatusData {
    session: ActiveSessionData | null;
    healthReport: ContextHealthReport | null;
    anchors: MicroAnchorEntry[];
}

export interface StatusOptions {
    json?: boolean;
    telemetry?: boolean;
}

function parseFrontmatter<T = any>(content: string): { data: T; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { data: {} as T, body: content };
    }
    try {
        const data = yaml.parse(match[1]) || {};
        return { data, body: match[2] };
    } catch {
        return { data: {} as T, body: match[2] };
    }
}

export function getTelemetryData(contextDir: string): TelemetryStatusData {
    const session = getActiveSession(contextDir);
    const anchors = getSessionAnchors(contextDir);
    if (!session) {
        return { session: null, healthReport: null, anchors: [] };
    }

    const sessionAgeMinutes = Math.max(0, Math.round((Date.now() - new Date(session.sessionStartedAt).getTime()) / 60000));
    const estimatedTurns = Math.max(1, Math.round(sessionAgeMinutes / 3));
    const avgTokensPerTurn = 800;
    const totalEstimatedTokens = session.packTokenEstimate + (estimatedTurns * avgTokensPerTurn);

    const healthReport = calculateContextHealth({
        estimatedTokensUsed: totalEstimatedTokens,
        modelName: session.modelName,
        confidence: 'estimated',
        turnsCount: estimatedTurns,
    });

    return { session, healthReport, anchors };
}

export function getStatusData(cwd: string = process.cwd()): StatusData {
    const { contextDir, projectRoot } = bootstrapPactx(cwd, { autoRecovery: false });

    // 1. project.md
    let projectName = path.basename(projectRoot);
    let projectVersion = '0.1.0';
    let stack: string[] = [];
    const projectFile = path.join(contextDir, 'project.md');
    if (fs.existsSync(projectFile)) {
        const { data } = parseFrontmatter(fs.readFileSync(projectFile, 'utf-8'));
        if (data.project) projectName = data.project;
        if (data.version) projectVersion = data.version;
        if (Array.isArray(data.stack)) stack = data.stack;
    }

    // 2. state.md
    let activeTask = '(No active task)';
    let stateStatus = 'UNKNOWN';
    let recommendedModel = 'Medium';
    let factsCount = 0;
    let discardedHypothesesCount = 0;
    let completedItemsCount = 0;

    const stateFile = path.join(contextDir, 'state.md');
    if (fs.existsSync(stateFile)) {
        const { data, body } = parseFrontmatter(fs.readFileSync(stateFile, 'utf-8'));
        if (data.active_task) activeTask = data.active_task;
        if (data.status) stateStatus = data.status;
        if (data.recommended_model) recommendedModel = data.recommended_model;

        const sections = body.split(/^#\s+/m);
        for (const sec of sections) {
            const lines = sec.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('-'));
            if (sec.toLowerCase().startsWith('facts & discoveries') || sec.toLowerCase().startsWith('facts')) {
                factsCount = lines.filter(l => !l.includes('(None)') && !l.includes('(Record here')).length;
            } else if (sec.toLowerCase().startsWith('rejected hypotheses') || sec.toLowerCase().startsWith('known errors')) {
                discardedHypothesesCount = lines.filter(l => !l.includes('(None)') && !l.includes('(Record here')).length;
            } else if (sec.toLowerCase().startsWith('recently completed')) {
                completedItemsCount = lines.filter(l => !l.includes('(No items)')).length;
            }
        }
    }

    // 3. requirements.md
    let totalReqs = 0;
    let activeReqs = 0;
    let draftReqs = 0;
    let deprecatedReqs = 0;
    let satisfiedCount = 0;

    const reqFile = path.join(contextDir, 'requirements.md');
    if (fs.existsSync(reqFile)) {
        const { data } = parseFrontmatter(fs.readFileSync(reqFile, 'utf-8'));
        if (Array.isArray(data.requirements)) {
            totalReqs = data.requirements.length;
            for (const r of data.requirements) {
                const status = (r.status || 'active').toLowerCase();
                if (status === 'active') activeReqs++;
                else if (status === 'draft') draftReqs++;
                else if (status === 'deprecated') deprecatedReqs++;

                if (Array.isArray(r.satisfied_by) && r.satisfied_by.length > 0) {
                    satisfiedCount++;
                }
            }
        }
    }
    const satisfactionPercentage = activeReqs > 0 ? Math.round((satisfiedCount / activeReqs) * 100) : 0;

    // 4. decisions/
    let activeAdrs = 0;
    let supersededAdrs = 0;
    const decisionsDir = path.join(contextDir, 'decisions');
    if (fs.existsSync(decisionsDir)) {
        const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
            const { data } = parseFrontmatter(fs.readFileSync(path.join(decisionsDir, f), 'utf-8'));
            const status = (data.status || 'active').toLowerCase();
            if (status === 'superseded') supersededAdrs++;
            else activeAdrs++;
        }
    }

    // 5. glossary.md
    let termsCount = 0;
    const glossaryFile = path.join(contextDir, 'glossary.md');
    if (fs.existsSync(glossaryFile)) {
        const content = fs.readFileSync(glossaryFile, 'utf-8');
        const matches = content.match(/^[ \t]*-[ \t]+\*\*[^*]+\*\*:/gm);
        termsCount = matches ? matches.length : 0;
    }

    // 6. Git State
    const gitState = getGitState(projectRoot);

    // 7. Context Revision
    const contextRevision = getCurrentContextRevision(contextDir);

    // 8. Last Mutation from Ledger
    let lastMutation: StatusData['lastMutation'] = null;
    const ledgerFile = path.join(contextDir, '.pactx', 'ledger.json');
    if (fs.existsSync(ledgerFile)) {
        try {
            const ledger: HistoryLedger = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
            if (ledger.applied_updates && ledger.applied_updates.length > 0) {
                const last = ledger.applied_updates[ledger.applied_updates.length - 1];
                lastMutation = {
                    hash: last.hash,
                    appliedAt: last.applied_at,
                    task: last.task,
                    forced: last.forced,
                };
            }
        } catch {}
    }

    // 9. Lock Status
    let isLocked = false;
    let lockPid: number | undefined;
    const lockFile = path.join(contextDir, '.pactx', '.pactx.lock');
    if (fs.existsSync(lockFile)) {
        isLocked = true;
        try {
            const lockContent = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
            if (lockContent.pid) lockPid = lockContent.pid;
        } catch {}
    }

    return {
        project: {
            name: projectName,
            version: projectVersion,
            stack,
        },
        state: {
            activeTask,
            status: stateStatus,
            recommendedModel,
            factsCount,
            discardedHypothesesCount,
            completedItemsCount,
        },
        requirements: {
            total: totalReqs,
            active: activeReqs,
            draft: draftReqs,
            deprecated: deprecatedReqs,
            satisfiedCount,
            satisfactionPercentage,
        },
        decisions: {
            total: activeAdrs + supersededAdrs,
            active: activeAdrs,
            superseded: supersededAdrs,
        },
        glossary: {
            termsCount,
        },
        git: {
            isGit: gitState.isGit,
            branch: gitState.branch || 'detached',
            recentCommitsCount: gitState.recentCommits.length,
            modifiedFilesCount: gitState.modifiedFiles.length,
        },
        contextRevision,
        lastMutation,
        lock: {
            isLocked,
            pid: lockPid,
        },
    };
}

export function renderStatus(cwd: string = process.cwd(), options: StatusOptions = {}): void {
    const { contextDir } = bootstrapPactx(cwd, { autoRecovery: false });
    const data = getStatusData(cwd);

    if (options.telemetry) {
        const telemetryData = getTelemetryData(contextDir);

        if (options.json) {
            console.log(JSON.stringify({ ...data, telemetry: telemetryData }, null, 2));
            return;
        }

        console.log(pc.bold(pc.cyan(`\n📦 PactX Context Telemetry — ${data.project.name} (v${data.project.version})`)));
        console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

        if (!telemetryData.session || !telemetryData.healthReport) {
            console.log(pc.yellow('Status: IDLE / NO ACTIVE SESSION. Run \'pactx\' to generate a context pack and start a session.'));
            console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));
            return;
        }

        const { session, healthReport, anchors } = telemetryData;
        const sessionAgeMinutes = Math.max(0, Math.round((Date.now() - new Date(session.sessionStartedAt).getTime()) / 60000));
        const estimatedTurns = healthReport.consumption.turnsCount;

        const decCount = anchors.filter(a => a.type === 'dec').length;
        const rejCount = anchors.filter(a => a.type === 'rej').length;
        const factCount = anchors.filter(a => a.type === 'fact').length;

        const statusBadge = data.state.status === 'COMPLETED'
            ? pc.green(`[${data.state.status}]`)
            : data.state.status === 'BLOCKED'
            ? pc.red(`[${data.state.status}]`)
            : pc.cyan(`[${data.state.status}]`);

        console.log(`${pc.bold('🎯 Active Task:')}     ${pc.white(data.state.activeTask)} ${statusBadge}`);
        console.log(`${pc.bold('🤖 Model Profile:')}   ${pc.yellow(healthReport.model.name)} (${healthReport.model.maxTokens.toLocaleString()} tokens)`);
        console.log(`${pc.bold('🔑 Context Rev:')}     ${pc.magenta(data.contextRevision)}`);

        // ANSI Progress Bar (30 chars)
        const saturation = healthReport.consumption.saturationPercent;
        const filledCount = Math.min(30, Math.max(0, Math.round((saturation / 100) * 30)));
        const unfilledCount = 30 - filledCount;
        const filledBlock = '█'.repeat(filledCount);
        const unfilledBlock = '░'.repeat(unfilledCount);

        let coloredFilled = pc.green(filledBlock);
        let gradeBadge = pc.green(`[${healthReport.health.grade}]`);
        if (healthReport.health.grade === 'WATCH') {
            coloredFilled = pc.cyan(filledBlock);
            gradeBadge = pc.cyan(`[${healthReport.health.grade}]`);
        } else if (healthReport.health.grade === 'CAUTION') {
            coloredFilled = pc.yellow(filledBlock);
            gradeBadge = pc.yellow(`[${healthReport.health.grade}]`);
        } else if (healthReport.health.grade === 'WARNING') {
            coloredFilled = pc.magenta(filledBlock);
            gradeBadge = pc.magenta(`[${healthReport.health.grade}]`);
        } else if (healthReport.health.grade === 'CRITICAL') {
            coloredFilled = pc.red(filledBlock);
            gradeBadge = pc.red(`[${healthReport.health.grade}]`);
        }

        const bar = `[${coloredFilled}${pc.dim(unfilledBlock)}]`;

        console.log(pc.bold('\n📊 Session Metrics:'));
        console.log(`   • Pack Initial:   ~${session.packTokenEstimate.toLocaleString()} tokens (ESTIMATED)`);
        console.log(`   • Session Age:    ${sessionAgeMinutes} min (Est. ${estimatedTurns} turns)`);
        console.log(`   • Tokens Used:    ~${healthReport.consumption.estimatedTokens.toLocaleString()} tokens [${saturation.toFixed(0)}% of window]`);
        console.log(`   • Anchors Logged: ${anchors.length} captured (${decCount} DEC, ${rejCount} REJ, ${factCount} FACT)`);
        console.log(`   • Context Health: ${healthReport.health.score}/100 ${gradeBadge}`);
        console.log(`   • Confidence:     ${healthReport.health.confidence.toUpperCase()}`);

        console.log(`\n   ──── Session Timeline ────────────────────────────────`);
        console.log(`   ${bar} ${saturation.toFixed(0)}%`);
        console.log(`   0%      ↑ here     70% ⚡ handoff   85% 💀 cliff   100%`);
        console.log(`   ──────────────────────────────────────────────────────`);

        console.log(`\n💡 Recommendation: ${pc.bold(healthReport.recommendation.message)}`);
        console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));
        return;
    }

    if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
    }

    const statusBadge = data.state.status === 'COMPLETED'
        ? pc.green(`[${data.state.status}]`)
        : data.state.status === 'BLOCKED'
        ? pc.red(`[${data.state.status}]`)
        : pc.cyan(`[${data.state.status}]`);

    console.log(pc.bold(pc.cyan(`\n📦 PactX Status — ${data.project.name} (v${data.project.version})`)));
    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));
    console.log(`${pc.bold('🎯 Active Task:')}     ${pc.white(data.state.activeTask)} ${statusBadge}`);
    console.log(`${pc.bold('🤖 Recommended:')}     ${pc.yellow(data.state.recommendedModel)} Reasoning`);
    if (data.git.isGit) {
        console.log(`${pc.bold('🌿 Git Branch:')}      ${pc.green(data.git.branch)} (${data.git.recentCommitsCount} recent commits, ${data.git.modifiedFilesCount} modified)`);
    } else {
        console.log(`${pc.bold('🌿 Git Branch:')}      ${pc.dim('Not a git repository')}`);
    }
    console.log(`${pc.bold('🔑 Context Rev:')}     ${pc.magenta(data.contextRevision)}`);

    console.log(pc.bold('\n📊 Cognitive Memory:'));
    console.log(`   • 📋 Requirements: ${pc.bold(data.requirements.active.toString())} Active (${pc.green(`${data.requirements.satisfactionPercentage}% Satisfied`)})`);
    console.log(`   • 🏛️  ADRs:         ${pc.bold(data.decisions.active.toString())} Active | ${pc.yellow(data.decisions.superseded.toString())} Superseded`);
    console.log(`   • 💡 Facts:         ${pc.bold(data.state.factsCount.toString())} Recorded`);
    console.log(`   • 🚫 Discarded:     ${pc.bold(data.state.discardedHypothesesCount.toString())} Hypotheses`);
    console.log(`   • 📖 Glossary:      ${pc.bold(data.glossary.termsCount.toString())} Defined Terms`);

    if (data.lastMutation) {
        const dateStr = data.lastMutation.appliedAt ? new Date(data.lastMutation.appliedAt).toLocaleString() : 'Unknown';
        console.log(`\n${pc.bold('⏰ Last Mutation:')}   ${dateStr} (Hash: ${pc.dim(data.lastMutation.hash?.substring(0, 8) || 'N/A')})`);
        if (data.lastMutation.task) {
            console.log(`${pc.bold('🎯 Task at apply:')}  "${data.lastMutation.task}"`);
        }
    } else {
        console.log(`\n${pc.bold('⏰ Last Mutation:')}   ${pc.dim('(No mutations applied yet)')}`);
    }

    const lockStatusStr = data.lock.isLocked
        ? pc.red(`Locked (PID: ${data.lock.pid || 'unknown'})`)
        : pc.green('Unlocked');
    console.log(`${pc.bold('🔒 Lock Status:')}     ${lockStatusStr}`);
    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));
}
