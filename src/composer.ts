import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGitState } from './git';

export interface PackOptions {
    short?: boolean;
}

export function sanitizeInlineMarkdown(val: string): string {
    return val.replace(/[`\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseFrontmatterValue(content: string, key: string): string {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return '';
    const match = fmMatch[1].match(new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]+)["']?`, 'm'));
    return match ? match[1].trim() : '';
}

export function getCurrentContextRevision(contextDir: string): string {
    const readFileSafe = (relPath: string) => {
        const full = path.join(contextDir, relPath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n').trim() : '';
    };

    const projectContent = readFileSafe('project.md');
    const stateContent = readFileSafe('state.md');
    const decisionsDir = path.join(contextDir, 'decisions');
    const decisions: string[] = [];

    if (fs.existsSync(decisionsDir)) {
        const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md')).sort();
        for (const f of files) {
            decisions.push(fs.readFileSync(path.join(decisionsDir, f), 'utf-8').replace(/\r\n/g, '\n').trim());
        }
    }

    const rawStateBlob = projectContent + stateContent + decisions.join('');
    return crypto.createHash('sha256').update(rawStateBlob).digest('hex').substring(0, 6);
}

export function composeContext(cwd: string = process.cwd(), options: PackOptions = {}): string {
    const contextDir = path.join(cwd, '.ai-context');

    if (!fs.existsSync(contextDir)) {
        throw new Error('Pasta .ai-context não encontrada. Execute `pactx init` para inicializar.');
    }

    const readFileSafe = (relPath: string) => {
        const full = path.join(contextDir, relPath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8').trim() : '';
    };

    const projectContent = readFileSafe('project.md');
    const stateContent = readFileSafe('state.md');
    const glossaryContent = readFileSafe('glossary.md');

    const decisionsDir = path.join(contextDir, 'decisions');
    const activeDecisions: string[] = [];
    const supersededDecisions: string[] = [];

    if (fs.existsSync(decisionsDir)) {
        const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md'));
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

    const git = getGitState(cwd);
    const contextRevisionHash = getCurrentContextRevision(contextDir);

    let out = `<!-- CONTEXT PACK: GERADO AUTOMATICAMENTE POR PACTX [rev: ${contextRevisionHash}] -->\n\n`;
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
        out += `- **Branch Git Atual:** \`${sanitizeInlineMarkdown(git.branch || 'detached')}\`\n`;
        if (git.recentCommits.length > 0) {
            out += `- **Últimos Commits:**\n  ` + git.recentCommits.map((c: string) => `* ${sanitizeInlineMarkdown(c)}`).join('\n  ') + `\n`;
        }
        if (git.modifiedFiles.length > 0) {
            out += `- **Arquivos Modificados Localmente:**\n  ` + git.modifiedFiles.slice(0, 10).map((m: string) => `* \`${sanitizeInlineMarkdown(m)}\``).join('\n  ') + `\n`;
        }
        out += `\n`;
    }

    out += `### PROTOCOLO DE ENCERRAMENTO & HANDOFF CANÔNICO:\n`;
    out += `Ao concluir uma tarefa, tomar decisões ou quando o usuário solicitar "/handoff", emita OBRIGATORIAMENTE o bloco abaixo.\n`;
    out += `DIRETRIZES: Registre apenas fatos e decisões reais desta sessão. NUNCA invente decisões para preencher o schema. Se não houver novas decisões, use listas vazias ([]).\n\n`;
    out += `\`\`\`pactx-update\n`;
    out += `version: "1.0"\n`;
    out += `base_revision: "${contextRevisionHash}"\n`;
    out += `state:\n`;
    out += `  active_task: "<nome da tarefa ativa>"\n`;
    out += `  status: "IN_PROGRESS | BLOCKED | COMPLETED"\n`;
    out += `  recommended_model: "Medium | High"\n`;
    out += `  completed_items:\n    - "<item concluído>"\n`;
    out += `  new_facts:\n    - "<descoberta ou fato comprovado no runtime>"\n`;
    out += `  rejected_hypotheses:\n    - "<hipótese testada e comprovadamente falsa>"\n`;
    out += `  next_action: "<ação imediata seguinte>"\n`;
    out += `new_decisions: []\n`;
    out += `superseded_decisions: []\n`;
    out += `new_glossary_terms: []\n`;
    out += `\`\`\`\n`;

    return out;
}