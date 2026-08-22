import fs from 'node:fs';
import path from 'node:path';
import { RawUpdatePayload, MutationPlan, HistoryLedger } from './types';

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
    return `DEC-${next.toString().padStart(3, '0')}`;
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

    // 1. Verificação de Idempotência no Ledger
    let isAlreadyApplied = false;
    if (fs.existsSync(historyFile)) {
        try {
            const ledger: HistoryLedger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            if (ledger.applied_updates && ledger.applied_updates.some(entry => entry.hash === canonicalHash)) {
                isAlreadyApplied = true;
            }
        } catch {
            // Se o ledger estiver corrompido, emite warning mas não bloqueia
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

    // 2. Planejamento de Novos ADRs
    let currentNextNum = 0;
    if (payload.new_decisions && Array.isArray(payload.new_decisions)) {
        for (const d of payload.new_decisions) {
            let adrId = d.id;
            if (!adrId || adrId.toLowerCase() === 'auto') {
                if (currentNextNum === 0) {
                    const nextStr = getNextAdrId(decisionsDir);
                    currentNextNum = parseInt(nextStr.replace('DEC-', ''), 10);
                } else {
                    currentNextNum++;
                }
                adrId = `DEC-${currentNextNum.toString().padStart(3, '0')}`;
            }

            const targetPath = path.resolve(decisionsDir, `${adrId}.md`);
            if (!targetPath.startsWith(path.resolve(contextDir))) {
                throw new Error(`Violação de segurança (Path Traversal) para o ADR ${adrId}`);
            }

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

    // 3. Planejamento de ADRs Substituídos
    if (payload.superseded_decisions && Array.isArray(payload.superseded_decisions)) {
        for (const s of payload.superseded_decisions) {
            const targetPath = path.resolve(decisionsDir, `${s.id}.md`);
            if (!targetPath.startsWith(path.resolve(contextDir))) {
                throw new Error(`Violação de segurança (Path Traversal) para o ADR ${s.id}`);
            }

            let supersededBy = s.by || 'auto';
            if (supersededBy.toLowerCase() === 'auto' && plan.operations.createdAdrs.length > 0) {
                supersededBy = plan.operations.createdAdrs[0].id;
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

    // 4. Planejamento do state.md
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

    // 5. Planejamento do glossary.md
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