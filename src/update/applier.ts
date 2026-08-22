import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { MutationPlan, HistoryLedger } from './types';
import { ContextLock } from './lock';

const MAX_HISTORY_ENTRIES = 500;

export function safeWriteFileSync(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
    try {
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink()) {
            throw new Error(`Violação de segurança: "${filePath}" é um link simbólico. Escrita recusada.`);
        }
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
    fs.writeFileSync(filePath, content, encoding);
}

export function sanitizeBodyField(val: string): string {
    if (typeof val !== 'string' || !val) return '';
    return val
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => {
            const trimmed = line.trim();
            // Neutraliza cabeçalhos markdown (# a ######) transformando em citações
            if (/^#{1,6}\s/.test(trimmed)) {
                return line.replace(/^(\s*)#{1,6}\s*/, '$1> ');
            }
            // Remove réguas horizontais que possam quebrar a hierarquia do documento
            if (/^[-*_]{3,}\s*$/.test(trimmed)) {
                return '';
            }
            // Neutraliza cercas de código de bloco
            if (/^`{3,}/.test(trimmed)) {
                return line.replace(/`/g, "'");
            }
            return line;
        })
        .join('\n')
        .trim();
}

function normalizeLine(line: string): string {
    return line.replace(/^[-*•]\s*/, '').trim().normalize('NFC').toLowerCase();
}

