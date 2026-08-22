#!/usr/bin/env node
import { Command } from 'commander';
import clipboardy from 'clipboardy';
import pc from 'picocolors';
import readline from 'node:readline';
import fs from 'node:fs';
import { initProject } from './init';
import { composeContext } from './composer';
import { parseAndValidateUpdate } from './update/parser';
import { buildMutationPlan } from './update/planner';
import { applyMutationPlan } from './update/applier';

const program = new Command();

program
    .name('pactx')
    .description('Universal context continuity & handoff engine for AI-assisted development')
    .version('0.2.1');

program
    .command('init')
    .description('Initialize .ai-context/ structure in current project')
    .action(() => {
        initProject();
    });

program
    .command('pack', { isDefault: true })
    .description('Package current project state and copy to clipboard')
    .option('-s, --short', 'Generate a more compact version in tokens')
    .option('--stdout', 'Print to terminal only without copying to clipboard')
    .action(async (options) => {
        try {
            const output = composeContext(process.cwd(), { short: options.short });
            const bytes = Buffer.byteLength(output, 'utf8');
            const estimatedTokens = Math.round(bytes / 3.8);

            if (options.stdout) {
                console.log(output);
                return;
            }

            try {
                await clipboardy.write(output);
                console.log(pc.green('✔ Context packed successfully!'));
                console.log(pc.bold(pc.white(`📋 Copied to clipboard!`)));
                console.log(pc.dim(`Size: ${(bytes / 1024).toFixed(2)} KB | ~${estimatedTokens} tokens`));
                console.log(pc.cyan(`\n👉 Paste directly into ChatGPT, Claude, Gemini, or your coding agent!`));
            } catch {
                console.log(pc.yellow('⚠ Could not access clipboard. Displaying output in terminal:\n'));
                console.log(output);
            }
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('update')
    .description('Ingest AI response and update canonical repository state')
    .option('--dry-run', 'Simulate and display the plan without modifying files on disk')
    .option('-y, --yes', 'Apply mutations without interactive confirmation')
    .option('--force', 'Force application even with critical warnings (e.g., Stale Context with -y)')
    .option('--file <path>', 'Read pactx-update block from a file')
    .option('--stdin', 'Read block from stdin (pipe)')
    .action(async (options) => {
        try {
            let rawInput = '';

            if (options.file) {
                if (!fs.existsSync(options.file)) {
                    throw new Error(`File not found: ${options.file}`);
                }
                rawInput = fs.readFileSync(options.file, 'utf-8');
            } else if (options.stdin) {
                if (process.stdin.isTTY) {
                    throw new Error('No data received from pipe. Use: cat update.md | pactx update --stdin');
                }
                rawInput = fs.readFileSync(0, 'utf-8');
            } else {
                try {
                    rawInput = await clipboardy.read();
                } catch {
                    throw new Error('Could not read clipboard. Use --file or --stdin.');
                }
            }

            const { payload, canonicalHash, warnings } = parseAndValidateUpdate(rawInput);
            const plan = buildMutationPlan(process.cwd(), payload, canonicalHash, warnings);

            console.log(pc.bold(pc.cyan('\n📦 pactx-update block detected!\n')));

            if (plan.isAlreadyApplied) {
                console.log(pc.yellow(`ℹ This update was already applied previously (Hash: ${canonicalHash.substring(0, 8)}). Completed (No-Op).`));
                return;
            }

            if (plan.warnings.length > 0) {
                console.log(pc.bold(pc.yellow('⚠️ WARNINGS:')));
                plan.warnings.forEach(w => console.log(pc.yellow(`  • ${w}`)));
                console.log('');
            }

            const hasStaleContext = plan.warnings.some(w => w.includes('Stale Context'));
            if (options.yes && hasStaleContext && !options.force) {
                console.error(pc.red('✖ Error: Stale Context detected with -y/--yes flag.'));
                console.error(pc.yellow('  The update was based on an outdated revision of the repository.'));
                console.error(pc.yellow('  To force application without interactive confirmation, use:'));
                console.error(pc.cyan('    pactx update -y --force\n'));
                process.exit(1);
            }

            // Renderização do Plano em Texto Integral
            console.log(pc.bold('Canonical Mutation Plan:'));
            console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

            if (plan.operations.stateUpdate) {
                console.log(pc.cyan('📝 .ai-context/state.md'));
                console.log(`   • Active Task: "${plan.operations.stateUpdate.activeTask}" [${plan.operations.stateUpdate.status}]`);
                console.log(`   • Next Action: "${plan.operations.stateUpdate.nextAction}"`);
                plan.operations.stateUpdate.newFacts.forEach(f => console.log(pc.green(`   • [+] Fact: "${f}"`)));
                plan.operations.stateUpdate.newRejectedHypotheses.forEach(h => console.log(pc.magenta(`   • [+] Discarded Hypothesis: "${h}"`)));
            }

            for (const adr of plan.operations.createdAdrs) {
                console.log(pc.green(`🏛️  .ai-context/decisions/${adr.id}.md [CREATE]`));
                console.log(`   • Title: "${adr.title}"`);
                console.log(`   • Decision: "${adr.decision}"`);
            }

            for (const adr of plan.operations.supersededAdrs) {
                console.log(pc.yellow(`🏛️  .ai-context/decisions/${adr.id}.md [SUPERSEDE]`));
                console.log(`   • Superseded by: ${adr.supersededBy} (${adr.reason})`);
            }

            for (const term of plan.operations.appendedGlossaryTerms) {
                console.log(pc.blue(`📖 .ai-context/glossary.md [APPEND]`));
                console.log(`   • ${term.term}: "${term.definition}"`);
            }

            console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));

            if (options.dryRun) {
                console.log(pc.yellow('🔍 --dry-run mode: No files were modified on disk.'));
                return;
            }

            const proceed = options.yes ? true : await new Promise<boolean>((resolve) => {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                rl.question(pc.bold('? Apply canonical changes to repository? (Y/n) '), (answer) => {
                    rl.close();
                    resolve(answer.trim().toLowerCase() === 'y' || answer.trim() === '');
                });
            });

            if (!proceed) {
                console.log(pc.yellow('✖ Operation cancelled by user.'));
                return;
            }

            plan.isForced = !!options.force;
            applyMutationPlan(process.cwd(), plan);
            console.log(pc.green('\n✔ Canonical state updated successfully!'));
            console.log(pc.dim('📋 Audit ledger recorded in .ai-context/.pactx-history.json\n'));

        } catch (err: any) {
            console.error(pc.red(`\n✖ Error: ${err.message}\n`));
            process.exit(1);
        }
    });

program.parse(process.argv);