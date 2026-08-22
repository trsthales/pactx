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
    .description('Inicializa a estrutura .ai-context/ no projeto atual')
    .action(() => {
        initProject();
    });

program
    .command('pack', { isDefault: true })
    .description('Empacota o estado atual do projeto e copia para a área de transferência')
    .option('-s, --short', 'Gera uma versão mais compacta em tokens')
    .option('--stdout', 'Apenas imprime no terminal sem copiar para o clipboard')
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
                console.log(pc.green('✔ Context packed com sucesso!'));
                console.log(pc.bold(pc.white(`📋 Copiado para a Área de Transferência!`)));
                console.log(pc.dim(`Tamanho: ${(bytes / 1024).toFixed(2)} KB | ~${estimatedTokens} tokens`));
                console.log(pc.cyan(`\n👉 Cole diretamente no ChatGPT, Claude, Gemini ou no seu agente!`));
            } catch {
                console.log(pc.yellow('⚠ Não foi possível acessar o clipboard. Exibindo saída no terminal:\n'));
                console.log(output);
            }
        } catch (err: any) {
            console.error(pc.red(`✖ Erro: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('update')
    .description('Ingere a resposta da IA e atualiza o estado canônico do repositório')
    .option('--dry-run', 'Apenas simula e exibe o plano sem alterar arquivos no disco')
    .option('-y, --yes', 'Aplica as mutações sem confirmação interativa')
    .option('--force', 'Força a aplicação mesmo em caso de avisos críticos (ex: Stale Context com -y)')
    .option('--file <path>', 'Lê o bloco pactx-update a partir de um arquivo')
    .option('--stdin', 'Lê o bloco a partir do stdin (pipe)')
    .action(async (options) => {
        try {
            let rawInput = '';

            if (options.file) {
                if (!fs.existsSync(options.file)) {
                    throw new Error(`Arquivo não encontrado: ${options.file}`);
                }
                rawInput = fs.readFileSync(options.file, 'utf-8');
            } else if (options.stdin) {
                if (process.stdin.isTTY) {
                    throw new Error('Nenhum dado recebido via pipe. Utilize: cat update.md | pactx update --stdin');
                }
                rawInput = fs.readFileSync(0, 'utf-8');
            } else {
                try {
                    rawInput = await clipboardy.read();
                } catch {
                    throw new Error('Não foi possível ler o clipboard. Use --file ou --stdin.');
                }
            }

            const { payload, canonicalHash, warnings } = parseAndValidateUpdate(rawInput);
            const plan = buildMutationPlan(process.cwd(), payload, canonicalHash, warnings);

            console.log(pc.bold(pc.cyan('\n📦 Bloco pactx-update detectado!\n')));

            if (plan.isAlreadyApplied) {
                console.log(pc.yellow(`ℹ Este bloco já foi aplicado anteriormente (Hash: ${canonicalHash.substring(0, 8)}). Operação concluída (No-Op).`));
                return;
            }

            if (plan.warnings.length > 0) {
                console.log(pc.bold(pc.yellow('⚠️ AVISOS:')));
                plan.warnings.forEach(w => console.log(pc.yellow(`  • ${w}`)));
                console.log('');
            }

            const hasStaleContext = plan.warnings.some(w => w.includes('Stale Context'));
            if (options.yes && hasStaleContext && !options.force) {
                console.error(pc.red('✖ Erro: Stale Context detectado com flag -y/--yes.'));
                console.error(pc.yellow('  O update foi baseado em uma revisão desatualizada do repositório.'));
                console.error(pc.yellow('  Para forçar a aplicação sem confirmação interativa, utilize:'));
                console.error(pc.cyan('    pactx update -y --force\n'));
                process.exit(1);
            }

            // Renderização do Plano em Texto Integral
            console.log(pc.bold('Plano de Mutação Canônica:'));
            console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

            if (plan.operations.stateUpdate) {
                console.log(pc.cyan('📝 .ai-context/state.md'));
                console.log(`   • Tarefa Ativa: "${plan.operations.stateUpdate.activeTask}" [${plan.operations.stateUpdate.status}]`);
                console.log(`   • Próximo Passo: "${plan.operations.stateUpdate.nextAction}"`);
                plan.operations.stateUpdate.newFacts.forEach(f => console.log(pc.green(`   • [+] Fato: "${f}"`)));
                plan.operations.stateUpdate.newRejectedHypotheses.forEach(h => console.log(pc.magenta(`   • [+] Hipótese Descartada: "${h}"`)));
            }

            for (const adr of plan.operations.createdAdrs) {
                console.log(pc.green(`🏛️  .ai-context/decisions/${adr.id}.md [CREATE]`));
                console.log(`   • Título: "${adr.title}"`);
                console.log(`   • Decisão: "${adr.decision}"`);
            }

            for (const adr of plan.operations.supersededAdrs) {
                console.log(pc.yellow(`🏛️  .ai-context/decisions/${adr.id}.md [SUPERSEDE]`));
                console.log(`   • Substituída por: ${adr.supersededBy} (${adr.reason})`);
            }

            for (const term of plan.operations.appendedGlossaryTerms) {
                console.log(pc.blue(`📖 .ai-context/glossary.md [APPEND]`));
                console.log(`   • ${term.term}: "${term.definition}"`);
            }

            console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));

            if (options.dryRun) {
                console.log(pc.yellow('🔍 Modo --dry-run: Nenhuma alteração foi gravada no disco.'));
                return;
            }

            const proceed = options.yes ? true : await new Promise<boolean>((resolve) => {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                rl.question(pc.bold('? Deseja aplicar as alterações canônicas ao repositório? (Y/n) '), (answer) => {
                    rl.close();
                    resolve(answer.trim().toLowerCase() === 'y' || answer.trim() === '');
                });
            });

            if (!proceed) {
                console.log(pc.yellow('✖ Operação cancelada pelo usuário.'));
                return;
            }

            plan.isForced = !!options.force;
            applyMutationPlan(process.cwd(), plan);
            console.log(pc.green('\n✔ Estado canônico atualizado com sucesso!'));
            console.log(pc.dim('📋 Ledger de auditoria gravado em .ai-context/.pactx-history.json\n'));

        } catch (err: any) {
            console.error(pc.red(`\n✖ Erro: ${err.message}\n`));
            process.exit(1);
        }
    });

program.parse(process.argv);