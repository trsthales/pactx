import fs from 'node:fs';
import clipboardy from 'clipboardy';
import pc from 'picocolors';
import { parseAndValidateUpdate } from '../update/parser';
import { buildMutationPlan } from '../update/planner';
import { bootstrapPactx } from '../core/bootstrap';

export interface DiffOptions {
    file?: string;
    stdin?: boolean;
}

export async function renderDiff(cwd: string = process.cwd(), options: DiffOptions = {}): Promise<void> {
    let rawInput = '';

    if (options.file) {
        if (!fs.existsSync(options.file)) {
            throw new Error(`File not found: ${options.file}`);
        }
        rawInput = fs.readFileSync(options.file, 'utf-8');
    } else if (options.stdin) {
        if (process.stdin.isTTY) {
            throw new Error('No data received from pipe. Use: cat update.md | pactx diff --stdin');
        }
        rawInput = fs.readFileSync(0, 'utf-8');
    } else {
        try {
            rawInput = await clipboardy.read();
        } catch {
            throw new Error('Could not read clipboard. Use --file <path> or --stdin.');
        }
    }

    const { projectRoot } = bootstrapPactx(cwd, { autoRecovery: false });
    const { payload, canonicalHash, warnings } = parseAndValidateUpdate(rawInput);
    const plan = buildMutationPlan(projectRoot, payload, canonicalHash, warnings);

    console.log(pc.bold(pc.cyan(`\n📦 pactx-update mutation preview (Schema v${plan.schemaVersion})`)));
    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));
    console.log(`${pc.bold('🔑 Base Revision:')}  ${pc.magenta(plan.baseRevision || '(not specified)')}`);
    console.log(`${pc.bold('🔒 Canonical Hash:')} ${pc.dim(plan.canonicalHash)}`);

    if (plan.warnings && plan.warnings.length > 0) {
        console.log(pc.yellow('\n⚠️  Warnings:'));
        for (const w of plan.warnings) {
            console.log(pc.yellow(`   • ${w}`));
        }
    }

    console.log('');

    if (plan.operations.stateUpdate) {
        console.log(pc.cyan('📝 .ai-context/state.md [UPDATE]'));
        if (plan.operations.stateUpdate.activeTask) {
            console.log(`   ${pc.yellow('[~]')} Active Task: "${plan.operations.stateUpdate.activeTask}" [${plan.operations.stateUpdate.status || 'IN_PROGRESS'}]`);
        }
        if (plan.operations.stateUpdate.nextAction) {
            console.log(`   ${pc.yellow('[~]')} Next Action: "${plan.operations.stateUpdate.nextAction}"`);
        }
        for (const f of plan.operations.stateUpdate.newFacts) {
            console.log(`   ${pc.green('[+]')} Fact: "${f}"`);
        }
        for (const h of plan.operations.stateUpdate.newRejectedHypotheses) {
            console.log(`   ${pc.magenta('[+]')} Discarded: "${h}"`);
        }
        for (const c of plan.operations.stateUpdate.newCompletedItems) {
            console.log(`   ${pc.green('[x]')} Completed: "${c}"`);
        }
    }

    if (plan.operations.createdRequirements && plan.operations.createdRequirements.length > 0) {
        console.log(pc.magenta('📋 .ai-context/requirements.md [CREATE/UPDATE]'));
        for (const req of plan.operations.createdRequirements) {
            console.log(`   ${pc.green('[+]')} [${req.id}] "${req.title}" (type: ${req.type})`);
            if (req.statement) {
                console.log(`       Statement: "${req.statement}"`);
            }
        }
    }

    for (const adr of plan.operations.createdAdrs || []) {
        console.log(pc.green(`🏛️  .ai-context/decisions/${adr.id}.md [CREATE]`));
        console.log(`   ${pc.green('[+]')} Title: "${adr.title}"`);
        if (adr.satisfies && adr.satisfies.length > 0) {
            console.log(`   ${pc.green('[+]')} Satisfies: ${adr.satisfies.join(', ')}`);
        }
        console.log(`   ${pc.green('[+]')} Decision: "${adr.decision}"`);
        if (adr.reason) {
            console.log(`   ${pc.green('[+]')} Reason: "${adr.reason}"`);
        }
    }

    for (const adr of plan.operations.supersededAdrs || []) {
        console.log(pc.yellow(`🏛️  .ai-context/decisions/${adr.id}.md [SUPERSEDE]`));
        console.log(`   ${pc.cyan('[↺]')} Superseded by: ${adr.supersededBy} (${adr.reason})`);
    }

    for (const term of plan.operations.appendedGlossaryTerms || []) {
        console.log(pc.blue(`📖 .ai-context/glossary.md [APPEND]`));
        console.log(`   ${pc.green('[+]')} ${term.term}: "${term.definition}"`);
    }

    console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));
    console.log(pc.green('🔍 Diff mode: 0 files were modified on disk.\n'));
}
