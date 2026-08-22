import fs from 'node:fs';
import path from 'node:path';
import { getGitState } from './git';

export interface PackOptions {
    short?: boolean;
}

interface AdrParsed {
    id: string;
    title: string;
    status: string;
    rawContent: string;
}

function parseFrontmatterValue(content: string, key: string): string {
    const match = content.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'));
    return match ? match[1].trim() : '';
}

export function composeContext(cwd: string = process.cwd(), options: PackOptions = {}): string {
    const contextDir = path.join(cwd, '.ai-context');

    if (!fs.existsSync(contextDir)) {
        throw new Error('Pasta .ai-context não encontrada. Execute o comando init para inicializar.');
    }

    const readFileSafe = (relPath: string) => {
        const full = path.join(contextDir, relPath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8').trim() : '';
    };

    const projectContent = readFileSafe('project.md');
    const stateContent = readFileSafe('state.md');
    const glossaryContent = readFileSafe('glossary.md');

    // Lê e filtra decisões por status
    const decisionsDir = path.join(contextDir, 'decisions');
    const activeDecisions: string[] = [];
    const supersededDecisions: string[] = [];

    if (fs.existsSync(decisionsDir)) {
        const files = (fs.readdirSync(decisionsDir) as string[]).filter((f: string) => f.endsWith('.md'));

        for (const f of files) {
            const content = fs.readFileSync(path.join(decisionsDir, f), 'utf-8').trim();
            const status = parseFrontmatterValue(content, 'status') || 'active';
            const id = parseFrontmatterValue(content, 'id') || f.replace('.md', '');
            const title = parseFrontmatterValue(content, 'title') || 'Decisão sem título';

            if (status.toLowerCase() === 'active') {
                activeDecisions.push(content);
            } else if (status.toLowerCase() === 'superseded') {
                supersededDecisions.push(`- **[${id}] ${title}** *(Substituída / Obsoleta)*`);
            }
        }
    }

    const git = getGitState();

    // Montagem do Markdown otimizado para IAs
    let out = `<!-- CONTEXT PACK: GERADO AUTOMATICAMENTE -->\n\n`;
    out += `Você está assumindo como Tech Lead / Engenheiro de Software deste projeto.\n`;
    out += `Leia o estado canônico abaixo antes de tomar qualquer decisão ou gerar código.\n\n`;

    if (projectContent) {
        out += `### 1. PROJETO & INVARIANTES\n${projectContent}\n\n`;
    }

    if (stateContent) {
        out += `### 2. ESTADO ATUAL & PRÓXIMA TAREFA\n${stateContent}\n\n`;
    }

    if (activeDecisions.length > 0) {
        out += `### 3. DECISÕES ARQUITETURAIS ATIVAS (ADRs)\n`;
        out += activeDecisions.join('\n---\n') + `\n\n`;
    }

    if (supersededDecisions.length > 0 && !options.short) {
        out += `### DECISÕES OBSOLETAS (NÃO SEGUIR):\n`;
        out += supersededDecisions.join('\n') + `\n\n`;
    }

    if (glossaryContent && !options.short) {
        out += `### 4. GLOSSÁRIO & CONTRATOS\n${glossaryContent}\n\n`;
    }

    if (git.isGit) {
        out += `### 5. RUNTIME & REPOSITÓRIO LOCAL\n`;
        out += `- **Branch Git Atual:** \`${git.branch}\`\n`;
        if (git.recentCommits.length > 0) {
            out += `- **Últimos Commits:**\n  ` + git.recentCommits.map((c: string) => `* ${c}`).join('\n  ') + `\n`;
        }
        if (git.modifiedFiles.length > 0) {
            out += `- **Arquivos Modificados Localmente:**\n  ` + git.modifiedFiles.slice(0, 10).map((m: string) => `* \`${m}\``).join('\n  ') + `\n`;
            if (git.modifiedFiles.length > 10) {
                out += `  * ... e mais ${git.modifiedFiles.length - 10} arquivos.\n`;
            }
        }
        out += `\n`;
    }

    out += `### DIRETRIZ DE EXECUÇÃO:\n`;
    out += `1. Confirme que entendeu a tarefa ativa.\n`;
    out += `2. Aponte se o próximo passo deve usar raciocínio Medium ou High.\n`;
    out += `3. NÃO repita hipóteses já descartadas.\n`;

    return out;
}