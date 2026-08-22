import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { MutationPlan, HistoryLedger } from './types';

function normalizeLine(line: string): string {
    return line.replace(/^[-*•]\s*/, '').trim().toLowerCase();
}

export function applyMutationPlan(cwd: string, plan: MutationPlan): void {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');
    const historyFile = path.join(contextDir, '.pactx-history.json');

    if (!fs.existsSync(decisionsDir)) {
        fs.mkdirSync(decisionsDir, { recursive: true });
    }

    // Snapshot em Memória para Rollback Transacional
    const snapshot = new Map<string, string | null>(); // path -> content (null se arquivo não existia)
    const createdFiles: string[] = [];

    const recordSnapshot = (filePath: string) => {
        if (!snapshot.has(filePath)) {
            snapshot.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null);
        }
    };

    try {
        // 1. Criar Novos ADRs com Serialização Segura
        for (const adr of plan.operations.createdAdrs) {
            recordSnapshot(adr.targetPath);
            const frontmatter = {
                spec_version: '1.0',
                id: adr.id,
                title: adr.title,
                status: 'active',
                date: adr.date,
            };

            const frontmatterYaml = yaml.stringify(frontmatter).trim();
            const body = `# Decisão\n${adr.decision}\n\n# Motivo\n${adr.reason}\n`;
            const fullContent = `---\n${frontmatterYaml}\n---\n\n${body}`;

            fs.writeFileSync(adr.targetPath, fullContent, 'utf-8');
            if (snapshot.get(adr.targetPath) === null) {
                createdFiles.push(adr.targetPath);
            }
        }

        // 2. Atualizar ADRs Substituídos
        for (const adr of plan.operations.supersededAdrs) {
            if (fs.existsSync(adr.targetPath)) {
                recordSnapshot(adr.targetPath);
                const original = fs.readFileSync(adr.targetPath, 'utf-8');

                // Parse seguro do frontmatter existente
                const match = original.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
                if (match) {
                    const data = yaml.parse(match[1]) || {};
                    data.status = 'superseded';
                    data.superseded_by = adr.supersededBy;
                    data.superseded_date = adr.date;
                    if (adr.reason) {
                        data.superseded_reason = adr.reason;
                    }

                    const newFrontmatter = yaml.stringify(data).trim();
                    const newContent = `---\n${newFrontmatter}\n---\n${match[2]}`;
                    fs.writeFileSync(adr.targetPath, newContent, 'utf-8');
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

            if (fs.existsSync(statePath)) {
                const raw = fs.readFileSync(statePath, 'utf-8');
                const lines = raw.split('\n');
                let currentSection = '';

                for (const line of lines) {
                    if (line.startsWith('# O que foi feito')) currentSection = 'completed';
                    else if (line.startsWith('# Hipóteses Descartadas')) currentSection = 'hypotheses';
                    else if (line.startsWith('# Fatos & Descobertas')) currentSection = 'facts';
                    else if (line.startsWith('# ')) currentSection = 'other';
                    else if (line.trim().startsWith('-')) {
                        const clean = line.replace(/^-\s*(\[[ x]\])?\s*/, '').trim();
                        if (clean) {
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
                    const norm = normalizeLine(item);
                    if (!result.some(e => normalizeLine(e) === norm)) {
                        result.push(item);
                    }
                }
                return result;
            };

            const finalCompleted = mergeUnique(existingCompleted, plan.operations.stateUpdate.newCompletedItems);
            const finalHypotheses = mergeUnique(existingHypotheses, plan.operations.stateUpdate.newRejectedHypotheses);
            const finalFacts = mergeUnique(existingFacts, plan.operations.stateUpdate.newFacts);

            const frontmatter = {
                spec_version: '1.0',
                sprint: 'SPRINT_CURRENT',
                active_task: plan.operations.stateUpdate.activeTask,
                recommended_model: plan.operations.stateUpdate.recommendedModel,
                status: plan.operations.stateUpdate.status,
            };

            const stateFrontmatter = yaml.stringify(frontmatter).trim();
            let stateBody = `# Objetivo Atual\n${plan.operations.stateUpdate.activeTask}\n\n`;

            stateBody += `# O que foi feito recentemente\n`;
            stateBody += finalCompleted.length > 0 ? finalCompleted.map(c => `- [x] ${c}`).join('\n') + '\n\n' : `- (Nenhum item)\n\n`;

            if (finalFacts.length > 0) {
                stateBody += `# Fatos & Descobertas\n`;
                stateBody += finalFacts.map(f => `- ${f}`).join('\n') + '\n\n';
            }

            stateBody += `# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)\n`;
            stateBody += finalHypotheses.length > 0 ? finalHypotheses.map(h => `- ${h}`).join('\n') + '\n\n' : `- (Nenhuma)\n\n`;

            stateBody += `# Próxima Ação Imediata\n${plan.operations.stateUpdate.nextAction || '(Definir próxima ação)'}\n`;

            fs.writeFileSync(statePath, `---\n${stateFrontmatter}\n---\n\n${stateBody}`, 'utf-8');
        }

        // 4. Append ao glossary.md
        if (plan.operations.appendedGlossaryTerms.length > 0) {
            const glossaryPath = path.join(contextDir, 'glossary.md');
            recordSnapshot(glossaryPath);

            let content = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf-8').trim() : '# Glossário & Contratos';
            for (const term of plan.operations.appendedGlossaryTerms) {
                if (!content.includes(`**${term.term}**`)) {
                    content += `\n- **${term.term}**: ${term.definition}`;
                }
            }
            fs.writeFileSync(glossaryPath, content + '\n', 'utf-8');
        }

        // 5. Atualizar o Ledger de Histórico
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

        fs.writeFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');

    } catch (error: any) {
        // FAIL-CLOSED: Rollback Transacional Instantâneo
        for (const [filePath, origContent] of snapshot.entries()) {
            if (origContent === null) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } else {
                fs.writeFileSync(filePath, origContent, 'utf-8');
            }
        }
        throw new Error(`Falha transacional durante a escrita. Rollback executado com sucesso. Causa: ${error.message}`);
    }
}