export function applyMutationPlan(cwd: string, plan: MutationPlan): void {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');
    const historyFile = path.join(contextDir, '.pactx-history.json');

    if (!fs.existsSync(decisionsDir)) {
        fs.mkdirSync(decisionsDir, { recursive: true });
    }

    const lock = new ContextLock(contextDir);
    lock.acquire();

    // Snapshot em Memória para Rollback Transacional
    const snapshot = new Map<string, string | null>(); // path -> content (null se arquivo não existia)
    const createdFiles: string[] = [];

    const recordSnapshot = (filePath: string) => {
        if (!snapshot.has(filePath)) {
            snapshot.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null);
        }
    };

    const rollback = () => {
        for (const [filePath, origContent] of snapshot.entries()) {
            try {
                if (origContent === null) {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } else {
                    safeWriteFileSync(filePath, origContent, 'utf-8');
                }
            } catch {}
        }
    };

    let isApplying = true;
    const handleSignal = () => {
        if (isApplying) {
            rollback();
            lock.release();
            process.exit(130);
        }
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    try {
        // 1. Criar Novos ADRs com Serialização Segura & Sanitização de Body
        for (const adr of plan.operations.createdAdrs) {
            recordSnapshot(adr.targetPath);
            const frontmatter = {
                spec_version: '1.0',
                id: adr.id,
                title: sanitizeBodyField(adr.title),
                status: 'active',
                date: adr.date,
            };

            const frontmatterYaml = yaml.stringify(frontmatter).trim();
            const sanitizedDecision = sanitizeBodyField(adr.decision);
            const sanitizedReason = sanitizeBodyField(adr.reason);
            const body = `# Decisão\n${sanitizedDecision}\n\n# Motivo\n${sanitizedReason}\n`;
            const fullContent = `---\n${frontmatterYaml}\n---\n\n${body}`;

            safeWriteFileSync(adr.targetPath, fullContent, 'utf-8');
            if (snapshot.get(adr.targetPath) === null) {
                createdFiles.push(adr.targetPath);
            }
        }

        // 2. Atualizar ADRs Substituídos
        for (const adr of plan.operations.supersededAdrs) {
            if (fs.existsSync(adr.targetPath)) {
                recordSnapshot(adr.targetPath);
                const original = fs.readFileSync(adr.targetPath, 'utf-8');

                // Parse seguro do frontmatter existente com suporte a CRLF
                const match = original.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
                if (match) {
                    const data = yaml.parse(match[1]) || {};
                    data.status = 'superseded';
                    data.superseded_by = adr.supersededBy;
                    data.superseded_date = adr.date;
                    if (adr.reason) {
                        data.superseded_reason = sanitizeBodyField(adr.reason);
                    }

                    const newFrontmatter = yaml.stringify(data).trim();
                    const newContent = `---\n${newFrontmatter}\n---\n${match[2]}`;
                    safeWriteFileSync(adr.targetPath, newContent, 'utf-8');
                } else {
                    throw new Error(`Estrutura de frontmatter inválida ou corrompida no ADR: ${adr.targetPath}`);
                }
            }
        }

        // 3. Atualizar state.md
        if (plan.operations.stateUpdate) {
            const statePath = plan.operations.stateUpdate.targetPath;
            recordSnapshot(statePath);

            let existingCompleted: string[] = [];
            let existingHypotheses: string[] = [];
            let existingFacts: string[] = [];
            let existingSprint = 'SPRINT_CURRENT';

            const isPlaceholder = (s: string) => /^\([^)]+\)$/.test(s.trim());

            if (fs.existsSync(statePath)) {
                const raw = fs.readFileSync(statePath, 'utf-8');

                // Preserva sprint existente se presente no frontmatter
                const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (fmMatch) {
                    try {
                        const existingFm = yaml.parse(fmMatch[1]);
                        if (existingFm && existingFm.sprint) {
                            existingSprint = String(existingFm.sprint);
                        }
                    } catch {}
                }

                const lines = raw.split(/\r?\n/);
                let currentSection = '';

                for (const line of lines) {
                    const sectionLine = line.replace(/^#+\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
                    if (sectionLine.startsWith('o que foi feito')) {
                        currentSection = 'completed';
                    } else if (sectionLine.startsWith('hipóteses descartadas') || sectionLine.startsWith('hipoteses descartadas')) {
                        currentSection = 'hypotheses';
                    } else if (sectionLine.startsWith('fatos')) {
                        currentSection = 'facts';
                    } else if (/^#+\s/.test(line.trim())) {
                        currentSection = 'other';
                    } else if (line.trim().startsWith('-')) {
                        const clean = line.replace(/^-\s*(\[[ x]\])?\s*/, '').trim();
                        if (clean && !isPlaceholder(clean)) {
                            if (currentSection === 'completed') existingCompleted.push(clean);
                            if (currentSection === 'hypotheses') existingHypotheses.push(clean);
                            if (currentSection === 'facts') existingFacts.push(clean);
                        }
                    }
                }
            }

            // Merge semântico deduplicado
            const mergeUnique = (existing: string[], incoming: string[]) => {
                const result = [...existing];
                for (const item of incoming) {
                    const sanitized = sanitizeBodyField(item);
                    if (!sanitized) continue;
                    const norm = normalizeLine(sanitized);
                    if (!result.some(e => normalizeLine(e) === norm)) {
                        result.push(sanitized);
                    }
                }
                return result;
            };

            const finalCompleted = mergeUnique(existingCompleted, plan.operations.stateUpdate.newCompletedItems);
            const finalHypotheses = mergeUnique(existingHypotheses, plan.operations.stateUpdate.newRejectedHypotheses);
            const finalFacts = mergeUnique(existingFacts, plan.operations.stateUpdate.newFacts);

            const frontmatter = {
                spec_version: '1.0',
                sprint: existingSprint,
                active_task: plan.operations.stateUpdate.activeTask,
                recommended_model: plan.operations.stateUpdate.recommendedModel,
                status: plan.operations.stateUpdate.status,
            };

            const stateFrontmatter = yaml.stringify(frontmatter).trim();
            const sanitizedActiveTask = sanitizeBodyField(plan.operations.stateUpdate.activeTask);
            const sanitizedNextAction = sanitizeBodyField(plan.operations.stateUpdate.nextAction);

            let stateBody = `# Objetivo Atual\n${sanitizedActiveTask}\n\n`;

            stateBody += `# O que foi feito recentemente\n`;
            stateBody += finalCompleted.length > 0 ? finalCompleted.map(c => `- [x] ${c}`).join('\n') + '\n\n' : `- (Nenhum item)\n\n`;

            if (finalFacts.length > 0) {
                stateBody += `# Fatos & Descobertas\n`;
                stateBody += finalFacts.map(f => `- ${f}`).join('\n') + '\n\n';
            }

            stateBody += `# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)\n`;
            stateBody += finalHypotheses.length > 0 ? finalHypotheses.map(h => `- ${h}`).join('\n') + '\n\n' : `- (Nenhuma)\n\n`;

            stateBody += `# Próxima Ação Imediata\n${sanitizedNextAction || '(Definir próxima ação)'}\n`;

            safeWriteFileSync(statePath, `---\n${stateFrontmatter}\n---\n\n${stateBody}`, 'utf-8');
        }

        // 4. Append ao glossary.md
        if (plan.operations.appendedGlossaryTerms.length > 0) {
            const glossaryPath = path.join(contextDir, 'glossary.md');
            recordSnapshot(glossaryPath);

            let content = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf-8').trim() : '# Glossário & Contratos';
            for (const term of plan.operations.appendedGlossaryTerms) {
                const normalizedTerm = sanitizeBodyField(term.term.trim());
                const sanitizedDefinition = sanitizeBodyField(term.definition.trim());
                if (!content.toLowerCase().includes(`**${normalizedTerm.toLowerCase()}**`)) {
                    content += `\n- **${normalizedTerm}**: ${sanitizedDefinition}`;
                }
            }
            safeWriteFileSync(glossaryPath, content + '\n', 'utf-8');
        }

        // 5. Atualizar o Ledger de Histórico com Limite de Entradas
        recordSnapshot(historyFile);
        let ledger: HistoryLedger = { version: '1.0', applied_updates: [] };
        if (fs.existsSync(historyFile)) {
            try {
                ledger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch {
                ledger = { version: '1.0', applied_updates: [] };
            }
        }

        ledger.applied_updates.push({
            hash: plan.canonicalHash,
            applied_at: new Date().toISOString(),
            task: plan.operations.stateUpdate?.activeTask,
            created_adrs: plan.operations.createdAdrs.map(a => a.id),
            superseded_adrs: plan.operations.supersededAdrs.map(a => a.id),
        });

        // Limita o histórico às últimas MAX_HISTORY_ENTRIES entradas
        if (ledger.applied_updates.length > MAX_HISTORY_ENTRIES) {
            ledger.applied_updates = ledger.applied_updates.slice(-MAX_HISTORY_ENTRIES);
        }

        safeWriteFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');

    } catch (error: any) {
        // FAIL-CLOSED: Rollback Transacional Instantâneo
        rollback();
        throw new Error(`Falha transacional durante a escrita. Rollback executado com sucesso. Causa: ${error.message}`);
    } finally {
        isApplying = false;
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
        lock.release();
    }
}