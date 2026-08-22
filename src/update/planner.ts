import fs from 'node:fs';
import path from 'node:path';
import { RawUpdatePayload, MutationPlan, HistoryLedger } from './types';
import { getCurrentContextRevision } from '../composer';

function getNextAdrId(decisionsDir: string): string {
    if (!fs.existsSync(decisionsDir)) return 'DEC-001';
    const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md'));
    let maxNum = 0;
    for (const f of files) {
        const match = f.match(/^DEC-(\d+)\.md$/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    if (next > 9999) {
        throw new Error('Limite de identificadores de decisão atingido (DEC-9999).');
    }
    return `DEC-${next.toString().padStart(3, '0')}`;
}

function assertInsideDirectory(parentDir: string, targetPath: string, entityName: string): void {
    const resolvedParent = path.resolve(parentDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedParent, resolvedTarget);

    if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
        throw new Error(`Violação de segurança (Path Traversal): Tentativa de acesso fora de ${parentDir} para ${entityName}`);
    }
}

export function buildMutationPlan(
    cwd: string,
    payload: RawUpdatePayload,
    canonicalHash: string,
    initialWarnings: string[] = []
): MutationPlan {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');
    const historyFile = path.join(contextDir, '.pactx-history.json');

    if (!fs.existsSync(contextDir)) {
        throw new Error('Pasta .ai-context não encontrada no projeto.');
    }

    const warnings = [...initialWarnings];

    // 1. Validação de Concorrência Otimista (base_revision vs current_revision)
    if (payload.base_revision) {
        const currentRev = getCurrentContextRevision(contextDir);
        if (payload.base_revision !== currentRev) {
            warnings.push(`Stale Context: O update foi baseado na revisão "${payload.base_revision}", mas o repositório atual está na revisão "${currentRev}".`);
        }
    }

    // 2. Verificação de Idempotência no Ledger
    let isAlreadyApplied = false;
    if (fs.existsSync(historyFile)) {
        try {
            const ledger: HistoryLedger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            if (ledger.applied_updates && ledger.applied_updates.some(entry => entry.hash === canonicalHash)) {
                isAlreadyApplied = true;
            }
        } catch {
            warnings.push('Não foi possível ler o arquivo .pactx-history.json.');
        }
    }

    const plan: MutationPlan = {
        schemaVersion: payload.version,
        baseRevision: payload.base_revision,
        canonicalHash,
        isAlreadyApplied,
        warnings,
        source: payload.source ? {
            model: payload.source.model,
            sessionTopic: payload.source.session_topic,
        } : undefined,
        operations: {
            createdAdrs: [],
            supersededAdrs: [],
            appendedGlossaryTerms: [],
        },
    };

    const today = new Date().toISOString().split('T')[0];

    // 3. Planejamento de Novos ADRs & Detecção de Colisão
    const allocatedIds = new Set<string>();
    let currentNextNum = 0;
    if (payload.new_decisions && Array.isArray(payload.new_decisions)) {
        for (const d of payload.new_decisions) {
            let adrId = d.id ? String(d.id).trim() : '';
            if (!adrId || adrId.toLowerCase() === 'auto') {
                if (currentNextNum === 0) {
                    const nextStr = getNextAdrId(decisionsDir);
                    currentNextNum = parseInt(nextStr.replace('DEC-', ''), 10);
                } else {
                    currentNextNum++;
                }
                while (
                    allocatedIds.has(`DEC-${currentNextNum.toString().padStart(3, '0')}`) ||
                    fs.existsSync(path.resolve(decisionsDir, `DEC-${currentNextNum.toString().padStart(3, '0')}.md`))
                ) {
                    currentNextNum++;
                }
                if (currentNextNum > 9999) {
                    throw new Error('Limite de identificadores de decisão atingido (DEC-9999).');
                }
                adrId = `DEC-${currentNextNum.toString().padStart(3, '0')}`;
            } else {
                if (allocatedIds.has(adrId)) {
                    throw new Error(`Conflito: A decisão ${adrId} foi declarada mais de uma vez no mesmo lote.`);
                }
                // ID explícito: verifica se já existe para evitar sobrescrita acidental
                const existingPath = path.resolve(decisionsDir, `${adrId}.md`);
                if (fs.existsSync(existingPath)) {
                    throw new Error(`Conflito: A decisão ${adrId} já existe no repositório.`);
                }
            }

            allocatedIds.add(adrId);
            const targetPath = path.resolve(decisionsDir, `${adrId}.md`);
            assertInsideDirectory(decisionsDir, targetPath, `ADR ${adrId}`);

            plan.operations.createdAdrs.push({
                id: adrId,
                targetPath,
                title: d.title || 'Decisão sem título',
                reason: d.reason || '',
                decision: d.decision || '',
                date: today,
            });
        }
    }

    // 4. Planejamento de ADRs Substituídos & Validação Semântica
    if (payload.superseded_decisions && Array.isArray(payload.superseded_decisions)) {
        for (const s of payload.superseded_decisions) {
            // Conflito Intra-Lote: Impede que um ADR seja criado e substituído no mesmo lote (P2-07)
            if (allocatedIds.has(s.id)) {
                throw new Error(`Conflito lógico: A decisão ${s.id} não pode ser criada e substituída (superseded) no mesmo lote.`);
            }

            const targetPath = path.resolve(decisionsDir, `${s.id}.md`);
            assertInsideDirectory(decisionsDir, targetPath, `ADR ${s.id}`);

            // Validação Semântica: O ADR a ser substituído PRECISA existir
            if (!fs.existsSync(targetPath)) {
                throw new Error(`Decisão para substituição não encontrada no repositório: ${s.id}`);
            }

            let supersededBy = s.by || 'auto';
            if (supersededBy.toLowerCase() === 'auto') {
                if (plan.operations.createdAdrs.length === 1) {
                    supersededBy = plan.operations.createdAdrs[0].id;
                } else if (plan.operations.createdAdrs.length > 1) {
                    throw new Error(`Ambiguidade em superseded_decisions: 'by: auto' não pode ser resolvido pois foram criados ${plan.operations.createdAdrs.length} novos ADRs neste lote. Especifique o ID explicitamente.`);
                } else {
                    throw new Error(`superseded_decisions definiu 'by: auto', mas nenhum novo ADR foi criado no lote.`);
                }
            }

            plan.operations.supersededAdrs.push({
                id: s.id,
                targetPath,
                supersededBy,
                reason: s.reason || '',
                date: today,
            });
        }
    }

    // 5. Planejamento do state.md
    if (payload.state) {
        plan.operations.stateUpdate = {
            targetPath: path.join(contextDir, 'state.md'),
            activeTask: payload.state.active_task || '',
            status: payload.state.status || 'IN_PROGRESS',
            recommendedModel: payload.state.recommended_model || 'Medium',
            newCompletedItems: payload.state.completed_items || [],
            newFacts: payload.state.new_facts || [],
            newRejectedHypotheses: payload.state.rejected_hypotheses || [],
            nextAction: payload.state.next_action || '',
        };
    }

    // 6. Planejamento do glossary.md
    if (payload.new_glossary_terms && Array.isArray(payload.new_glossary_terms)) {
        for (const g of payload.new_glossary_terms) {
            if (g.term && g.definition) {
                plan.operations.appendedGlossaryTerms.push({
                    term: g.term.trim(),
                    definition: g.definition.trim(),
                });
            }
        }
    }

    return plan;
}