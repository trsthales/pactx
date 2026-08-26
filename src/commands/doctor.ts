import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import pc from 'picocolors';
import { findContextDir } from '../utils/contextFinder';
import { ensureStorageLayout } from '../update/migration';
import { TransactionEngine } from '../update/transaction';
import { RequirementItem, HistoryLedger, TransactionManifest } from '../update/types';

export interface DiagnosticResult {
    id: number;
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: string[];
    fixable?: boolean;
}

export interface DoctorReport {
    results: DiagnosticResult[];
    hasErrors: boolean;
    hasWarnings: boolean;
    exitCode: number;
}

const VALID_STATE_STATUSES = ['IN_PROGRESS', 'BLOCKED', 'COMPLETED'];
const VALID_STATE_MODELS = ['Medium', 'High'];
const VALID_ADR_STATUSES = ['active', 'superseded'];

function parseFrontmatter<T = any>(content: string): { data: T; body: string; hasFm: boolean } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { data: {} as T, body: content, hasFm: false };
    }
    try {
        const data = yaml.parse(match[1]) || {};
        return { data, body: match[2], hasFm: true };
    } catch {
        return { data: {} as T, body: match[2], hasFm: false };
    }
}

export function runDiagnostics(cwd: string = process.cwd(), fix: boolean = false): DoctorReport {
    const contextDir = findContextDir(cwd);
    const results: DiagnosticResult[] = [];
    const fixesApplied: string[] = [];

    // Auto-fix preliminar: ensureStorageLayout
    if (fix) {
        try {
            ensureStorageLayout(contextDir);
        } catch {}
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 1: YAML Frontmatters
    // ─────────────────────────────────────────────────────────────────────────────
    const fmErrors: string[] = [];
    const projectFile = path.join(contextDir, 'project.md');
    if (fs.existsSync(projectFile)) {
        const parsed = parseFrontmatter(fs.readFileSync(projectFile, 'utf-8'));
        if (!parsed.hasFm) fmErrors.push('project.md missing valid YAML frontmatter delimiters (---).');
    }

    const stateFile = path.join(contextDir, 'state.md');
    if (fs.existsSync(stateFile)) {
        const parsed = parseFrontmatter(fs.readFileSync(stateFile, 'utf-8'));
        if (!parsed.hasFm) {
            fmErrors.push('state.md missing valid YAML frontmatter.');
        } else {
            if (parsed.data.status && !VALID_STATE_STATUSES.includes(parsed.data.status)) {
                fmErrors.push(`state.md contains invalid status: "${parsed.data.status}".`);
            }
            if (parsed.data.recommended_model && !VALID_STATE_MODELS.includes(parsed.data.recommended_model)) {
                fmErrors.push(`state.md contains invalid recommended_model: "${parsed.data.recommended_model}".`);
            }
        }
    }

    const reqFile = path.join(contextDir, 'requirements.md');
    if (fs.existsSync(reqFile)) {
        const parsed = parseFrontmatter(fs.readFileSync(reqFile, 'utf-8'));
        if (!parsed.hasFm) {
            fmErrors.push('requirements.md missing valid YAML frontmatter.');
        } else if (parsed.data.requirements !== undefined && !Array.isArray(parsed.data.requirements)) {
            fmErrors.push('requirements.md frontmatter field "requirements" must be an array.');
        }
    }

    const decisionsDir = path.join(contextDir, 'decisions');
    if (fs.existsSync(decisionsDir)) {
        const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const adrPath = path.join(decisionsDir, file);
            const parsed = parseFrontmatter(fs.readFileSync(adrPath, 'utf-8'));
            if (!parsed.hasFm) {
                fmErrors.push(`decisions/${file} missing valid YAML frontmatter.`);
            } else {
                if (!parsed.data.id) {
                    fmErrors.push(`decisions/${file} missing "id" in frontmatter.`);
                }
                if (parsed.data.status && !VALID_ADR_STATUSES.includes(parsed.data.status.toLowerCase())) {
                    fmErrors.push(`decisions/${file} has invalid status: "${parsed.data.status}".`);
                }
            }
        }
    }

    results.push({
        id: 1,
        name: 'YAML Frontmatters',
        status: fmErrors.length === 0 ? 'pass' : 'fail',
        message: fmErrors.length === 0 ? 'All canonical files have valid YAML frontmatters' : `${fmErrors.length} frontmatter syntax or schema violation(s)`,
        details: fmErrors.length > 0 ? fmErrors : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 2: Security Jail (Symlinks & Hardlinks)
    // ─────────────────────────────────────────────────────────────────────────────
    const jailViolations: string[] = [];
    function inspectSecurityJail(dir: string) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            try {
                const stat = fs.lstatSync(fullPath);
                if (stat.isSymbolicLink()) {
                    jailViolations.push(`Symbolic link detected: ${path.relative(contextDir, fullPath)}`);
                }
                if (stat.isFile() && stat.nlink > 1) {
                    jailViolations.push(`Hardlink detected (${stat.nlink} links): ${path.relative(contextDir, fullPath)}`);
                }
                if (stat.isDirectory() && !stat.isSymbolicLink()) {
                    inspectSecurityJail(fullPath);
                }
            } catch {}
        }
    }
    inspectSecurityJail(contextDir);

    results.push({
        id: 2,
        name: 'Security Jail',
        status: jailViolations.length === 0 ? 'pass' : 'fail',
        message: jailViolations.length === 0 ? 'No symbolic links or insecure hardlinks detected in .ai-context/' : `${jailViolations.length} filesystem jail violation(s)`,
        details: jailViolations.length > 0 ? jailViolations : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 3: ADR Lineage & Circular Graph Check
    // ─────────────────────────────────────────────────────────────────────────────
    const adrLineageErrors: string[] = [];
    const existingAdrMap = new Map<string, { supersededBy?: string; path: string }>();

    if (fs.existsSync(decisionsDir)) {
        const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const adrPath = path.join(decisionsDir, file);
            const { data } = parseFrontmatter(fs.readFileSync(adrPath, 'utf-8'));
            const id = (data.id || file.replace('.md', '')).toUpperCase();
            const supersededBy = data.superseded_by ? String(data.superseded_by).toUpperCase() : undefined;
            existingAdrMap.set(id, { supersededBy, path: adrPath });
        }
    }

    for (const [id, info] of existingAdrMap.entries()) {
        if (info.supersededBy) {
            if (!existingAdrMap.has(info.supersededBy)) {
                adrLineageErrors.push(`ADR ${id} declares superseded_by: "${info.supersededBy}", which does not exist.`);
            } else {
                // Circular detection
                const visited = new Set<string>([id]);
                let curr: string | undefined = info.supersededBy;
                while (curr) {
                    if (visited.has(curr)) {
                        adrLineageErrors.push(`Circular ADR supersede loop detected: ${Array.from(visited).join(' -> ')} -> ${curr}`);
                        break;
                    }
                    visited.add(curr);
                    curr = existingAdrMap.get(curr)?.supersededBy;
                }
            }
        }
    }

    results.push({
        id: 3,
        name: 'ADR Lineage',
        status: adrLineageErrors.length === 0 ? 'pass' : 'fail',
        message: adrLineageErrors.length === 0 ? 'ADR lineage is coherent and acyclic' : `${adrLineageErrors.length} ADR lineage violation(s)`,
        details: adrLineageErrors.length > 0 ? adrLineageErrors : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 4: Requirement Mapping
    // ─────────────────────────────────────────────────────────────────────────────
    const reqMappingErrors: string[] = [];
    const existingReqMap = new Map<string, RequirementItem>();

    if (fs.existsSync(reqFile)) {
        const { data } = parseFrontmatter(fs.readFileSync(reqFile, 'utf-8'));
        if (Array.isArray(data.requirements)) {
            for (const r of data.requirements) {
                if (r && r.id) existingReqMap.set(String(r.id).toUpperCase(), r);
            }
        }
    }

    if (fs.existsSync(decisionsDir)) {
        const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const { data } = parseFrontmatter(fs.readFileSync(path.join(decisionsDir, file), 'utf-8'));
            if (Array.isArray(data.satisfies)) {
                for (const satId of data.satisfies) {
                    if (!existingReqMap.has(String(satId).toUpperCase())) {
                        reqMappingErrors.push(`ADR ${data.id || file} satisfies "${satId}", but it is not defined in requirements.md.`);
                    }
                }
            }
        }
    }

    results.push({
        id: 4,
        name: 'Requirement Mapping',
        status: reqMappingErrors.length === 0 ? 'pass' : 'warn',
        message: reqMappingErrors.length === 0 ? 'All ADR satisfies references map to defined requirements' : `${reqMappingErrors.length} requirement mapping discrepancy(ies)`,
        details: reqMappingErrors.length > 0 ? reqMappingErrors : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 5: Bidirectional Parity (ADR satisfies ⇄ Req satisfied_by)
    // ─────────────────────────────────────────────────────────────────────────────
    const parityErrors: string[] = [];
    // Map: reqId -> Set of ADR IDs declaring satisfies
    const adrSatisfiesMap = new Map<string, Set<string>>();
    if (fs.existsSync(decisionsDir)) {
        const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const { data } = parseFrontmatter(fs.readFileSync(path.join(decisionsDir, file), 'utf-8'));
            const adrId = (data.id || file.replace('.md', '')).toUpperCase();
            if (Array.isArray(data.satisfies)) {
                for (const satId of data.satisfies) {
                    const normReq = String(satId).toUpperCase();
                    if (!adrSatisfiesMap.has(normReq)) adrSatisfiesMap.set(normReq, new Set());
                    adrSatisfiesMap.get(normReq)!.add(adrId);
                }
            }
        }
    }

    for (const [reqId, reqItem] of existingReqMap.entries()) {
        const declaredInReq = new Set((reqItem.satisfied_by || []).map(d => d.toUpperCase()));
        const declaredInAdrs = adrSatisfiesMap.get(reqId) || new Set();

        for (const adrId of declaredInAdrs) {
            if (!declaredInReq.has(adrId)) {
                parityErrors.push(`ADR ${adrId} declares satisfies: ["${reqId}"], but is missing from ${reqId}'s satisfied_by list.`);
            }
        }
        for (const adrId of declaredInReq) {
            if (!declaredInAdrs.has(adrId)) {
                parityErrors.push(`Requirement ${reqId} lists satisfied_by: ["${adrId}"], but ADR ${adrId} does not declare satisfies: ["${reqId}"].`);
            }
        }
    }

    results.push({
        id: 5,
        name: 'Bidirectional Parity',
        status: parityErrors.length === 0 ? 'pass' : 'warn',
        message: parityErrors.length === 0 ? 'Full bidirectional parity between ADRs and Requirements' : `${parityErrors.length} bidirectional parity mismatch(es)`,
        details: parityErrors.length > 0 ? parityErrors : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 6: Ledger Health
    // ─────────────────────────────────────────────────────────────────────────────
    const ledgerErrors: string[] = [];
    const ledgerPath = path.join(contextDir, '.pactx', 'ledger.json');
    if (fs.existsSync(ledgerPath)) {
        try {
            const raw = fs.readFileSync(ledgerPath, 'utf-8');
            const ledger: HistoryLedger = JSON.parse(raw);
            if (!Array.isArray(ledger.applied_updates)) {
                ledgerErrors.push('ledger.json missing "applied_updates" array.');
            } else {
                let lastTime = 0;
                for (const u of ledger.applied_updates) {
                    if (!u.hash || typeof u.hash !== 'string' || u.hash.length !== 64) {
                        ledgerErrors.push(`Invalid transaction hash in ledger: "${u.hash}".`);
                    }
                    const itemTime = u.applied_at ? new Date(u.applied_at).getTime() : 0;
                    if (itemTime < lastTime) {
                        ledgerErrors.push(`Ledger updates are not strictly chronological around ${u.applied_at}.`);
                    }
                    lastTime = itemTime;
                }
            }
        } catch (err: any) {
            ledgerErrors.push(`ledger.json is corrupted: ${err.message}`);
        }
    }

    results.push({
        id: 6,
        name: 'Ledger Health',
        status: ledgerErrors.length === 0 ? 'pass' : 'fail',
        message: ledgerErrors.length === 0 ? 'Audit ledger structure and chronology are intact' : `${ledgerErrors.length} ledger anomaly(ies) detected`,
        details: ledgerErrors.length > 0 ? ledgerErrors : undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 7: Transaction Integrity
    // ─────────────────────────────────────────────────────────────────────────────
    const txErrors: string[] = [];
    const txDir = path.join(contextDir, '.pactx', 'transactions');
    if (fs.existsSync(txDir)) {
        const txFiles = fs.readdirSync(txDir).filter(f => f.startsWith('TX-') && f.endsWith('.json'));
        for (const file of txFiles) {
            const filePath = path.join(txDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const manifest: TransactionManifest = JSON.parse(raw);
                if (manifest.status === 'PREPARED' || manifest.status === 'APPLYING') {
                    txErrors.push(`Transaction ${manifest.txHash || file} is in unfinished state (${manifest.status}).`);
                } else if (manifest.status === 'FAILED') {
                    txErrors.push(`Transaction ${manifest.txHash || file} failed auto-recovery.`);
                }
            } catch (err: any) {
                txErrors.push(`Corrupted transaction manifest ${file}: ${err.message}`);
            }
        }
    }

    if (fix) {
        TransactionEngine.pruneTransactions(contextDir);
        fixesApplied.push('Pruned excess/expired transactions (>50 / >30d).');
    }

    results.push({
        id: 7,
        name: 'Transaction Integrity',
        status: txErrors.length === 0 ? 'pass' : 'warn',
        message: txErrors.length === 0 ? 'All transactions are finalized and verified' : `${txErrors.length} transaction manifest issue(s)`,
        details: txErrors.length > 0 ? txErrors : undefined,
        fixable: true,
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Rule 8: Lockfile Health
    // ─────────────────────────────────────────────────────────────────────────────
    const lockErrors: string[] = [];
    const lockFile = path.join(contextDir, '.pactx', '.pactx.lock');
    let isStaleLock = false;

    if (fs.existsSync(lockFile)) {
        try {
            const stats = fs.statSync(lockFile);
            if (Date.now() - stats.mtimeMs > 30000) {
                isStaleLock = true;
                lockErrors.push(`Abandoned lock file detected (>30s old): ${lockFile}`);
                if (fix) {
                    try {
                        fs.unlinkSync(lockFile);
                        fixesApplied.push('Removed abandoned stale lock file.');
                        lockErrors.pop();
                    } catch {}
                }
            }
        } catch {}
    }

    results.push({
        id: 8,
        name: 'Lockfile Health',
        status: lockErrors.length === 0 ? 'pass' : 'fail',
        message: lockErrors.length === 0 ? 'Lockfile is clean and responsive' : 'Stale or corrupted lockfile detected',
        details: lockErrors.length > 0 ? lockErrors : undefined,
        fixable: isStaleLock,
    });

    // Clean orphan .tmp files if fix is enabled
    if (fix) {
        function cleanTempFiles(dir: string) {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isFile() && e.name.endsWith('.tmp')) {
                    try { fs.unlinkSync(full); } catch {}
                } else if (e.isDirectory() && !e.isSymbolicLink()) {
                    cleanTempFiles(full);
                }
            }
        }
        cleanTempFiles(contextDir);
    }

    const hasErrors = results.some(r => r.status === 'fail');
    const hasWarnings = results.some(r => r.status === 'warn');
    const exitCode = hasErrors ? 2 : (hasWarnings ? 1 : 0);

    return {
        results,
        hasErrors,
        hasWarnings,
        exitCode,
    };
}

export function renderDoctor(cwd: string = process.cwd(), fix: boolean = false): number {
    console.log(pc.bold(pc.cyan(`\n🩺 PactX Doctor — Diagnostic Suite ${fix ? '(with --fix auto-repair)' : ''}`)));
    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

    const report = runDiagnostics(cwd, fix);

    for (const r of report.results) {
        let badge = '';
        if (r.status === 'pass') {
            badge = pc.green(`[✔ PASS]`);
        } else if (r.status === 'warn') {
            badge = pc.yellow(`[⚠ WARN]`);
        } else {
            badge = pc.red(`[✖ FAIL]`);
        }

        console.log(`${badge} ${pc.bold(r.name)}: ${r.message}`);
        if (r.details) {
            for (const d of r.details) {
                console.log(pc.dim(`         • ${d}`));
            }
        }
    }

    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

    if (fix) {
        console.log(pc.green('✔ Auto-repair routine completed.'));
    }

    if (report.exitCode === 0) {
        console.log(pc.green('🎉 All 8 integrity checks passed! Repository health is 100%.\n'));
    } else if (report.exitCode === 1) {
        console.log(pc.yellow('⚠ Warnings detected. The repository is operational, but review the warnings above.\n'));
    } else {
        console.log(pc.red('✖ Critical errors detected in repository state. Review failures above or use --fix if applicable.\n'));
    }

    return report.exitCode;
}
