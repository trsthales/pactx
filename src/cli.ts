#!/usr/bin/env node
import { Command } from 'commander';
import clipboardy from 'clipboardy';
import pc from 'picocolors';
import { initProject } from './init';
import { composeContext } from './composer';

const program = new Command();

program
    .name('pactx')
    .description('Universal context continuity & handoff engine for AI-assisted development')
    .version('0.1.0');

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
            } catch (clipErr) {
                console.log(pc.yellow('⚠ Não foi possível acessar o clipboard (ambiente headless/sem display). Exibindo saída no terminal:\n'));
                console.log(output);
            }
        } catch (err: any) {
            console.error(pc.red(`✖ Erro: ${err.message}`));
            process.exit(1);
        }
    });

program.parse(process.argv);