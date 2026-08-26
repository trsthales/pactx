#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';

const program = new Command();

program
    .name('pactx')
    .description('Universal context continuity & handoff engine for AI-assisted development')
    .version('0.3.2');

program
    .command('init')
    .description('Initialize .ai-context/ structure in current project')
    .action(async () => {
        try {
            const { initProject } = await import('./init');
            initProject();
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('pack', { isDefault: true })
    .description('Package current project state and copy to clipboard')
    .option('-s, --short', 'Generate a more compact version in tokens')
    .option('--stdout', 'Print to terminal only without copying to clipboard')
    .action(async (options) => {
        try {
            const { bootstrapPactx } = await import('./core/bootstrap');
            const { composeContext } = await import('./composer');
            const clipboardy = (await import('clipboardy')).default;

            const { projectRoot } = bootstrapPactx(process.cwd());
            const output = composeContext(projectRoot, { short: options.short });
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
            const fs = await import('node:fs');
            const readline = await import('node:readline');
            const { bootstrapPactx } = await import('./core/bootstrap');
            const { parseAndValidateUpdate } = await import('./update/parser');
            const { buildMutationPlan } = await import('./update/planner');
            const { applyMutationPlan } = await import('./update/applier');

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
                    const clipboardy = (await import('clipboardy')).default;
                    rawInput = await clipboardy.read();
                } catch {
                    throw new Error('Could not read clipboard. Use --file or --stdin.');
                }
            }

            const { projectRoot } = bootstrapPactx(process.cwd());
            const { payload, canonicalHash, warnings } = parseAndValidateUpdate(rawInput);
            const plan = buildMutationPlan(projectRoot, payload, canonicalHash, warnings);

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

            if (plan.operations.createdRequirements && plan.operations.createdRequirements.length > 0) {
                console.log(pc.magenta('📋 .ai-context/requirements.md [CREATE]'));
                for (const req of plan.operations.createdRequirements) {
                    console.log(`   • [${req.id}] "${req.title}" (${req.type})`);
                    if (req.statement) {
                        console.log(`     Statement: "${req.statement}"`);
                    }
                }
            }

            for (const adr of plan.operations.createdAdrs) {
                console.log(pc.green(`🏛️  .ai-context/decisions/${adr.id}.md [CREATE]`));
                console.log(`   • Title: "${adr.title}"`);
                if (adr.satisfies && adr.satisfies.length > 0) {
                    console.log(`   • Satisfies: ${adr.satisfies.join(', ')}`);
                }
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
            applyMutationPlan(projectRoot, plan);
            console.log(pc.green('\n✔ Canonical state updated successfully!'));
            console.log(pc.dim('📋 Audit ledger recorded in .ai-context/.pactx/ledger.json\n'));

        } catch (err: any) {
            console.error(pc.red(`\n✖ Error: ${err.message}\n`));
            process.exit(1);
        }
    });

program
    .command('status')
    .description('Display status and cognitive memory metrics of the repository')
    .option('-j, --json', 'Output full metrics as structured JSON')
    .action(async (options) => {
        try {
            const { renderStatus } = await import('./commands/status');
            renderStatus(process.cwd(), { json: options.json });
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('diff')
    .description('Inspect the mutation plan from clipboard, file, or stdin without modifying disk')
    .option('--file <path>', 'Read pactx-update block from a file')
    .option('--stdin', 'Read block from stdin (pipe)')
    .action(async (options) => {
        try {
            const { renderDiff } = await import('./commands/diff');
            await renderDiff(process.cwd(), { file: options.file, stdin: options.stdin });
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('rollback [hash]')
    .description('Rollback one or more committed transactions safely (LIFO or specific hash)')
    .option('-y, --yes', 'Apply rollback without interactive confirmation')
    .option('--dry-run', 'Simulate rollback and display plan without modifying files on disk')
    .option('--force-cascade', 'Automatically rollback all subsequent dependent transactions')
    .action(async (hash, options) => {
        try {
            const { executeRollback } = await import('./commands/rollback');
            await executeRollback(process.cwd(), hash, {
                yes: options.yes,
                dryRun: options.dryRun,
                forceCascade: options.forceCascade,
            });
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('doctor')
    .description('Run integrity and consistency diagnostics across .ai-context/')
    .option('--fix', 'Automatically repair fixable discrepancies, remove stale locks, and prune old records')
    .action(async (options) => {
        try {
            const { renderDoctor } = await import('./commands/doctor');
            const exitCode = renderDoctor(process.cwd(), options.fix);
            if (exitCode !== 0 && !options.fix) {
                process.exit(exitCode);
            }
        } catch (err: any) {
            console.error(pc.red(`✖ Error: ${err.message}`));
            process.exit(2);
        }
    });

program.parse(process.argv);